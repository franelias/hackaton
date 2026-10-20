// The career tree. Works for any plan: each subject is a branch that grows from its prerequisite
// (or from the trunk), each branch's fan is proportional to what it holds up and the year sets the
// height. Leaves are the tree's life: they depend on `leaves` and `health`, and fall with an
// animation when health drops. What is approved (the flowers) is never lost.
import { useEffect, useMemo, useRef } from 'react'
import type { HealthState, Plan, PlanSubject, StudentSubject, SubjectState, Tree } from '../lib/types'

interface Props { plan: Plan; tree: Tree | null; selected: number | null; onSelect: (id: number | null) => void }

interface Node { s: PlanSubject; state: SubjectState; info?: StudentSubject; parent: Node | null; children: Node[]; n: number; weight: number; ang: number; r: number;
  leaves: { dx: number; dy: number; rot: number; k: number; t: number; v: number }[]; branchLeaves: { f: number; rot: number; k: number; t: number; v: number }[] }
type Point = { x: number; y: number }
type Leaf = { x: number; y: number; rot: number; k: number; col: string }

const W = 1000, H = 640, CX = 500, FORK = 470, GROUND = H - 34, R0 = 168, DR = 60
const HEALTH: Record<HealthState, number> = { lush: 1, wilted: .55, withered: .14 }
const BASE_LEAVES: Record<SubjectState, number> = { approved: 11, regular: 9, enrolled: 7, available: 5, locked: 4 }
const GREENS: Record<SubjectState, string[]> = { approved: ['#4c8a43', '#5f9a4e', '#79b05e'], regular: ['#5f9a4e', '#79b05e', '#94c26c'], enrolled: ['#79b05e', '#94c26c', '#a9cf80'], available: ['#86b66a', '#9cc77a', '#b1d48e'], locked: ['#9cc77a', '#b1d48e', '#c3dca3'] }

const hex = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16))
export const mix = (a: string, b: string, t: number) => { t = Math.max(0, Math.min(1, t)); const B = hex(b); return '#' + hex(a).map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join('') }
const dried = (c: string, s: number) => s > .75 ? c : s > .4 ? mix(c, '#c9b04a', (.75 - s) / .35) : mix('#c9b04a', '#9a6a3a', (.4 - s) / .3)
const rng = (seed: number) => () => (seed = (seed * 16807) % 2147483647) / 2147483647
export const shortName = (n: string) => {
  const s = n.replace('Estructuras de Datos y Algoritmos', 'EDyA').replace('Análisis Matemático', 'Análisis Mat.').replace('Álgebra y Geometría Analítica', 'Álgebra y Geom.')
    .replace('Lenguajes Formales y Computabilidad', 'Leng. Formales').replace('Arquitectura del Computador', 'Arquitectura').replace('Probabilidad y Estadística', 'Probabilidad')
    .replace('Ingeniería de Software', 'Ing. de Software').replace('Introducción a la', 'Intro. a la').replace('Sistemas Operativos', 'Sist. Operativos')
  return s.length > 24 ? s.slice(0, 22).trimEnd() + '…' : s
}
const measure = (() => { const c = document.createElement('canvas').getContext('2d')!; return (t: string, size = 11) => { c.font = `700 ${size}px 'Nunito Variable'`; return c.measureText(t).width } })()
const leafPath = (x: number, y: number, rot: number, k: number, col: string, op = 1) => `<path d="M0 -8C5.5 -4.5 5.5 4.5 0 9C-5.5 4.5 -5.5 -4.5 0 -8Z" transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${rot.toFixed(0)}) scale(${k.toFixed(2)})" fill="${col}" opacity="${op}"/>`
const PILL: Record<SubjectState, [string, string, string]> = { approved: ['#e8f0df', '#bfd3ac', '#2b2a22'], regular: ['#fbecc9', '#efcf86', '#2b2a22'], enrolled: ['#e4edf6', '#b9cde2', '#2b2a22'], available: ['#ffffff', '#cfd8c4', '#3d4a37'], locked: ['#f6f5f0', '#dcdcd4', '#8a867a'] }

