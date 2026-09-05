const express = require('express');
const crypto = require('node:crypto');
const db = require('../db');
const auth = require('../auth');
const wrap = require('../wrap');
const { handlesFor } = require('../handles');
const clubs = require('../clubs');
const live = require('../live');
const { readDataUrl } = require('../image');
const throttle = require('../throttle');

/* Trocar nome, bio ou retrato. O retrato é o que pesa: até 400 KB gravados numa
   linha, e a rota aceita um novo a cada chamada. Vinte por hora é muito para
   quem está escolhendo uma foto e pouco para quem está gravando bytes. */
const throttleProfile = throttle.limit({
  name: 'profile',
  max: 20,
  windowMs: 60 * 60_000,
  message: espera => `Muitas mudanças seguidas no perfil. Tente de novo em ${espera}.`,
});

/* Dois roteadores, e a divisão é a mesma pergunta em todo lugar deste recorte:
   isto é sobre uma PESSOA ou sobre uma SALA?

   `index` é a pessoa: o próprio perfil, o próprio retrato, apagar a conta. Nada
   disso pertence a clube nenhum, e o retrato de alguém tem de carregar em toda
   sala em que ela apareça. `scoped` é a sala: quem está nela. */
const router = express.Router();
const scoped = express.Router({ mergeParams: true });

/* ── o elenco de UMA sala ─────────────────────────────────────────────────
   Isto listava a plataforma inteira, porque a plataforma inteira era um clube e
   a tela de entrada precisava dos rostos antes de alguém entrar. As duas coisas
   deixaram de valer no mesmo dia: entrar agora é pelo Google, e listar todo
   mundo que existe seria a rede entregando seus usuários a qualquer visitante.

   Então é o elenco do clube pedido, e `review_count` conta as fichas DAQUELE
   clube — a mesma pessoa tem contagens diferentes em salas diferentes, que é
   exatamente o que a decisão de a ficha ser do clube significa.

   `password_hash` e `password_salt` nunca são selecionados aqui, de propósito. */
const listStmt = db.prepare(`
  SELECT r.id, r.name, r.dot, r.is_admin, r.avatar_rev, r.bio, r.created_at,
         m.role, m.joined_at,
         (r.password_hash IS NOT NULL) AS has_password,
         COUNT(rv.id) AS review_count
  FROM club_members m
  JOIN reviewers r ON r.id = m.reviewer_id
  LEFT JOIN reviews rv ON rv.reviewer_id = r.id AND rv.club_id = m.club_id
  WHERE m.club_id = ?
  GROUP BY r.id
  ORDER BY m.joined_at ASC
`);
const deleteStmt = db.prepare('DELETE FROM reviewers WHERE id = ?');
const getStmt = db.prepare('SELECT id, name, is_admin FROM reviewers WHERE id = ?');
const renameStmt = db.prepare('UPDATE reviewers SET name = ? WHERE id = ?');
const avatarStmt = db.prepare('SELECT avatar, avatar_mime FROM reviewers WHERE id = ?');
const setAvatarStmt = db.prepare(
  'UPDATE reviewers SET avatar = ?, avatar_mime = ?, avatar_rev = ? WHERE id = ?'
);
const setBioStmt = db.prepare('UPDATE reviewers SET bio = ? WHERE id = ?');

/* ── o teto da bio ────────────────────────────────────────────────────────
   Uma linha, não um parágrafo. O perfil desenha isto embaixo do nome, numa
   coluna, e o que a pessoa tem a dizer de verdade sobre um filme tem mil
   caracteres na conversa — este espaço é para o tom de voz, não para o
   argumento. Cento e quarenta porque é o comprimento em que uma frase ainda é
   uma frase e não vira um texto que precisa de parágrafo. */
const MAX_BIO = 140;

/* The picture is a URL and not the bytes. Putting base64 in this DTO would mean
   every list of reviewers — which the sign-in screen fetches before anyone is
   even signed in — carried every portrait in the club, uncacheable, on every
   request. As a URL it is one small extra request that the browser then keeps
   forever, because `rev` changes whenever the picture does. */
const avatarUrl = row => (row.avatar_rev ? `/api/reviewers/${row.id}/avatar?v=${row.avatar_rev}` : null);

