/* O cliente encolhe a imagem para um quadrado pequeno antes de mandar. Um
   corpo perto do teto quer dizer que o cliente não estava no caminho — o
   navegador é conveniência, nunca a checagem. */

const TYPES = ['image/webp', 'image/jpeg', 'image/png'];
const MAX_BYTES = 400 * 1024;

/** Uma data URL entra, `{ data, mime }` ou `{ error }` sai. Nunca lança. */
function readDataUrl(value, { types = TYPES, maxBytes = MAX_BYTES } = {}) {
  const m = /^data:([a-z/+-]+);base64,([A-Za-z0-9+/=]+)$/.exec(String(value || ''));
  if (!m) return { error: 'Imagem inválida.' };
  const [, mime, b64] = m;
  if (!types.includes(mime)) return { error: 'A imagem precisa ser WebP, JPEG ou PNG.' };
  /* Base64 são 4 caracteres a cada 3 bytes; medir a string evita decodificar
     algo grande demais só para descobrir que era grande demais. */
  if (Math.floor((b64.length * 3) / 4) > maxBytes) return { error: 'A imagem é grande demais.' };
  const buf = Buffer.from(b64, 'base64');
  if (!buf.length) return { error: 'Imagem inválida.' };
  return { data: b64, mime };
}

module.exports = { readDataUrl, TYPES, MAX_BYTES };
