/* ── the portrait, cut down to size before it leaves the browser ──────────
   A phone camera produces four megabytes and twelve megapixels for something
   this interface draws at twenty pixels across. Sending that would be sending
   four megabytes to store, to read back, and to push down the wire to every
   member on every visit — for an image nobody will ever see at that size.

   So the shrinking happens here, where the file already is: centre-cropped to a
   square, scaled to a small side, and re-encoded. What reaches the server is
   tens of kilobytes. The server enforces its own ceiling regardless — this is
   the courtesy, not the rule. */

const SIDE = 256;
/** What a browser will attempt to decode. Past this it is not a portrait. */
const MAX_FILE_BYTES = 12 * 1024 * 1024;

type Source = ImageBitmap | HTMLImageElement;

/* `createImageBitmap` is the direct route and the only one that honours the
   orientation an EXIF tag asks for — a portrait shot on a phone is stored
   sideways with a flag saying so, and drawing the pixels without reading the
   flag is how someone ends up lying on their side. Where it is unavailable, an
   <img> decodes the same file, and the browser applies the orientation itself
   as part of loading it. */
async function decode(file: File): Promise<{ source: Source; done: () => void }> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    return { source: bitmap, done: () => bitmap.close() };
  } catch {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.src = url;
    await img.decode();
    return { source: img, done: () => URL.revokeObjectURL(url) };
  }
}

const sizeOf = (s: Source) =>
  s instanceof HTMLImageElement
    ? { w: s.naturalWidth, h: s.naturalHeight }
    : { w: s.width, h: s.height };

/**
 * A square data URL, `SIDE` across, cropped from the middle of the file.
 * Throws with a message meant to be shown to the person who picked the file.
 */
export async function squarePortrait(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Escolha um arquivo de imagem.');
  if (file.size > MAX_FILE_BYTES) throw new Error('A imagem é grande demais (máximo 12 MB).');

  const { source, done } = await decode(file);
  try {
    const { w, h } = sizeOf(source);
    if (!w || !h) throw new Error('Não foi possível ler esta imagem.');

    // The middle of the frame, squared off — a face is almost never in a corner.
    const side = Math.min(w, h);
    const canvas = document.createElement('canvas');
    canvas.width = SIDE;
    canvas.height = SIDE;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Não foi possível processar esta imagem.');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, (w - side) / 2, (h - side) / 2, side, side, 0, 0, SIDE, SIDE);

    /* WebP where it exists, which is everywhere that matters and is about a
       third of the JPEG for the same picture. A browser that cannot encode it
       does not fail — it quietly returns a PNG, which is why the result is
       checked rather than trusted, and JPEG is asked for instead. */
    const webp = canvas.toDataURL('image/webp', 0.85);
    return webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/jpeg', 0.85);
  } finally {
    done();
  }
}
