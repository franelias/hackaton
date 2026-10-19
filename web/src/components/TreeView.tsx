// El árbol de la carrera. Sirve para cualquier plan: cada materia es una rama que nace de su
// correlativa (o del tronco), el abanico de cada rama es proporcional a lo que sostiene y el año
// define la altura. Las hojas son la vida del árbol: dependen de `leaves` y de `health`, y se caen
// con animación cuando la salud baja. Lo aprobado (las flores) no se pierde nunca.
import { useEffect, useMemo, useRef } from 'react'
import type { HealthState, Plan, PlanSubject, StudentSubject, SubjectState, Tree } from '../lib/types'

interface Props { plan: Plan; tree: Tree | null; selected: number | null; onSelect: (id: number | null) => void }

interface Nodo { s: PlanSubject; est: SubjectState; info?: StudentSubject; par: Nodo | null; hijos: Nodo[]; n: number; peso: number; ang: number; r: number;
  hojas: { dx: number; dy: number; rot: number; k: number; t: number; v: number }[]; ramaHojas: { f: number; rot: number; k: number; t: number; v: number }[] }

const W = 1000, H = 640, CX = 500, HORQUILLA = 470, SUELO = H - 34, R0 = 168, DR = 60
const SALUD: Record<HealthState, number> = { lush: 1, wilted: .55, withered: .14 }
const BASE: Record<SubjectState, number> = { approved: 11, regular: 9, enrolled: 7, available: 5, locked: 4 }
const VERDES: Record<SubjectState, string[]> = { approved: ['#4c8a43', '#5f9a4e', '#79b05e'], regular: ['#5f9a4e', '#79b05e', '#94c26c'], enrolled: ['#79b05e', '#94c26c', '#a9cf80'], available: ['#86b66a', '#9cc77a', '#b1d48e'], locked: ['#9cc77a', '#b1d48e', '#c3dca3'] }

const hx = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16))
export const mix = (a: string, b: string, t: number) => { t = Math.max(0, Math.min(1, t)); const B = hx(b); return '#' + hx(a).map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join('') }
const seco = (c: string, s: number) => s > .75 ? c : s > .4 ? mix(c, '#c9b04a', (.75 - s) / .35) : mix('#c9b04a', '#9a6a3a', (.4 - s) / .3)
const rng = (seed: number) => () => (seed = (seed * 16807) % 2147483647) / 2147483647
export const corto = (n: string) => {
  const s = n.replace('Estructuras de Datos y Algoritmos', 'EDyA').replace('Análisis Matemático', 'Análisis Mat.').replace('Álgebra y Geometría Analítica', 'Álgebra y Geom.')
    .replace('Lenguajes Formales y Computabilidad', 'Leng. Formales').replace('Arquitectura del Computador', 'Arquitectura').replace('Probabilidad y Estadística', 'Probabilidad')
    .replace('Ingeniería de Software', 'Ing. de Software').replace('Introducción a la', 'Intro. a la').replace('Sistemas Operativos', 'Sist. Operativos')
  return s.length > 24 ? s.slice(0, 22).trimEnd() + '…' : s
}
const medir = (() => { const c = document.createElement('canvas').getContext('2d')!; return (t: string, tam = 11) => { c.font = `700 ${tam}px Nunito`; return c.measureText(t).width } })()
const hoja = (x: number, y: number, rot: number, k: number, col: string, op = 1) => `<path d="M0 -8C5.5 -4.5 5.5 4.5 0 9C-5.5 4.5 -5.5 -4.5 0 -8Z" transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${rot.toFixed(0)}) scale(${k.toFixed(2)})" fill="${col}" opacity="${op}"/>`
const PILDORA: Record<SubjectState, [string, string, string]> = { approved: ['#e8f0df', '#bfd3ac', '#2b2a22'], regular: ['#fbecc9', '#efcf86', '#2b2a22'], enrolled: ['#e4edf6', '#b9cde2', '#2b2a22'], available: ['#ffffff', '#cfd8c4', '#3d4a37'], locked: ['#f6f5f0', '#dcdcd4', '#8a867a'] }

export function caminoDe(plan: Plan, id: number | null): Set<number> | null {
  if (id == null) return null
  const set = new Set([id]), por = new Map(plan.subjects.map(s => [s.subject_id, s]))
  const sube = (x: number) => por.get(x)?.requires.forEach(r => { if (!set.has(r.subject_id)) { set.add(r.subject_id); sube(r.subject_id) } })
  const baja = (x: number) => por.get(x)?.unlocks.forEach(u => { if (!set.has(u)) { set.add(u); baja(u) } })
  sube(id); baja(id); return set
}

