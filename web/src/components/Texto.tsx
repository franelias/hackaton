// Markdown mínimo para las respuestas del tutor: párrafos, listas, **negrita**, *cursiva* y `código`.
// Arma elementos de React (nunca HTML crudo). LaTeX queda pendiente (KaTeX).
import type { ReactNode } from 'react'

function enLinea(t: string): ReactNode[] {
  const partes: ReactNode[] = [], re = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*)/g
  let ultimo = 0, m: RegExpExecArray | null, k = 0
  while ((m = re.exec(t))) {
    if (m.index > ultimo) partes.push(t.slice(ultimo, m.index))
    const s = m[0]
    partes.push(s.startsWith('**') ? <strong key={k++}>{s.slice(2, -2)}</strong> : s.startsWith('`') ? <code key={k++}>{s.slice(1, -1)}</code> : <em key={k++}>{s.slice(1, -1)}</em>)
    ultimo = m.index + s.length
  }
  if (ultimo < t.length) partes.push(t.slice(ultimo))
  return partes
}

export default function Texto({ texto }: { texto: string }) {
  const bloques = texto.split(/\n{2,}/)
  return <>{bloques.map((b, i) => {
    const lineas = b.split('\n')
    if (lineas.every(l => /^\s*([-*]|\d+[.)])\s+/.test(l))) {
      const ordenada = /^\s*\d/.test(lineas[0]), items = lineas.map((l, j) => <li key={j}>{enLinea(l.replace(/^\s*([-*]|\d+[.)])\s+/, ''))}</li>)
      return ordenada ? <ol key={i}>{items}</ol> : <ul key={i}>{items}</ul>
    }
    if (/^#{1,4}\s/.test(b)) return <p key={i}><strong>{enLinea(b.replace(/^#{1,4}\s/, ''))}</strong></p>
    return <p key={i}>{lineas.flatMap((l, j) => j ? [<br key={`b${j}`} />, ...enLinea(l)] : enLinea(l))}</p>
  })}</>
}
