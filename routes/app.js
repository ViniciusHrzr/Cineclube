const express = require('express');
const wrap = require('../lib/wrap');
const ota = require('../lib/ota');
const throttle = require('../lib/throttle');

const router = express.Router();

const throttleUpdate = throttle.limit({
  name: 'app-update',
  max: 60,
  windowMs: 60 * 60_000,
  by: 'ip',
  message: espera => `Muitas verificações seguidas. Tente de novo em ${espera}.`,
});

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

router.get('/bundle/:version.zip', wrap(async (req, res) => {
  const origin = ota.originFrom(req);
  const feito = origin ? ota.bundle(origin) : null;
  if (!feito || feito.version !== req.params.version) {
    return res.status(404).json({ error: 'Este pacote não é o que está publicado.' });
  }

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Length', String(feito.bytes.length));
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.setHeader('X-Bundle-Checksum', feito.checksum);
  res.end(feito.bytes);
}));

module.exports = router;
