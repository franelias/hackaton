// The career tree, as a pine. Works for any plan: on a base of foliage, each year is a tier of branches,
// from 1st year at the bottom to the last one at the top, with the thesis as the star on the tip. In each
// tier the first term is the lower row and the second term the upper one, and every subject sits close
// to its prerequisites. Needles are the tree's life: they depend on `leaves` and `health`, and fall with an
// animation when health drops. What is approved (the flowers) is never lost.
import { useEffect, useMemo, useRef } from 'react'
import type { HealthState, Plan, PlanSubject, StudentSubject, SubjectState, Tree } from '../lib/types'

interface Props { plan: Plan; tree: Tree | null; selected: number | null; onSelect: (id: number | null) => void }

interface Node { s: PlanSubject; state: SubjectState; info?: StudentSubject; x: number; y: number
  // needles along the subject's branch: where (f, 0 at the trunk and 1 at the tip), on which side, and from
  // what fullness they show (t)
  leaves: { f: number; side: number; rot: number; k: number; t: number; v: number }[] }
type Point = { x: number; y: number }
type Leaf = { x: number; y: number; rot: number; k: number; col: string }

// the pine: tip, one tier per year between TOP and BASE, the base of foliage and the trunk down to the grass
const W = 1000, H = 640, CX = 500, GROUND = H - 34, APEX = 58, TOP = 132, BASE = 488, TRUNK = 552
const halfWidth = (y: number) => 100 + (y - APEX) * .74
const HEALTH: Record<HealthState, number> = { lush: 1, wilted: .55, withered: .14 }
const BASE_LEAVES: Record<SubjectState, number> = { approved: 12, regular: 11, enrolled: 10, available: 8, locked: 7 }
// how full a subject's branch is: what is done is full, what is being taken fills up with practice
// (`leaves`), what is ahead is a young twig
const FULL: Record<SubjectState, number> = { approved: 1, regular: .9, enrolled: .62, available: .45, locked: .3 }
const WIDTH: Record<SubjectState, number> = { approved: 4.6, regular: 4.4, enrolled: 4.2, available: 3, locked: 2.4 }
const GREENS: Record<SubjectState, string[]> = { approved: ['#4c8a43', '#5f9a4e', '#79b05e'], regular: ['#5f9a4e', '#79b05e', '#94c26c'], enrolled: ['#79b05e', '#94c26c', '#a9cf80'], available: ['#86b66a', '#9cc77a', '#b1d48e'], locked: ['#9cc77a', '#b1d48e', '#c3dca3'] }
// the pine's foliage, lit from the left: [light, middle, shadow]
const PINE = ['#5c9a5c', '#3f7a4a', '#2c5a3a']

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
const leafPath = (x: number, y: number, rot: number, k: number, col: string, op = 1) => `<path d="M0 -8C2.6 -3 2.6 3 0 8C-2.6 3 -2.6 -3 0 -8Z" transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${rot.toFixed(0)}) scale(${k.toFixed(2)})" fill="${col}" opacity="${op}"/>`
// a subject's name tag: [fill, border, text]. Each state has its own hue so it reads apart from the others
export const PILL: Record<SubjectState, [string, string, string]> = { approved: ['#d6e8c6', '#79a865', '#2d4a24'], regular: ['#f8e2a6', '#d9a93f', '#5a4210'], enrolled: ['#d7e5f4', '#5b84b1', '#24405f'], available: ['#ffffff', '#86b66a', '#3d4a37'], locked: ['#efede6', '#cdc8ba', '#8a867a'] }
export const BOTTLENECK = '#c98a2b'

