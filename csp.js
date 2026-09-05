const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

/* ══════════════════════════════════════════════════════════════════════════
   A POLÍTICA DE CONTEÚDO.

   O que ela é, em uma frase: a lista do que esta página tem permissão de
   carregar e executar. Tudo que não está aqui o navegador recusa — inclusive um
   `<script>` que alguém consiga injetar. É a única defesa contra XSS que
   continua valendo depois de todas as outras falharem.

   Esta não foi escrita de memória. Foi levantada do que os arquivos publicados
   de fato referenciam, um por um, e cada linha abaixo diz de onde veio.

   ── por que o navegador é o juiz, e o servidor não ────────────────────────
   Um `<script>` injetado numa página é executado pelo navegador com todos os
   direitos da página: o cookie de sessão, as rotas autenticadas, o que estiver
   na tela. Nenhuma validação no servidor alcança isso, porque no momento em que
   o script roda o servidor já respondeu. A CSP é a instrução para o navegador
   não rodar.

   ── o que NÃO precisou entrar, e é a melhor notícia deste arquivo ─────────
   `'unsafe-eval'`. Os três pacotes publicados — a aplicação, o WebTorrent e o
   service worker — foram varridos e não têm uma chamada a `eval` nem a
   `new Function`, e não usam WebAssembly. Sem essa exceção, um script injetado
   não consegue nem se montar a partir de texto. Vale conferir de novo no dia em
   que uma dependência nova entrar: é a linha mais fácil de perder.
   ══════════════════════════════════════════════════════════════════════════ */

/* ── os dois scripts de dentro do HTML ────────────────────────────────────
   `index.html` carrega dois trechos inline antes da primeira pintura: o que
   mede a janela e escreve `--ui-zoom`, e o que pergunta se há GPU. Os dois
   precisam rodar ANTES do bundle, então não dá para movê-los para um arquivo.

   Um `'unsafe-inline'` resolveria e destruiria a política inteira: seria dizer
   "qualquer script escrito dentro do HTML pode rodar", que é exatamente o que
   um XSS produz. Então em vez disso cada um entra pelo seu HASH — o navegador
   calcula o SHA-256 do que encontrou e só executa se bater com um da lista.

   Calculado no boot, lendo o HTML publicado. Não é preguiça de gerar na
   build: é o que impede a política de silenciosamente parar de bater no dia em
   que alguém mexer numa daquelas linhas de comentário. O hash acompanha o
   arquivo porque é derivado dele.

   Se o arquivo não estiver lá — desenvolvimento, onde quem serve a página é o
   Vite na 5173 e este cabeçalho nem chega nela — a lista sai vazia e o resto da
   política continua valendo para as respostas da API. */
const INLINE = /<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g;

