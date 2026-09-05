try { require('node:process').loadEnvFile('.env'); } catch { /* .env é opcional */ }

const mail = require('../mail');

/* ══════════════════════════════════════════════════════════════════════════
   MANDA UM E-MAIL DE VERDADE, AGORA.

       npm run mail:check -- voce@exemplo.com

   Existe por causa do laço que ele encurta. Sem isto, conferir uma chave de
   envio é: editar a variável no painel → esperar o serviço reiniciar → provocar
   um envio pela interface → abrir os logs → ler. Três minutos por tentativa, e
   a resposta chega num lugar diferente de onde se está trabalhando.

   Aqui é um comando e cinco segundos, e ele usa `mail.send` — a mesma função
   que o produto usa, com os mesmos cabeçalhos, o mesmo corpo e o mesmo timeout.
   Um script que montasse a requisição por conta própria testaria o script.

   ── e por que `check` e não `test` no nome ────────────────────────────────
   Chamou-se `mail-test.js` por dez minutos, e o `npm test` quebrou: `node
   --test` varre `*-test.js` como suíte, e este arquivo manda um e-mail de
   verdade ao ser carregado. É o mesmo motivo pelo qual `testkit.js` mora fora
   de `test/` — só que ali a armadilha é a pasta e aqui é o sufixo.

   ── as duas variáveis ─────────────────────────────────────────────────────
   Lidas do ambiente ou do `.env`:

       BREVO_API_KEY          a chave da API v3 (começa com `xkeysib-`)
       CINECLUBE_MAIL_FROM    o remetente VERIFICADO no painel do Brevo

   O remetente é a segunda causa de recusa depois da chave, e ela vem com outro
   código: um endereço não verificado dá 400, não 401.
   ══════════════════════════════════════════════════════════════════════════ */

async function main() {
  const para = process.argv[2];
  if (!para || !para.includes('@')) {
    console.error('Uso: npm run mail:check -- voce@exemplo.com');
    process.exit(1);
  }

  if (!mail.configured()) {
    console.error('Faltam BREVO_API_KEY e/ou CINECLUBE_MAIL_FROM no ambiente (ou no .env).');
    process.exit(1);
  }

  console.log(`Mandando de ${process.env.CINECLUBE_MAIL_FROM} para ${para}…`);
  const out = await mail.send({
    to: para,
    toName: 'Teste',
    subject: 'Teste de envio do Cineclube',
    text: [
      'Se esta mensagem chegou, o envio está funcionando.',
      '',
      'Ela foi mandada por `npm run mail:test` e não significa nada sobre a sua conta.',
    ].join('\n'),
  });

  if (out.sent) {
    console.log('\n✓ O provedor aceitou.');
    console.log('  Olhe a caixa de entrada — e o spam, que é onde o primeiro envio de um');
    console.log('  remetente novo costuma cair. Aceito não é o mesmo que entregue: o');
    console.log('  painel do Brevo, em Transactional → Logs, mostra o que aconteceu depois.');
    return;
  }

  console.error('\n✗ Não saiu. O motivo está na linha [mail] acima.');
  /* A dica de forma da chave também aqui, e não só no 401 do servidor: quem
     está rodando isto está justamente tentando descobrir qual chave é a certa. */
  if (out.reason === 'rejected') console.error(mail.keyHint());
  process.exit(1);
}

main().catch(err => {
  console.error('[mail:test] falhou:', err.message);
  process.exit(1);
});
