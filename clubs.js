const db = require('./db');

/* ══════════════════════════════════════════════════════════════════════════
   De qual clube é este pedido.

   ── por que o clube mora na URL ────────────────────────────────────────────
   Havia três lugares possíveis e dois deles estão errados.

   Na SESSÃO seria o mais barato de escrever: uma coluna, e toda rota já saberia
   sem mudar de assinatura. Mas aí o endereço de uma ficha deixa de ser um
   endereço — `#reviews/r1a2b3` passa a significar coisas diferentes conforme o
   clube em que o leitor está por acaso, e este produto tem como hábito colar
   link de ficha no Discord. Também impediria duas abas em dois clubes.

   Num CABEÇALHO seria invisível e limpo, e morre num detalhe: `EventSource` não
   manda cabeçalho nenhum. A sala ao vivo e o cano de avisos são as duas coisas
   mais importantes para separar por clube, e são exatamente as duas que um
   cabeçalho não alcança.

   Sobra a URL, que é onde ele devia estar desde o começo: `/api/c/<slug>/...`.
   O endereço diz de que sala ele fala, o SSE funciona, e a mesma pessoa pode ter
   dois clubes abertos em duas abas.

   ── o que NÃO passa por aqui ──────────────────────────────────────────────
   `/api/auth` (quem é você não depende de sala), `/api/catalog` (o TMDB é o
   mesmo mundo para todo mundo), `/api/clubs` (a lista de salas não pode exigir
   estar dentro de uma) e o retrato de uma pessoa, que é dela e não do clube.
   ══════════════════════════════════════════════════════════════════════════ */

const bySlug = db.prepare('SELECT * FROM clubs WHERE slug = ?');
const byId = db.prepare('SELECT * FROM clubs WHERE id = ?');
const membership = db.prepare(
  'SELECT role FROM club_members WHERE club_id = ? AND reviewer_id = ?'
);

/* Aceita o slug ou o id. O slug é o que a URL carrega e o que a pessoa vê; o id
   é o que o próprio cliente usa logo depois de criar um clube, antes de ter
   recarregado qualquer coisa. Os dois são únicos e não colidem — um id começa
   com `c` seguido de um UUID, e um slug com esse formato exigiria alguém
   nomear um clube exatamente assim. */
async function findClub(key) {
  if (!key) return null;
  return (await bySlug.get(key)) || (await byId.get(key)) || null;
}

/* Resolve o clube e o papel de quem está pedindo. Não recusa nada sozinho: quem
   decide o que cada rota exige são as guardas abaixo, e algumas leituras são
   legítimas para quem está de fora. */
async function resolve(req, res, next) {
  try {
    const club = await findClub(req.params.club);
    if (!club) return res.status(404).json({ error: 'Clube não encontrado.' });

    const mine = req.session
      ? await membership.get(club.id, req.session.reviewer_id)
      : null;

    req.club = {
      id: club.id,
      name: club.name,
      slug: club.slug,
      visibility: club.visibility,
      createdBy: club.created_by,
      /* 'admin' | 'member' | null. Null é "não sou daqui", e é um estado
         normal: é o que todo visitante de um clube público tem. */
      role: mine?.role || null,
      isMember: !!mine,
      isClubAdmin: mine?.role === 'admin',
    };
    next();
  } catch (e) {
    next(e);
  }
}

/* ── ler ──────────────────────────────────────────────────────────────────
   Clube público é lido por qualquer um, inclusive deslogado — é isso que
   alimenta a vitrine e é a versão por clube do "leitura é aberta" que este
   produto sempre teve. Clube privado responde 404, e não 403, de propósito: um
   403 confirma que o clube existe, e a existência de um clube privado é
   exatamente a informação que ele não quer dar. */
function requireReadable(req, res, next) {
  if (req.club.isMember || req.club.visibility === 'public') return next();
  res.status(404).json({ error: 'Clube não encontrado.' });
}

/** Escrever é de quem é do clube. Sempre. */
function requireMember(req, res, next) {
  if (!req.session) return res.status(401).json({ error: 'Entre para continuar.' });
  if (req.club.isMember) return next();
  if (req.club.visibility === 'public') {
    return res.status(403).json({ error: 'Você precisa entrar no clube para fazer isso.' });
  }
  res.status(404).json({ error: 'Clube não encontrado.' });
}

/* ── mandar ───────────────────────────────────────────────────────────────
   O ADM do clube, e o administrador da instalação como exceção deliberada: ele
   é quem sobra quando um clube fica sem ADM nenhum — alguém saiu, alguém foi
   removido — e sem essa porta a sala ficaria trancada para sempre com as fichas
   de todo mundo dentro. */
function requireClubAdmin(req, res, next) {
  if (!req.session) return res.status(401).json({ error: 'Entre para continuar.' });
  if (req.club.isClubAdmin || req.session.is_admin) return next();
  if (req.club.isMember || req.club.visibility === 'public') {
    return res.status(403).json({ error: 'Só quem administra o clube pode fazer isso.' });
  }
  res.status(404).json({ error: 'Clube não encontrado.' });
}

/** Os membros de um clube, na ordem em que entraram. Usado pelo apelido também. */
const rosterStmt = db.prepare(`
  SELECT r.id, r.name, r.dot, r.is_admin, r.avatar_rev, r.bio, r.created_at,
         m.role, m.joined_at
  FROM club_members m
  JOIN reviewers r ON r.id = m.reviewer_id
  WHERE m.club_id = ?
  ORDER BY m.joined_at ASC
`);

const roster = clubId => rosterStmt.all(clubId);

/** Em quais clubes esta pessoa está. */
const mineStmt = db.prepare(`
  SELECT c.*, m.role, m.joined_at
  FROM club_members m
  JOIN clubs c ON c.id = m.club_id
  WHERE m.reviewer_id = ?
  ORDER BY m.joined_at ASC
`);

module.exports = {
  findClub,
  resolve,
  requireReadable,
  requireMember,
  requireClubAdmin,
  roster,
  mineStmt,
  membership,
};
