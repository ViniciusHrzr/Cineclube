const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const dbPath = path.join(os.tmpdir(), `cineclube-csp-${crypto.randomUUID()}.db`);
process.env.CINECLUBE_DB = dbPath;

const app = require('../server');
const db = require('../db');
const live = require('../live');
const screening = require('../screening');
const throttle = require('../throttle');
const csp = require('../csp');

let baseUrl;
let server;

test.before(async () => {
  await app.ready;
  server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  live.stopTimers();
  screening.stopTimers();
  throttle.stopTimers();
  const closed = new Promise(resolve => server.close(resolve));
  server.closeAllConnections?.();
  await closed;
  db.close();
  for (const suffix of ['', '-shm', '-wal']) {
    try { fs.rmSync(dbPath + suffix, { force: true }); } catch { }
  }
});

test.beforeEach(() => throttle.reset());

const PUBLIC_INDEX = path.join(__dirname, '..', 'public', 'index.html');

function directivesOf(header) {
  const out = {};
  for (const part of header.split(';')) {
    const [name, ...values] = part.trim().split(/\s+/);
    if (name) out[name] = values;
  }
  return out;
}

async function headerFromServer() {
  const res = await fetch(baseUrl + '/');
  const value =
    res.headers.get('content-security-policy-report-only') ||
    res.headers.get('content-security-policy');
  assert.ok(value, 'a página tem de sair com uma política');
  return value;
}

test('a política não abre mão de nenhuma das duas', async () => {
  const d = directivesOf(await headerFromServer());
  assert.ok(!d['script-src'].includes(`'unsafe-eval'`), 'unsafe-eval esvazia a política');
  assert.ok(
    !d['script-src'].includes(`'unsafe-inline'`),
    'unsafe-inline em script é literalmente permitir o que um XSS produz'
  );
});

