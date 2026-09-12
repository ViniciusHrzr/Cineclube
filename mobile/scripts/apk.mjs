/* O APK, sem abrir o Android Studio.
 *
 *     npm --prefix mobile run apk        (release)
 *     npm --prefix mobile run apk debug
 *
 * Existe porque o wrapper do Gradle tem dois nomes — `gradlew` e `gradlew.bat` —
 * e lembrar qual é o desta máquina não é trabalho de ninguém. O build em si é o
 * do Gradle, sem nada por cima.
 *
 * Um release SEM keystore.properties sai sem assinatura e não instala em
 * aparelho nenhum; o próprio build avisa. Ver android/app/build.gradle.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const android = join(import.meta.dirname, '..', 'android');
const janela = process.platform === 'win32';
const wrapper = join(android, janela ? 'gradlew.bat' : 'gradlew');

if (!existsSync(wrapper)) {
  console.error('[apk] o projeto Android não está aqui. Rode `npx cap add android` em mobile/.');
  process.exit(1);
}

const tipo = process.argv[2] === 'debug' ? 'assembleDebug' : 'assembleRelease';
const saida = spawnSync(wrapper, [tipo], { cwd: android, stdio: 'inherit', shell: janela });

if (saida.status === 0) {
  const pasta = tipo === 'assembleDebug' ? 'debug' : 'release';
  console.log(`\n[apk] pronto em mobile/android/app/build/outputs/apk/${pasta}/`);
}
process.exit(saida.status ?? 1);
