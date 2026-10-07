const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { zip } = require('./zip');

const RAIZ = path.join(__dirname, '..', 'public');

const FORA = new Set(['.map']);

function walk(dir, prefixo = '') {
  const saida = [];
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const cheio = path.join(dir, item.name);
    const nome = prefixo ? `${prefixo}/${item.name}` : item.name;
    if (item.isDirectory()) saida.push(...walk(cheio, nome));
    else if (!FORA.has(path.extname(item.name))) saida.push({ nome, cheio });
  }
  return saida;
}

function version() {
  if (!fs.existsSync(RAIZ)) return null;
  let novo = 0;
  for (const { cheio } of walk(RAIZ)) {
    const at = fs.statSync(cheio).mtimeMs;
    if (at > novo) novo = at;
  }
  return novo ? `1.0.${Math.floor(novo / 1000)}` : null;
}

const HOST_OK = /^[a-z0-9.-]+(:\d+)?$/i;

function originFrom(req) {
  const dito = (process.env.CINECLUBE_PUBLIC_URL || '').trim().replace(/\/$/, '');
  if (dito) return dito;
  const host = String(req.headers.host || '');
  if (!HOST_OK.test(host)) return '';
  return `${req.protocol}://${host}`;
}

const guardado = new Map();

function bundle(origin) {
  const atual = version();
  if (!atual) return null;

  const held = guardado.get(origin);
  if (held?.version === atual) return held;

  const arquivos = walk(RAIZ).map(({ nome, cheio }) => ({
    name: nome,
    data: nome === 'index.html' ? withApi(fs.readFileSync(cheio), origin) : fs.readFileSync(cheio),
  }));

  const bytes = zip(arquivos);
  const feito = {
    version: atual,
    bytes,
    checksum: crypto.createHash('sha256').update(bytes).digest('hex'),
  };
  guardado.set(origin, feito);
  return feito;
}

function withApi(html, origin) {
  if (!origin) return html;
  const texto = html.toString('utf8');
  const marca = '<head>';
  const corte = texto.indexOf(marca);
  if (corte < 0) return html;
  const script = `<script>window.__CINECLUBE_API__=${JSON.stringify(origin)}</script>`;
  return Buffer.from(
    texto.slice(0, corte + marca.length) + script + texto.slice(corte + marca.length),
    'utf8'
  );
}

module.exports = { version, bundle, originFrom };
