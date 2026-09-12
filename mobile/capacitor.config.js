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
};

module.exports = config;
