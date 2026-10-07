const fs = require('node:fs');
const path = require('node:path');

const arquivo = path.join(__dirname, '..', 'client', '.env.app');
const atual = () => {
  if (!fs.existsSync(arquivo)) return null;
  const achado = /^\s*VITE_API_BASE\s*=\s*(\S+)/m.exec(fs.readFileSync(arquivo, 'utf8'));
  return achado ? achado[1] : null;
};

const dito = (process.argv[2] || '').trim();

if (!dito) {
  const tem = atual();
  console.log(
    tem
      ? `[app] a API do aplicativo está em ${tem}\n      para trocar: npm run app:url https://outro-endereco`
      : '[app] nenhum endereço configurado ainda.\n      npm run app:url https://o-seu-servico'
  );
  process.exit(tem ? 0 : 1);
}

let url;
try {
  url = new URL(dito);
} catch {
  console.error(`[app] "${dito}" não é um endereço. Exemplo: https://cineclube.onrender.com`);
  process.exit(1);
}

if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
  console.error('[app] tem de ser https — o Android recusa tráfego em claro.');
  process.exit(1);
}

if (url.pathname !== '/' || url.search || url.hash) {
  console.error('[app] só o endereço do servidor, sem caminho: https://o-seu-servico');
  process.exit(1);
}

const base = url.origin;
fs.writeFileSync(
  arquivo,
  `# Onde a API mora, para o build que vai dentro do aplicativo. Escrito por
# \`npm run app:url\`. O site não usa nada disto: lá a API é a própria origem.
VITE_API_BASE=${base}
`
);

console.log(`[app] a API do aplicativo agora é ${base}`);
console.log('      próximo: npm run app   (compila o cliente e sincroniza a casca)');
