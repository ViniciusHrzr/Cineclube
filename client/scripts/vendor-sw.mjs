/* ══════════════════════════════════════════════════════════════════════════
   O service worker do WebTorrent, com dois defeitos costurados na saída.

   Era um `copyFileSync` em `package.json` e virou script porque a cópia crua
   tem um bug que derrubava a sessão do clube toda noite, sempre na mesma
   pessoa: quem soltou o filme.

   O worker serve o vídeo por um ReadableStream. A cada `pull` ele arma um timer
   de cinco segundos que mata o canal com a página, e o timer só é desarmado
   pelo `pull` seguinte — nunca pela chegada do pedaço. Ou seja: ele não mede "a
   página demorou a responder", mede "faz cinco segundos que ninguém pede nada".
   E um <video> para de pedir assim que enche o buffer.

   Quem semeia enche o buffer na velocidade do disco, o elemento cala a boca, e
   cinco segundos depois o worker desliga o canal. O que já estava carregado
   continua tocando, então nada parece errado: o filme trava minutos adiante e
   não volta mais, sem evento de erro nenhum. Quem está baixando não passa por
   isso porque o buffer nunca enche.

   As duas correções abaixo são a mesma ideia dita duas vezes: o timer só pode
   significar "a página parou de responder".
   ══════════════════════════════════════════════════════════════════════════ */

import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const source = require.resolve('webtorrent/dist/sw.min.js');
const target = new URL('../public/sw.min.js', import.meta.url);

/* Aplicadas sobre código minificado, o que só é aceitável com a garantia
   abaixo: cada trecho tem de aparecer exatamente uma vez. Se uma atualização
   do WebTorrent renomear uma variável, o build para com uma mensagem em vez de
   copiar o arquivo original em silêncio e devolver o bug ao clube. */
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
