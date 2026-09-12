/* ══════════════════════════════════════════════════════════════════════════
   O ÍCONE DO APP, DESENHADO EM CÓDIGO.

   Ele é a única peça do produto que não é HTML: um PNG, exigido em três
   tamanhos por quem instala — Android quer 192 e 512, o iPhone quer 180, e a
   máscara circular do Android precisa de uma quarta versão com o desenho
   recuado para o corte não comer nada.

   Gerado em vez de versionado, como o service worker do WebTorrent ao lado:
   são quatro arquivos derivados de quatro cores e três medidas, e um PNG no
   repositório é uma cópia que ninguém sabe refazer no dia em que a paleta
   mudar.

   Sem biblioteca de imagem, e não é bravata: o desenho é retângulo e trapézio,
   e um PNG é `zlib` por cima de linhas de pixel com um byte de filtro na
   frente. A alternativa era uma dependência de dez megabytes na árvore de
   build para pintar quatro quadrados.

   O DESENHO é o que o produto é: a sala escura, a moldura de latão de um
   fotograma, e o facho de luz cruzando de um lado ao outro. Sem letra nenhuma —
   um "C" de vinte pixels na tela inicial de um telefone não é lido por
   ninguém. */

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

/* A paleta da sala, as mesmas de tailwind.config.ts. Copiadas e não
   importadas: aquele arquivo é TypeScript e este roda antes do build. Quatro
   valores que mudam uma vez por ano. */
const HOUSE = [0x07, 0x09, 0x0e];
const BRASS = [0xd9, 0xa4, 0x41];
const BEAM = [0xff, 0xe9, 0xc4];

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** Um PNG RGB de `size`×`size` a partir de um buffer de pixels. */
function png(size, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bits por canal
  header[9] = 2; // cor verdadeira, sem alfa: o fundo é a sala, nunca transparente
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    // O byte de filtro por linha. Zero: nenhum — o desenho tem áreas chapadas,
    // e o deflate resolve a repetição sozinho.
    raw[y * (size * 3 + 1)] = 0;
    pixels.copy(raw, y * (size * 3 + 1) + 1, y * size * 3, (y + 1) * size * 3);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* `inset` é o recuo do desenho dentro do quadro, em fração do lado. A máscara
   do Android corta um círculo de 80% do ícone: com o desenho encostado na
   borda, a moldura de latão vira quatro cantos cortados. */
function draw(size, inset) {
  const px = Buffer.alloc(size * size * 3);
  const put = (x, y, [r, g, b]) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 3;
    px[i] = r;
    px[i + 1] = g;
    px[i + 2] = b;
  };

  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) put(x, y, HOUSE);

  const pad = Math.round(size * inset);
  const side = size - pad * 2;
  const frame = Math.max(2, Math.round(side * 0.075));

  /* ── o facho ─────────────────────────────────────────────────────────────
     Um trapézio: sai estreito da esquerda, na altura do projetor, e chega
     aberto na direita. É a luz atravessando a sala, e é o que dá direção ao
     ícone num tamanho em que nada mais é legível. */
  const x0 = pad + frame;
  const x1 = pad + side - frame;
  const meio = pad + side / 2;
  const bocaCima = meio - side * 0.06;
  const bocaBaixo = meio + side * 0.06;
  const telaCima = pad + side * 0.16;
  const telaBaixo = pad + side - side * 0.16;

  for (let x = x0; x < x1; x++) {
    const t = (x - x0) / Math.max(1, x1 - x0 - 1);
    const cima = bocaCima + (telaCima - bocaCima) * t;
    const baixo = bocaBaixo + (telaBaixo - bocaBaixo) * t;
    for (let y = Math.round(cima); y < Math.round(baixo); y++) put(x, y, BEAM);
  }

  // ── a moldura do fotograma, por cima do facho ──────────────────────────
  for (let y = pad; y < pad + side; y++) {
    for (let x = pad; x < pad + side; x++) {
      const borda =
        x < pad + frame || x >= pad + side - frame || y < pad + frame || y >= pad + side - frame;
      if (borda) put(x, y, BRASS);
    }
  }

  /* E as perfurações: dois pares de furos nas bordas de cima e de baixo, que é
     o que faz um quadrado virar um FOTOGRAMA. */
  const furo = Math.round(side * 0.09);
  const folga = Math.round((frame - furo) / 2);
  for (const cx of [pad + side * 0.3, pad + side * 0.7]) {
    for (const cy of [pad + folga, pad + side - frame + folga]) {
      for (let y = 0; y < furo; y++) {
        for (let x = 0; x < furo; x++) put(Math.round(cx - furo / 2) + x, Math.round(cy) + y, HOUSE);
      }
    }
  }

  return px;
}

const out = new URL('../public/', import.meta.url);
mkdirSync(out, { recursive: true });

/* O recuo de 6% é margem ótica — o ícone quadrado do iPhone e o atalho do
   Android já vêm cortados por fora. O de 20% é o que a máscara circular pede. */
const feitos = [
  ['icon-192.png', 192, 0.06],
  ['icon-512.png', 512, 0.06],
  ['icon-180.png', 180, 0.06],
  ['icon-mask-512.png', 512, 0.2],
];

for (const [nome, size, inset] of feitos) {
  writeFileSync(new URL(nome, out), png(size, draw(size, inset)));
}

console.log(`[icons] ${feitos.length} ícones gerados.`);
