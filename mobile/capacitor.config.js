const { existsSync, readFileSync } = require('node:fs');
const { join } = require('node:path');

function apiBase() {
  const arquivo = join(__dirname, '..', 'client', '.env.app');
  if (!existsSync(arquivo)) return '';
  const achado = /^\s*VITE_API_BASE\s*=\s*(\S+)/m.exec(readFileSync(arquivo, 'utf8'));
  return achado ? achado[1].replace(/\/$/, '') : '';
}

const base = apiBase();

const config = {
  appId: 'com.cineclube.app',
  appName: 'Cineclube',

  webDir: 'www',

  android: {
    allowMixedContent: false,
  },

  plugins: {
    CapacitorUpdater: {
      autoUpdate: !!base,
      ...(base ? { updateUrl: `${base}/api/app/update` } : {}),
      directUpdate: true,
      resetWhenUpdate: true,
      appReadyTimeout: 10000,
    },
  },
};

module.exports = config;
