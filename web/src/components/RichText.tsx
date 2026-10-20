// Minimal Markdown for the tutor's replies: paragraphs, lists, **bold**, *italics*, `code`, ``` blocks and
// LaTeX ($…$, $$…$$, \(…\), \[…\]) with KaTeX. Builds React elements; the only HTML is the one KaTeX
// generates, which escapes its input and does not allow \href or trusted commands.
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

// blocks that may contain blank lines: ``` code and display formulas
const BLOCKS = /(```[^\n]*\n[\s\S]*?```|\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\])/
const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\\\(.+?\\\)|\$(?!\s)[^$\n]+?(?<!\s)\$|\*[^*\s][^*]*\*)/g

// With `animate`, each word goes in a <span> that fades in when it mounts. Keys are positional,
// so as the text grows only the new words mount (and animate).
function inline(t: string, prefix: string, animate: boolean): ReactNode[] {
  const parts: ReactNode[] = []
  let last = 0, m: RegExpExecArray | null, k = 0
  const text = (s: string) => { if (!animate) parts.push(s); else for (const p of s.match(/\s*\S+\s*|\s+/g) ?? []) parts.push(<span key={`${prefix}${k++}`} className="word">{p}</span>) }
  INLINE.lastIndex = 0
  while ((m = INLINE.exec(t))) {
    if (m.index > last) text(t.slice(last, m.index))
    const s = m[0], key = `${prefix}${k++}`, cls = animate ? 'word' : undefined
    if (s.startsWith('**')) parts.push(<strong key={key} className={cls}>{s.slice(2, -2)}</strong>)
    else if (s.startsWith('`')) parts.push(<code key={key} className={cls}>{s.slice(1, -1)}</code>)
    else if (s.startsWith('\\(')) parts.push(<span key={key} className={cls} dangerouslySetInnerHTML={{ __html: formula(s.slice(2, -2), false) }} />)
    else if (s.startsWith('$')) parts.push(<span key={key} className={cls} dangerouslySetInnerHTML={{ __html: formula(s.slice(1, -1), false) }} />)
    else parts.push(<em key={key} className={cls}>{s.slice(1, -1)}</em>)
    last = m.index + s.length
  }
  if (last < t.length) text(t.slice(last))
  return parts
}

function paragraphs(text: string, prefix: string, animate: boolean): ReactNode[] {
  return text.split(/\n{2,}/).filter(b => b.trim()).map((b, i) => {
    const key = `${prefix}${i}`, lines = b.replace(/^\n+|\n+$/g, '').split('\n')
    if (lines.every(l => /^\s*([-*]|\d+[.)])\s+/.test(l))) {
      const ordered = /^\s*\d/.test(lines[0]), items = lines.map((l, j) => <li key={j}>{inline(l.replace(/^\s*([-*]|\d+[.)])\s+/, ''), `${key}.${j}.`, animate)}</li>)
      return ordered ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>
    }
    if (/^#{1,4}\s/.test(b)) return <p key={key}><strong>{inline(b.replace(/^#{1,4}\s/, ''), `${key}.`, animate)}</strong></p>
    return <p key={key}>{lines.flatMap((l, j) => j ? [<br key={`${key}b${j}`} />, ...inline(l, `${key}.${j}.`, animate)] : inline(l, `${key}.${j}.`, animate))}</p>
  })
}

export default function RichText({ text, animate = false }: { text: string; animate?: boolean }) {
  // split before paragraphs; code is shown as is, without Markdown or LaTeX
  return <>{text.split(BLOCKS).map((seg, i) => i % 2 === 0 ? paragraphs(seg, `${i}:`, animate)
    : seg.startsWith('```') ? <pre key={i} className={animate ? 'word' : undefined}><code>{seg.slice(seg.indexOf('\n') + 1, -3).replace(/\n$/, '')}</code></pre>
    : <div key={i} className={`formula${animate ? ' word' : ''}`} dangerouslySetInnerHTML={{ __html: formula(seg.slice(2, -2), true) }} />)}</>
}

// Constructs that cannot be shown half-way: if the cut falls inside one, it extends to its end.
const WHOLE = /```[\s\S]+?```|\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\(.+?\\\)|\$(?!\s)[^$\n]+?(?<!\s)\$|\*\*[^*]+\*\*|`[^`]+`/g
function cutAt(t: string, n: number): number {
  if (n >= t.length) return t.length
  const space = t.slice(n).search(/\s/)
  n = space < 0 ? t.length : n + space
  WHOLE.lastIndex = 0
  for (let m: RegExpExecArray | null; (m = WHOLE.exec(t)) && m.index < n;) if (n < m.index + m[0].length) n = m.index + m[0].length
  return n
}

const reducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

// Shows `text` little by little, as if it were being typed: at least 90 characters per second and
// never more than ~2.5 s in total. If the text keeps growing (SSE), it carries on.
export function TypedText({ text, onGrow, onDone }: { text: string; onGrow?: () => void; onDone?: () => void }) {
  const [upTo, setUpTo] = useState(() => reducedMotion() ? text.length : 0)
  const pos = useRef(upTo), cb = useRef({ onGrow, onDone })
  cb.current = { onGrow, onDone }
  useEffect(() => {
    if (pos.current >= text.length) { cb.current.onDone?.(); return }
    const speed = Math.max(90, text.length / 2.5)
    let frame = 0, before = performance.now()
    const step = (now: number) => {
      pos.current = Math.min(text.length, pos.current + speed * (now - before) / 1000); before = now
      setUpTo(Math.floor(pos.current))
      if (pos.current < text.length) frame = requestAnimationFrame(step)
      else cb.current.onDone?.()
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [text])
  useEffect(() => { cb.current.onGrow?.() }, [upTo])
  const visible = text.slice(0, cutAt(text, upTo)), typing = visible.length < text.length
  return <div className={typing ? 'typing' : undefined}><RichText text={visible} animate /></div>
}
