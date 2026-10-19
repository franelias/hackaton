// Markdown mínimo para las respuestas del tutor: párrafos, listas, **negrita**, *cursiva*, `código`, bloques ``` y
// LaTeX ($…$, $$…$$, \(…\), \[…\]) con KaTeX. Arma elementos de React; el único HTML es el que genera
// KaTeX, que escapa la entrada y no admite \href ni comandos de confianza.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import katex from 'katex'
import 'katex/dist/katex.min.css'

const cache = new Map<string, string>()
function formula(tex: string, display: boolean): string {
  const k = (display ? 'D' : 'I') + tex
  let html = cache.get(k)
  if (html == null) { html = katex.renderToString(tex, { displayMode: display, throwOnError: false, strict: 'ignore' }); cache.set(k, html) }
  return html
}

// bloques que pueden tener líneas en blanco adentro: código entre ``` y fórmulas en bloque
const BLOQUES = /(```[^\n]*\n[\s\S]*?```|\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\])/
const EN_LINEA = /(\*\*[^*]+\*\*|`[^`]+`|\\\(.+?\\\)|\$(?!\s)[^$\n]+?(?<!\s)\$|\*[^*\s][^*]*\*)/g

// Con `animar`, cada palabra va en un <span> que aparece con un fundido al montarse. Las claves son
// por posición, así que al crecer el texto solo se montan (y se animan) las palabras nuevas.
function enLinea(t: string, pre: string, animar: boolean): ReactNode[] {
  const partes: ReactNode[] = []
  let ultimo = 0, m: RegExpExecArray | null, k = 0
  const texto = (s: string) => { if (!animar) partes.push(s); else for (const p of s.match(/\s*\S+\s*|\s+/g) ?? []) partes.push(<span key={`${pre}${k++}`} className="palabra">{p}</span>) }
  EN_LINEA.lastIndex = 0
  while ((m = EN_LINEA.exec(t))) {
    if (m.index > ultimo) texto(t.slice(ultimo, m.index))
    const s = m[0], key = `${pre}${k++}`, cls = animar ? 'palabra' : undefined
    if (s.startsWith('**')) partes.push(<strong key={key} className={cls}>{s.slice(2, -2)}</strong>)
    else if (s.startsWith('`')) partes.push(<code key={key} className={cls}>{s.slice(1, -1)}</code>)
    else if (s.startsWith('\\(')) partes.push(<span key={key} className={cls} dangerouslySetInnerHTML={{ __html: formula(s.slice(2, -2), false) }} />)
    else if (s.startsWith('$')) partes.push(<span key={key} className={cls} dangerouslySetInnerHTML={{ __html: formula(s.slice(1, -1), false) }} />)
    else partes.push(<em key={key} className={cls}>{s.slice(1, -1)}</em>)
    ultimo = m.index + s.length
  }
  if (ultimo < t.length) texto(t.slice(ultimo))
  return partes
}

function bloques(texto: string, pre: string, animar: boolean): ReactNode[] {
  return texto.split(/\n{2,}/).filter(b => b.trim()).map((b, i) => {
    const key = `${pre}${i}`, lineas = b.replace(/^\n+|\n+$/g, '').split('\n')
    if (lineas.every(l => /^\s*([-*]|\d+[.)])\s+/.test(l))) {
      const ordenada = /^\s*\d/.test(lineas[0]), items = lineas.map((l, j) => <li key={j}>{enLinea(l.replace(/^\s*([-*]|\d+[.)])\s+/, ''), `${key}.${j}.`, animar)}</li>)
      return ordenada ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>
    }
    if (/^#{1,4}\s/.test(b)) return <p key={key}><strong>{enLinea(b.replace(/^#{1,4}\s/, ''), `${key}.`, animar)}</strong></p>
    return <p key={key}>{lineas.flatMap((l, j) => j ? [<br key={`${key}b${j}`} />, ...enLinea(l, `${key}.${j}.`, animar)] : enLinea(l, `${key}.${j}.`, animar))}</p>
  })
}

export default function Texto({ texto, animar = false }: { texto: string; animar?: boolean }) {
  // se separan antes de partir en párrafos; el código se muestra tal cual, sin Markdown ni LaTeX
  return <>{texto.split(BLOQUES).map((seg, i) => i % 2 === 0 ? bloques(seg, `${i}:`, animar)
    : seg.startsWith('```') ? <pre key={i} className={animar ? 'palabra' : undefined}><code>{seg.slice(seg.indexOf('\n') + 1, -3).replace(/\n$/, '')}</code></pre>
    : <div key={i} className={`formula${animar ? ' palabra' : ''}`} dangerouslySetInnerHTML={{ __html: formula(seg.slice(2, -2), true) }} />)}</>
}

// Construcciones que no se pueden mostrar a medias: si el corte cae adentro de una, se estira hasta su final.
const ENTERAS = /```[\s\S]+?```|\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\(.+?\\\)|\$(?!\s)[^$\n]+?(?<!\s)\$|\*\*[^*]+\*\*|`[^`]+`/g
function corte(t: string, n: number): number {
  if (n >= t.length) return t.length
  const espacio = t.slice(n).search(/\s/)
  n = espacio < 0 ? t.length : n + espacio
  ENTERAS.lastIndex = 0
  for (let m: RegExpExecArray | null; (m = ENTERAS.exec(t)) && m.index < n;) if (n < m.index + m[0].length) n = m.index + m[0].length
  return n
}

const sinMovimiento = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

// Muestra `texto` de a poco, como si se estuviera escribiendo: al menos 90 caracteres por segundo y
// nunca más de ~2,5 s en total. Si el texto sigue creciendo (SSE), sigue de largo.
export function TextoQueAparece({ texto, alCrecer, alTerminar }: { texto: string; alCrecer?: () => void; alTerminar?: () => void }) {
  const [hasta, setHasta] = useState(() => sinMovimiento() ? texto.length : 0)
  const pos = useRef(hasta), cb = useRef({ alCrecer, alTerminar })
  cb.current = { alCrecer, alTerminar }
  useEffect(() => {
    if (pos.current >= texto.length) { cb.current.alTerminar?.(); return }
    const velocidad = Math.max(90, texto.length / 2.5)
    let frame = 0, antes = performance.now()
    const paso = (ahora: number) => {
      pos.current = Math.min(texto.length, pos.current + velocidad * (ahora - antes) / 1000); antes = ahora
      setHasta(Math.floor(pos.current))
      if (pos.current < texto.length) frame = requestAnimationFrame(paso)
      else cb.current.alTerminar?.()
    }
    frame = requestAnimationFrame(paso)
    return () => cancelAnimationFrame(frame)
  }, [texto])
  useEffect(() => { cb.current.alCrecer?.() }, [hasta])
  const visible = texto.slice(0, corte(texto, hasta)), escribiendo = visible.length < texto.length
  return <div className={escribiendo ? 'escribiendo' : undefined}><Texto texto={visible} animar /></div>
}
