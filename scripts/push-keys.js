/* ══════════════════════════════════════════════════════════════════════════
   UM PAR DE CHAVES PARA OS AVISOS.

       npm run push:keys

   A metade pública viaja para o navegador de cada pessoa, e é por ela que o
   serviço de entrega reconhece quem manda. A privada fica no servidor e assina
   cada entrega — ver push.js.

   Trocar o par DESLIGA todo mundo: as inscrições existentes foram feitas contra
   a chave antiga, e o serviço passa a recusá-las. Então isto se roda uma vez, e
   o resultado vai para o ambiente do Render, não para o repositório.
   ══════════════════════════════════════════════════════════════════════════ */

const { generate } = require('../push');

const par = generate();
console.log(`VAPID_PUBLIC=${par.public}`);
console.log(`VAPID_PRIVATE=${par.private}`);
console.log('VAPID_SUBJECT=mailto:voce@exemplo.com');
