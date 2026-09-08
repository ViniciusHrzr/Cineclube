const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

/* ══════════════════════════════════════════════════════════════════════════
   A POLÍTICA DE CONTEÚDO: a lista do que esta página pode carregar e executar.

   Não foi escrita de memória — foi levantada do que os arquivos publicados de
   fato referenciam, um por um, e cada diretiva abaixo diz de onde veio.

   `'unsafe-eval'` NÃO precisou entrar: os três pacotes publicados não têm
   `eval`, `new Function` nem WebAssembly. Sem essa exceção, um script injetado
   não consegue nem se montar a partir de texto. Vale conferir de novo no dia em
   que uma dependência nova entrar — é a linha mais fácil de perder.
   ══════════════════════════════════════════════════════════════════════════ */

/* `index.html` carrega dois trechos inline antes da primeira pintura — o que
   mede a janela e escreve `--ui-zoom`, e o que pergunta se há GPU —, e os dois
   precisam rodar ANTES do bundle. `'unsafe-inline'` resolveria e destruiria a
   política: seria liberar exatamente o que um XSS produz. Cada um entra pelo
   seu HASH.

   Calculado no boot, lendo o HTML publicado: assim o hash não para de bater em
   silêncio no dia em que alguém mexer numa daquelas linhas. Sem o arquivo (no
   Vite, em desenvolvimento) a lista sai vazia e o resto da política vale. */
const INLINE = /<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g;

/* O navegador NÃO hasheia os bytes que recebeu: o parser de HTML normaliza o
   fluxo antes — todo CRLF e todo CR solto viram LF — e hasheia o resultado.

   Este arquivo hasheava o que estava no disco, e o `index.html` publicado está
   em CRLF: os dois hashes diferiam por um caractere que o navegador já tinha
   jogado fora, e a política recusava os scripts do próprio produto. O sintoma
   não ajuda — para script inline o `blocked-uri` é a palavra "inline".

   Normalizar aqui é fazer com este texto o que o parser fará com ele. */
const asHtmlParser = s => s.replace(/\r\n?/g, '\n');

/** Para onde o navegador manda o que ele teria bloqueado. Ver routes/csp.js. */
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
    /* O corpo inteiro, sem aparar: o espaço em branco conta, e um `.trim()`
       aqui produziria um hash que nunca bate com nada. */
    const digest = crypto
      .createHash('sha256')
      .update(asHtmlParser(m[1]), 'utf8')
      .digest('base64');
    out.push(`'sha256-${digest}'`);
  }
  return out;
}

/* Os trackers WebSocket do WebTorrent estão em client/src/lib/torrent.ts, e um
   magnet gerado por um membro carrega esses mesmos endereços dentro de si. */

