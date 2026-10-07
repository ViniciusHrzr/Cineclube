import { mkdirSync, writeFileSync } from 'node:fs';
import { draw, png } from '../../client/scripts/icons.mjs';

const res = new URL('../android/app/src/main/res/', import.meta.url);

const DENSIDADES = [
  ['mdpi', 1],
  ['hdpi', 1.5],
  ['xhdpi', 2],
  ['xxhdpi', 3],
  ['xxxhdpi', 4],
];

const RECUO = { quadrado: 0.06, redondo: 0.16, adaptativo: 0.22 };

let escritos = 0;
for (const [nome, escala] of DENSIDADES) {
  const pasta = new URL(`mipmap-${nome}/`, res);
  mkdirSync(pasta, { recursive: true });

  const lancador = Math.round(48 * escala);
  const adaptativo = Math.round(108 * escala);

  const arquivos = [
    ['ic_launcher.png', lancador, RECUO.quadrado],
    ['ic_launcher_round.png', lancador, RECUO.redondo],
    ['ic_launcher_foreground.png', adaptativo, RECUO.adaptativo],
  ];

  for (const [arquivo, size, inset] of arquivos) {
    writeFileSync(new URL(arquivo, pasta), png(size, draw(size, inset)));
    escritos += 1;
  }
}

mkdirSync(new URL('values/', res), { recursive: true });
writeFileSync(
  new URL('values/ic_launcher_background.xml', res),
  `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#07090E</color>
</resources>
`
);

console.log(`[icons] ${escritos} ícones do Android gerados.`);
