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

/* ══════════════════════════════════════════════════════════════════════════
   A política de conteúdo, conferida sem navegador.

   Uma CSP só é verificada de verdade abrindo a página, e é por isso que ela sai
   em modo aviso primeiro. O que dá para verificar aqui é outra coisa, e não é
   pouca: que a política PERMITE tudo que os arquivos publicados referenciam, e
   que ela não permite as duas coisas que a esvaziariam.

   O valor deste arquivo é no futuro. No dia em que uma dependência nova trouxer
   um `eval`, ou alguém apontar uma imagem para outro domínio, é aqui que
   aparece — em vez de aparecer como um pedaço branco na tela de outra pessoa.
   ══════════════════════════════════════════════════════════════════════════ */

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
    try { fs.rmSync(dbPath + suffix, { force: true }); } catch { /* it is a temp file */ }
  }
});

test.beforeEach(() => throttle.reset());

const PUBLIC_INDEX = path.join(__dirname, '..', 'public', 'index.html');

/** As diretivas como um mapa, para um teste falar sobre uma delas por vez. */
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

/* ── o que não pode estar lá ──────────────────────────────────────────────
   As duas exceções que transformam uma CSP em decoração. Este é o teste mais
   importante do arquivo: as duas entram por conveniência, quando alguma coisa
   quebra e a saída rápida é abrir a política.
   ══════════════════════════════════════════════════════════════════════════ */

test('a política não abre mão de nenhuma das duas', async () => {
  const d = directivesOf(await headerFromServer());
  assert.ok(!d['script-src'].includes(`'unsafe-eval'`), 'unsafe-eval esvazia a política');
  assert.ok(
    !d['script-src'].includes(`'unsafe-inline'`),
    'unsafe-inline em script é literalmente permitir o que um XSS produz'
  );
});

test('nem os pacotes publicados precisam delas', () => {
  /* O que justifica a ausência acima. No dia em que uma dependência trouxer um
     `eval`, a página quebra em produção — e a explicação começa aqui. */
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

/* ── os dois scripts de dentro do HTML ────────────────────────────────────── */

test('cada script inline entra pelo hash, e são exatamente dois', async () => {
  const html = fs.readFileSync(PUBLIC_INDEX, 'utf8');
  /* Contados por um caminho diferente do que o csp.js usa: se o regex de lá
     deixar um de fora — ou pegar o do bundle por engano — os números divergem. */
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

/* ══════════════════════════════════════════════════════════════════════════
   O FIM DE LINHA, que é como este arquivo errou uma vez.

   O navegador não hasheia os bytes que recebeu. O parser de HTML normaliza o
   fluxo de entrada antes de olhar para qualquer coisa — todo CRLF vira LF, todo
   CR solto vira LF — e é o texto DEPOIS disso que ele hasheia.

   Este arquivo lia o HTML do disco e hasheava o que estava lá. Com o
   `index.html` publicado gravado em CRLF, os dois hashes ficavam diferentes por
   causa de um caractere que o navegador já tinha descartado, e a política
   recusava os dois scripts do próprio produto. Em modo de bloquear, a página
   teria perdido o ajuste de zoom e a detecção de GPU sem uma única mensagem de
   erro; foi o modo de aviso que contou.

   O teste é o que impede a volta: o mesmo script com os dois fins de linha tem
   de produzir o mesmo hash, e ele tem de ser o do LF, que é o que o navegador
   calcula.
   ══════════════════════════════════════════════════════════════════════════ */

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

    /* E que esse hash é o do texto normalizado, não o de outra coisa: é o
       número que o navegador vai calcular. */
    const esperado = crypto.createHash('sha256').update(corpo, 'utf8').digest('base64');
    assert.deepEqual(comLf, [`'sha256-${esperado}'`]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('o index.html publicado é hasheado sem os CR que ele tem', () => {
  /* O arquivo de verdade, que é onde isto aconteceu. Se ele estiver em CRLF, o
     hash publicado tem de ser o da versão normalizada — e se um dia ele passar
     a ser LF, a asserção continua valendo sem mudar nada. */
  const html = fs.readFileSync(PUBLIC_INDEX, 'utf8');
  const corpos = [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)];
  assert.equal(corpos.length, 2);

  const esperados = corpos.map(m => {
    const normalizado = m[1].replace(/\r\n?/g, '\n');
    return `'sha256-${crypto.createHash('sha256').update(normalizado, 'utf8').digest('base64')}'`;
  });
  assert.deepEqual(csp.inlineHashes(PUBLIC_INDEX), esperados);
});

/* ── e tudo que a página de fato carrega ─────────────────────────────────── */

test('a política permite cada origem que os arquivos publicados referenciam', async () => {
  const d = directivesOf(await headerFromServer());

  // As duas famílias, pelo <link> em index.html.
  assert.ok(d['style-src-elem'].includes('https://fonts.googleapis.com'));
  assert.ok(d['font-src'].includes('https://fonts.gstatic.com'));
  // Pôsteres e logos de serviço — ver IMG_BASE e LOGO_BASE em tmdb.js.
  assert.ok(d['img-src'].includes('https://image.tmdb.org'));
  // O retrato recortado (data:) e o arquivo escolhido do disco (blob:).
  assert.ok(d['img-src'].includes('data:') && d['img-src'].includes('blob:'));
  // Os trackers do WebTorrent, e o filme.
  assert.ok(d['connect-src'].includes('wss:'));
  assert.ok(d['media-src'].includes('blob:'));
  // O service worker do torrent e o worker que a engine cria de um blob.
  assert.ok(d['worker-src'].includes('blob:'));
});

test('o atributo de estilo passa, e um bloco de estilo injetado não', async () => {
  /* O React escreve `style={{...}}` por toda parte — a cor de cada avaliador, a
     fração acesa de uma régua —, e isso é atributo. Um `<style>` injetado é
     outra coisa e continua recusado. */
  const d = directivesOf(await headerFromServer());
  assert.ok(d['style-src-attr'].includes(`'unsafe-inline'`));
  assert.ok(!d['style-src-elem'].includes(`'unsafe-inline'`));
});

test('nada emoldura e nada é emoldurado', async () => {
  const d = directivesOf(await headerFromServer());
  assert.deepEqual(d['frame-ancestors'], [`'none'`]);
  assert.deepEqual(d['frame-src'], [`'none'`]);
  assert.deepEqual(d['object-src'], [`'none'`]);
  assert.deepEqual(d['base-uri'], [`'self'`]);
});

/* ── vigiar antes de trancar ─────────────────────────────────────────────── */

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

  // O formato do `report-uri`, que é o que esta política pede.
  const velho = await mandar({
    'csp-report': {
      'violated-directive': 'img-src',
      'blocked-uri': 'https://exemplo.invalido/x.png',
      'document-uri': 'http://127.0.0.1/',
    },
  });
  assert.equal(velho.status, 204);

  // E o do `report-to`, que é para onde a especificação foi.
  const novo = await mandar({ body: { effectiveDirective: 'img-src', blockedURL: 'https://outro.invalido' } });
  assert.equal(novo.status, 204);

  // Um corpo que não é nada disso também não derruba nada.
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
