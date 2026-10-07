const express = require('express');
const throttle = require('../throttle');

const router = express.Router();

const vistos = new Set();
const MAX_VISTOS = 500;

const corte = (v, n) => (typeof v === 'string' ? v.slice(0, n) : null);

router.post(
  '/',
  express.json({ type: '*/*', limit: '16kb' }),
  throttle.limit({
    name: 'csp-report',
    max: 30,
    windowMs: 60 * 60_000,
    by: 'ip',
    message: () => 'Avisos demais.',
  }),
  (req, res) => {
    const corpo = req.body || {};
    const r = corpo['csp-report'] || corpo.body || corpo;

    const directive = corte(r['violated-directive'] || r.effectiveDirective, 60);
    const blocked = corte(r['blocked-uri'] || r.blockedURL, 200);

    const sample = corte(
      String(r['script-sample'] || r.sample || '').replace(/\s+/g, ' ').trim(),
      120
    );
    const source = corte(r['source-file'] || r.sourceFile, 160);

    const line = Number.isFinite(Number(r['line-number'])) ? Number(r['line-number']) : null;

    const chave = `${directive}|${blocked}|${source}|${line}|${sample}`;

    if (!vistos.has(chave)) {
      if (vistos.size >= MAX_VISTOS) vistos.clear();
      vistos.add(chave);
      console.warn(
        `[csp] recusaria ${directive || 'algo'} -> ${blocked || 'sem origem'}` +
          ` (em ${corte(r['document-uri'] || r.documentURL, 120) || 'página desconhecida'})` +
          (source ? ` | de ${source}${line !== null ? ':' + line : ''}` : '') +
          (sample ? ` | trecho: ${sample}` : '')
      );
    }

    res.status(204).end();
  }
);

module.exports = router;
