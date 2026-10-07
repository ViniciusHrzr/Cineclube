const TYPES = ['image/webp', 'image/jpeg', 'image/png'];
const MAX_BYTES = 400 * 1024;

function readDataUrl(value, { types = TYPES, maxBytes = MAX_BYTES } = {}) {
  const m = /^data:([a-z/+-]+);base64,([A-Za-z0-9+/=]+)$/.exec(String(value || ''));
  if (!m) return { error: 'Imagem inválida.' };
  const [, mime, b64] = m;
  if (!types.includes(mime)) return { error: 'A imagem precisa ser WebP, JPEG ou PNG.' };
  if (Math.floor((b64.length * 3) / 4) > maxBytes) return { error: 'A imagem é grande demais.' };
  const buf = Buffer.from(b64, 'base64');
  if (!buf.length) return { error: 'Imagem inválida.' };
  return { data: b64, mime };
}

module.exports = { readDataUrl, TYPES, MAX_BYTES };