/* `handle` é o apelido de menção, e ele depende do clube inteiro: "bruno" só
   serve enquanto não houver dois. Por isso é calculado sobre a lista toda e
   entregue junto de cada pessoa, em vez de derivado do nome dela sozinha — ver
   handles.js. Um DTO de uma pessoa só não tem como saber se está sozinha com
   aquele primeiro nome, então quem lista passa o mapa pronto. */
function toDTO(row, handles) {
  return {
    id: row.id,
    name: row.name,
    dot: row.dot,
    handle: handles?.[row.id] ?? null,
    isAdmin: !!row.is_admin,
    /** ADM desta sala, que é outra coisa de `isAdmin` (a instalação inteira). */
    role: row.role ?? null,
    hasPassword: !!row.has_password,
    avatar: avatarUrl(row),
    /* Vazio e ausente são a mesma coisa aqui, e viram `null`: uma bio apagada
       grava string vazia, e o perfil que recebesse `""` teria de decidir de
       novo, na tela, se aquilo é uma linha para desenhar. */
    bio: row.bio || null,
    createdAt: row.created_at ?? null,
    /** Desde quando está NESTE clube, que é o que o perfil dentro dele mostra. */
    joinedAt: row.joined_at ?? null,
    review_count: row.review_count ?? 0,
  };
}

/* O que uma imagem enviada pode ser mora em image.js agora, porque duas coisas
   deste produto aceitam figura — o retrato de uma pessoa e a foto de um clube —
   com exatamente as mesmas regras. */

/* O elenco de um clube. Vai no roteador com escopo, sob `/api/c/<slug>/`.
   Legível por quem pode ler o clube — num clube público, isso inclui quem está
   de fora e está decidindo se pede para entrar. */
scoped.get('/', clubs.requireReadable, wrap(async (req, res) => {
  const rows = await listStmt.all(req.club.id);
  const handles = handlesFor(rows);
  res.json({ reviewers: rows.map(r => toDTO(r, handles)) });
}));

/* ── e não existe mais rota de cadastro ───────────────────────────────────
   Havia aqui um POST que criava avaliador com nome e PIN, aberto a qualquer um.
   Ele estava certo enquanto o produto era uma sala de amigos com um endereço
   que só eles conheciam: cadastrar-se era entrar na sala.

   Numa rede, um endpoint público que cria contas sem verificar e-mail nenhum é
   um cadastro sem dono. Conta agora nasce de um lugar só — a volta do Google,
   em accountForGoogle —, e entrar numa SALA é outra coisa completamente: é
   pedir, e alguém aprovar. */

/* ── your own profile, and nobody else's ──────────────────────────────────
   The name and the picture are how a person appears next to everything they
   ever said here, so the rule is the same one the reviews already follow: it
   belongs to whoever it is. The route takes no id — it edits the account the
   session is signed in as, which makes editing someone else's not something to
   forbid but something there is no way to ask for.

   The admin is deliberately not an exception. Resetting a forgotten PIN is
   letting someone back in; renaming them is speaking for them. */
