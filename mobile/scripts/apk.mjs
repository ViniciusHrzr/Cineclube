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

const JDKS = [
  'C:\\Program Files\\Android\\Android Studio\\jbr',
  'C:\\Program Files\\Android\\Android Studio\\jre',
  '/Applications/Android Studio.app/Contents/jbr/Contents/Home',
  '/usr/lib/jvm/java-17-openjdk',
];

const env = { ...process.env };
if (!env.JAVA_HOME) {
  const achado = JDKS.find(caminho => existsSync(join(caminho, 'bin')));
  if (achado) env.JAVA_HOME = achado;
}
if (!env.JAVA_HOME) {
  console.error(
    '[apk] não achei um Java nesta máquina.\n' +
      '      Instale o Android Studio (ele traz um dentro) ou aponte JAVA_HOME\n' +
      '      para um JDK 17.'
  );
  process.exit(1);
}

if (!existsSync(join(android, 'local.properties')) && !env.ANDROID_HOME && !env.ANDROID_SDK_ROOT) {
  console.error(
    '[apk] não achei o SDK do Android.\n' +
      '      Abra mobile/android no Android Studio uma vez — ele escreve o\n' +
      '      local.properties — ou defina ANDROID_HOME.'
  );
  process.exit(1);
}

const pedido = process.argv[2];
const tarefa =
  !pedido || pedido === 'release'
    ? 'assembleRelease'
    : pedido === 'debug'
      ? 'assembleDebug'
      : pedido;

const saida = spawnSync(wrapper, [tarefa], { cwd: android, stdio: 'inherit', shell: janela, env });

if (saida.status === 0 && tarefa.startsWith('assemble')) {
  const pasta = tarefa === 'assembleDebug' ? 'debug' : 'release';
  console.log(`\n[apk] pronto em mobile/android/app/build/outputs/apk/${pasta}/`);
}
process.exit(saida.status ?? 1);
