const db = require('./db');

/* ══════════════════════════════════════════════════════════════════════════
   De qual clube é este pedido: `/api/c/<slug>/...`.

   Na SESSÃO seria mais barato, e quebra duas coisas: o endereço de uma ficha
   deixaria de ser um endereço (o mesmo link significaria coisas diferentes
   conforme a sala em que o leitor está por acaso), e a mesma pessoa não poderia
   ter dois clubes abertos em duas abas.

   Num CABEÇALHO seria invisível e morre num detalhe: `EventSource` não manda
   cabeçalho nenhum, e a sala ao vivo e o cano de avisos são justamente as duas
   coisas mais importantes de separar por clube.

   NÃO passam por aqui: `/api/auth` (quem é você não depende de sala),
   `/api/catalog` (o TMDB é o mesmo mundo para todos), `/api/clubs` (a lista de
   salas não pode exigir estar dentro de uma) e o retrato de uma pessoa.
   ══════════════════════════════════════════════════════════════════════════ */

const bySlug = db.prepare('SELECT * FROM clubs WHERE slug = ?');
const byId = db.prepare('SELECT * FROM clubs WHERE id = ?');
const membership = db.prepare(
  'SELECT role FROM club_members WHERE club_id = ? AND reviewer_id = ?'
);

/* Aceita o slug ou o id: o slug é o que a URL carrega, o id é o que o cliente
   usa logo depois de criar um clube. Não colidem — um id é `c` mais um UUID. */
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
      /* A política de leitura de um clube fechado. Num clube aberto elas ficam
         dormentes — lá tudo é legível de qualquer jeito. */
      showReviews: !!club.show_reviews,
      showComments: !!club.show_comments,
    };
    next();
  } catch (e) {
    next(e);
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   As duas camadas de "ver".

   Elas são coisas diferentes e é a confusão entre as duas que faz um produto
   assim ficar errado:

   **A FACHADA** — nome, foto, descrição, quantas pessoas. Isso é de todo mundo,
   inclusive de um clube fechado. Uma sala que ninguém consegue enxergar é uma
   sala em que ninguém consegue pedir para entrar, e um clube fechado quer ser
   achado; o que ele não quer é ser lido.

   **O CONTEÚDO** — fichas, mural, conversa, fila, elenco. Isso é de quem é da
   sala, a não ser que a sala seja aberta.

   ── e por que 403 e não 404 ───────────────────────────────────────────────
   Houve uma versão disto em que clube fechado respondia 404 para não confirmar
   que existia. Isso deixou de fazer sentido no instante em que ele passou a
   aparecer na vitrine com nome e foto: esconder pela rota o que a tela lista é
   uma mentira que só engana quem escreveu o código. 403 é a resposta honesta, e
   ela diz o que fazer.
   ══════════════════════════════════════════════════════════════════════════ */

/** A fachada. Todo clube tem uma, e ela é de todo mundo. */
function requireVisible(_req, _res, next) {
  next();
}

/* ── o conteúdo, e ele não é uma coisa só ─────────────────────────────────
   Um clube fechado tem uma política de leitura: o ADM decide, em dois
   interruptores, se um estranho vê as avaliações, os comentários, os dois ou
   nenhum. Com os dois ligados o clube fica fechado apenas na porta.

   `o quê` é 'reviews', 'comments', ou 'any'. O último é para o que não é nem uma
   coisa nem outra — a fila e o elenco — e ele segue o interruptor mais
   permissivo: quem pode ler o que o clube escreveu pode saber quem escreveu e o
   que ele pretende assistir. Esconder o elenco enquanto se mostram as
   avaliações assinadas por ele seria uma regra que a própria tela desmente.

   A sala de projeção não passa por aqui em caso nenhum: assistir junto é de
   dentro, e o painel dela diz quem está na sala AGORA — informação sobre
   pessoas, não sobre filmes. */
function canRead(what) {
  return function readable(req, res, next) {
    if (req.club.isMember || req.club.visibility === 'public') return next();

    const liberado =
      what === 'reviews'
        ? req.club.showReviews
        : what === 'comments'
          ? req.club.showComments
          : req.club.showReviews || req.club.showComments;

    if (liberado) return next();
    res.status(403).json({
      error: 'Este clube é fechado. Peça para entrar para ver o que tem dentro.',
    });
  };
}

/** O que não é avaliação nem comentário: a fila, o elenco, a fachada de dentro. */
const requireReadable = canRead('any');

/* Escrever é de quem é do clube, sempre — e a diferença entre aberto e fechado
   nunca é essa: é só como se entra. Num clube aberto, entrar é um clique; num
   fechado, é um pedido que alguém aprova. Depois de dentro, os dois são iguais. */
function requireMember(req, res, next) {
  if (!req.session) return res.status(401).json({ error: 'Entre para continuar.' });
  if (req.club.isMember) return next();
  res.status(403).json({
    error:
      req.club.visibility === 'public'
        ? 'Entre no clube para fazer isso.'
        : 'Este clube é fechado. Peça para entrar.',
  });
}

/* ── mandar ───────────────────────────────────────────────────────────────
   O ADM do clube, e o administrador da instalação como exceção deliberada: ele
   é quem sobra quando um clube fica sem ADM nenhum — alguém saiu, alguém foi
   removido — e sem essa porta a sala ficaria trancada para sempre com as fichas
   de todo mundo dentro. */
function requireClubAdmin(req, res, next) {
  if (!req.session) return res.status(401).json({ error: 'Entre para continuar.' });
  if (req.club.isClubAdmin || req.session.is_admin) return next();
  res.status(403).json({ error: 'Só quem administra o clube pode fazer isso.' });
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

/* Em quais clubes esta pessoa está.

   Com o tamanho de cada um: o painel do saguão dizia quantas pessoas havia nas
   salas da vitrine e nada nas suas — a contagem vinha do GROUP BY da outra
   consulta, e o chaveiro não tinha nenhum. Ficava um cartão mudo do lado de um
   cartão informado, sobre a sala que a pessoa conhece melhor. */
const mineStmt = db.prepare(`
  SELECT c.*, m.role, m.joined_at,
         (SELECT COUNT(*) FROM club_members x WHERE x.club_id = c.id) AS members
  FROM club_members m
  JOIN clubs c ON c.id = m.club_id
  WHERE m.reviewer_id = ?
  ORDER BY m.joined_at ASC
`);

module.exports = {
  findClub,
  resolve,
  requireVisible,
  canRead,
  requireReadable,
  requireMember,
  requireClubAdmin,
  roster,
  mineStmt,
  membership,
};