// a subject's prerequisite path: everything it needs (up) and everything it unlocks (down)
export function pathOf(plan: Plan, id: number | null): Set<number> | null {
  if (id == null) return null
  const set = new Set([id]), byId = new Map(plan.subjects.map(s => [s.subject_id, s]))
  const up = (x: number) => byId.get(x)?.requires.forEach(r => { if (!set.has(r.subject_id)) { set.add(r.subject_id); up(r.subject_id) } })
  const down = (x: number) => byId.get(x)?.unlocks.forEach(u => { if (!set.has(u)) { set.add(u); down(u) } })
  up(id); down(id); return set
}

function layout(plan: Plan, tree: Tree | null): Node[] {
  const info = new Map((tree?.subjects ?? []).map(s => [s.subject_id, s]))
  const maxYear = Math.max(...plan.subjects.map(s => s.year ?? 0))
  // electives only join the tree once the student has picked them
  const subs = plan.subjects.filter(s => !s.optional || ['approved', 'regular', 'enrolled'].includes(info.get(s.subject_id)?.state ?? ''))
  const R = rng(17), nodes = new Map<number, Node>()
  for (const s of subs) { const i = info.get(s.subject_id), state: SubjectState = i?.state ?? 'locked', n = Math.min(18, BASE_LEAVES[state] + (i?.leaves ?? 0))
    nodes.set(s.subject_id, { s: { ...s, year: s.year ?? maxYear }, state, info: i, parent: null, children: [], n: 1, weight: 1, ang: 0, r: 0,
      leaves: Array.from({ length: n }, () => ({ dx: (R() - .5) * 64, dy: (R() - .65) * 48, rot: R() * 360, k: .8 + R() * .6, t: .05 + R() * .9, v: R() })),
      branchLeaves: [.3, .5, .7, .86].map(f => ({ f, rot: R() * 360, k: .8 + R() * .4, t: .08 + R() * .85, v: R() })) }) }
  const order = (s: PlanSubject) => (s.year ?? 0) * 2 + (s.term ?? 1)
  for (const n of nodes.values()) { const ps = n.s.requires.map(r => nodes.get(r.subject_id)).filter((p): p is Node => !!p).sort((a, b) => order(b.s) - order(a.s)); n.parent = ps[0] ?? null; n.parent?.children.push(n) }
  const countTips = (m: Node): number => (m.n = m.children.length ? m.children.reduce((t, h) => t + countTips(h), 0) : 1)
  const weigh = (m: Node): number => (m.weight = 1 + m.children.reduce((t, h) => t + weigh(h), 0))
  let roots = [...nodes.values()].filter(n => !n.parent); roots.forEach(countTips); roots.forEach(weigh)
  roots = [...roots].sort((a, b) => b.n - a.n).reduce<Node[]>((o, r, i) => (i % 2 ? [...o, r] : [r, ...o]), [])
  const A0 = Math.PI * 1.06, A1 = Math.PI * 1.94, share = (r: Node) => Math.max(r.n, 2.2), total = roots.reduce((t, r) => t + share(r), 0)
  const spread = (m: Node, lo: number, hi: number) => { m.ang = (lo + hi) / 2; let b = lo; for (const h of m.children) { const k = (hi - lo) * h.n / m.n; spread(h, b, b + k); b += k } }
  let a = A0; for (const r of roots) { const k = (A1 - A0) * share(r) / total; spread(r, a, a + k); a += k }
  for (const n of nodes.values()) n.r = R0 + ((n.s.year ?? 1) - 1) * DR + ((n.s.term ?? 1) === 2 ? DR * .45 : 0)
  return [...nodes.values()]
}

