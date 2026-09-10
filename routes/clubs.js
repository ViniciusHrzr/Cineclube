const crypto = require('node:crypto');
const express = require('express');
const db = require('../db');
const auth = require('../auth');
const clubs = require('../clubs');
const throttle = require('../throttle');
const live = require('../live');
const wrap = require('../wrap');
const { readDataUrl } = require('../image');

/* Duas metades. `index` é sobre o conjunto — quais existem, e criar mais um —
   e é a única coisa da rede que se lê sem estar dentro de sala nenhuma.
   `scoped` é sobre UM clube, atrás de `clubs.resolve`. */

const index = express.Router();
const scoped = express.Router({ mergeParams: true });

/* O nome é o recurso escasso: mil clubes criados por um programa não enchem o
   banco — eles tomam mil nomes e enchem a vitrine, que é a primeira tela do
   produto.

   Cinco por dia por conta: ninguém convida cinco grupos de amigos por dia.
   Junto com a trava de cadastro, que impede alguém de trocar de conta, isto
   fecha a torneira. */
const throttleFound = throttle.limit({
  name: 'club:create',
  max: 5,
  windowMs: 24 * 60 * 60_000,
  message: espera => `Muitos clubes fundados hoje. Tente de novo em ${espera}.`,
});

/* Trocar a foto de um clube é gravar até 400 KB. Vinte por hora é mais do que
   qualquer pessoa escolhendo um cartaz, e é um teto para quem só quer escrever. */
const throttleClubEdit = throttle.limit({
  name: 'club:edit',
  max: 20,
  windowMs: 60 * 60_000,
  message: espera => `Muitas mudanças seguidas na sala. Tente de novo em ${espera}.`,
});

const MAX_NAME = 40;
/* Uma linha sobre o clube, do mesmo tamanho da bio de uma pessoa e pelo mesmo
   motivo: é tom de voz, não manifesto. */
const MAX_TAGLINE = 140;

const photoUrl = c => (c.photo_rev ? `/api/c/${c.slug}/photo?v=${c.photo_rev}` : null);

function toDTO(row, extra = {}) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    tagline: row.tagline || null,
    visibility: row.visibility,
    /* Vai sempre, inclusive num clube aberto, onde está dormente: a folha de
       ajustes precisa saber o que mostrar marcado se o ADM fechar a sala. */
    showReviews: !!row.show_reviews,
    showComments: !!row.show_comments,
    photo: photoUrl(row),
    createdAt: row.created_at ?? null,
    ...extra,
  };
}

/* Duas listas numa resposta, porque a tela é uma só e elas respondem perguntas
   diferentes: `mine` é o chaveiro de quem já chegou, `open` a vitrine de quem
   está olhando. Um clube em que você já está não aparece na vitrine.

   A vitrine lista TODOS, aberto e fechado: uma sala que ninguém enxerga é uma
   sala em que ninguém consegue pedir para entrar. O que a fachada carrega é
   nome, foto, descrição e quantas pessoas; o acervo fica atrás da porta. */
index.get('/', wrap(async (req, res) => {
  const me = req.session?.reviewer_id || null;

  const mine = me ? await clubs.mineStmt.all(me) : [];
  const held = new Set(mine.map(c => c.id));

  const open = await db.prepare(`
    SELECT c.*, COUNT(m.reviewer_id) AS members
    FROM clubs c
    LEFT JOIN club_members m ON m.club_id = c.id
    GROUP BY c.id
    ORDER BY c.created_at ASC
  `).all();

  /* É o que separa "Pedir para entrar" de "Pedido enviado" na vitrine: sem
     isto a tela ofereceria de novo o botão que a pessoa acabou de apertar. */
  const asked = me
    ? (await db.prepare('SELECT club_id FROM club_join_requests WHERE reviewer_id = ?').all(me))
        .map(r => r.club_id)
    : [];
  const pending = new Set(asked);

  res.json({
    mine: mine.map(c =>
      toDTO(c, { role: c.role, isMember: true, members: Number(c.members) || 0 })
    ),
    open: open
      .filter(c => !held.has(c.id))
      .map(c => toDTO(c, { members: Number(c.members) || 0, requested: pending.has(c.id) })),
  });
}));

