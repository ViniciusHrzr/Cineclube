/* ══════════════════════════════════════════════════════════════════════════
   O MESMO ÍCONE, NO FORMATO QUE O ANDROID PEDE.

   O desenho vem de client/scripts/icons.mjs — um só, para o atalho do navegador
   e o app instalado não serem duas marcas diferentes do mesmo produto. O que
   este arquivo faz é traduzi-lo para as exigências da plataforma:

   · **cinco densidades**, de 48 a 192 pixels. O Android escolhe pela tela.
   · **três formatos por densidade**: o quadrado antigo, o redondo de quem usa
     máscara circular, e a camada de frente do ícone adaptativo.
   · **o adaptativo é maior e mais recuado.** Ele é desenhado em 108dp e a
     máscara — círculo, quadrado arredondado, gota, conforme o fabricante —
     corta tudo fora dos 72dp centrais. Com o desenho encostado na borda, a
     moldura de latão perde os quatro cantos.

   Rodado por `npm run icons` dentro de mobile/, e antes de gerar um APK. Os
   arquivos ficam versionados junto com o resto do projeto Android: eles são
   parte do que o Gradle compila, e o build do aplicativo não roda Node.
   ══════════════════════════════════════════════════════════════════════════ */

import { mkdirSync, writeFileSync } from 'node:fs';
import { draw, png } from '../../client/scripts/icons.mjs';

const res = new URL('../android/app/src/main/res/', import.meta.url);

/* As densidades do Android, no tamanho do ícone de lançamento (48dp) e no da
   camada adaptativa (108dp). */
const DENSIDADES = [
  ['mdpi', 1],
  ['hdpi', 1.5],
  ['xhdpi', 2],
  ['xxhdpi', 3],
  ['xxxhdpi', 4],
];

/* Três recuos, três máscaras. O quadrado quase não corta; o redondo corta o
   círculo inscrito; o adaptativo corta dois terços do lado. */
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

/* O fundo do ícone adaptativo. Nasce branco no projeto que o Capacitor cria, e
   um quadrado branco atrás de uma sala escura é a moldura do produto com a luz
   acesa. */
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