function armar(plan: Plan, tree: Tree | null): Nodo[] {
  const info = new Map((tree?.subjects ?? []).map(s => [s.subject_id, s]))
  const maxAnio = Math.max(...plan.subjects.map(s => s.year ?? 0))
  // las optativas entran al árbol solo si el alumno ya las eligió
  const subs = plan.subjects.filter(s => !s.optional || ['approved', 'regular', 'enrolled'].includes(info.get(s.subject_id)?.state ?? ''))
  const R = rng(17), nodos = new Map<number, Nodo>()
  for (const s of subs) { const i = info.get(s.subject_id), est: SubjectState = i?.state ?? 'locked', n = Math.min(18, BASE[est] + (i?.leaves ?? 0))
    nodos.set(s.subject_id, { s: { ...s, year: s.year ?? maxAnio }, est, info: i, par: null, hijos: [], n: 1, peso: 1, ang: 0, r: 0,
      hojas: Array.from({ length: n }, () => ({ dx: (R() - .5) * 64, dy: (R() - .65) * 48, rot: R() * 360, k: .8 + R() * .6, t: .05 + R() * .9, v: R() })),
      ramaHojas: [.3, .5, .7, .86].map(f => ({ f, rot: R() * 360, k: .8 + R() * .4, t: .08 + R() * .85, v: R() })) }) }
  const orden = (s: PlanSubject) => (s.year ?? 0) * 2 + (s.term ?? 1)
  for (const n of nodos.values()) { const ps = n.s.requires.map(r => nodos.get(r.subject_id)).filter((p): p is Nodo => !!p).sort((a, b) => orden(b.s) - orden(a.s)); n.par = ps[0] ?? null; n.par?.hijos.push(n) }
  const hojasDe = (m: Nodo): number => (m.n = m.hijos.length ? m.hijos.reduce((t, h) => t + hojasDe(h), 0) : 1)
  const pesoDe = (m: Nodo): number => (m.peso = 1 + m.hijos.reduce((t, h) => t + pesoDe(h), 0))
  let raices = [...nodos.values()].filter(n => !n.par); raices.forEach(hojasDe); raices.forEach(pesoDe)
  raices = [...raices].sort((a, b) => b.n - a.n).reduce<Nodo[]>((o, r, i) => (i % 2 ? [...o, r] : [r, ...o]), [])
  const A0 = Math.PI * 1.06, A1 = Math.PI * 1.94, pr = (r: Nodo) => Math.max(r.n, 2.2), tot = raices.reduce((t, r) => t + pr(r), 0)
  const rep = (m: Nodo, lo: number, hi: number) => { m.ang = (lo + hi) / 2; let b = lo; for (const h of m.hijos) { const k = (hi - lo) * h.n / m.n; rep(h, b, b + k); b += k } }
  let a = A0; for (const r of raices) { const k = (A1 - A0) * pr(r) / tot; rep(r, a, a + k); a += k }
  for (const n of nodos.values()) n.r = R0 + ((n.s.year ?? 1) - 1) * DR + ((n.s.term ?? 1) === 2 ? DR * .45 : 0)
  return [...nodos.values()]
}

