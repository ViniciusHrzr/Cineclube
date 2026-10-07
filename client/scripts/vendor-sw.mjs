import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const source = require.resolve('webtorrent/dist/sw.min.js');
const target = new URL('../public/sw.min.js', import.meta.url);

const patches = [
  {
    why: 'desarma o relógio quando o pedaço chega, não quando o próximo é pedido',
    from: 'i.onmessage=({data:e})=>{e?s.enqueue(e):(d(),s.close()),t()}',
    to: 'i.onmessage=({data:e})=>{e?(clearTimeout(c),s.enqueue(e)):(d(),s.close()),t()}',
  },
  {
    why: 'e dá ao enxame tempo de achar a peça antes de desistir da página',
    from: 'c=setTimeout(()=>{d(),t()},5e3)',
    to: 'c=setTimeout(()=>{d(),t()},45e3)',
  },
];

let code = readFileSync(source, 'utf8');

for (const { why, from, to } of patches) {
  const hits = code.split(from).length - 1;
  if (hits !== 1) {
    console.error(`\n[vendor:sw] o service worker do WebTorrent mudou — o remendo "${why}" não se aplica mais.`);
    console.error(`[vendor:sw] esperava 1 ocorrência de:\n  ${from}\n[vendor:sw] encontrei ${hits}.`);
    console.error('[vendor:sw] leia o comentário no topo de scripts/vendor-sw.mjs antes de mexer.\n');
    process.exit(1);
  }
  code = code.replace(from, to);
}

mkdirSync(new URL('../public/', import.meta.url), { recursive: true });
writeFileSync(target, code);
console.log(`[vendor:sw] sw.min.js gerado com ${patches.length} correções.`);
