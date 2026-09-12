const crypto = require('node:crypto');
const express = require('express');
const db = require('../db');
const auth = require('../auth');
const wrap = require('../wrap');
const push = require('../push');
const fcm = require('../fcm');
const airing = require('../airing');

const router = express.Router();

/* ══════════════════════════════════════════════════════════════════════════
   QUEM QUER SER AVISADO, E O QUE ACORDA O APARELHO.

   Três superfícies, e a última é a única que não é chamada por gente:

   · a chave pública, que o navegador precisa para se inscrever;
   · a inscrição em si, que é do APARELHO e não da conta — o mesmo clube aberto
     no telefone e no computador são duas linhas, e quem instalou nos dois quer
     ser avisado nos dois;
   · o trabalho da noite, que percorre as estreias do dia e entrega os avisos.

   O conteúdo do aviso vai CIFRADO com as chaves do aparelho, e quem o carrega
   não consegue lê-lo. Ver push.js.
   ══════════════════════════════════════════════════════════════════════════ */

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

/* O endereço é longo e é a identidade da inscrição. O hash dele é a chave
   primária: reinscrever o mesmo aparelho atualiza a linha em vez de criar uma
   segunda, e o índice fica de tamanho fixo. */
const idOf = endpoint => crypto.createHash('sha256').update(endpoint).digest('hex');

/* A chave pública desta instalação. 404 quando ninguém configurou VAPID: a tela
   lê isso como "este servidor não manda aviso", e não oferece o interruptor —
   que é melhor do que um interruptor que liga e nunca avisa nada. */
router.get('/key', (req, res) => {
  const chaves = push.keys();
  /* 404 só quando NENHUMA das duas portas existe: um aplicativo não precisa da
     chave VAPID, e um navegador não precisa do FCM. */
  if (!chaves && !fcm.configured()) {
    return res.status(404).json({ error: 'Este servidor não manda avisos.' });
  }
  res.json({ key: chaves?.public ?? null, fcm: fcm.configured() });
});

router.post('/subscribe', auth.requireSession, wrap(async (req, res) => {
  const { endpoint, keys, kind, token } = req.body || {};

  /* ── a porta do Android ────────────────────────────────────────────────
     O aplicativo não tem endereço de entrega nem chaves: o que ele tem é um
     token do aparelho, e quem cifra e entrega é o próprio Google. */
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
  /* Um endereço de push é de um serviço conhecido e tem tamanho de endereço. O
     teto existe porque isto é texto de fora que vai para o banco e volta como
     destino de uma requisição nossa. */
  if (endpoint.length > 1000) return res.status(400).json({ error: 'Inscrição inválida.' });

  await upsertSub.run(idOf(endpoint), req.session.reviewer_id, 'web', endpoint, p256dh, segredo);
  res.status(201).json({ ok: true });
}));

router.delete('/subscribe', auth.requireSession, wrap(async (req, res) => {
  /* O endereço no navegador, o token no aplicativo: a chave da linha sai do
     hash de um ou de outro, e os dois chegam por este mesmo campo. */
  const dado = req.body?.endpoint ?? req.body?.token;
  if (typeof dado === 'string') await deleteSub.run(idOf(dado));
  res.status(204).end();
}));

/* Um aviso de teste para os próprios aparelhos. Existe porque a cadeia tem
   cinco elos — permissão, inscrição, cifra, serviço de entrega, service worker
   — e sem isto a única forma de descobrir onde ela quebrou é esperar uma
   estreia. */
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

/* ── o trabalho da noite ──────────────────────────────────────────────────
   Chamado por um relógio de fora — o GitHub Action, que já roda o backup —, e
   não por gente. A porta é um segredo compartilhado, comparado em tempo
   constante; sem ele configurado, a porta não existe.

   Idempotente de propósito: o que já foi avisado fica anotado por pessoa,
   episódio e dia, então uma segunda execução depois de uma falha no meio não
   acorda ninguém duas vezes. */
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
      /* A chave carrega o dia: a mesma estreia no ano que vem é outro aviso, e
         a mesma estreia hoje já foi. */
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
      /* Anotado quando ALGUM aparelho recebeu. Se nenhum recebeu, a próxima
         execução tenta de novo — e é por isso que a anotação não vem antes. */
      if (saida.enviados) await anotarAviso.run(chave);
    }
  }

  res.json({ pessoas, avisos, falhas });
}));

/** Manda o mesmo aviso a vários aparelhos, e limpa os que já não existem. */
async function entregar(subs, conteudo) {
  const corpo = JSON.stringify(conteudo);
  let enviados = 0;
  let falhas = 0;

  for (const sub of subs) {
    /* Duas portas, uma mensagem. O navegador recebe um corpo cifrado por nós; o
       aplicativo recebe um aviso montado pelo Google a partir dos mesmos
       campos. Ver fcm.js. */
    const saida =
      sub.kind === 'fcm' ? await fcm.send(sub, conteudo) : await push.send(sub, corpo);
    if (saida.ok) {
      enviados += 1;
      await marcarOk.run(sub.id);
      continue;
    }
    falhas += 1;
    /* O aparelho foi formatado, o navegador desinstalado, a permissão revogada:
       aquele endereço responde 410 para sempre, e insistir é gastar uma
       requisição por dia até o fim dos tempos. */
    if (saida.gone) await deleteSub.run(sub.id);
  }

  return { aparelhos: subs.length, enviados, falhas };
}

module.exports = router;
