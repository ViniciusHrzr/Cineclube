/* ══════════════════════════════════════════════════════════════════════════
   A CASCA ANDROID.

   Não há app nativo aqui: o que roda dentro dela é o mesmo cliente que o site
   serve, empacotado. O que muda entre os dois é uma variável de build
   (`VITE_API_BASE`), e é ela que faz a sessão viajar em `Bearer` em vez de
   cookie — ver client/src/lib/session.ts.

   ── por que os arquivos vão DENTRO do APK ────────────────────────────────
   A outra opção era `server.url` apontando para o Render: a casca vira uma
   janela do site, e um deploy atualiza os dois de uma vez. Foi recusada por
   duas razões:

   · **o app abriria em branco** toda vez que o servidor estivesse fora do ar ou
     a rede caísse — e uma instância pequena dorme;
   · **a primeira tela custaria uma volta à rede**, sempre. Um app que demora
     dois segundos para desenhar a moldura é um app que parece quebrado.

   Com os arquivos embarcados o app abre offline e instantâneo, e o preço é que
   um deploy do site NÃO atualiza quem já instalou. Esse preço se paga no passo
   seguinte, com atualização pelo ar (OTA): o app baixa o mesmo pacote que o
   deploy gerou e troca sozinho, caindo para o embarcado quando a troca falha.
   Até lá, atualizar o app é publicar uma versão.

   ── o esquema ────────────────────────────────────────────────────────────
   `https` é o padrão do Capacitor no Android e fica: a página passa a rodar em
   `https://localhost`, que é contexto seguro — e sem isso o service worker que
   serve o vídeo da Sessão se recusa a registrar. Essa origem já está na lista
   do servidor; ver cors.js.
   ══════════════════════════════════════════════════════════════════════════ */

const { existsSync, readFileSync } = require('node:fs');
const { join } = require('node:path');

/* O endereço do servidor, lido de client/.env.app — o mesmo arquivo que o build
   do cliente usa, e que não é versionado. Aqui ele decide para onde o
   aplicativo pergunta se existe versão nova; escrevê-lo neste arquivo poria o
   endereço no repositório, que é justamente o que aquele .env evita. */
function apiBase() {
  const arquivo = join(__dirname, '..', 'client', '.env.app');
  if (!existsSync(arquivo)) return '';
  const achado = /^\s*VITE_API_BASE\s*=\s*(\S+)/m.exec(readFileSync(arquivo, 'utf8'));
  return achado ? achado[1].replace(/\/$/, '') : '';
}

const base = apiBase();

/** @type {import('@capacitor/cli').CapacitorConfig} */
const config = {
  /* O identificador do pacote. Ele é PERMANENTE depois da primeira publicação:
     a Play Store trata outro id como outro aplicativo, sem caminho de volta e
     sem levar as instalações junto. */
  appId: 'com.cineclube.app',
  appName: 'Cineclube',

  /* O cliente compilado com o endereço da API dentro. É outro build que o do
     site — ver `build:app` em client/package.json — e por isso outra pasta:
     `app/public` é o que o Express serve, e ele fala com a própria origem. */
  webDir: 'www',

  android: {
    /* Nada de http dentro de uma página https. O servidor é TLS, e a exceção
       existiria só para desenvolvimento contra uma máquina da rede local. */
    allowMixedContent: false,
  },

  plugins: {
    /* ── a atualização pelo ar ───────────────────────────────────────────
       O que paga o preço de embarcar os arquivos: na abertura, o app pergunta
       ao servidor se existe pacote novo, baixa, e troca na abertura seguinte.
       O servidor zipa a própria pasta que ele serve — ver ota.js —, então o
       que chega aqui é byte a byte o que o site está publicando.

       `autoUpdate` deixa o plugin cuidar do ciclo sozinho. A rede de proteção é
       o aviso de que a tela subiu: sem ele, o plugin DESFAZ a troca e volta ao
       pacote anterior. Quem o manda é o cliente, quando a árvore monta — ver
       appIsReady em client/src/lib/session.ts.

       Sem endereço, o recurso simplesmente não existe: um APK compilado sem
       client/.env.app é um app que não atualiza, e não um que atualiza errado. */
    CapacitorUpdater: {
      autoUpdate: !!base,
      ...(base ? { updateUrl: `${base}/api/app/update` } : {}),
      /* Publicar na loja volta ao pacote que veio no APK. É o certo: aquele é o
         mais novo que existe naquele instante, e a próxima pergunta ao servidor
         resolve o resto. */
      resetWhenUpdate: true,
      /* Dez segundos para a tela dizer que subiu. Passado isso, o pacote novo é
         considerado quebrado e o anterior volta. */
      appReadyTimeout: 10000,
    },
  },
};

module.exports = config;
