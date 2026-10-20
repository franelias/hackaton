// Apart from the 3D component so that knowing whether there is WebGL does not load three.js.
export function hasWebGL() { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')) } catch { return false } }
