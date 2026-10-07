export const PORTRAIT_SIDE = 256;
const MAX_FILE_BYTES = 12 * 1024 * 1024;

export type Loaded = {
  source: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
};

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

export type Crop = { x: number; y: number; side: number };

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
