import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const arquivo = join(import.meta.dirname, '..', '..', 'client', '.env.app');
const texto = existsSync(arquivo) ? readFileSync(arquivo, 'utf8') : '';
const achado = /^\s*VITE_API_BASE\s*=\s*(\S+)/m.exec(texto);

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