/* ── a armadilha do fim de linha ──────────────────────────────────────────
   Esta função existe por causa de um defeito que chegou até a produção, e ele é
   a armadilha clássica de hash em CSP.

   O navegador NÃO calcula o hash sobre os bytes que recebeu. Antes de o parser
   de HTML olhar para qualquer coisa, ele normaliza o fluxo de entrada: todo
   CRLF vira LF, e todo CR solto vira LF. O que ele hasheia é o texto do script
   depois disso.

   Este arquivo lia o HTML do disco e hasheava o que estava lá. Num repositório
   cujo `index.html` está gravado em CRLF — que é o caso aqui, 119 CR no arquivo
   publicado —, os dois hashes ficam diferentes por causa de um caractere que o
   navegador já tinha jogado fora, e a política recusa os dois scripts do
   próprio produto.

   O sintoma não ajuda: para script inline o `blocked-uri` é a palavra "inline",
   e o aviso aponta a linha do documento e mais nada. Se isto tivesse ido para o
   modo de bloquear em vez do modo de aviso, a página teria perdido o ajuste de
   zoom e a detecção de GPU sem uma mensagem de erro em lugar nenhum. É
   exatamente para isto que a rodada em modo aviso existe.

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
       aqui produziria um hash que nunca bate com nada. O que muda é só o fim de
       linha, e por quê está escrito em `asHtmlParser`. */
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

    /* ── e por que estilo é diferente ──────────────────────────────────────
       A folha de estilo é um arquivo publicado (o Vite não deixa nada inline) e
       a fonte vem do Google. Isso resolveria `style-src` sozinho, se não fosse
       o `style={{...}}` do React: a cor de cada avaliador, a fração de célula
       acesa numa régua, a duração da parede de cartazes — todos são atributo
       `style` num elemento, e o CSP os trata como estilo inline.

       Então a política é partida em duas, que é o que o CSP nível 3 permite:
       BLOCO de estilo (`style-src-elem`) só de arquivo, e ATRIBUTO de estilo
       (`style-src-attr`) liberado. A diferença importa: um `<style>` injetado
       continua recusado, e o que fica permitido é a única forma que este app
       de fato usa. `style-src` fica como está para o navegador antigo que não
       conhece as duas de baixo — nele a política é a frouxa, que ainda é
       melhor que nenhuma. */
    'style-src': [`'self'`, `'unsafe-inline'`, 'https://fonts.googleapis.com'],
    'style-src-elem': [`'self'`, 'https://fonts.googleapis.com'],
    'style-src-attr': [`'unsafe-inline'`],

    /* As duas famílias vêm do CDN do Google. Ver o `<link>` em index.html. */
    'font-src': [`'self'`, 'https://fonts.gstatic.com', 'data:'],

    /* Pôsteres e logos de serviço são do TMDB (ver tmdb.js). `data:` é o
       retrato que a pessoa acabou de recortar, antes de subir; `blob:` é a
       pré-visualização de um arquivo escolhido do disco. */
    'img-src': [`'self'`, 'data:', 'blob:', 'https://image.tmdb.org'],

    /* ── o que a página tem permissão de FALAR ─────────────────────────────
       É a direção que interessa contra roubo de dados: um script injetado que
       não consegue abrir uma conexão para fora não consegue mandar nada para
       fora. Por isso `https:` NÃO entra aqui — nada neste cliente chama outro
       servidor; toda chamada é `/api/...`.

       `wss:` entra inteiro, e é a única concessão larga do arquivo. O
       WebTorrent precisa dos trackers WebSocket para dois navegadores se
       acharem, e um magnet colado de fora carrega os DELE — restringir à nossa
       lista de quatro quebraria em silêncio um link que veio de outro lugar,
       com a sala dizendo apenas "ninguém respondeu".

       A troca é aceitável porque WebSocket não é vetor de injeção: quem já
       consegue rodar script na página tem coisas melhores a fazer do que um
       socket, e o que este buraco custa é a exfiltração por um canal que o
       navegador só abre depois de um handshake com um servidor preparado para
       isso. O que continua fechado é o `fetch` para qualquer lugar, que é o
       jeito fácil.

       O par entre navegadores é WebRTC, que não passa por `connect-src`. */
    'connect-src': [`'self'`, 'blob:', 'wss:'],

    /* O filme. `blob:` é o que o service worker do WebTorrent entrega e o que
       um arquivo do disco vira; `https:`/`http:` porque a sala aceita que um
       membro aponte para um endereço (ver URL_SCHEMES em screening.js). Numa
       página em HTTPS o próprio navegador já recusa o `http:`, então ele está
       aqui pelo desenvolvimento local e não custa nada em produção. */
    'media-src': [`'self'`, 'blob:', 'data:', 'https:', 'http:'],

    /* O service worker do torrent (`/sw.min.js`) e o worker que a engine cria
       a partir de um blob. */
    'worker-src': [`'self'`, 'blob:'],

    /* Nada neste produto é moldura de nada. Não há um único `<iframe>` no
       cliente — conferido —, e o trailer é um LINK para o YouTube, que abre uma
       aba e não uma moldura. */
    'frame-src': [`'none'`],
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
   Vigiar antes de trancar.

   `CINECLUBE_CSP` decide qual dos dois cabeçalhos sai:

   - `report` (o padrão de hoje): `Content-Security-Policy-Report-Only`. O
     navegador NÃO bloqueia nada e manda um aviso para cada coisa que teria
     bloqueado. É a política sendo medida no navegador de verdade das pessoas do
     clube, que é o único lugar onde ela pode ser medida.
   - `enforce`: o cabeçalho de verdade.

   A ordem é essa e não a inversa por uma razão honesta: esta política foi
   levantada lendo os arquivos publicados, e ler é bom mas não é o mesmo que
   abrir a página. Uma CSP errada não avisa — ela apaga um pedaço da tela na
   máquina de outra pessoa. Uma rodada em modo aviso custa alguns dias e
   substitui o palpite por dado.

   Trocar é uma variável de ambiente, não um deploy.
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
