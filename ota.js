const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { zip } = require('./zip');

/* ══════════════════════════════════════════════════════════════════════════
   ATUALIZAR O APLICATIVO SEM PASSAR PELA LOJA.

   O APK carrega os arquivos dentro dele — é o que faz o app abrir offline e
   instantâneo (ver mobile/capacitor.config.js). O preço disso é que um deploy
   do site não alcançava quem já tinha instalado: a pessoa ficaria com a tela de
   março até a próxima publicação na Play Store.

   Isto é o que paga o preço. O aplicativo pergunta, na abertura, se existe
   coisa nova; se existe, baixa um zip e troca o conteúdo na próxima vez que
   abrir. Quem aplica é o @capgo/capacitor-updater, que é nativo — trocar o que
   o WebView serve não é coisa que JavaScript faça.

   ── o pacote é a própria pasta public/ ──────────────────────────────────
   Zipada na hora, e não um artefato gerado no build e commitado. Três coisas
   saem de graça com isso:

   · **nunca desencontra.** O que o app baixa é byte a byte o que o site está
     servindo neste instante — não há um segundo lugar para esquecer de
     atualizar.
   · **nada a mais no repositório.** Um zip de um megabyte por publicação
     ficaria no histórico do git para sempre.
   · **o endereço da API não vaza.** O pacote do site fala com a própria origem;
     o do aplicativo precisa de um endereço absoluto, e ele é INJETADO aqui, na
     hora de servir, a partir de onde o pedido chegou. O repositório continua
     sem saber onde este servidor mora.

   ── a versão ─────────────────────────────────────────────────────────────
   O instante do arquivo mais novo de `public/`, em segundos. Sobe sozinha a
   cada deploy — um checkout novo carimba os arquivos —, é a mesma para todo
   mundo que perguntar, e tem a forma que o plugin espera (`1.0.<n>`). Sem
   contador em lugar nenhum para alguém esquecer de girar.
   ══════════════════════════════════════════════════════════════════════════ */

const RAIZ = path.join(__dirname, 'public');

/* O que NÃO vai no pacote do aplicativo. O worker do WebTorrent vai — ele serve
   o vídeo da Sessão —, e o mapa de fontes não existe neste build. */
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

/** A versão do que está publicado agora, ou null quando não há pasta nenhuma. */
function version() {
  if (!fs.existsSync(RAIZ)) return null;
  let novo = 0;
  for (const { cheio } of walk(RAIZ)) {
    const at = fs.statSync(cheio).mtimeMs;
    if (at > novo) novo = at;
  }
  return novo ? `1.0.${Math.floor(novo / 1000)}` : null;
}

/* A origem por onde este servidor é alcançado, para o pacote saber com quem
   falar. Do ambiente quando ele diz, do pedido quando não — e neste caso
   PENEIRADA: o `Host` é escrito por quem pergunta, e ele vai parar dentro de um
   `<script>`. Um host com aspas dentro seria uma tag fechada no meio do nosso
   HTML, escrita por quem pediu o pacote. */
const HOST_OK = /^[a-z0-9.-]+(:\d+)?$/i;

function originFrom(req) {
  const dito = (process.env.CINECLUBE_PUBLIC_URL || '').trim().replace(/\/$/, '');
  if (dito) return dito;
  const host = String(req.headers.host || '');
  if (!HOST_OK.test(host)) return '';
  return `${req.protocol}://${host}`;
}

/* O pacote pronto, por origem. Um megabyte na memória e uma origem na prática;
   refazer o zip a cada pergunta seria comprimir o cliente inteiro para
   responder "não mudou nada". */
const guardado = new Map();

/** O zip do que está publicado, com o endereço da API dentro. */
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
    /* SHA-256 do zip, que é o que o plugin confere antes de aplicar. Um pacote
       que chegou pela metade não vira a tela de ninguém. */
    checksum: crypto.createHash('sha256').update(bytes).digest('hex'),
  };
  guardado.set(origin, feito);
  return feito;
}

/* O endereço da API, escrito na página antes de qualquer script do cliente
   rodar. É o mesmo global que lib/session.ts já lê — lá está por que ele
   existe. Sem origem conhecida, o HTML sai intacto: um endereço vazio faria o
   app procurar a API dentro do próprio aparelho. */
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
