// Prepara una foto para el tutor: la achica (lado mayor 1600 px) y la vuelve a codificar en JPEG.
// Así siempre queda bajo el límite del backend (5 MB, PNG/JPEG/GIF/WebP) y gasta menos datos;
// de paso convierte formatos que el backend no acepta (HEIC, BMP…) si el navegador los puede abrir.
const LADO_MAX = 1600, LIMITE = 5 * 1024 * 1024

export class ErrorFoto extends Error {}

async function abrir(archivo: Blob): Promise<{ img: CanvasImageSource; w: number; h: number; cerrar: () => void }> {
  if ('createImageBitmap' in window) {
    try { const b = await createImageBitmap(archivo, { imageOrientation: 'from-image' }); return { img: b, w: b.width, h: b.height, cerrar: () => b.close() } } catch { /* probar con <img> */ }
  }
  const url = URL.createObjectURL(archivo)
  try {
    const img = new Image(); img.src = url; await img.decode()
    return { img, w: img.naturalWidth, h: img.naturalHeight, cerrar: () => URL.revokeObjectURL(url) }
  } catch { URL.revokeObjectURL(url); throw new ErrorFoto('No pudimos abrir esa imagen. Probá con una foto JPG o PNG.') }
}

export async function prepararFoto(archivo: Blob): Promise<string> {
  if (!archivo.type.startsWith('image/') && archivo.type !== '') throw new ErrorFoto('Eso no es una imagen.')
  if (archivo.size > 40 * 1024 * 1024) throw new ErrorFoto('La imagen es demasiado grande.')
  const { img, w, h, cerrar } = await abrir(archivo)
  try {
    const k = Math.min(1, LADO_MAX / Math.max(w, h)), lienzo = document.createElement('canvas')
    lienzo.width = Math.round(w * k); lienzo.height = Math.round(h * k)
    const ctx = lienzo.getContext('2d')!
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, lienzo.width, lienzo.height)   // fondo blanco para PNG con transparencia
    ctx.drawImage(img, 0, 0, lienzo.width, lienzo.height)
    for (const calidad of [.85, .7, .55]) {
      const url = lienzo.toDataURL('image/jpeg', calidad)
      if ((url.length - url.indexOf(',') - 1) * .75 < LIMITE) return url
    }
    throw new ErrorFoto('La imagen supera los 5 MB incluso achicada.')
  } finally { cerrar() }
}