// the mark on a subject's tip: a flower when approved (pink when it bloomed with practice), a yellow fruit
// when regular, a blue ring while being taken, and a bud (green if it can be taken) otherwise
export function mark(state: SubjectState, x: number, y: number, flower = false, op = 1) {
  const petals = (c: string, center: string) => `<g opacity="${op}">${[0, 72, 144, 216, 288].map(a => `<circle cx="${(x + 6 * Math.cos(a * Math.PI / 180)).toFixed(1)}" cy="${(y + 6 * Math.sin(a * Math.PI / 180)).toFixed(1)}" r="5" fill="${c}" stroke="#7a5236" stroke-width=".6"/>`).join('')}<circle cx="${x}" cy="${y}" r="3.2" fill="${center}"/></g>`
  if (state === 'approved') return petals('#ffffff', '#f2c14e')
  if (flower) return petals('#ffc2dc', '#d9822b')
  if (state === 'regular') return `<circle cx="${x}" cy="${y}" r="6" fill="#f2c14e" stroke="#b8863b" opacity="${op}"/>`
  if (state === 'enrolled') return `<circle cx="${x}" cy="${y}" r="6.5" fill="#fff" stroke="#5b84b1" stroke-width="2.2" opacity="${op}"/><circle cx="${x}" cy="${y}" r="2.6" fill="#5b84b1" opacity="${op}"/>`
  return `<path d="M${x} ${y + 6}C${x - 6} ${y} ${x - 4} ${y - 9} ${x} ${y - 12}C${x + 4} ${y - 9} ${x + 6} ${y} ${x} ${y + 6}Z" fill="${state === 'available' ? '#c9e0b0' : '#ead9c4'}" stroke="${state === 'available' ? '#6f9866' : '#b99c80'}" opacity="${op}"/>`
}
// a dry branch, as the tree draws one with an open alert, for the legend
export const DRY_BRANCH = `<path d="M2 8Q12 6 22 16" stroke="#8a7258" stroke-width="3" fill="none" stroke-linecap="round"/>${[[8, 7, 150], [13, 9, 30], [17, 12, 160]].map(([x, y, r]) => leafPath(x, y, r, .7, '#b08a4a')).join('')}`

// a subject's prerequisite path: everything it needs (up) and everything it unlocks (down)
export function pathOf(plan: Plan, id: number | null): Set<number> | null {
  if (id == null) return null
  const set = new Set([id]), byId = new Map(plan.subjects.map(s => [s.subject_id, s]))
  const up = (x: number) => byId.get(x)?.requires.forEach(r => { if (!set.has(r.subject_id)) { set.add(r.subject_id); up(r.subject_id) } })
  const down = (x: number) => byId.get(x)?.unlocks.forEach(u => { if (!set.has(u)) { set.add(u); down(u) } })
  up(id); down(id); return set
}

// the subject the career ends in (the Tesina): the last of the critical path, which unlocks nothing.
// It is drawn as the star on top instead of a branch
export const goalOf = (plan: Plan) => plan.subjects.find(s => s.subject_id === plan.critical_path[plan.critical_path.length - 1] && !s.unlocks.length)

function layout(plan: Plan, tree: Tree | null): Node[] {
  const info = new Map((tree?.subjects ?? []).map(s => [s.subject_id, s]))
  const years = Math.max(1, ...plan.subjects.map(s => s.year ?? 0)), band = (BASE - TOP) / years
  // electives only join the tree once the student has picked them; they go with the last year
  const goal = goalOf(plan)?.subject_id
  const subs = plan.subjects.filter(s => s.subject_id !== goal && (!s.optional || ['approved', 'regular', 'enrolled'].includes(info.get(s.subject_id)?.state ?? '')))
    .map(s => ({ ...s, year: s.year ?? years, term: s.term ?? 1 }))
  const R = rng(17), xOf = new Map<number, number>(), nodes: Node[] = []
  for (let year = 1; year <= years; year++) {
    const bottom = BASE - (year - 1) * band, rowY = [bottom - band * .27, bottom - band * .76]
    const width = (y: number) => 2 * halfWidth(y) * .86, cap = rowY.map(y => Math.max(1, Math.floor(width(y) / 112)))
    // close to its prerequisites; the first year, with the ones that unlock the most in the middle
    const want = (s: PlanSubject) => { const xs = s.requires.map(r => xOf.get(r.subject_id)).filter((x): x is number => x != null); return xs.length ? xs.reduce((a, b) => a + b) / xs.length : CX }
    const centered = (l: PlanSubject[]) => [...l].sort((a, b) => b.unlocks_total - a.unlocks_total).reduce<PlanSubject[]>((o, x, i) => (i % 2 ? [...o, x] : [x, ...o]), [])
    const rows = [1, 2].map(t => subs.filter(s => s.year === year && s.term === t))
    // a row that does not fit passes its extra subjects to the other row of the same year
    if (rows[0].length > cap[0]) rows[1].push(...rows[0].splice(cap[0])); else if (rows[1].length > cap[1]) rows[0].push(...rows[1].splice(cap[1]))
    rows.forEach((row, r) => {
      const sorted = year === 1 && row.every(s => !s.requires.some(q => xOf.has(q.subject_id))) ? centered(row) : [...row].sort((a, b) => want(a) - want(b))
      const w = width(rowY[r]) * Math.min(1, (sorted.length + 1.6) / (cap[r] + 1.6))
      sorted.forEach((s, i) => {
        const x = CX - w / 2 + w * (i + .5) / sorted.length, y = rowY[r] + (i % 2 ? -3 : 3), st = info.get(s.subject_id), state: SubjectState = st?.state ?? 'locked'
        const n = Math.min(18, BASE_LEAVES[state] + (st?.leaves ?? 0))
        nodes.push({ s, state, info: st, x, y, leaves: Array.from({ length: n }, () => ({ f: .3 + R() * .72, side: R() < .5 ? -1 : 1, rot: 35 + R() * 25, k: .75 + R() * .5, t: .05 + R() * .9, v: R() })) })
      })
      sorted.forEach((s, i) => xOf.set(s.subject_id, CX - w / 2 + w * (i + .5) / sorted.length))
    })
  }
  return nodes
}