export default function TreeView({ plan, tree, selected, onSelect }: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const nodes = useMemo(() => layout(plan, tree), [plan, tree])
  const state = useRef({ health: HEALTH[tree?.health.state ?? 'lush'], target: HEALTH[tree?.health.state ?? 'lush'], path: null as Set<number> | null, sel: selected,
    falling: [] as (Leaf & { vy: number; phase: number; life: number; onGround?: boolean; fade?: number })[], visible: new Map<string, Leaf>(), first: true })

  useEffect(() => { const e = state.current; e.target = HEALTH[tree?.health.state ?? 'lush']; if (e.first) { e.health = e.target } }, [tree])
  useEffect(() => { state.current.path = pathOf(plan, selected); state.current.sel = selected; draw() })

  const KX = useMemo(() => Math.min(1.6, 440 / Math.max(1, ...nodes.map(n => Math.abs(Math.cos(n.ang)) * n.r))), [nodes])

  function draw() {
    const svg = svgRef.current; if (!svg) return
    const e = state.current, s = e.health, path = e.path
    const pos = (m: Node): Point => { const droop = (1 - s) * .34 * ((m.s.year ?? 1) / 5), a = m.ang + (m.ang < Math.PI * 1.5 ? -droop : droop); return { x: CX + Math.cos(a) * m.r * KX, y: FORK + Math.sin(a) * m.r + (1 - s) * (m.s.year ?? 1) * 7 } }
    const op = (id: number) => path && !path.has(id) ? .22 : 1, bark = mix('#6e6259', '#7a5236', s)
    let o = ''
    // sky, sun and hills (they fade with health)
    o += `<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${mix('#9aa3a8', '#d5e8ef', s)}"/><stop offset=".62" stop-color="${mix('#c9c0b2', '#f1f3e8', s)}"/><stop offset="1" stop-color="${mix('#c8a98a', '#f9e2b4', s)}"/></linearGradient>
      <radialGradient id="sun"><stop offset="0" stop-color="#f9dfae" stop-opacity="${(.9 * s).toFixed(2)}"/><stop offset="1" stop-color="#f9dfae" stop-opacity="0"/></radialGradient></defs>
      <rect width="${W}" height="${H}" fill="url(#sky)"/><ellipse cx="${CX}" cy="${H - 120}" rx="400" ry="260" fill="url(#sun)"/>
      <path d="M0 ${H - 92} C200 ${H - 132} 400 ${H - 132} 500 ${H - 102} C650 ${H - 72} 800 ${H - 132} ${W} ${H - 112} L${W} ${H} L0 ${H}Z" fill="${mix('#b7ab8f', '#a9c08a', s)}"/>
      <path d="M0 ${H - 58} C200 ${H - 84} 380 ${H - 76} 550 ${H - 60} C720 ${H - 46} 860 ${H - 80} ${W} ${H - 66} L${W} ${H} L0 ${H}Z" fill="${mix('#a39270', '#8fae6a', s)}"/>
      <path d="M0 ${H - 26} C250 ${H - 44} 450 ${H - 36} 620 ${H - 28} C800 ${H - 20} 900 ${H - 38} ${W} ${H - 30} L${W} ${H} L0 ${H}Z" fill="${mix('#8f7f60', '#7a9c58', s)}"/>`
    // trunk and roots
    o += `<path d="M${CX - 30} ${GROUND + 6} C${CX - 24} ${GROUND - 60} ${CX - 14} ${FORK + 50} ${CX - 11} ${FORK} L${CX + 11} ${FORK} C${CX + 14} ${FORK + 50} ${CX + 24} ${GROUND - 60} ${CX + 30} ${GROUND + 6}Z" fill="${bark}"/>
      <path d="M${CX - 26} ${GROUND} q-40 6 -80 18 l10 5 q36 -10 76 -14Z M${CX + 26} ${GROUND} q40 6 82 16 l-10 5 q-36 -9 -76 -12Z" fill="${bark}"/>`
    const geo = new Map<number, { a: Point; b: Point; q: Point }>()
    for (const m of [...nodes].sort((x, y) => x.weight - y.weight)) {
      const a = m.parent ? pos(m.parent) : { x: CX + Math.cos(m.ang) * 10, y: FORK + 2 }, b = pos(m), q = { x: a.x + (b.x - a.x) * .2, y: a.y + (b.y - a.y) * .8 - 10 }
      geo.set(m.s.subject_id, { a, b, q })
      const d = `M${a.x.toFixed(1)} ${a.y.toFixed(1)} Q${q.x.toFixed(1)} ${q.y.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`, taken = m.state === 'approved' || m.state === 'regular' || m.state === 'enrolled'
      const w = taken ? 3 + Math.sqrt(m.weight) * 2.4 : 1.8 + Math.sqrt(m.weight) * 1.1
      if (path?.has(m.s.subject_id) && (!m.parent || path.has(m.parent.s.subject_id))) o += `<path d="${d}" stroke="#fff27a" stroke-width="${w + 12}" fill="none" stroke-linecap="round" opacity=".9"/>`
      o += `<path d="${d}" stroke="${m.info?.dry ? '#8a7a68' : taken ? bark : mix('#9c8d7c', '#ab9a85', s)}" stroke-width="${w.toFixed(1)}" fill="none" stroke-linecap="round" opacity="${op(m.s.subject_id)}"/>`
    }
    // prerequisites other than the main branch: only when a subject is selected
    if (path) for (const m of nodes) for (const r of m.s.requires) { const p = nodes.find(x => x.s.subject_id === r.subject_id)
      if (p && p !== m.parent && path.has(m.s.subject_id) && path.has(r.subject_id)) { const a = geo.get(p.s.subject_id)!.b, b = geo.get(m.s.subject_id)!.b
        o += `<path d="M${a.x} ${a.y} Q${(a.x + b.x) / 2} ${Math.min(a.y, b.y) - 40} ${b.x} ${b.y}" stroke="#2b2a22" stroke-width="1.5" stroke-dasharray="${r.condition === 'regular' ? '2 4' : '5 4'}" fill="none"/>` } }
    // leaves: they appear or fall with health (a dry branch has brown leaves)
    const now = new Map<string, Leaf>()
    const at = (g: { a: Point; q: Point; b: Point }, t: number) => ({ x: (1 - t) ** 2 * g.a.x + 2 * (1 - t) * t * g.q.x + t * t * g.b.x, y: (1 - t) ** 2 * g.a.y + 2 * (1 - t) * t * g.q.y + t * t * g.b.y })
    for (const m of nodes) { const g = geo.get(m.s.subject_id)!, o2 = op(m.s.subject_id), sl = m.info?.dry ? Math.min(s, .3) : s
      const put = (key: string, x: number, y: number, h: { rot: number; k: number; t: number; v: number }) => { const v = Math.max(0, Math.min(1, (sl - h.t * .95) / .08)); if (v <= 0) return
        const col = dried(GREENS[m.state][Math.floor(h.v * 3)], sl); o += leafPath(x, y, h.rot, h.k * v, col, o2); now.set(key, { x, y, rot: h.rot, k: h.k, col }) }
      m.branchLeaves.forEach((h, i) => { const p = at(g, h.f); put(`${m.s.subject_id}r${i}`, p.x, p.y, h) })
      m.leaves.forEach((h, i) => put(`${m.s.subject_id}h${i}`, g.b.x + h.dx, g.b.y + h.dy, h)) }
    if (!(e.health < e.target - 1e-3) && !e.first) for (const [k, h] of e.visible) if (!now.has(k)) e.falling.push({ ...h, vy: .5 + Math.random() * .6, phase: Math.random() * 6, life: 0 })
    e.visible = now; e.first = false
    // marks and names: what is approved stays even if the tree dries up
    for (const m of nodes) { const p = geo.get(m.s.subject_id)!.b, o2 = op(m.s.subject_id), id = m.s.subject_id
      const flower = (c: string, center: string) => `<g opacity="${o2}">${[0, 72, 144, 216, 288].map(a => `<circle cx="${(p.x + 6 * Math.cos(a * Math.PI / 180)).toFixed(1)}" cy="${(p.y + 6 * Math.sin(a * Math.PI / 180)).toFixed(1)}" r="5" fill="${c}" stroke="#7a5236" stroke-width=".6"/>`).join('')}<circle cx="${p.x}" cy="${p.y}" r="3.2" fill="${center}"/></g>`
      if (m.state === 'approved') o += flower('#ffffff', '#f2c14e')
      else if (m.info?.flower) o += flower('#ffc2dc', '#d9822b')
      else if (m.state === 'regular') o += `<circle cx="${p.x}" cy="${p.y}" r="6" fill="#f2c14e" stroke="#b8863b" opacity="${o2}"/>`
      else if (m.state === 'enrolled') o += `<circle cx="${p.x}" cy="${p.y}" r="6.5" fill="#fff" stroke="#5b84b1" stroke-width="2.2" opacity="${o2}"/><circle cx="${p.x}" cy="${p.y}" r="2.6" fill="#5b84b1" opacity="${o2}"/>`
      else o += `<path d="M${p.x} ${p.y + 6}C${p.x - 6} ${p.y} ${p.x - 4} ${p.y - 9} ${p.x} ${p.y - 12}C${p.x + 4} ${p.y - 9} ${p.x + 6} ${p.y} ${p.x} ${p.y + 6}Z" fill="${m.state === 'available' ? '#c9e0b0' : '#ead9c4'}" stroke="${m.state === 'available' ? '#6f9866' : '#b99c80'}" opacity="${o2}"/>`
      const t = shortName(m.s.name), w = measure(t) + 18, h = 21, y = p.y + 22, [f, b, c] = PILL[m.state], sel = id === e.sel, px = Math.max(w / 2 + 6, Math.min(W - w / 2 - 6, p.x)), hidden = m.state === 'locked' && !sel && !path?.has(id)
      o += `<g class="node" data-id="${id}" opacity="${o2}" tabindex="0" role="button" aria-label="${m.s.name}"><title>${m.s.name}</title>
        <circle cx="${p.x}" cy="${p.y}" r="18" fill="transparent"/>
        <g class="pill${hidden ? ' hidden-label' : ''}"><rect x="${(px - w / 2).toFixed(1)}" y="${y - h / 2}" width="${w.toFixed(1)}" height="${h}" rx="${h / 2}" fill="${f}" stroke="${sel ? '#2b2a22' : m.s.bottleneck && m.state !== 'approved' ? '#c98a2b' : b}" stroke-width="${sel ? 2 : m.s.bottleneck && m.state !== 'approved' ? 1.4 : 1}"/>
        <text x="${px}" y="${y + 4}" text-anchor="middle" font-size="11" font-weight="700" fill="${c}">${t}</text></g></g>` }
    for (const f of e.falling) o += leafPath(f.x, f.y, f.rot, f.k, f.col, f.onGround ? Math.max(0, 1 - (f.fade ?? 0)) : 1)
    svg.innerHTML = o
  }

  // animation: health moves towards the target; leaves fall and pile up on the grass
  useEffect(() => {
    let raf = 0, t0 = performance.now(); const still = matchMedia('(prefers-reduced-motion: reduce)').matches
    const tick = (t: number) => { const e = state.current, dt = Math.min(50, t - t0); t0 = t; const before = e.health
      e.health += (e.target - e.health) * (still ? 1 : Math.min(1, dt / 700)); if (Math.abs(e.target - e.health) < .002) e.health = e.target
      for (const f of e.falling) { if (!f.onGround) { f.life += dt; f.y += f.vy * dt * .12; f.x += Math.sin(f.life / 260 + f.phase) * .8; f.rot += dt * .12; if (f.y >= GROUND - Math.random() * 12) f.onGround = true } else if (e.target > .9) f.fade = (f.fade ?? 0) + dt / 700 }
      e.falling = e.falling.filter(f => !(f.onGround && (f.fade ?? 0) >= 1)).slice(-180)
      if (e.target < .5 && !still && Math.random() < dt / 800 && e.visible.size) { const a = [...e.visible.values()]; e.falling.push({ ...a[Math.floor(Math.random() * a.length)], vy: .5, phase: 0, life: 0 }) }
      if (before !== e.health || e.falling.some(f => !f.onGround || f.fade)) draw()
      raf = requestAnimationFrame(tick) }
    document.fonts.ready.then(() => { draw(); raf = requestAnimationFrame(tick) })
    return () => cancelAnimationFrame(raf)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, KX])

  return <svg ref={svgRef} className="tree-svg block h-auto w-full" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Árbol del plan de estudios"
    onClick={ev => { const g = (ev.target as Element).closest('.node') as SVGGElement | null; const id = g ? Number(g.dataset.id) : null; onSelect(id === selected ? null : id) }}
    onKeyDown={ev => { if (ev.key === 'Enter' || ev.key === ' ') { const g = (ev.target as Element).closest('.node') as SVGGElement | null; if (g) { ev.preventDefault(); onSelect(Number(g.dataset.id)) } } }} />
}
