// Separado del componente 3D para no cargar three.js solo para saber si hay WebGL.
export function hayWebGL() { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')) } catch { return false } }
