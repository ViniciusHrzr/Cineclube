/* O build do aplicativo precisa saber ONDE a API mora — o site fala com a
   própria origem, o app não tem servidor dentro dele. A variável vive em
   `client/.env.app`, que não é versionado: o endereço do serviço fica só na
   máquina, como render.yaml.

   Isto existe porque a falha silenciosa é cara: sem a variável, o build sai
   inteiro e o APK instalado tenta chamar `https://localhost/api` — que é ele
   mesmo. O app abre, desenha a moldura, e nada carrega. */

import { existsSync, readFileSync } from 'node:fs';

const arquivo = new URL('../.env.app', import.meta.url);
const texto = existsSync(arquivo) ? readFileSync(arquivo, 'utf8') : '';
const achado = /^\s*VITE_API_BASE\s*=\s*(\S+)/m.exec(texto);

if (!achado) {
  console.error(
    '\n[app] Falta client/.env.app com VITE_API_BASE.\n' +
      '      Copie client/.env.app.example e ponha o endereço do servidor:\n' +
      '        VITE_API_BASE=https://seu-servidor\n' +
      '      Sem ele o app procura a API dentro do próprio aparelho.\n'
  );
  process.exit(1);
}

console.log(`[app] API em ${achado[1]}`);