/* Quem cria é ADM, e isso não é opção em lugar nenhum da interface: uma sala sem
   ninguém que possa aprovar uma entrada nasce trancada.

   Nasce aberto quando não se diz nada. As duas aparecem na vitrine; o que muda
   é a porta — num clube aberto entrar é um clique, num fechado é um pedido. */
index.post('/', auth.requireSession, throttleFound, wrap(async (req, res) => {
  /* ── fundar exige um endereço provado ───────────────────────────────────
     Não é sobre o clube, é sobre o custo de criar identidades: um clube toma um
     nome único e uma vaga na vitrine, e uma conta custa uma requisição.
     Exigindo confirmação, cada sala fundada passa a exigir uma caixa de entrada
     de verdade. Avaliar, comentar e entrar num clube continuam livres — a regra
     encarece FUNDAR, não participar.

     Uma conta do Google já chega verificada, então isto não pede nada de quem
     entrou pela porta normal.

     A conta SEM e-mail nenhum passa: ela existe porque `accountForGoogle` grava
     nulo quando o endereço já é de outra conta, e essa pessoa não tem o que
     confirmar — a regra aplicada a ela não pede uma prova, tranca uma porta
     para sempre. Não abre nada: uma conta do Google já custou uma conta do
     Google, e quem é medido aqui é quem se cadastrou por senha. */
  if (req.session.email && !req.session.email_verified) {
    return res.status(403).json({
      error: 'Confirme seu e-mail para fundar um clube. O link está na sua caixa de entrada.',
      needsVerifiedEmail: true,
    });
  }

  const name = String(req.body?.name || '').trim();
  const tagline = String(req.body?.tagline || '').trim();
  /* Aberto quando não se diz nada: `public` deixou de significar "qualquer um
     lê" e passou a significar "qualquer um entra e avalia", que é o que faz uma
     rede crescer. Quem quer uma sala de amigos marca fechado, e o formulário
     mostra as duas com o que cada uma quer dizer. */
  const visibility = req.body?.visibility === 'private' ? 'private' : 'public';

  if (!name) return res.status(400).json({ error: 'O clube precisa de um nome.' });
  if (name.length > MAX_NAME) {
    return res.status(400).json({ error: `O nome pode ter no máximo ${MAX_NAME} caracteres.` });
  }
  if (tagline.length > MAX_TAGLINE) {
    return res.status(400).json({ error: `A descrição pode ter no máximo ${MAX_TAGLINE} caracteres.` });
  }

  const taken = await db.prepare('SELECT id FROM clubs WHERE name = ? COLLATE NOCASE').get(name);
  if (taken) return res.status(409).json({ error: 'Já existe um clube com esse nome.' });

  let photo = null;
  if (req.body?.photo) {
    photo = readDataUrl(req.body.photo);
    if (photo.error) return res.status(400).json({ error: photo.error });
  }

  const id = 'c' + crypto.randomUUID();
  const slug = await db.freeSlug(name);
  await db.prepare(
    `INSERT INTO clubs (id, name, slug, tagline, visibility, created_by, photo, photo_mime, photo_rev)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id, name, slug, tagline || null, visibility, req.session.reviewer_id,
    photo?.data ?? null, photo?.mime ?? null, photo ? crypto.randomUUID().slice(0, 8) : null
  );
  await db.prepare(
    `INSERT INTO club_members (club_id, reviewer_id, role) VALUES (?, ?, 'admin')`
  ).run(id, req.session.reviewer_id);

  const row = await db.prepare('SELECT * FROM clubs WHERE id = ?').get(id);
  res.status(201).json({ club: toDTO(row, { role: 'admin', isMember: true }) });
}));

/* ══════════════════════════════════════════════════════════════════════════
   Um clube. Tudo abaixo já passou por clubs.resolve, então req.club existe.
   ══════════════════════════════════════════════════════════════════════════ */

/* A fachada: de todo mundo, inclusive de um clube fechado. É o que a vitrine
   desenha e o que um link colado no Discord tem de mostrar a quem não é de lá. */
scoped.get('/', clubs.requireVisible, wrap(async (req, res) => {
  const row = await db.prepare('SELECT * FROM clubs WHERE id = ?').get(req.club.id);
  const { n } = await db
    .prepare('SELECT COUNT(*) AS n FROM club_members WHERE club_id = ?').get(req.club.id);
  const asked = req.session
    ? await db.prepare('SELECT 1 AS x FROM club_join_requests WHERE club_id = ? AND reviewer_id = ?')
        .get(req.club.id, req.session.reviewer_id)
    : null;

  /* Só para quem pode abrir a porta, e junto do clube em vez de numa busca
     própria porque a marquise precisa dele em toda tela — é o que faz um pedido
     se anunciar em vez de esperar alguém ir procurá-lo. */
  const pending =
    req.club.isClubAdmin || req.session?.is_admin
      ? (await db
          .prepare('SELECT COUNT(*) AS n FROM club_join_requests WHERE club_id = ?')
          .get(req.club.id)).n
      : 0;

  res.json({
    club: toDTO(row, {
      members: n,
      role: req.club.role,
      isMember: req.club.isMember,
      /* Quem fundou. É a única pessoa que pode encerrar o clube, e a única que
         não pode deixar de administrá-lo — ver as regras lá embaixo. */
      isCreator: !!req.session && row.created_by === req.session.reviewer_id,
      requested: !!asked,
      pending: Number(pending) || 0,
    }),
  });
}));

/* A foto, como bytes e com cache eterno — o `?v=` muda quando ela muda, que é o
   que torna o "para sempre" seguro. Mesma mecânica do retrato de uma pessoa. */
scoped.get('/photo', clubs.requireVisible, wrap(async (req, res) => {
  const row = await db.prepare('SELECT photo, photo_mime FROM clubs WHERE id = ?').get(req.club.id);
  if (!row?.photo) return res.status(404).json({ error: 'Este clube não tem foto.' });
  res.setHeader('Content-Type', row.photo_mime || 'image/webp');
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.end(Buffer.from(row.photo, 'base64'));
}));

scoped.patch('/', clubs.requireClubAdmin, throttleClubEdit, wrap(async (req, res) => {
  const patch = req.body || {};

  if ('name' in patch) {
    const name = String(patch.name ?? '').trim();
    if (!name) return res.status(400).json({ error: 'O nome não pode ficar vazio.' });
    if (name.length > MAX_NAME) {
      return res.status(400).json({ error: `O nome pode ter no máximo ${MAX_NAME} caracteres.` });
    }
    const taken = await db
      .prepare('SELECT id FROM clubs WHERE name = ? COLLATE NOCASE AND id <> ?')
      .get(name, req.club.id);
    if (taken) return res.status(409).json({ error: 'Já existe um clube com esse nome.' });
    /* O slug acompanha o nome, e o antigo deixa de funcionar. É o preço de o
       endereço ser legível; renomear um clube é raro. */
    const slug = await db.freeSlug(name, req.club.id);
    await db.prepare('UPDATE clubs SET name = ?, slug = ? WHERE id = ?').run(name, slug, req.club.id);
  }

  if ('tagline' in patch) {
    const line = String(patch.tagline ?? '').trim();
    if (line.length > MAX_TAGLINE) {
      return res.status(400).json({ error: `A descrição pode ter no máximo ${MAX_TAGLINE} caracteres.` });
    }
    await db.prepare('UPDATE clubs SET tagline = ? WHERE id = ?').run(line || null, req.club.id);
  }

  if ('visibility' in patch) {
    const v = patch.visibility === 'public' ? 'public' : 'private';
    await db.prepare('UPDATE clubs SET visibility = ? WHERE id = ?').run(v, req.club.id);
    /* Abrir a sala admite quem estava esperando: entrar virou um clique, e
       deixá-los na fila seria fazê-los apertar um botão para conseguir o que já
       lhes foi concedido. Fechar não mexe em nada — numa sala aberta ninguém
       cria pedido. */
    if (v === 'public') {
      const esperando = await db
        .prepare('SELECT reviewer_id FROM club_join_requests WHERE club_id = ?')
        .all(req.club.id);
      if (esperando.length) {
        await db.batch(esperando.map(r => ({
          sql: 'INSERT INTO club_members (club_id, reviewer_id) VALUES (?, ?) ON CONFLICT DO NOTHING',
          args: [req.club.id, r.reviewer_id],
        })));
        await db.prepare('DELETE FROM club_join_requests WHERE club_id = ?').run(req.club.id);
      }
    }
  }

  /* Gravados sempre, mesmo com o clube aberto, onde não fazem diferença: assim
     a política sobrevive a um período de porta aberta, e fechar de novo devolve
     o que o ADM tinha escolhido em vez de zerar em silêncio. */
  for (const [campo, coluna] of [
    ['showReviews', 'show_reviews'],
    ['showComments', 'show_comments'],
  ]) {
    if (campo in patch) {
      await db.prepare(`UPDATE clubs SET ${coluna} = ? WHERE id = ?`)
        .run(patch[campo] ? 1 : 0, req.club.id);
    }
  }

  if ('photo' in patch) {
    if (patch.photo === null) {
      await db.prepare('UPDATE clubs SET photo = NULL, photo_mime = NULL, photo_rev = NULL WHERE id = ?')
        .run(req.club.id);
    } else {
      const img = readDataUrl(patch.photo);
      if (img.error) return res.status(400).json({ error: img.error });
      await db.prepare('UPDATE clubs SET photo = ?, photo_mime = ?, photo_rev = ? WHERE id = ?')
        .run(img.data, img.mime, crypto.randomUUID().slice(0, 8), req.club.id);
    }
  }

  const row = await db.prepare('SELECT * FROM clubs WHERE id = ?').get(req.club.id);
  live.emit('club', req.session.reviewer_id, req.club.id);
  res.json({
    club: toDTO(row, {
      role: req.club.role,
      isMember: true,
      isCreator: row.created_by === req.session.reviewer_id,
    }),
  });
}));

/* ══════════════════════════════════════════════════════════════════════════
   ENCERRAR O CLUBE — a única coisa verdadeiramente destrutiva deste produto, e
   a única reservada a quem fundou. Não ao ADM: ADMs podem ser vários e são
   promovidos por outro ADM, e "quem administra hoje" é um cargo, não um dono.

   Sai junto, em cascata: as fichas de todo mundo, a conversa em cima delas, os
   votos, as curtidas, a fila e a lista de quem estava dentro. Por isso a tela
   exige escrever o nome do clube antes.

   O clube fundador não casa com a condição abaixo — foi criado pela migração,
   sem `created_by` —, então não pode ser apagado por rota nenhuma. É a
   propriedade certa para a sala que guarda o histórico de antes da rede.
   ══════════════════════════════════════════════════════════════════════════ */
scoped.delete('/', auth.requireSession, wrap(async (req, res) => {
  const row = await db.prepare('SELECT * FROM clubs WHERE id = ?').get(req.club.id);
  if (!row.created_by || row.created_by !== req.session.reviewer_id) {
    return res.status(403).json({ error: 'Só quem fundou o clube pode encerrá-lo.' });
  }

  /* Antes de apagar: os quadros ainda alcançam quem está com a aba aberta, e a
     tela deles descobre que a sala acabou em vez de esbarrar num 404. */
  live.emit('club', req.session.reviewer_id, req.club.id);

  await db.prepare('DELETE FROM clubs WHERE id = ?').run(req.club.id);
  res.status(204).end();
}));

/* Conteúdo, e não fachada: a fachada diz QUANTAS pessoas, o que ajuda a decidir
   se vale pedir para entrar. Quem são elas é coisa de dentro. */
scoped.get('/members', clubs.requireReadable, wrap(async (req, res) => {
  const rows = await clubs.roster(req.club.id);
  res.json({
    members: rows.map(r => ({
      id: r.id,
      name: r.name,
      dot: r.dot,
      role: r.role,
      avatar: r.avatar_rev ? `/api/reviewers/${r.id}/avatar?v=${r.avatar_rev}` : null,
      joinedAt: r.joined_at,
    })),
  });
}));

/* Sair, ou tirar alguém: a mesma linha apagada, e o que muda é quem tem
   direito — a sua é sua, a dos outros é do ADM.

   O último ADM não sai. Não é proteção do cargo, é da sala: sem ADM ninguém
   aprova entrada nem muda nada, e as fichas de todo mundo ficam trancadas. */
scoped.delete('/members/:id', auth.requireSession, wrap(async (req, res) => {
  const target = req.params.id;
  const me = req.session.reviewer_id;
  const isSelf = target === me;

  if (!isSelf && !req.club.isClubAdmin && !req.session.is_admin) {
    return res.status(403).json({ error: 'Só quem administra o clube pode tirar alguém.' });
  }

  /* ── quem fundou não sai ───────────────────────────────────────────────
     Nem sozinho, nem tirado por outro ADM. Não é o cargo sendo protegido, é a
     sala: um clube cujo dono some continua existindo com o acervo de todo mundo
     dentro e sem ninguém que possa encerrá-lo. A saída existe e é outra —
     encerrar o clube. */
  if (req.club.createdBy && target === req.club.createdBy) {
    return res.status(409).json({
      error: isSelf
        ? 'Você fundou este clube, então administra ele enquanto ele existir. Para sair de vez, encerre o clube.'
        : 'Quem fundou o clube não pode ser tirado dele.',
    });
  }

  const held = await clubs.membership.get(req.club.id, target);
  if (!held) return res.status(404).json({ error: 'Essa pessoa não está no clube.' });

  if (held.role === 'admin') {
    const { n } = await db
      .prepare(`SELECT COUNT(*) AS n FROM club_members WHERE club_id = ? AND role = 'admin'`)
      .get(req.club.id);
    if (n <= 1) {
      return res.status(409).json({
        error: isSelf
          ? 'Você é o único ADM. Promova outra pessoa antes de sair.'
          : 'Este é o único ADM do clube.',
      });
    }
  }

  await db.prepare('DELETE FROM club_members WHERE club_id = ? AND reviewer_id = ?')
    .run(req.club.id, target);
  live.emit('club', me, req.club.id);
  res.status(204).end();
}));

/** Promover ou rebaixar. Só ADM, e ninguém se rebaixa sozinho até o clube ficar sem. */
scoped.patch('/members/:id', clubs.requireClubAdmin, wrap(async (req, res) => {
  const role = req.body?.role === 'admin' ? 'admin' : 'member';
  const target = req.params.id;
  const held = await clubs.membership.get(req.club.id, target);
  if (!held) return res.status(404).json({ error: 'Essa pessoa não está no clube.' });

  // Quem fundou administra enquanto o clube existir. Ver a saída, logo abaixo.
  if (req.club.createdBy && target === req.club.createdBy && role !== 'admin') {
    return res.status(409).json({ error: 'Quem fundou o clube não deixa de administrá-lo.' });
  }

  if (held.role === 'admin' && role === 'member') {
    const { n } = await db
      .prepare(`SELECT COUNT(*) AS n FROM club_members WHERE club_id = ? AND role = 'admin'`)
      .get(req.club.id);
    if (n <= 1) return res.status(409).json({ error: 'O clube ficaria sem nenhum ADM.' });
  }

  await db.prepare('UPDATE club_members SET role = ? WHERE club_id = ? AND reviewer_id = ?')
    .run(role, req.club.id, target);
  live.emit('club', req.session.reviewer_id, req.club.id);
  res.json({ ok: true, role });
}));

/* ══════════════════════════════════════════════════════════════════════════
   A porta: uma rota, dois comportamentos, e a visibilidade do clube decide.

   **Aberto** — entra na hora e já pode avaliar. A consequência é assumida: quem
   abre uma sala está dizendo que aceita quem chegar.

   **Fechado** — vira um pedido, e um ADM decide. A sala aparece na vitrine com
   nome e foto justamente para que este pedido seja possível.

   Sem corpo e sem mensagem nos dois casos: um pedido é um nome numa lista, e a
   conversa sobre por que você quer entrar acontece onde as pessoas já se falam.
   ══════════════════════════════════════════════════════════════════════════ */
scoped.post('/join', auth.requireSession, wrap(async (req, res) => {
  if (req.club.isMember) return res.status(409).json({ error: 'Você já está neste clube.' });

  if (req.club.visibility === 'public') {
    await db.prepare(
      'INSERT INTO club_members (club_id, reviewer_id) VALUES (?, ?) ON CONFLICT DO NOTHING'
    ).run(req.club.id, req.session.reviewer_id);
    /* Um pedido antigo, de quando a sala ainda era fechada, deixa de fazer
       sentido no instante em que a pessoa está dentro. */
    await db.prepare('DELETE FROM club_join_requests WHERE club_id = ? AND reviewer_id = ?')
      .run(req.club.id, req.session.reviewer_id);
    live.emit('club', req.session.reviewer_id, req.club.id);
    return res.status(201).json({ joined: true });
  }

  await db.prepare(
    'INSERT INTO club_join_requests (club_id, reviewer_id) VALUES (?, ?) ON CONFLICT DO NOTHING'
  ).run(req.club.id, req.session.reviewer_id);
  live.emit('club', req.session.reviewer_id, req.club.id);
  res.status(201).json({ requested: true });
}));

/** Desistir do próprio pedido. */
scoped.delete('/join', auth.requireSession, wrap(async (req, res) => {
  await db.prepare('DELETE FROM club_join_requests WHERE club_id = ? AND reviewer_id = ?')
    .run(req.club.id, req.session.reviewer_id);
  res.status(204).end();
}));

scoped.get('/requests', clubs.requireClubAdmin, wrap(async (req, res) => {
  const rows = await db.prepare(`
    SELECT r.id, r.name, r.dot, r.avatar_rev, q.created_at
    FROM club_join_requests q
    JOIN reviewers r ON r.id = q.reviewer_id
    WHERE q.club_id = ?
    ORDER BY q.created_at ASC
  `).all(req.club.id);
  res.json({
    requests: rows.map(r => ({
      id: r.id,
      name: r.name,
      dot: r.dot,
      avatar: r.avatar_rev ? `/api/reviewers/${r.id}/avatar?v=${r.avatar_rev}` : null,
      createdAt: r.created_at,
    })),
  });
}));

/* Aprovar move a linha de uma tabela para a outra; recusar só apaga. Não existe
   coluna de estado, de propósito: quem responde "esta pessoa está dentro?" é
   club_members, e uma segunda tabela com um 'aprovado' seria uma segunda
   resposta livre para discordar da primeira. */
scoped.post('/requests/:id', clubs.requireClubAdmin, wrap(async (req, res) => {
  const target = req.params.id;
  const approve = req.body?.approve !== false;

  const asked = await db
    .prepare('SELECT 1 AS x FROM club_join_requests WHERE club_id = ? AND reviewer_id = ?')
    .get(req.club.id, target);
  if (!asked) return res.status(404).json({ error: 'Esse pedido não existe mais.' });

  if (approve) {
    await db.prepare(
      'INSERT INTO club_members (club_id, reviewer_id) VALUES (?, ?) ON CONFLICT DO NOTHING'
    ).run(req.club.id, target);
  }
  await db.prepare('DELETE FROM club_join_requests WHERE club_id = ? AND reviewer_id = ?')
    .run(req.club.id, target);

  live.emit('club', req.session.reviewer_id, req.club.id);
  res.json({ ok: true, approved: approve });
}));

module.exports = { index, scoped };
