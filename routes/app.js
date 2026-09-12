const express = require('express');
const wrap = require('../wrap');
const ota = require('../ota');
const throttle = require('../throttle');

const router = express.Router();

/* ══════════════════════════════════════════════════════════════════════════
   AS DUAS ROTAS DO APLICATIVO INSTALADO.

   Perguntar se há coisa nova, e baixar o que há. Quem fala aqui é o
   @capgo/capacitor-updater, nativo, na abertura do app — e o formato das duas
   respostas é ditado por ele. Ver ota.js, que é onde o pacote é feito.

   SEM SESSÃO, de propósito: o que se entrega é o mesmo JavaScript que qualquer
   pessoa baixa ao abrir o site. Exigir conta para atualizar o app seria trancar
   a porta de quem foi deslogado justamente pelo defeito que a atualização
   conserta.

   O teto é generoso e existe pelo motivo de sempre: isto é uma pergunta barata
   feita por um aparelho, e o pacote é um megabyte para quem insistir.
   ══════════════════════════════════════════════════════════════════════════ */

const throttleUpdate = throttle.limit({
  name: 'app-update',
  max: 60,
  windowMs: 60 * 60_000,
  by: 'ip',
  message: espera => `Muitas verificações seguidas. Tente de novo em ${espera}.`,
});

/* O plugin manda a versão que ele tem em `version_name` e espera uma de duas
   formas: `{version, url, checksum}` para baixar, ou `{message, version}` para
   ficar quieto. Um erro aqui não pode virar 500 — o app trataria como falha de
   rede e perguntaria de novo no minuto seguinte. */
router.post('/update', throttleUpdate, wrap(async (req, res) => {
  const origin = ota.originFrom(req);
  const atual = ota.version();

  if (!atual || !origin) {
    return res.json({ message: 'Sem pacote para servir agora.', version: '0.0.0' });
  }

  const tem = String(req.body?.version_name || '').trim();
  if (tem === atual) return res.json({ message: 'Já está na última.', version: atual });

  res.json({
    version: atual,
    url: `${origin}/api/app/bundle/${atual}.zip`,
    checksum: ota.bundle(origin).checksum,
  });
}));

/* O pacote. A versão vai na URL para o download ser cacheável e para o app
   nunca receber um pacote diferente do que o `checksum` que ele guardou
   descreve: um deploy no meio do caminho responde 404, e o plugin tenta de novo
   na próxima abertura — que é melhor do que aplicar um pacote e descobrir na
   hora de conferir que ele é outro. */
router.get('/bundle/:version.zip', wrap(async (req, res) => {
  const origin = ota.originFrom(req);
  const feito = origin ? ota.bundle(origin) : null;
  if (!feito || feito.version !== req.params.version) {
    return res.status(404).json({ error: 'Este pacote não é o que está publicado.' });
  }

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Length', String(feito.bytes.length));
  /* Imutável porque o nome carrega a versão: este arquivo não muda mais. */
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.setHeader('X-Bundle-Checksum', feito.checksum);
  res.end(feito.bytes);
}));

module.exports = router;
