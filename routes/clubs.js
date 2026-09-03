const crypto = require('node:crypto');
const express = require('express');
const db = require('../db');
const auth = require('../auth');
const clubs = require('../clubs');
const live = require('../live');
const wrap = require('../wrap');
const { readDataUrl } = require('../image');

/* ══════════════════════════════════════════════════════════════════════════
   Os clubes.

   Duas metades. `index` é sobre o conjunto — quais existem, e criar mais um — e
   é a única coisa da rede que se lê sem estar dentro de sala nenhuma. `scoped`
   é sobre UM clube, montado atrás de `clubs.resolve`, e é onde mora tudo que
   um ADM faz com a sala dele.
   ══════════════════════════════════════════════════════════════════════════ */

const index = express.Router();
const scoped = express.Router({ mergeParams: true });

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
    photo: photoUrl(row),
    createdAt: row.created_at ?? null,
    ...extra,
  };
}

/* ── quais clubes existem ─────────────────────────────────────────────────
   Duas listas numa resposta, porque a tela que as consome é uma só e as duas
   respondem perguntas diferentes: `mine` é o chaveiro de quem já chegou,
   `open` é a vitrine de quem está olhando.

   Um clube em que você já está não aparece na vitrine — ele já está no
   chaveiro, e uma sala listada duas vezes na mesma tela é a tela dizendo que
   não sabe quem você é. */
index.get('/', wrap(async (req, res) => {
  const me = req.session?.reviewer_id || null;

  const mine = me ? await clubs.mineStmt.all(me) : [];
  const held = new Set(mine.map(c => c.id));

  const open = await db.prepare(`
    SELECT c.*, COUNT(m.reviewer_id) AS members
    FROM clubs c
    LEFT JOIN club_members m ON m.club_id = c.id
    WHERE c.visibility = 'public'
    GROUP BY c.id
    ORDER BY c.created_at ASC
  `).all();

  /* Se você já pediu para entrar em algum. É o que separa "Pedir para entrar"
     de "Pedido enviado" na vitrine, e sem isto a tela ofereceria de novo o
     botão que a pessoa acabou de apertar. */
  const asked = me
    ? (await db.prepare('SELECT club_id FROM club_join_requests WHERE reviewer_id = ?').all(me))
        .map(r => r.club_id)
    : [];
  const pending = new Set(asked);

  res.json({
    mine: mine.map(c => toDTO(c, { role: c.role, isMember: true })),
    open: open
      .filter(c => !held.has(c.id))
      .map(c => toDTO(c, { members: Number(c.members) || 0, requested: pending.has(c.id) })),
  });
}));

/* ── fundar um clube ──────────────────────────────────────────────────────
   Quem cria é ADM, e isso não é uma opção em lugar nenhum da interface: uma
   sala sem ninguém que possa aprovar uma entrada é uma sala que nasce trancada.

   Nasce privado quando não se diz nada. O erro caro tem um lado só — um clube
   que devia estar aberto e nasceu fechado é um menu a corrigir; o contrário é o
   acervo de um grupo de amigos exposto sem ninguém ter pedido. */
index.post('/', auth.requireSession, wrap(async (req, res) => {
  const name = String(req.body?.name || '').trim();
  const tagline = String(req.body?.tagline || '').trim();
  const visibility = req.body?.visibility === 'public' ? 'public' : 'private';

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

scoped.get('/', clubs.requireReadable, wrap(async (req, res) => {
  const row = await db.prepare('SELECT * FROM clubs WHERE id = ?').get(req.club.id);
  const { n } = await db
    .prepare('SELECT COUNT(*) AS n FROM club_members WHERE club_id = ?').get(req.club.id);
  const asked = req.session
    ? await db.prepare('SELECT 1 AS x FROM club_join_requests WHERE club_id = ? AND reviewer_id = ?')
        .get(req.club.id, req.session.reviewer_id)
    : null;
  res.json({
    club: toDTO(row, {
      members: n,
      role: req.club.role,
      isMember: req.club.isMember,
      requested: !!asked,
    }),
  });
}));

/* A foto, como bytes e com cache eterno — o `?v=` muda quando ela muda, que é o
   que torna o "para sempre" seguro. Mesma mecânica do retrato de uma pessoa. */
scoped.get('/photo', clubs.requireReadable, wrap(async (req, res) => {
  const row = await db.prepare('SELECT photo, photo_mime FROM clubs WHERE id = ?').get(req.club.id);
  if (!row?.photo) return res.status(404).json({ error: 'Este clube não tem foto.' });
  res.setHeader('Content-Type', row.photo_mime || 'image/webp');
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.end(Buffer.from(row.photo, 'base64'));
}));

scoped.patch('/', clubs.requireClubAdmin, wrap(async (req, res) => {
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
       endereço ser legível; renomear um clube é raro e o link novo é o que a
       pessoa vai colar da próxima vez. */
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
    /* Fechar o clube joga fora os pedidos pendentes: eles só existem como
       consequência de ele estar aberto, e um pedido que ninguém mais pode ter
       feito não é uma fila, é lixo com nome de gente. */
    if (v === 'private') {
      await db.prepare('DELETE FROM club_join_requests WHERE club_id = ?').run(req.club.id);
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
  res.json({ club: toDTO(row, { role: req.club.role, isMember: true }) });
}));

/* ── quem está aqui ───────────────────────────────────────────────────────
   Legível por quem pode ler o clube, o que num clube público inclui quem está
   de fora: saber quem já está na sala é metade da decisão de pedir para entrar. */
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

/* Sair, ou tirar alguém. As duas coisas na mesma rota porque são a mesma linha
   apagada; o que muda é quem tem direito, e a regra é a de sempre neste
   produto: a sua é sua, a dos outros é do ADM.

   O último ADM não sai. Não é proteção do cargo, é proteção da sala: sem ADM
   ninguém aprova entrada nem muda nada, e as fichas de todo mundo ficam
   trancadas lá dentro. */
scoped.delete('/members/:id', auth.requireSession, wrap(async (req, res) => {
  const target = req.params.id;
  const me = req.session.reviewer_id;
  const isSelf = target === me;

  if (!isSelf && !req.club.isClubAdmin && !req.session.is_admin) {
    return res.status(403).json({ error: 'Só quem administra o clube pode tirar alguém.' });
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

/* ── pedir para entrar ────────────────────────────────────────────────────
   Só clube público, porque um clube privado não aparece para quem não é dele —
   e a rota responde 404 justamente para não confirmar que ele existe.

   Sem corpo e sem mensagem: um pedido é um nome numa lista, e a conversa sobre
   por que você quer entrar acontece onde as pessoas já se falam. */
scoped.post('/join', auth.requireSession, wrap(async (req, res) => {
  if (req.club.visibility !== 'public') {
    return res.status(404).json({ error: 'Clube não encontrado.' });
  }
  if (req.club.isMember) return res.status(409).json({ error: 'Você já está neste clube.' });

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
   coluna de estado em lugar nenhum disto, e é de propósito: quem responde "esta
   pessoa está dentro?" é club_members, e uma segunda tabela guardando um
   'aprovado' seria uma segunda resposta livre para discordar da primeira. */
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