test('nem os pacotes publicados precisam delas', () => {
  const dir = path.join(__dirname, '..', 'public');
  const arquivos = [
    ...fs.readdirSync(path.join(dir, 'assets')).filter(f => f.endsWith('.js'))
      .map(f => path.join(dir, 'assets', f)),
    path.join(dir, 'sw.min.js'),
  ];
  for (const f of arquivos) {
    const code = fs.readFileSync(f, 'utf8');
    assert.ok(!/[^a-zA-Z0-9_$.]eval\(/.test(code), `${path.basename(f)} chama eval`);
    assert.ok(!/new Function\(/.test(code), `${path.basename(f)} monta função de texto`);
  }
});

test('cada script inline entra pelo hash, e são exatamente dois', async () => {
  const html = fs.readFileSync(PUBLIC_INDEX, 'utf8');
  const todos = (html.match(/<script/g) || []).length;
  const comSrc = (html.match(/<script[^>]*\ssrc=/g) || []).length;
  assert.equal(todos - comSrc, 2, 'index.html tem dois scripts inline');

  const hashes = csp.inlineHashes(PUBLIC_INDEX);
  assert.equal(hashes.length, 2);
  const vazio = `'sha256-${crypto.createHash('sha256').update('', 'utf8').digest('base64')}'`;
  assert.ok(!hashes.includes(vazio), 'um hash de string vazia é o regex tendo falhado');

  const d = directivesOf(await headerFromServer());
  for (const h of hashes) assert.ok(d['script-src'].includes(h), `falta o hash ${h}`);
});

test('o rastreador de rede do Node não vai junto para o navegador', () => {
  const dir = path.join(__dirname, '..', 'public', 'assets');
  const publicados = fs.readdirSync(dir).filter(f => f.endsWith('.js'));
  assert.ok(publicados.length, 'não há bundle publicado para conferir');

  for (const f of publicados) {
    const code = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const marca of ['isPublic', 'isPrivate', 'isLoopback']) {
      assert.ok(!code.includes(marca), `${f} embarcou o pacote 'ip' (${marca})`);
    }
  }
});

test('o hash é o do texto que o parser vê, e não o dos bytes em disco', () => {
  const corpo = '\n  var a = 1;\n  var b = 2;\n';
  const pagina = fim => `<!doctype html><html><head><script>${corpo.replace(/\n/g, fim)}</script></head><body></body></html>`;

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cineclube-csp-'));
  const escrever = (nome, texto) => {
    const p = path.join(dir, nome);
    fs.writeFileSync(p, texto);
    return p;
  };

  try {
    const comLf = csp.inlineHashes(escrever('lf.html', pagina('\n')));
    const comCrlf = csp.inlineHashes(escrever('crlf.html', pagina('\r\n')));
    const comCr = csp.inlineHashes(escrever('cr.html', pagina('\r')));

    assert.equal(comLf.length, 1);
    assert.deepEqual(comCrlf, comLf, 'CRLF tem de dar o mesmo hash que LF');
    assert.deepEqual(comCr, comLf, 'e um CR solto também — o parser normaliza os dois');

    const esperado = crypto.createHash('sha256').update(corpo, 'utf8').digest('base64');
    assert.deepEqual(comLf, [`'sha256-${esperado}'`]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('o index.html publicado é hasheado sem os CR que ele tem', () => {
  const html = fs.readFileSync(PUBLIC_INDEX, 'utf8');
  const corpos = [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)];
  assert.equal(corpos.length, 2);

  const esperados = corpos.map(m => {
    const normalizado = m[1].replace(/\r\n?/g, '\n');
    return `'sha256-${crypto.createHash('sha256').update(normalizado, 'utf8').digest('base64')}'`;
  });
  assert.deepEqual(csp.inlineHashes(PUBLIC_INDEX), esperados);
});

test('a política permite cada origem que os arquivos publicados referenciam', async () => {
  const d = directivesOf(await headerFromServer());

  assert.ok(d['style-src-elem'].includes('https://fonts.googleapis.com'));
  assert.ok(d['font-src'].includes('https://fonts.gstatic.com'));
  assert.ok(d['img-src'].includes('https://image.tmdb.org'));
  assert.ok(d['img-src'].includes('data:') && d['img-src'].includes('blob:'));
  assert.ok(d['connect-src'].includes('wss:'));
  assert.ok(d['media-src'].includes('blob:'));
  assert.ok(d['worker-src'].includes('blob:'));
});

test('o atributo de estilo passa, e um bloco de estilo injetado não', async () => {
  const d = directivesOf(await headerFromServer());
  assert.ok(d['style-src-attr'].includes(`'unsafe-inline'`));
  assert.ok(!d['style-src-elem'].includes(`'unsafe-inline'`));
});

test('a única moldura é a do trailer, e ninguém emoldura o produto', async () => {
  const d = directivesOf(await headerFromServer());
  assert.deepEqual(d['frame-ancestors'], [`'none'`]);
  assert.deepEqual(d['object-src'], [`'none'`]);
  assert.deepEqual(d['base-uri'], [`'self'`]);

  assert.deepEqual(d['frame-src'], ['https://www.youtube-nocookie.com']);
});

test('nasce em modo aviso, e a variável de ambiente é o que tranca', async () => {
  const res = await fetch(baseUrl + '/');
  assert.ok(
    res.headers.get('content-security-policy-report-only'),
    'sem CINECLUBE_CSP=enforce, o navegador avisa e não bloqueia'
  );
  assert.equal(res.headers.get('content-security-policy'), null);
});

test('a política aponta para onde os avisos vão', async () => {
  assert.ok((await headerFromServer()).includes(`report-uri ${csp.REPORT_PATH}`));
});

test('o coletor aceita os dois formatos e não discute', async () => {
  const mandar = body =>
    fetch(baseUrl + csp.REPORT_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/csp-report' },
      body: JSON.stringify(body),
    });

  const velho = await mandar({
    'csp-report': {
      'violated-directive': 'img-src',
      'blocked-uri': 'https://exemplo.invalido/x.png',
      'document-uri': 'http://127.0.0.1/',
    },
  });
  assert.equal(velho.status, 204);

  const novo = await mandar({ body: { effectiveDirective: 'img-src', blockedURL: 'https://outro.invalido' } });
  assert.equal(novo.status, 204);

  assert.equal((await mandar({ qualquer: 'coisa' })).status, 204);
});

test('o coletor de avisos tem trava própria', async () => {
  const codes = [];
  for (let i = 0; i < 34; i++) {
    const res = await fetch(baseUrl + csp.REPORT_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/csp-report' },
      body: JSON.stringify({ 'csp-report': { 'violated-directive': `d${i}` } }),
    });
    codes.push(res.status);
  }
  assert.ok(codes.includes(429), 'um endpoint aberto que escreve em log precisa de teto');
});