// one tier of the pine: from its tip down to a bottom edge of drooping needle tufts
function tier(top: number, bottom: number, w: number, droop: number) {
  const k = Math.max(3, Math.round(2 * w / 54)), seg = 2 * w / k, f = (n: number) => n.toFixed(1)
  let d = `M${CX} ${f(top)} Q${f(CX - w * .38)} ${f(bottom - (bottom - top) * .3)} ${f(CX - w)} ${f(bottom + droop)}`
  for (let i = 0; i < k; i++) { const x0 = CX - w + i * seg, last = i === k - 1
    d += ` Q${f(x0 + seg / 2)} ${f(bottom + 13 + droop * 1.4)} ${f(x0 + seg)} ${f(last ? bottom + droop : bottom - 5 + droop)}` }
  return d + ` Q${f(CX + w * .38)} ${f(bottom - (bottom - top) * .3)} ${CX} ${f(top)}Z`
}

export default function TreeView({ plan, tree, selected, onSelect }: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const nodes = useMemo(() => layout(plan, tree), [plan, tree])
  const state = useRef({ health: HEALTH[tree?.health.state ?? 'lush'], target: HEALTH[tree?.health.state ?? 'lush'], path: null as Set<number> | null, sel: selected,
    falling: [] as (Leaf & { vy: number; phase: number; life: number; onGround?: boolean; fade?: number })[], visible: new Map<string, Leaf>(), first: true,
    // the entrance: the pine grows from the ground up when the screen opens (0 to 1)
    grow: matchMedia('(prefers-reduced-motion: reduce)').matches ? 1 : 0 })

  useEffect(() => { const e = state.current; e.target = HEALTH[tree?.health.state ?? 'lush']; if (e.first) { e.health = e.target } }, [tree])
  useEffect(() => { state.current.path = pathOf(plan, selected); state.current.sel = selected; draw() })

  function draw() {
    const svg = svgRef.current; if (!svg) return
    const e = state.current, s = e.health, path = e.path
    const op = (id: number) => path && !path.has(id) ? .22 : 1, bark = mix('#6e6259', '#7a5236', s)
    // a dry tree sags a little: its rows go down with its tiers
    const sag = (y: number) => (1 - s) * (y - APEX) / (BASE - APEX) * 10
    // how grown something at height y is during the entrance: the bottom first, the tip last
    const ease = (t: number) => 1 - (1 - t) ** 3, grown = (y: number) => ease(Math.max(0, Math.min(1, (e.grow * 1.5 - (GROUND - y) / (GROUND - APEX)) / .5)))
    const appear = (y: number) => Math.max(0, Math.min(1, (grown(y) - .7) / .3))
    const pos = new Map<number, Point>(nodes.map(m => [m.s.subject_id, { x: m.x, y: m.y + sag(m.y) }]))
    let o = ''
    // sky, sun and hills (they fade with health)
    o += `<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${mix('#9aa3a8', '#d5e8ef', s)}"/><stop offset=".62" stop-color="${mix('#c9c0b2', '#f1f3e8', s)}"/><stop offset="1" stop-color="${mix('#c8a98a', '#f9e2b4', s)}"/></linearGradient>
      <radialGradient id="sun"><stop offset="0" stop-color="#f9dfae" stop-opacity="${(.9 * s).toFixed(2)}"/><stop offset="1" stop-color="#f9dfae" stop-opacity="0"/></radialGradient>
      <linearGradient id="pine" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${dried(PINE[0], s)}"/><stop offset=".45" stop-color="${dried(PINE[1], s)}"/><stop offset="1" stop-color="${dried(PINE[2], s)}"/></linearGradient></defs>
      <rect width="${W}" height="${H}" fill="url(#sky)"/><ellipse cx="${CX}" cy="${H - 120}" rx="400" ry="260" fill="url(#sun)"/>
      <path d="M0 ${H - 92} C200 ${H - 132} 400 ${H - 132} 500 ${H - 102} C650 ${H - 72} 800 ${H - 132} ${W} ${H - 112} L${W} ${H} L0 ${H}Z" fill="${mix('#b7ab8f', '#a9c08a', s)}"/>
      <path d="M0 ${H - 58} C200 ${H - 84} 380 ${H - 76} 550 ${H - 60} C720 ${H - 46} 860 ${H - 80} ${W} ${H - 66} L${W} ${H} L0 ${H}Z" fill="${mix('#a39270', '#8fae6a', s)}"/>
      <path d="M0 ${H - 26} C250 ${H - 44} 450 ${H - 36} 620 ${H - 28} C800 ${H - 20} 900 ${H - 38} ${W} ${H - 30} L${W} ${H} L0 ${H}Z" fill="${mix('#8f7f60', '#7a9c58', s)}"/>`
    // the pine's shadow on the grass, trunk and roots (in the same group as the tiers, so that when they step
    // back the trunk does not show through them)
    o += `<g opacity="${path ? .55 : 1}"><ellipse cx="${CX}" cy="${GROUND + 6}" rx="${((170 + 150 * s) * (.4 + .6 * grown(TRUNK))).toFixed(0)}" ry="15" fill="#2b2a22" opacity="${(.06 + .08 * s).toFixed(2)}"/>
      <path d="M${CX - 30} ${GROUND + 6} C${CX - 22} ${GROUND - 20} ${CX - 18} ${TRUNK + 20} ${CX - 16} ${TRUNK - 10} L${CX + 16} ${TRUNK - 10} C${CX + 18} ${TRUNK + 20} ${CX + 22} ${GROUND - 20} ${CX + 30} ${GROUND + 6}Z" fill="${bark}"/>
      <path d="M${CX - 26} ${GROUND} q-36 6 -74 16 l10 5 q34 -9 70 -12Z M${CX + 26} ${GROUND} q36 6 76 14 l-10 5 q-34 -8 -72 -10Z" fill="${bark}"/>`
    // the tiers, from the base up (each one covers the top of the one below): the base of foliage, one per
    // year and the tip. They narrow and sag with health; while a path is selected they step back
    const years = Math.max(1, ...plan.subjects.map(x => x.year ?? 0)), band = (BASE - TOP) / years
    const tiers: [number, number][] = [[BASE - 52, TRUNK + 6], ...Array.from({ length: years }, (_, i): [number, number] => [BASE - (i + 1) * band - 46, BASE - i * band + 10]), [APEX, TOP + 12]]
    o += `${tiers.map(([top, bottom]) => { const w = halfWidth(bottom) * (.8 + .2 * s), droop = (1 - s) * 12, d = tier(top + sag(top), bottom + sag(bottom), w, droop)
      // while growing, each tier unfolds from its bottom edge
      const k = grown(bottom); if (k <= 0) return ''
      const t = k < 1 ? ` transform="translate(${CX} ${bottom}) scale(${(.3 + .7 * k).toFixed(3)} ${k.toFixed(3)}) translate(${-CX} ${-bottom})"` : ''
      return `<g${t}><path d="${d}" transform="translate(0 7)" fill="${dried(mix(PINE[2], '#1d3a28', .45), s)}"/><path d="${d}" fill="url(#pine)"/></g>` }).join('')}</g>`
    // the thesis on top: the subject the career ends in
    const goal = goalOf(plan)
    if (goal && appear(APEX) > 0) o += `<g opacity="${(path ? .4 : 1) * appear(APEX)}"><polygon points="${[...Array(10)].map((_, i) => { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? 7 : 16; return `${(CX + rr * Math.cos(a)).toFixed(1)},${(40 + rr * Math.sin(a)).toFixed(1)}` }).join(' ')}" fill="#f2c14e" stroke="#b8863b" stroke-width="1.2"/>
      <text x="${CX + 24}" y="45" font-size="12" font-weight="800" fill="#4a473c" stroke="#f4f6ee" stroke-width="3" paint-order="stroke">${goal.name}</text></g>`
    // the trunk through the pine, and a branch for every subject. Each branch withers on its own: it dries
    // (yellow, then brown), hangs lower and loses needles when the subject has an open alert (`dry`) or the
    // tree is losing health. An approved subject never dries
    const life = (m: Node) => m.state === 'approved' ? Math.max(s, .85) : m.info?.dry ? Math.min(s, .22) : s
    const fullness = (m: Node) => grown(m.y) * (m.state === 'approved' ? 1 : Math.min(m.info?.dry ? .4 : 1, (FULL[m.state] + (m.state === 'enrolled' ? Math.min(.38, (m.info?.leaves ?? 0) * .04) : 0)) * (.35 + .65 * s)))
    const top = TRUNK - (TRUNK - TOP + 20) * grown(TOP)
    o += `<g opacity="${path ? .55 : 1}"><path d="M${CX - 8} ${TRUNK} L${CX - 1.5} ${top.toFixed(1)} L${CX + 1.5} ${top.toFixed(1)} L${CX + 8} ${TRUNK}Z" fill="${bark}" opacity=".85"/></g>`
    const bough = new Map<number, { a: Point; q: Point; b: Point }>()
    const at = (g: { a: Point; q: Point; b: Point }, t: number) => ({ x: (1 - t) ** 2 * g.a.x + 2 * (1 - t) * t * g.q.x + t * t * g.b.x, y: (1 - t) ** 2 * g.a.y + 2 * (1 - t) * t * g.q.y + t * t * g.b.y })
    const now = new Map<string, Leaf>()
    for (const m of nodes) { const b = pos.get(m.s.subject_id)!, c = life(m), dir = b.x < CX ? -1 : 1, near = Math.abs(b.x - CX) < 30
      // from the trunk, a little below the subject, out to it; a dry branch hangs lower
      const a = { x: CX + dir * (near ? 2 : 5), y: b.y + (near ? 26 : 12) }, hang = (1 - c) * 22, q = { x: near ? b.x : (a.x + b.x) / 2, y: (near ? (a.y + b.y) / 2 : Math.min(a.y, b.y) - 8) + hang }
      const g = { a, q, b: { x: b.x, y: b.y + hang * .6 } }; bough.set(m.s.subject_id, g)
      const o2 = op(m.s.subject_id), stroke = m.info?.dry && m.state !== 'approved' ? mix('#a8957c', '#8a7258', 1 - c) : mix('#a8957c', '#9a6a40', c)
      // while growing, the branch reaches out from the trunk
      const reach = grown(m.y); if (reach <= 0) continue
      o += `<path d="M${a.x.toFixed(1)} ${a.y.toFixed(1)} Q${q.x.toFixed(1)} ${q.y.toFixed(1)} ${g.b.x.toFixed(1)} ${g.b.y.toFixed(1)}" stroke="${stroke}" stroke-width="${WIDTH[m.state]}" fill="none" stroke-linecap="round" opacity="${o2}"${reach < 1 ? ` pathLength="1" stroke-dasharray="${reach.toFixed(3)} 1"` : ''}/>`
      // needles in a herringbone along the branch, pointing to its tip; they droop as it dries
      const full = fullness(m), angle = Math.atan2(g.b.y - a.y, g.b.x - a.x) * 180 / Math.PI
      m.leaves.forEach((h, i) => { const v = Math.max(0, Math.min(1, (full - h.t * .95) / .08)); if (v <= 0) return
        const p = at(g, h.f), x = p.x, y = p.y + h.side * 3, rot = angle + 90 - h.side * h.rot + (1 - c) * 50 * dir, col = dried(GREENS[m.state][Math.floor(h.v * 3)], c)
        o += leafPath(x, y, rot, h.k * v * 1.2, col, o2); now.set(`${m.s.subject_id}h${i}`, { x, y, rot, k: h.k, col }) }) }
    // prerequisites: only for the selected subject's path
    if (path) for (const m of nodes) for (const r of m.s.requires) { const a = pos.get(r.subject_id), b = pos.get(m.s.subject_id)
      if (a && b && path.has(m.s.subject_id) && path.has(r.subject_id)) { const d = `M${a.x.toFixed(1)} ${a.y.toFixed(1)} Q${((a.x + b.x) / 2).toFixed(1)} ${(Math.min(a.y, b.y) - 24).toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`
        o += `<path d="${d}" stroke="#fff27a" stroke-width="8" fill="none" stroke-linecap="round" opacity=".9"/><path d="${d}" stroke="#2b2a22" stroke-width="1.6" stroke-dasharray="${r.condition === 'regular' ? '2 4' : '6 4'}" fill="none"/>` } }
    if (!(e.health < e.target - 1e-3) && !e.first) for (const [k, h] of e.visible) if (!now.has(k)) e.falling.push({ ...h, vy: .5 + Math.random() * .6, phase: Math.random() * 6, life: 0 })
    e.visible = now; e.first = false
    // marks and names: what is approved stays even if the tree dries up
    for (const m of nodes) { const p = pos.get(m.s.subject_id)!, o2 = op(m.s.subject_id) * appear(m.y), id = m.s.subject_id
      if (o2 <= 0) continue
      o += mark(m.state, p.x, p.y, m.info?.flower, o2)
      const t = shortName(m.s.name), w = measure(t) + 18, h = 21, y = p.y + 18, [f, b, c] = PILL[m.state], sel = id === e.sel, px = Math.max(w / 2 + 6, Math.min(W - w / 2 - 6, p.x))
      o += `<g class="node" data-id="${id}" opacity="${o2}" tabindex="0" role="button" aria-label="${m.s.name}"><title>${m.s.name}</title>
        <circle cx="${p.x}" cy="${p.y}" r="18" fill="transparent"/>
        <g class="pill"><rect x="${(px - w / 2).toFixed(1)}" y="${y - h / 2}" width="${w.toFixed(1)}" height="${h}" rx="${h / 2}" fill="${f}" stroke="${sel ? '#2b2a22' : m.s.bottleneck && m.state !== 'approved' ? BOTTLENECK : b}" stroke-width="${sel ? 2 : m.s.bottleneck && m.state !== 'approved' ? 1.8 : 1.2}"${m.state === 'locked' && !sel ? ' stroke-dasharray="3 2"' : ''}/>
        <text x="${px}" y="${y + 4}" text-anchor="middle" font-size="11" font-weight="700" fill="${c}">${t}</text></g></g>` }
    for (const f of e.falling) o += leafPath(f.x, f.y, f.rot, f.k, f.col, f.onGround ? Math.max(0, 1 - (f.fade ?? 0)) : 1)
    svg.innerHTML = o
  }

  // animation: health moves towards the target; leaves fall and pile up on the grass
  useEffect(() => {
    let raf = 0, t0 = performance.now(); const still = matchMedia('(prefers-reduced-motion: reduce)').matches
    const tick = (t: number) => { const e = state.current, dt = Math.min(50, t - t0); t0 = t; const before = e.health
      e.health += (e.target - e.health) * (still ? 1 : Math.min(1, dt / 700)); if (Math.abs(e.target - e.health) < .002) e.health = e.target
      const growing = e.grow < 1; if (growing) e.grow = Math.min(1, e.grow + dt / 1800)
      for (const f of e.falling) { if (!f.onGround) { f.life += dt; f.y += f.vy * dt * .12; f.x += Math.sin(f.life / 260 + f.phase) * .8; f.rot += dt * .12; if (f.y >= GROUND - Math.random() * 12) f.onGround = true } else if (e.target > .9) f.fade = (f.fade ?? 0) + dt / 700 }
      e.falling = e.falling.filter(f => !(f.onGround && (f.fade ?? 0) >= 1)).slice(-180)
      if (e.target < .5 && !still && Math.random() < dt / 800 && e.visible.size) { const a = [...e.visible.values()]; e.falling.push({ ...a[Math.floor(Math.random() * a.length)], vy: .5, phase: 0, life: 0 }) }
      if (growing || before !== e.health || e.falling.some(f => !f.onGround || f.fade)) draw()
      raf = requestAnimationFrame(tick) }
    document.fonts.ready.then(() => { draw(); raf = requestAnimationFrame(tick) })
    return () => cancelAnimationFrame(raf)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes])

  return <svg ref={svgRef} className="tree-svg block h-auto w-full" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Árbol del plan de estudios"
    onClick={ev => { const g = (ev.target as Element).closest('.node') as SVGGElement | null; const id = g ? Number(g.dataset.id) : null; onSelect(id === selected ? null : id) }}
    onKeyDown={ev => { if (ev.key === 'Enter' || ev.key === ' ') { const g = (ev.target as Element).closest('.node') as SVGGElement | null; if (g) { ev.preventDefault(); onSelect(Number(g.dataset.id)) } } }} />
}