export default function TreeView({ plan, tree, selected, onSelect }: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const nodos = useMemo(() => armar(plan, tree), [plan, tree])
  const estado = useRef({ salud: SALUD[tree?.health.state ?? 'lush'], objetivo: SALUD[tree?.health.state ?? 'lush'], marca: null as Set<number> | null, sel: selected, caidas: [] as { x: number; y: number; rot: number; k: number; col: string; vy: number; fase: number; vida: number; piso?: boolean; borrar?: number }[], visibles: new Map<string, { x: number; y: number; rot: number; k: number; col: string }>(), primero: true })

  useEffect(() => { const e = estado.current; e.objetivo = SALUD[tree?.health.state ?? 'lush']; if (e.primero) { e.salud = e.objetivo } }, [tree])
  useEffect(() => { estado.current.marca = caminoDe(plan, selected); estado.current.sel = selected; pintar() })

  const KX = useMemo(() => Math.min(1.6, 440 / Math.max(1, ...nodos.map(n => Math.abs(Math.cos(n.ang)) * n.r))), [nodos])

  function pintar() {
    const svg = svgRef.current; if (!svg) return
    const e = estado.current, s = e.salud, marca = e.marca
    const pos = (m: Nodo) => { const caida = (1 - s) * .34 * ((m.s.year ?? 1) / 5), a = m.ang + (m.ang < Math.PI * 1.5 ? -caida : caida); return { x: CX + Math.cos(a) * m.r * KX, y: HORQUILLA + Math.sin(a) * m.r + (1 - s) * (m.s.year ?? 1) * 7 } }
    const op = (id: number) => marca && !marca.has(id) ? .22 : 1, tr = mix('#6e6259', '#7a5236', s)
    let o = ''
    // cielo, sol y lomas (se apagan con la salud)
    o += `<defs><linearGradient id="cielo" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${mix('#9aa3a8', '#d5e8ef', s)}"/><stop offset=".62" stop-color="${mix('#c9c0b2', '#f1f3e8', s)}"/><stop offset="1" stop-color="${mix('#c8a98a', '#f9e2b4', s)}"/></linearGradient>
      <radialGradient id="sol"><stop offset="0" stop-color="#f9dfae" stop-opacity="${(.9 * s).toFixed(2)}"/><stop offset="1" stop-color="#f9dfae" stop-opacity="0"/></radialGradient></defs>
      <rect width="${W}" height="${H}" fill="url(#cielo)"/><ellipse cx="${CX}" cy="${H - 120}" rx="400" ry="260" fill="url(#sol)"/>
      <path d="M0 ${H - 92} C200 ${H - 132} 400 ${H - 132} 500 ${H - 102} C650 ${H - 72} 800 ${H - 132} ${W} ${H - 112} L${W} ${H} L0 ${H}Z" fill="${mix('#b7ab8f', '#a9c08a', s)}"/>
      <path d="M0 ${H - 58} C200 ${H - 84} 380 ${H - 76} 550 ${H - 60} C720 ${H - 46} 860 ${H - 80} ${W} ${H - 66} L${W} ${H} L0 ${H}Z" fill="${mix('#a39270', '#8fae6a', s)}"/>
      <path d="M0 ${H - 26} C250 ${H - 44} 450 ${H - 36} 620 ${H - 28} C800 ${H - 20} 900 ${H - 38} ${W} ${H - 30} L${W} ${H} L0 ${H}Z" fill="${mix('#8f7f60', '#7a9c58', s)}"/>`
    // tronco y raíces
    o += `<path d="M${CX - 30} ${SUELO + 6} C${CX - 24} ${SUELO - 60} ${CX - 14} ${HORQUILLA + 50} ${CX - 11} ${HORQUILLA} L${CX + 11} ${HORQUILLA} C${CX + 14} ${HORQUILLA + 50} ${CX + 24} ${SUELO - 60} ${CX + 30} ${SUELO + 6}Z" fill="${tr}"/>
      <path d="M${CX - 26} ${SUELO} q-40 6 -80 18 l10 5 q36 -10 76 -14Z M${CX + 26} ${SUELO} q40 6 82 16 l-10 5 q-36 -9 -76 -12Z" fill="${tr}"/>`
    // la Tesina, arriba de todo: el objetivo final
    if (plan.final_goal) o += `<g opacity="${marca ? .4 : 1}"><path d="M${CX} ${HORQUILLA} L${CX} 58" stroke="${tr}" stroke-width="2" stroke-dasharray="3 6" opacity=".45"/>
      <polygon points="${[...Array(10)].map((_, i) => { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? 6 : 13; return `${(CX + rr * Math.cos(a)).toFixed(1)},${(42 + rr * Math.sin(a)).toFixed(1)}` }).join(' ')}" fill="#f2c14e" stroke="#b8863b"/>
      <text x="${CX + 20}" y="47" font-size="12" font-weight="800" fill="#6f6a5c">${plan.final_goal.name}</text></g>`
    const geo = new Map<number, { a: { x: number; y: number }; b: { x: number; y: number }; q: { x: number; y: number } }>()
    for (const m of [...nodos].sort((x, y) => x.peso - y.peso)) {
      const a = m.par ? pos(m.par) : { x: CX + Math.cos(m.ang) * 10, y: HORQUILLA + 2 }, b = pos(m), q = { x: a.x + (b.x - a.x) * .2, y: a.y + (b.y - a.y) * .8 - 10 }
      geo.set(m.s.subject_id, { a, b, q })
      const d = `M${a.x.toFixed(1)} ${a.y.toFixed(1)} Q${q.x.toFixed(1)} ${q.y.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`, hecha = m.est === 'approved' || m.est === 'regular' || m.est === 'enrolled'
      const w = hecha ? 3 + Math.sqrt(m.peso) * 2.4 : 1.8 + Math.sqrt(m.peso) * 1.1
      if (marca?.has(m.s.subject_id) && (!m.par || marca.has(m.par.s.subject_id))) o += `<path d="${d}" stroke="#fff27a" stroke-width="${w + 12}" fill="none" stroke-linecap="round" opacity=".9"/>`
      o += `<path d="${d}" stroke="${m.info?.dry ? '#8a7a68' : hecha ? tr : mix('#9c8d7c', '#ab9a85', s)}" stroke-width="${w.toFixed(1)}" fill="none" stroke-linecap="round" opacity="${op(m.s.subject_id)}"/>`
    }
    // correlativas que no son la rama principal: solo al elegir una materia
    if (marca) for (const m of nodos) for (const r of m.s.requires) { const p = nodos.find(x => x.s.subject_id === r.subject_id)
      if (p && p !== m.par && marca.has(m.s.subject_id) && marca.has(r.subject_id)) { const a = geo.get(p.s.subject_id)!.b, b = geo.get(m.s.subject_id)!.b
        o += `<path d="M${a.x} ${a.y} Q${(a.x + b.x) / 2} ${Math.min(a.y, b.y) - 40} ${b.x} ${b.y}" stroke="#2b2a22" stroke-width="1.5" stroke-dasharray="${r.condition === 'regular' ? '2 4' : '5 4'}" fill="none"/>` } }
    // hojas: aparecen o caen según la salud (una rama seca tiene las hojas marrones)
    const ahora = new Map<string, { x: number; y: number; rot: number; k: number; col: string }>()
    const en = (g: { a: { x: number; y: number }; q: { x: number; y: number }; b: { x: number; y: number } }, t: number) => ({ x: (1 - t) ** 2 * g.a.x + 2 * (1 - t) * t * g.q.x + t * t * g.b.x, y: (1 - t) ** 2 * g.a.y + 2 * (1 - t) * t * g.q.y + t * t * g.b.y })
    for (const m of nodos) { const g = geo.get(m.s.subject_id)!, o2 = op(m.s.subject_id), sl = m.info?.dry ? Math.min(s, .3) : s
      const pon = (key: string, x: number, y: number, h: { rot: number; k: number; t: number; v: number }) => { const v = Math.max(0, Math.min(1, (sl - h.t * .95) / .08)); if (v <= 0) return
        const col = seco(VERDES[m.est][Math.floor(h.v * 3)], sl); o += hoja(x, y, h.rot, h.k * v, col, o2); ahora.set(key, { x, y, rot: h.rot, k: h.k, col }) }
      m.ramaHojas.forEach((h, i) => { const p = en(g, h.f); pon(`${m.s.subject_id}r${i}`, p.x, p.y, h) })
      m.hojas.forEach((h, i) => pon(`${m.s.subject_id}h${i}`, g.b.x + h.dx, g.b.y + h.dy, h)) }
    if (!(e.salud < e.objetivo - 1e-3) && !e.primero) for (const [k, h] of e.visibles) if (!ahora.has(k)) e.caidas.push({ ...h, vy: .5 + Math.random() * .6, fase: Math.random() * 6, vida: 0 })
    e.visibles = ahora; e.primero = false
    // marcas y nombres: lo aprobado queda aunque el árbol se seque
    for (const m of nodos) { const p = geo.get(m.s.subject_id)!.b, o2 = op(m.s.subject_id), id = m.s.subject_id
      const flor = (c: string, cen: string) => `<g opacity="${o2}">${[0, 72, 144, 216, 288].map(a => `<circle cx="${(p.x + 6 * Math.cos(a * Math.PI / 180)).toFixed(1)}" cy="${(p.y + 6 * Math.sin(a * Math.PI / 180)).toFixed(1)}" r="5" fill="${c}" stroke="#7a5236" stroke-width=".6"/>`).join('')}<circle cx="${p.x}" cy="${p.y}" r="3.2" fill="${cen}"/></g>`
      if (m.est === 'approved') o += flor('#ffffff', '#f2c14e')
      else if (m.info?.flower) o += flor('#ffc2dc', '#d9822b')
      else if (m.est === 'regular') o += `<circle cx="${p.x}" cy="${p.y}" r="6" fill="#f2c14e" stroke="#b8863b" opacity="${o2}"/>`
      else if (m.est === 'enrolled') o += `<circle cx="${p.x}" cy="${p.y}" r="6.5" fill="#fff" stroke="#5b84b1" stroke-width="2.2" opacity="${o2}"/><circle cx="${p.x}" cy="${p.y}" r="2.6" fill="#5b84b1" opacity="${o2}"/>`
      else o += `<path d="M${p.x} ${p.y + 6}C${p.x - 6} ${p.y} ${p.x - 4} ${p.y - 9} ${p.x} ${p.y - 12}C${p.x + 4} ${p.y - 9} ${p.x + 6} ${p.y} ${p.x} ${p.y + 6}Z" fill="${m.est === 'available' ? '#c9e0b0' : '#ead9c4'}" stroke="${m.est === 'available' ? '#6f9866' : '#b99c80'}" opacity="${o2}"/>`
      const t = corto(m.s.name), w = medir(t) + 18, h = 21, y = p.y + 22, [f, b, c] = PILDORA[m.est], sel = id === e.sel, px = Math.max(w / 2 + 6, Math.min(W - w / 2 - 6, p.x)), oculta = m.est === "locked" && !sel && !marca?.has(id)
      o += `<g class="nodo" data-id="${id}" opacity="${o2}" tabindex="0" role="button" aria-label="${m.s.name}"><title>${m.s.name}</title>
        <circle cx="${p.x}" cy="${p.y}" r="18" fill="transparent"/>
        <g class="pild${oculta ? ' oculto' : ''}"><rect x="${(px - w / 2).toFixed(1)}" y="${y - h / 2}" width="${w.toFixed(1)}" height="${h}" rx="${h / 2}" fill="${f}" stroke="${sel ? '#2b2a22' : m.s.bottleneck && m.est !== 'approved' ? '#c98a2b' : b}" stroke-width="${sel ? 2 : m.s.bottleneck && m.est !== 'approved' ? 1.4 : 1}"/>
        <text x="${px}" y="${y + 4}" text-anchor="middle" font-size="11" font-weight="700" fill="${c}">${t}</text></g></g>` }
    for (const f of e.caidas) o += hoja(f.x, f.y, f.rot, f.k, f.col, f.piso ? Math.max(0, 1 - (f.borrar ?? 0)) : 1)
    svg.innerHTML = o
  }

  // animación: la salud se acerca al objetivo; las hojas caen y se juntan en el pasto
  useEffect(() => {
    let raf = 0, t0 = performance.now(); const quieto = matchMedia('(prefers-reduced-motion: reduce)').matches
    const tic = (t: number) => { const e = estado.current, dt = Math.min(50, t - t0); t0 = t; const antes = e.salud
      e.salud += (e.objetivo - e.salud) * (quieto ? 1 : Math.min(1, dt / 700)); if (Math.abs(e.objetivo - e.salud) < .002) e.salud = e.objetivo
      for (const f of e.caidas) { if (!f.piso) { f.vida += dt; f.y += f.vy * dt * .12; f.x += Math.sin(f.vida / 260 + f.fase) * .8; f.rot += dt * .12; if (f.y >= SUELO - Math.random() * 12) f.piso = true } else if (e.objetivo > .9) f.borrar = (f.borrar ?? 0) + dt / 700 }
      e.caidas = e.caidas.filter(f => !(f.piso && (f.borrar ?? 0) >= 1)).slice(-180)
      if (e.objetivo < .5 && !quieto && Math.random() < dt / 800 && e.visibles.size) { const a = [...e.visibles.values()]; e.caidas.push({ ...a[Math.floor(Math.random() * a.length)], vy: .5, fase: 0, vida: 0 }) }
      if (antes !== e.salud || e.caidas.some(f => !f.piso || f.borrar)) pintar()
      raf = requestAnimationFrame(tic) }
    document.fonts.ready.then(() => { pintar(); raf = requestAnimationFrame(tic) })
    return () => cancelAnimationFrame(raf)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodos, KX])

  return <svg ref={svgRef} className="arbol-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Árbol del plan de estudios"
    onClick={ev => { const g = (ev.target as Element).closest('.nodo') as SVGGElement | null; const id = g ? Number(g.dataset.id) : null; onSelect(id === selected ? null : id) }}
    onKeyDown={ev => { if (ev.key === 'Enter' || ev.key === ' ') { const g = (ev.target as Element).closest('.nodo') as SVGGElement | null; if (g) { ev.preventDefault(); onSelect(Number(g.dataset.id)) } } }} />
}
