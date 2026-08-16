/* ── the portrait, cut down to size before it leaves the browser ──────────
   A phone camera produces four megabytes and twelve megapixels for something
   this interface draws at twenty pixels across. Sending that would be sending
   four megabytes to store, to read back, and to push down the wire to every
   member on every visit — for an image nobody will ever see at that size.

   So the shrinking happens here, where the file already is. What reaches the
   server is tens of kilobytes. The server enforces its own ceiling regardless
   — this is the courtesy, not the rule.

   What it does *not* do any more is decide the framing. Cutting a square out
   of the middle is a guess, and it is wrong exactly as often as a face is not
   dead centre — which, in a photo somebody chose of themselves, is most of the
   time. The framing is now a decision the person makes; this file only loads
   the picture and cuts where it is told. */

/** The side of the square that is stored. Twelve times what it is drawn at. */
export const PORTRAIT_SIDE = 256;
/** What a browser will attempt to decode. Past this it is not a portrait. */
const MAX_FILE_BYTES = 12 * 1024 * 1024;

export type Loaded = {
  source: CanvasImageSource;
  width: number;
  height: number;
  /** Frees the decoded image. The caller owns this. */
  release: () => void;
};

/* `createImageBitmap` is the direct route and the only one that honours the
   orientation an EXIF tag asks for — a portrait shot on a phone is stored
   sideways with a flag saying so, and drawing the pixels without reading the
   flag is how someone ends up lying on their side. Where it is unavailable, an
   <img> decodes the same file and the browser applies the orientation itself
   as part of loading it. */
export async function loadImage(file: File): Promise<Loaded> {
  if (!file.type.startsWith('image/')) throw new Error('Escolha um arquivo de imagem.');
  if (file.size > MAX_FILE_BYTES) throw new Error('A imagem é grande demais (máximo 12 MB).');

  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    if (!bitmap.width || !bitmap.height) throw new Error('vazia');
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      release: () => bitmap.close(),
    };
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      if (!img.naturalWidth || !img.naturalHeight) throw new Error('vazia');
      return {
        source: img,
        width: img.naturalWidth,
        height: img.naturalHeight,
        release: () => URL.revokeObjectURL(url),
      };
    } catch {
      URL.revokeObjectURL(url);
      throw new Error('Não foi possível ler esta imagem.');
    }
  }
}

/** A square region of the source, in source pixels. */
export type Crop = { x: number; y: number; side: number };

/**
 * The chosen square, encoded small. WebP where it exists — about a third of
 * the JPEG for the same picture — and JPEG where it does not. A browser that
 * cannot encode WebP does not fail, it quietly returns a PNG, which is why the
 * result is checked rather than trusted.
 */
export function encodeCrop(loaded: Loaded, crop: Crop): string {
  const canvas = document.createElement('canvas');
  canvas.width = PORTRAIT_SIDE;
  canvas.height = PORTRAIT_SIDE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Não foi possível processar esta imagem.');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(
    loaded.source,
    crop.x,
    crop.y,
    crop.side,
    crop.side,
    0,
    0,
    PORTRAIT_SIDE,
    PORTRAIT_SIDE
  );

  const webp = canvas.toDataURL('image/webp', 0.85);
  return webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/jpeg', 0.85);
}
