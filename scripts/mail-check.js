try { require('node:process').loadEnvFile('.env'); } catch { }

const mail = require('../lib/mail');

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
  if (out.reason === 'rejected') console.error(mail.keyHint());
  process.exit(1);
}

main().catch(err => {
  console.error('[mail:test] falhou:', err.message);
  process.exit(1);
});