function policy({ indexPath, https }) {
  const hashes = inlineHashes(indexPath);

  const directives = {
    /* O padrão para tudo que não tiver regra própria: só a nossa origem. */
    'default-src': [`'self'`],

    /* O bundle, o service worker, e os dois trechos inline por hash. Nada de
       `'unsafe-inline'` e nada de `'unsafe-eval'` — ver a abertura. */
    'script-src': [`'self'`, ...hashes],

    /* A folha é um arquivo publicado e a fonte vem do Google — isso resolveria
       sozinho, se não fosse o `style={{...}}` do React, que o CSP trata como
       estilo inline.

       Partida em duas, que é o que o CSP nível 3 permite: BLOCO de estilo
       (`style-src-elem`) só de arquivo, ATRIBUTO (`style-src-attr`) liberado.
       Um `<style>` injetado continua recusado. `style-src` fica como está para
       o navegador antigo que não conhece as duas de baixo. */
    'style-src': [`'self'`, `'unsafe-inline'`, 'https://fonts.googleapis.com'],
    'style-src-elem': [`'self'`, 'https://fonts.googleapis.com'],
    'style-src-attr': [`'unsafe-inline'`],

    /* As duas famílias vêm do CDN do Google. Ver o `<link>` em index.html. */
    'font-src': [`'self'`, 'https://fonts.gstatic.com', 'data:'],

    /* Pôsteres e logos de serviço são do TMDB (ver tmdb.js). `data:` é o
       retrato que a pessoa acabou de recortar, antes de subir; `blob:` é a
       pré-visualização de um arquivo escolhido do disco. */
    'img-src': [`'self'`, 'data:', 'blob:', 'https://image.tmdb.org'],

    /* A direção que interessa contra roubo de dados: um script injetado que não
       abre conexão para fora não manda nada para fora. Por isso `https:` NÃO
       entra — toda chamada deste cliente é `/api/...`.

       `wss:` entra inteiro, e é a única concessão larga do arquivo: o
       WebTorrent precisa dos trackers WebSocket, e um magnet colado de fora
       carrega os DELE — restringir à nossa lista quebraria em silêncio um link
       que veio de outro lugar. A troca passa porque o `fetch` para qualquer
       lugar continua fechado, que é o caminho fácil.

       O par entre navegadores é WebRTC, que não passa por `connect-src`. */
    'connect-src': [`'self'`, 'blob:', 'wss:'],

    /* O filme. `blob:` é o que o service worker do WebTorrent entrega e o que
       um arquivo do disco vira; `https:`/`http:` porque a sala aceita um
       endereço (ver URL_SCHEMES em screening.js) — em HTTPS o navegador já
       recusa o `http:`, que está aqui pelo desenvolvimento local. */
    'media-src': [`'self'`, 'blob:', 'data:', 'https:', 'http:'],

    /* O service worker do torrent (`/sw.min.js`) e o worker que a engine cria
       a partir de um blob. */
    'worker-src': [`'self'`, 'blob:'],

    /* Permissão para EXECUTAR outro site dentro do nosso, com o que ele quiser
       rodar lá dentro — por isso um endereço, e não `https:`. O produto
       emoldura uma coisa só: o player do trailer.

       `youtube-nocookie.com` é o endereço que o próprio YouTube publica para
       este uso. `www.youtube.com` NÃO entra: nada nosso aponta para lá. */
    'frame-src': ['https://www.youtube-nocookie.com'],
    /* E ninguém emoldura este produto. É o X-Frame-Options em versão moderna;
       os dois vão juntos porque nem todo navegador aposentou o antigo. */
    'frame-ancestors': [`'none'`],

    /* `<object>` e `<embed>` não existem aqui, e são um caminho antigo para
       rodar coisa. */
    'object-src': [`'none'`],

    /* Um `<base>` injetado reescreve para onde TODO caminho relativo da página
       aponta — inclusive o do bundle. É barato de fechar e caro de esquecer. */
    'base-uri': [`'self'`],

    /* Para onde um formulário pode ser enviado. Os deste app não são enviados a
       lugar nenhum (todos têm `preventDefault`), e a entrada pelo Google é uma
       navegação, não um envio. */
    'form-action': [`'self'`],
  };

  /* Em produção, qualquer sub-recurso pedido em http vira https antes de sair.
     Em desenvolvimento a própria página é http, e isto quebraria tudo. */
  const linhas = Object.entries(directives).map(([k, v]) => `${k} ${v.join(' ')}`);
  if (https) linhas.push('upgrade-insecure-requests');
  linhas.push(`report-uri ${REPORT_PATH}`);
  return linhas.join('; ');
}

/* ══════════════════════════════════════════════════════════════════════════
   `CINECLUBE_CSP` decide qual cabeçalho sai: `report` (padrão) manda
   `Content-Security-Policy-Report-Only`, que não bloqueia nada e avisa o que
   teria bloqueado; `enforce` manda o de verdade.

   Nessa ordem porque uma CSP errada não avisa — ela apaga um pedaço da tela na
   máquina de outra pessoa. A política foi levantada lendo os arquivos
   publicados, e ler não é o mesmo que abrir a página.
   ══════════════════════════════════════════════════════════════════════════ */
function middleware({ indexPath = path.join(__dirname, 'public', 'index.html') } = {}) {
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
