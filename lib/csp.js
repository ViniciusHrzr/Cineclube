const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const INLINE = /<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g;

const asHtmlParser = s => s.replace(/\r\n?/g, '\n');

const REPORT_PATH = '/api/csp-report';

function inlineHashes(indexPath) {
  let html;
  try {
    html = fs.readFileSync(indexPath, 'utf8');
  } catch {
    return [];
  }
  const out = [];
  for (const m of html.matchAll(INLINE)) {
    const digest = crypto
      .createHash('sha256')
      .update(asHtmlParser(m[1]), 'utf8')
      .digest('base64');
    out.push(`'sha256-${digest}'`);
  }
  return out;
}

function policy({ indexPath, https }) {
  const hashes = inlineHashes(indexPath);

  const directives = {
    'default-src': [`'self'`],

    'script-src': [`'self'`, ...hashes],

    'style-src': [`'self'`, `'unsafe-inline'`, 'https://fonts.googleapis.com'],
    'style-src-elem': [`'self'`, 'https://fonts.googleapis.com'],
    'style-src-attr': [`'unsafe-inline'`],

    'font-src': [`'self'`, 'https://fonts.gstatic.com', 'data:'],

    'img-src': [`'self'`, 'data:', 'blob:', 'https://image.tmdb.org'],

    'connect-src': [`'self'`, 'blob:', 'wss:'],

    'media-src': [`'self'`, 'blob:', 'data:', 'https:', 'http:'],

    'worker-src': [`'self'`, 'blob:'],

    'frame-src': ['https://www.youtube-nocookie.com'],
    'frame-ancestors': [`'none'`],

    'object-src': [`'none'`],

    'base-uri': [`'self'`],

    'form-action': [`'self'`],
  };

  const linhas = Object.entries(directives).map(([k, v]) => `${k} ${v.join(' ')}`);
  if (https) linhas.push('upgrade-insecure-requests');
  linhas.push(`report-uri ${REPORT_PATH}`);
  return linhas.join('; ');
}

function middleware({ indexPath = path.join(__dirname, '..', 'public', 'index.html') } = {}) {
  const https = process.env.CINECLUBE_HTTPS === '1';
  const enforce = process.env.CINECLUBE_CSP === 'enforce';
  const value = policy({ indexPath, https });
  const header = enforce ? 'Content-Security-Policy' : 'Content-Security-Policy-Report-Only';

  return function csp(_req, res, next) {
    res.setHeader(header, value);
    next();
  };
}

module.exports = { middleware, policy, inlineHashes, REPORT_PATH };