router.patch('/me', auth.requireSession, throttleProfile, wrap(async (req, res) => {
  const id = req.session.reviewer_id;
  const patch = req.body || {};

  if ('name' in patch) {
    const name = String(patch.name ?? '').trim();
    if (!name) return res.status(400).json({ error: 'O nome não pode ficar vazio.' });
    if (name.length > 40) return res.status(400).json({ error: 'O nome pode ter no máximo 40 caracteres.' });
    await renameStmt.run(name, id);
  }

  if ('avatar' in patch) {
    if (patch.avatar === null) {
      await setAvatarStmt.run(null, null, null, id);
    } else {
      const read = readDataUrl(patch.avatar);
      if (read.error) return res.status(400).json({ error: read.error });
      await setAvatarStmt.run(read.data, read.mime, crypto.randomBytes(6).toString('hex'), id);
    }
  }

  /* ── a bio ──────────────────────────────────────────────────────────────
     Mesma regra do nome e do retrato, e ela é a razão de esta rota não receber
     id nenhum: escrever "sou o cara do terror" na página de outra pessoa é
     falar pela boca dela. Nem o admin — a exceção dele é deixar alguém entrar
     de volta, não dizer quem alguém é.

     Uma linha em branco apaga. `null` e `''` chegam pelo mesmo caminho porque
     do lado de lá são o mesmo gesto: limpar o campo e salvar. Gravar vazio em
     vez de `null` seria uma segunda forma de "não tem bio", e a leitura acima
     teria de conhecer as duas. */
  if ('bio' in patch) {
    const bio = patch.bio == null ? '' : String(patch.bio).trim();
    if (bio.length > MAX_BIO) {
      return res.status(400).json({ error: `A bio pode ter no máximo ${MAX_BIO} caracteres.` });
    }
    await setBioStmt.run(bio || null, id);
  }

  /* Um nome e um retrato aparecem ao lado de tudo o que a pessoa já disse aqui,
     então trocar qualquer um dos dois redesenha o produto inteiro para o resto
     do clube — não só a tela de avaliadores. */
  /* Um aviso por clube em que a pessoa está: o nome e o retrato dela aparecem
     ao lado de tudo que ela já disse em cada uma dessas salas, e o cano só
     entrega dentro da sala que ele nomeia. */
  for (const c of await clubs.mineStmt.all(id)) live.emit('reviewers', id, c.id);

  const row = await db
    .prepare('SELECT id, name, dot, is_admin, avatar_rev, bio FROM reviewers WHERE id = ?')
    .get(id);
  res.json({
    reviewer: {
      id: row.id,
      name: row.name,
      dot: row.dot,
      isAdmin: !!row.is_admin,
      avatar: avatarUrl(row),
      bio: row.bio || null,
    },
  });
}));

/* The picture itself. Readable without a session for the same reason the roster
   is: the sign-in screen shows the club before anyone has signed in.

   Immutable for a year, and truthfully so — the `rev` in the URL changes with
   every upload, so this exact URL can only ever answer with this exact image. */
router.get('/:id/avatar', wrap(async (req, res) => {
  const row = await avatarStmt.get(req.params.id);
  if (!row?.avatar) return res.status(404).end();
  const buf = Buffer.from(row.avatar, 'base64');
  res.set('Content-Type', row.avatar_mime || 'image/webp');
  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  res.send(buf);
}));

/* Being removed. Only the admin removes anyone, and the admin is not removable
   — not even by themselves.

   Deleting used to be allowed on your own account, which is friendlier and is
   also how the club could lose its only administrator with one click: the seat
   is held by a flag on a row, so deleting that row leaves nobody able to reset
   a PIN or remove anyone, and no route grants the flag back. The rule is
   enforced here rather than by hiding a button, because a button is not a
   permission — anyone can call the route directly.

   Reviews go with the account (ON DELETE CASCADE), which is why the
   confirmation in the client spells out how many. */
/* ── apagar uma CONTA ─────────────────────────────────────────────────────
   Isto é a pessoa deixando a plataforma, e não deixando um clube: sair de uma
   sala é `DELETE /api/c/<slug>/members/<id>`, e é lá que mora a regra do último
   ADM. Aqui as fichas dela vão junto em cascata, em todos os clubes de uma vez,
   e é por isso que só o administrador da instalação alcança esta rota.

   O administrador não é removível, nem por ele mesmo: a cadeira é uma coluna
   numa linha, e apagar a linha deixaria a instalação sem ninguém que possa
   fazer isto — sem rota que devolva a coluna. */
router.delete('/:id', auth.requireAdmin, wrap(async (req, res) => {
  const target = await getStmt.get(req.params.id);
  if (!target) return res.status(404).json({ error: 'Conta não encontrada.' });
  if (target.is_admin) {
    return res.status(403).json({ error: 'O administrador não pode ser removido.' });
  }

  // Em quais salas ela estava, antes de as linhas sumirem em cascata.
  const was = await clubs.mineStmt.all(target.id);

  await auth.destroyAllSessions(target.id);
  await deleteStmt.run(target.id);
  /* As avaliações vão junto (ON DELETE CASCADE), e com elas as conversas
     penduradas nelas. Três coleções mudaram, em cada sala em que ela estava. */
  for (const c of was) {
    live.emit('reviewers', req.session.reviewer_id, c.id);
    live.emit('reviews', req.session.reviewer_id, c.id);
    live.emit('social', req.session.reviewer_id, c.id);
  }
  res.status(204).end();
}));

module.exports = { index: router, scoped };
