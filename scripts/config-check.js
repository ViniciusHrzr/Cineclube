try { require('node:process').loadEnvFile('.env'); } catch (e) { /* .env é opcional */ }

/* ══════════════════════════════════════════════════════════════════════════
   O QUE ESTÁ LIGADO NESTA INSTALAÇÃO.

       npm run check

   Cada recurso deste produto que depende de configuração externa tem a mesma
   regra: sem a variável, ele não existe — a tela não oferece o interruptor, a
   rota responde 404, o Gradle não aplica o plugin. Nada quebra, e é justamente
   isso que torna difícil descobrir que falta alguma coisa.

   Então isto lista, de uma vez: o que está de pé, o que está desligado, e a
   linha exata que liga cada um.

   Roda contra o ambiente DESTA máquina. Para conferir o servidor, as duas
   perguntas que respondem de fora estão no fim da lista.
   ══════════════════════════════════════════════════════════════════════════ */

const has = nome => !!String(process.env[nome] || '').trim();
const algum = (...nomes) => nomes.some(has);

const itens = [
  {
    o: 'O catálogo (TMDB)',
    ok: has('TMDB_TOKEN'),
    como: 'TMDB_TOKEN — o API Read Access Token (v4) do themoviedb.org',
    sem: 'sem ele o produto não tem filme nem série nenhuma',
  },
  {
    o: 'O banco em produção (Turso)',
    ok: has('TURSO_DATABASE_URL') && has('TURSO_AUTH_TOKEN'),
    como: 'TURSO_DATABASE_URL e TURSO_AUTH_TOKEN',
    sem: 'sem eles o app abre data/cineclube.db, que é o modo de desenvolvimento',
  },
  {
    o: 'Entrar pelo Google',
    ok: has('GOOGLE_CLIENT_ID') && has('GOOGLE_CLIENT_SECRET'),
    como: 'GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET, e CINECLUBE_BASE_URL para o redirect bater',
    sem: 'a tela de entrada oferece só e-mail e senha',
  },
  {
    o: 'Mandar e-mail (confirmação, senha esquecida)',
    ok: has('BREVO_API_KEY'),
    como: 'BREVO_API_KEY e CINECLUBE_MAIL_FROM',
    sem: 'a tela não oferece "reenviar confirmação" nem "esqueci minha senha"',
  },
  {
    o: 'Aviso de estreia no navegador e no PWA',
    ok: has('VAPID_PUBLIC') && has('VAPID_PRIVATE'),
    como: 'npm run push:keys, e as três linhas que ele imprime',
    sem: 'Ajustes não mostra o interruptor de Avisos',
  },
  {
    o: 'Aviso de estreia dentro do APK',
    ok: algum('FCM_SERVICE_ACCOUNT', 'FCM_PRIVATE_KEY'),
    como: 'FCM_SERVICE_ACCOUNT com o JSON da conta de serviço do Firebase',
    sem: 'o aplicativo não oferece o interruptor de Avisos (o navegador continua oferecendo)',
  },
  {
    o: 'O relógio que dispara os avisos do dia',
    ok: has('CINECLUBE_CRON_SECRET'),
    como: 'CINECLUBE_CRON_SECRET aqui e nos segredos do GitHub, com CINECLUBE_URL',
    sem: 'a porta /api/push/airing responde 404 e ninguém é avisado',
  },
  {
    o: 'O link do clube abrindo dentro do aplicativo',
    ok: has('ANDROID_FINGERPRINT'),
    como: 'ANDROID_FINGERPRINT — a linha SHA-256 de `keytool -list -v -keystore <arquivo>`',
    sem: 'os links do grupo abrem no navegador',
  },
  {
    o: 'A sala ao vivo atrás de rede difícil (TURN)',
    ok: has('TURN_URLS'),
    como: 'TURN_URLS e TURN_SECRET (ou usuário e senha)',
    sem: 'quem estiver em rede móvel pode não receber a transmissão',
  },
  {
    o: 'Cookie de sessão marcado como seguro',
    ok: has('CINECLUBE_HTTPS'),
    como: 'CINECLUBE_HTTPS=1 — em produção, atrás de TLS',
    sem: 'correto em desenvolvimento; em produção é uma falha de segurança',
  },
];

const verde = t => `\x1b[32m${t}\x1b[0m`;
const vermelho = t => `\x1b[31m${t}\x1b[0m`;
const fraco = t => `\x1b[2m${t}\x1b[0m`;

console.log('');
for (const item of itens) {
  console.log(`${item.ok ? verde('  ligado  ') : vermelho(' desligado')}  ${item.o}`);
  if (!item.ok) {
    console.log(fraco(`              ${item.como}`));
    console.log(fraco(`              sem isso: ${item.sem}`));
  }
}

const faltam = itens.filter(i => !i.ok).length;
console.log('');
console.log(faltam ? `${faltam} recurso(s) desligado(s).` : 'Tudo o que depende de configuração está de pé.');

console.log(
  fraco(
    '\nO servidor responde por si em duas perguntas:\n' +
      '  curl https://<seu-servidor>/.well-known/assetlinks.json\n' +
      '  curl -X POST https://<seu-servidor>/api/push/airing -H "X-Cineclube-Cron: <segredo>"\n'
  )
);
