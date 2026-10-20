// Prepares a photo for the tutor: downsizes it (longest side 1600 px) and re-encodes it as JPEG.
// That keeps it under the backend limit (5 MB, PNG/JPEG/GIF/WebP) and uses less data; it also
// converts formats the backend rejects (HEIC, BMP…) when the browser can decode them.
const MAX_SIDE = 1600, LIMIT = 5 * 1024 * 1024

export class PhotoError extends Error {}

async function decode(file: Blob): Promise<{ img: CanvasImageSource; w: number; h: number; close: () => void }> {
  if ('createImageBitmap' in window) {
    try { const b = await createImageBitmap(file, { imageOrientation: 'from-image' }); return { img: b, w: b.width, h: b.height, close: () => b.close() } } catch { /* fall back to <img> */ }
  }
  const url = URL.createObjectURL(file)
  try {
    const img = new Image(); img.src = url; await img.decode()
    return { img, w: img.naturalWidth, h: img.naturalHeight, close: () => URL.revokeObjectURL(url) }
  } catch { URL.revokeObjectURL(url); throw new PhotoError('No pudimos abrir esa imagen. Probá con una foto JPG o PNG.') }
}

export async function preparePhoto(file: Blob): Promise<string> {
  if (!file.type.startsWith('image/') && file.type !== '') throw new PhotoError('Eso no es una imagen.')
  if (file.size > 40 * 1024 * 1024) throw new PhotoError('La imagen es demasiado grande.')
  const { img, w, h, close } = await decode(file)
  try {
    const k = Math.min(1, MAX_SIDE / Math.max(w, h)), canvas = document.createElement('canvas')
    canvas.width = Math.round(w * k); canvas.height = Math.round(h * k)
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height)   // white background for transparent PNGs
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    for (const quality of [.85, .7, .55]) {
      const url = canvas.toDataURL('image/jpeg', quality)
      if ((url.length - url.indexOf(',') - 1) * .75 < LIMIT) return url
    }
    throw new PhotoError('La imagen supera los 5 MB incluso achicada.')
  } finally { close() }
}
