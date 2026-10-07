const crypto = require('node:crypto');
const express = require('express');
const db = require('../lib/db');
const auth = require('../lib/auth');
const wrap = require('../lib/wrap');
const push = require('../lib/push');
const fcm = require('../lib/fcm');
const airing = require('../tmdb/airing');

const router = express.Router();

const upsertSub = db.prepare(`
  INSERT INTO push_subs (id, reviewer_id, kind, endpoint, p256dh, auth)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    reviewer_id = excluded.reviewer_id,
    kind = excluded.kind,
    p256dh = excluded.p256dh,
    auth = excluded.auth
`);
const deleteSub = db.prepare('DELETE FROM push_subs WHERE id = ?');
const minhasSubs = db.prepare('SELECT * FROM push_subs WHERE reviewer_id = ?');
const marcarOk = db.prepare("UPDATE push_subs SET last_ok_at = datetime('now') WHERE id = ?");

const jaAvisado = db.prepare('SELECT 1 AS x FROM push_log WHERE id = ?');
const anotarAviso = db.prepare('INSERT OR IGNORE INTO push_log (id) VALUES (?)');

const idOf = endpoint => crypto.createHash('sha256').update(endpoint).digest('hex');

router.get('/key', (req, res) => {
  const chaves = push.keys();
  if (!chaves && !fcm.configured()) {
    return res.status(404).json({ error: 'Este servidor não manda avisos.' });
  }
  res.json({ key: chaves?.public ?? null, fcm: fcm.configured() });
});

router.post('/subscribe', auth.requireSession, wrap(async (req, res) => {
  const { endpoint, keys, kind, token } = req.body || {};

  if (kind === 'fcm') {
    if (typeof token !== 'string' || !token.trim() || token.length > 1000) {
      return res.status(400).json({ error: 'Inscrição inválida.' });
    }
    await upsertSub.run(idOf(token), req.session.reviewer_id, 'fcm', token.trim(), '', '');
    return res.status(201).json({ ok: true });
  }

  const p256dh = keys?.p256dh;
  const segredo = keys?.auth;
  if (typeof endpoint !== 'string' || !/^https:\/\//.test(endpoint) || !p256dh || !segredo) {
    return res.status(400).json({ error: 'Inscrição inválida.' });
  }
  if (endpoint.length > 1000) return res.status(400).json({ error: 'Inscrição inválida.' });

  await upsertSub.run(idOf(endpoint), req.session.reviewer_id, 'web', endpoint, p256dh, segredo);
  res.status(201).json({ ok: true });
}));

router.delete('/subscribe', auth.requireSession, wrap(async (req, res) => {
  const dado = req.body?.endpoint ?? req.body?.token;
  if (typeof dado === 'string') await deleteSub.run(idOf(dado));
  res.status(204).end();
}));

router.post('/test', auth.requireSession, wrap(async (req, res) => {
  const subs = await minhasSubs.all(req.session.reviewer_id);
  const saida = await entregar(subs, {
    title: 'Cineclube',
    body: 'Os avisos estão funcionando neste aparelho.',
    tag: 'teste',
    url: '/',
  });
  res.json(saida);
}));

router.post('/airing', wrap(async (req, res) => {
  const segredo = (process.env.CINECLUBE_CRON_SECRET || '').trim();
  if (!segredo) return res.status(404).json({ error: 'Sem relógio configurado.' });

  const dado = String(req.headers['x-cineclube-cron'] || '');
  const igual =
    dado.length === segredo.length &&
    crypto.timingSafeEqual(Buffer.from(dado), Buffer.from(segredo));
  if (!igual) return res.status(403).json({ error: 'Não.' });

  const porPessoa = await airing.todayByReviewer();
  let avisos = 0;
  let falhas = 0;
  let pessoas = 0;

  for (const [reviewerId, estreias] of porPessoa) {
    const subs = await minhasSubs.all(reviewerId);
    if (!subs.length) continue;
    pessoas += 1;

    for (const ep of estreias) {
      const chave = `air:${reviewerId}:${ep.showId}:${ep.season}x${ep.episode}:${ep.airDate}`;
      if (await jaAvisado.get(chave)) continue;

      const saida = await entregar(subs, {
        title: ep.showTitle,
        body: `Episódio novo hoje — ${airing.tagOf(ep)}${ep.episodeTitle ? ` · ${ep.episodeTitle}` : ''}`,
        tag: `air:${ep.showId}:${ep.season}x${ep.episode}`,
        url: '/',
      });
      avisos += saida.enviados;
      falhas += saida.falhas;
      if (saida.enviados) await anotarAviso.run(chave);
    }
  }

  res.json({ pessoas, avisos, falhas });
}));

async function entregar(subs, conteudo) {
  const corpo = JSON.stringify(conteudo);
  let enviados = 0;
  let falhas = 0;

  for (const sub of subs) {
    const saida =
      sub.kind === 'fcm' ? await fcm.send(sub, conteudo) : await push.send(sub, corpo);
    if (saida.ok) {
      enviados += 1;
      await marcarOk.run(sub.id);
      continue;
    }
    falhas += 1;
    if (saida.gone) await deleteSub.run(sub.id);
  }

  return { aparelhos: subs.length, enviados, falhas };
}

module.exports = router;
