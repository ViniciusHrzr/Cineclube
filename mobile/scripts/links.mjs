/* ══════════════════════════════════════════════════════════════════════════
   O DOMÍNIO DO CLUBE, PARA O ANDROID.

   O manifesto precisa do host escrito nele para reconhecer um link
   `https://…/#c/<slug>` como coisa deste aplicativo. Escrevê-lo lá poria o
   endereço do serviço no repositório — que é justamente o que client/.env.app
   evita —, então ele entra por um recurso gerado aqui, e o manifesto aponta
   para `@string/deeplink_host`.

   Sem `.env.app`, o recurso nasce com um host que não existe: o filtro fica
   declarado e nunca casa com nada, o app compila, e link nenhum é roubado do
   navegador. É o mesmo princípio do `updateUrl`: sem endereço, o recurso não
   funciona — em vez de funcionar errado.
   ══════════════════════════════════════════════════════════════════════════ */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const arquivo = join(import.meta.dirname, '..', '..', 'client', '.env.app');
const texto = existsSync(arquivo) ? readFileSync(arquivo, 'utf8') : '';
const achado = /^\s*VITE_API_BASE\s*=\s*(\S+)/m.exec(texto);

/* Só o host: o filtro do Android é sobre domínio, e um `https://` na frente faz
   o recurso virar um host que nunca casa. */
let host = 'aplicativo.invalido';
if (achado) {
  try {
    host = new URL(achado[1]).host;
  } catch {
    console.warn('[links] VITE_API_BASE não é uma URL; o filtro de link fica inerte.');
  }
}

const destino = join(import.meta.dirname, '..', 'android', 'app', 'src', 'main', 'res', 'values');
mkdirSync(destino, { recursive: true });
writeFileSync(
  join(destino, 'deeplink.xml'),
  `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="deeplink_host" translatable="false">${host}</string>
</resources>
`
);

console.log(`[links] o app reconhece links de ${host}`);
