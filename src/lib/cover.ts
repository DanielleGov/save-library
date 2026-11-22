import { LIMITS } from './types';

export const COVER_MAX_EDGE = 480;

/**
 * Resize a user-picked image on-device into a small static JPEG. Re-encoding through a canvas
 * drops EXIF/GPS and other metadata; only the resized copy is ever stored.
 */
export async function makeCover(file: Blob): Promise<{ bytes: ArrayBuffer; type: string; width: number; height: number }> {
  if (file.size > LIMITS.coverInputBytes) throw new Error('Image is too large (max 30 MB)');
  if (file.type && !file.type.startsWith('image/')) throw new Error('Please choose an image');
  let source: ImageBitmap | HTMLImageElement;
  let sw: number;
  let sh: number;
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
    source = bmp;
    sw = bmp.width;
    sh = bmp.height;
  } catch {
    const img = await loadImage(file);
    source = img;
    sw = img.naturalWidth;
    sh = img.naturalHeight;
  }
  if (!sw || !sh) throw new Error('Could not read this image');
  const scale = Math.min(1, COVER_MAX_EDGE / Math.max(sw, sh));
  const width = Math.max(1, Math.round(sw * scale));
  const height = Math.max(1, Math.round(sh * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, width, height);
  if ('close' in source) source.close();

  for (const q of [0.8, 0.65, 0.5, 0.35]) {
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', q));
    if (blob && blob.size <= LIMITS.coverBytes) {
      return { bytes: await blob.arrayBuffer(), type: 'image/jpeg', width, height };
    }
  }
  throw new Error('Could not shrink this image enough');
}

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('This image format is not supported'));
    };
    img.src = url;
  });
}
