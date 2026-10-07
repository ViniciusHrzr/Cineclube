const { generate } = require('../push');

const par = generate();
console.log(`VAPID_PUBLIC=${par.public}`);
console.log(`VAPID_PRIVATE=${par.private}`);
console.log('VAPID_SUBJECT=mailto:voce@exemplo.com');
