'use client'

// The career tree. Works for any plan: each subject is a branch that grows from its prerequisite
// (or from the trunk), each branch's fan is proportional to what it holds up and the year sets the
// height. Leaves are the tree's life: they depend on `leaves` and `health`, and fall with an
// animation when health drops. What is approved (the flowers) is never lost.
//
// Drawing style: flat, warm illustration. A thick shaded trunk with roots splits into tapered,
// curved branches (thickness follows what each branch holds up). Foliage is drawn as clumps of
// overlapping puffs in three layers (back shadow, front body, highlights) so the crown has volume.
import { useEffect, useMemo, useRef } from 'react'
import type { HealthState, Plan, PlanSubject, StudentSubject, SubjectState, Tree } from '../lib/types'

interface Props { plan: Plan; tree: Tree | null; selected: number | null; onSelect: (id: number | null) => void }

export interface Node { s: PlanSubject; state: SubjectState; info?: StudentSubject; parent: Node | null; children: Node[]; n: number; weight: number; ang: number; r: number;
  leaves: { dx: number; dy: number; rot: number; k: number; t: number; v: number }[]; branchLeaves: { f: number; rot: number; k: number; t: number; v: number }[] }
type Point = { x: number; y: number }
type Leaf = { x: number; y: number; rot: number; k: number; col: string }
type Geo = { a: Point; c1: Point; c2: Point; b: Point; w0: number; w1: number }
type LeafSeed = { rot: number; k: number; t: number; v: number }
type Rect = { x: number; y: number; w: number; h: number }
type KoalaPose = 'walk' | 'climb' | 'sit' | 'hug' | 'sleep'
type KoalaMood = 'happy' | 'sad' | 'sleep'
// a stretch of the route: edge key ('trunk', 'L<rootId>' for the trunk-to-root link, or a subject id) and t range
type Seg = { k: string; t0: number; t1: number }
interface Koala { k: string; t: number; route: Seg[]; d: number; wait: number; rest: 'sit' | 'hug'; face: 1 | -1; clock: number; blinkAt: number; blinkEnd: number; key: string; el: SVGGElement | null; placed: boolean }

export const W = 1000, H = 640, CX = 500, FORK = 470, GROUND = H - 34, R0 = 168, DR = 60
const BASE_LEAVES: Record<SubjectState, number> = { approved: 11, regular: 9, enrolled: 7, available: 5, locked: 4 }
export const GREENS: Record<SubjectState, string[]> = { approved: ['#4c8a43', '#5f9a4e', '#79b05e'], regular: ['#5f9a4e', '#79b05e', '#94c26c'], enrolled: ['#79b05e', '#94c26c', '#a9cf80'], available: ['#86b66a', '#9cc77a', '#b1d48e'], locked: ['#9cc77a', '#b1d48e', '#c3dca3'] }

const hex = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16))
export const mix = (a: string, b: string, t: number) => { t = Math.max(0, Math.min(1, t)); const B = hex(b); return '#' + hex(a).map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join('') }
export const dried = (c: string, s: number) => s > .75 ? c : s > .4 ? mix(c, '#c9b04a', (.75 - s) / .35) : mix('#c9b04a', '#9a6a3a', (.4 - s) / .3)
const rng = (seed: number) => () => (seed = (seed * 16807) % 2147483647) / 2147483647
export const shortName = (n: string) => {
  const s = n.replace('Estructuras de Datos y Algoritmos', 'EDyA').replace('Análisis Matemático', 'Análisis Mat.').replace('Álgebra y Geometría Analítica', 'Álgebra y Geom.')
    .replace('Lenguajes Formales y Computabilidad', 'Leng. Formales').replace('Arquitectura del Computador', 'Arquitectura').replace('Probabilidad y Estadística', 'Probabilidad')
    .replace('Ingeniería de Software', 'Ing. de Software').replace('Introducción a la', 'Intro. a la').replace('Sistemas Operativos', 'Sist. Operativos')
  return s.length > 24 ? s.slice(0, 22).trimEnd() + '…' : s
}
let measureCtx: CanvasRenderingContext2D | null = null
const measure = (t: string, size = 11) => { measureCtx ??= document.createElement('canvas').getContext('2d')!; measureCtx.font = `700 ${size}px Nunito`; return measureCtx.measureText(t).width }
const leafPath = (x: number, y: number, rot: number, k: number, col: string, op = 1) => `<path d="M0 -8C5.5 -4.5 5.5 4.5 0 9C-5.5 4.5 -5.5 -4.5 0 -8Z" transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${rot.toFixed(0)}) scale(${k.toFixed(2)})" fill="${col}" opacity="${op}"/>`
const PILL: Record<SubjectState, [string, string, string]> = { approved: ['#e8f0df', '#bfd3ac', '#2b2a22'], regular: ['#fbecc9', '#efcf86', '#2b2a22'], enrolled: ['#e4edf6', '#b9cde2', '#2b2a22'], available: ['#ffffff', '#cfd8c4', '#3d4a37'], locked: ['#f6f5f0', '#dcdcd4', '#8a867a'] }

// drawing helpers (internal)
const SHADE = '#26391d', SHINE = '#f3f0c4', FADE = '#eef1e8'
const TAKEN = new Set<SubjectState>(['approved', 'regular', 'enrolled'])
const fx = (v: number) => v.toFixed(1)
const clamp01 = (v: number) => Math.max(0, Math.min(1, v))
const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
const unit = (p: Point): Point => { const l = Math.hypot(p.x, p.y) || 1; return { x: p.x / l, y: p.y / l } }
const jitter = (id: number) => { const v = Math.sin(id * 12.9898 + 4.1) * 43758.5453; return v - Math.floor(v) }
const bez = (g: Geo, t: number): Point => { const u = 1 - t
  return { x: u * u * u * g.a.x + 3 * u * u * t * g.c1.x + 3 * u * t * t * g.c2.x + t * t * t * g.b.x, y: u * u * u * g.a.y + 3 * u * u * t * g.c1.y + 3 * u * t * t * g.c2.y + t * t * t * g.b.y } }
const tan = (g: Geo, t: number): Point => { const u = 1 - t
  return { x: 3 * u * u * (g.c1.x - g.a.x) + 6 * u * t * (g.c2.x - g.c1.x) + 3 * t * t * (g.b.x - g.c2.x), y: 3 * u * u * (g.c1.y - g.a.y) + 6 * u * t * (g.c2.y - g.c1.y) + 3 * t * t * (g.b.y - g.c2.y) } }
const curve = (g: Geo) => `M${fx(g.a.x)} ${fx(g.a.y)}C${fx(g.c1.x)} ${fx(g.c1.y)} ${fx(g.c2.x)} ${fx(g.c2.y)} ${fx(g.b.x)} ${fx(g.b.y)}`
// a tapered branch as a filled shape; `off` shifts it sideways (used for the lit edge)
const ribbon = (g: Geo, w0: number, w1: number, off = 0, side = 1) => {
  const L: string[] = [], R: string[] = []
  for (let i = 0; i <= 12; i++) { const t = i / 12, p = bez(g, t), d = unit(tan(g, t)), nx = -d.y, ny = d.x, w = w0 + (w1 - w0) * Math.pow(t, .85), c = off * w * side, hw = w / 2
    L.push(`${fx(p.x + nx * (c + hw))} ${fx(p.y + ny * (c + hw))}`); R.push(`${fx(p.x + nx * (c - hw))} ${fx(p.y + ny * (c - hw))}`) }
  return `M${L.join('L')}L${R.reverse().join('L')}Z`
}
const circle = (x: number, y: number, r: number, col: string) => `<circle cx="${fx(x)}" cy="${fx(y)}" r="${fx(r)}" fill="${col}"/>`
const thick = (m: Node) => (1.4 + Math.sqrt(m.weight) * 2.4) * (TAKEN.has(m.state) ? 1.15 : 1)
const depth = (m: Node): number => m.parent ? 1 + depth(m.parent) : 0
const cloud = (x: number, y: number, k: number, op: number) => `<g opacity="${op.toFixed(2)}" fill="#ffffff"><circle cx="${x}" cy="${y}" r="${14 * k}"/><circle cx="${x + 18 * k}" cy="${y - 8 * k}" r="${18 * k}"/><circle cx="${x + 40 * k}" cy="${y}" r="${13 * k}"/><rect x="${x}" y="${y}" width="${40 * k}" height="${13 * k}"/></g>`

// crown: an egg-shaped canopy like the 3D linden (widest a little below the middle, narrower on top)
const CY = 282, RH = 372, RV = 218, ORIGIN: Point = { x: CX, y: FORK }
const halfWidth = (y: number) => { const dy = (y - CY) / RV; return RH * Math.sqrt(Math.max(0, 1 - dy * dy)) * (1 + .14 * dy) }
const inCrown = (p: Point) => Math.abs(p.x - CX) <= halfWidth(p.y)
// distance from `o` to the crown edge along the direction `d`
const reach = (o: Point, d: Point) => { let lo = 0, hi = 900; for (let i = 0; i < 22; i++) { const m = (lo + hi) / 2; if (inCrown({ x: o.x + d.x * m, y: o.y + d.y * m })) lo = m; else hi = m } return lo }
// a branch that leaves in the direction it was growing and bends up towards the light (or hangs, when dry)
const shapeGeo = (a: Point, b: Point, inDir: Point, s: number, seed: number, w0: number, w1: number): Geo => {
  const L = Math.hypot(b.x - a.x, b.y - a.y), to = unit({ x: b.x - a.x, y: b.y - a.y }), d0 = unit({ x: inDir.x * .55 + to.x * .45, y: inDir.y * .55 + to.y * .45 })
  const lift = .32 - (1 - s) * .7, d1 = unit({ x: to.x, y: to.y - lift }), wob = (jitter(seed) - .5) * L * .2
  return { a, b, c1: { x: a.x + d0.x * L * .38 - d0.y * wob, y: a.y + d0.y * L * .38 + d0.x * wob }, c2: { x: b.x - d1.x * L * .3, y: b.y - d1.y * L * .3 }, w0, w1 }
}
type Puff = { x: number; y: number; r: number; t: number; tone: number; rot: number; light: number }
// canopy puffs (fixed, any plan): a dark back mass for the silhouette and lit puffs denser on the outer
// shell; the underside stays open so the trunk and the branches show through, like a real crown
const CANOPY = (() => {
  const R = rng(53), back: Puff[] = [], front: Puff[] = []
  const fill = (out: Puff[], n: number, r0: number, r1: number, keep: (rho: number, dy: number, side: number) => boolean) => {
    for (let g = 0; out.length < n && g < n * 60; g++) {
      const x = CX + (R() * 2 - 1) * RH * 1.15, y = CY + (R() * 2 - 1) * RV, hw = halfWidth(y); if (hw < 1) continue
      const dy = (y - CY) / RV, side = Math.abs(x - CX) / hw; if (side > 1) continue
      const rho = Math.hypot(side * Math.sqrt(Math.max(0, 1 - dy * dy)), dy); if (!keep(rho, dy, side)) continue
      out.push({ x, y, r: r0 + R() * (r1 - r0), t: .05 + R() * .9, tone: R(), rot: R() * 360, light: clamp01(.55 - dy * .45 - (x - CX) / RH * .25) })
    }
  }
  fill(back, 95, 30, 50, (rho, dy, side) => rho < .84 && dy < .62 && !(dy > .45 && side < .5))
  fill(front, 250, 14, 26, (rho, dy, side) => rho < 1.02 && dy < .7 && R() < .2 + .8 * rho && !(dy > .45 && side < .62))
  front.sort((a, b) => a.light - b.light)
  return { back, front }
})()
// the thesis star sits just above the crown, not inside it
const STAR_Y = Math.max(16, Math.min(...[...CANOPY.back, ...CANOPY.front].map(p => p.y - p.r)) - 20)
// inner branches without data: they grow from the leader and hold the canopy, so a dry tree still looks like a tree
const INNER = (() => { const R = rng(71); return Array.from({ length: 14 }, (_, i) => ({ t: .12 + R() * .62, ang: Math.PI * (1.1 + .8 * (i + R() * .8) / 14), rho: .72 + R() * .2, w: 4 + R() * 3, twig: .45 + R() * .3, tAng: (R() - .5) * 1.2 })) })()
const CANOPY_GREENS = ['#4f8a45', '#62a052', '#7cb35e']

// a subject's prerequisite path: everything it needs (up) and everything it unlocks (down)
export function pathOf(plan: Plan, id: number | null): Set<number> | null {
  if (id == null) return null
  const set = new Set([id]), byId = new Map(plan.subjects.map(s => [s.subject_id, s]))
  const up = (x: number) => byId.get(x)?.requires.forEach(r => { if (!set.has(r.subject_id)) { set.add(r.subject_id); up(r.subject_id) } })
  const down = (x: number) => byId.get(x)?.unlocks.forEach(u => { if (!set.has(u)) { set.add(u); down(u) } })
  up(id); down(id); return set
}

export function layout(plan: Plan, tree: Tree | null): Node[] {
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
  const state = useRef({ health: visualHealth(tree), target: visualHealth(tree), path: null as Set<number> | null, sel: selected,
    falling: [] as (Leaf & { vy: number; phase: number; life: number; onGround?: boolean; fade?: number })[], visible: new Map<string, Leaf>(), first: true,
    geo: new Map<number, Geo>(), trunk: null as Geo | null, pills: [] as Rect[],
    koala: { k: 'trunk', t: .3, route: [], d: 0, wait: 1800, rest: 'sit', face: 1, clock: 0, blinkAt: 2500, blinkEnd: 0, key: '', el: null, placed: false } as Koala })
  const byKey = useMemo(() => new Map(nodes.map(n => [String(n.s.subject_id), n])), [nodes])

  const geoOf = (k: string): Geo | null => {
    const e = state.current
    if (k === 'trunk') return e.trunk
    if (k[0] === 'L') { const r = e.geo.get(Number(k.slice(1))); return r && e.trunk ? straight(e.trunk.b, r.a) : null }
    return e.geo.get(Number(k)) ?? null
  }
  // edge keys from an edge down to the trunk; each edge's t=0 sits on its parent's t=1
  const chain = (k: string): string[] => {
    if (k === 'trunk') return ['trunk']
    if (k[0] === 'L') return [k, 'trunk']
    const out: string[] = []
    for (let n = byKey.get(k); n; n = n.parent ?? undefined) { out.push(String(n.s.subject_id)); if (!n.parent) out.push(`L${n.s.subject_id}`) }
    return [...out, 'trunk']
  }
  const route = (from: string, t: number, to: string, u: number): Seg[] => {
    if (from === to) return [{ k: from, t0: t, t1: u }]
    const up = chain(from), down = chain(to), c = up.find(k => down.includes(k)) ?? 'trunk', segs: Seg[] = []
    for (const k of up) { if (k === c) break; segs.push({ k, t0: k === from ? t : 1, t1: 0 }) }
    segs.push({ k: c, t0: c === from ? t : 1, t1: c === to ? u : 1 })
    for (const k of down.slice(0, down.indexOf(c)).reverse()) segs.push({ k, t0: 0, t1: k === to ? u : 1 })
    return segs.filter(g => Math.abs(g.t1 - g.t0) > 1e-3)
  }
  // a resting spot on a sturdy branch (or the trunk) that keeps clear of labels and subject marks
  const pickSpot = (): { k: string; t: number } => {
    const e = state.current, sturdy = nodes.filter(n => (e.geo.get(n.s.subject_id)?.w0 ?? 0) >= 2.6)
    for (let i = 0; i < 40; i++) {
      const onTrunk = !sturdy.length || Math.random() < .12
      const k = onTrunk ? 'trunk' : String(sturdy[Math.floor(Math.random() * sturdy.length)].s.subject_id), t = onTrunk ? .15 + Math.random() * .6 : .22 + Math.random() * .5
      const g = geoOf(k); if (!g) continue
      const p = bez(g, t), box = { x: p.x - 15, y: p.y - 36, w: 30, h: 44 }
      if (p.x < 20 || p.x > W - 20 || p.y < 60) continue
      if (e.pills.some(r => overlap(box, r, 4))) continue
      if ([...e.geo.values()].some(q => Math.hypot(q.b.x - p.x, q.b.y - (p.y - 14)) < 24)) continue
      return { k, t }
    }
    return { k: 'trunk', t: .4 }
  }

  function updateKoala(dt: number, still: boolean) {
    const e = state.current, K = e.koala; if (!e.trunk || !K.el) return
    const s = e.health, mood: KoalaMood = s < .38 ? 'sleep' : s < .8 ? 'sad' : 'happy'
    if (!K.placed) { if (still) Object.assign(K, pickSpot()); K.placed = true }
    let dir: Point | null = null
    if (!still) {
      K.clock += dt
      const seg = K.route[0], g = seg && geoOf(seg.k)
      if (seg && !g) K.route = []
      else if (seg && g) {
        const speed = mood === 'happy' ? 30 : 18
        K.d += dt / 1000 * speed
        const f = Math.min(1, K.d / Math.max(1, arcLength(g, seg.t0, seg.t1)))
        K.k = seg.k; K.t = seg.t0 + (seg.t1 - seg.t0) * f
        const tg = tan(g, K.t), sign = seg.t1 > seg.t0 ? 1 : -1; dir = unit({ x: tg.x * sign, y: tg.y * sign })
        if (f >= 1) { K.route.shift(); K.d = 0; if (!K.route.length) { K.wait = 2500 + Math.random() * 4500; K.rest = Math.random() < .5 ? 'sit' : 'hug' } }
      } else if (mood !== 'sleep') {
        K.wait -= dt
        if (K.wait <= 0) { const spot = pickSpot(); K.route = route(K.k, K.t, spot.k, spot.t); K.d = 0; if (!K.route.length) K.wait = 2000 }
      }
      if (K.clock > K.blinkAt) { K.blinkEnd = K.clock + 150; K.blinkAt = K.clock + 2200 + Math.random() * 3000 }
    }
    let g = geoOf(K.k); if (!g) { K.k = 'trunk'; K.t = .3; K.route = []; g = e.trunk }
    const moving = !!dir && K.route.length > 0
    const pose: KoalaPose = moving ? (Math.abs(dir!.y) > Math.abs(dir!.x) * 1.4 ? 'climb' : 'walk') : mood === 'sleep' ? 'sleep' : K.k === 'trunk' ? 'hug' : K.rest
    if (moving && Math.abs(dir!.x) > .15) K.face = dir!.x > 0 ? 1 : -1
    const frame = moving ? Math.floor(K.clock / 180) % 2 : 0, shut = !still && K.clock < K.blinkEnd
    const z = mood === 'sleep' && !still ? Math.floor((K.clock / 1600 % 1) * 12) / 12 : .3
    const p = bez(g, K.t), w = g.w0 + (g.w1 - g.w0) * K.t
    const y = pose === 'hug' || pose === 'climb' ? p.y + 7 : p.y - w / 2 + 1.5 - (pose === 'walk' ? frame : 0)
    const key = `${pose}${mood}${frame}${shut}${z}`
    if (key !== K.key) { K.el.innerHTML = koalaSvg(pose, mood, shut, frame, z); K.key = key }
    K.el.setAttribute('transform', `translate(${fx(p.x)} ${fx(y)}) scale(${.88 * K.face} .88)`)
  }

  useEffect(() => { const e = state.current; e.target = visualHealth(tree); if (e.first) { e.health = e.target } }, [tree])
  useEffect(() => { state.current.path = pathOf(plan, selected); state.current.sel = selected; draw() })

  const RMAX = useMemo(() => Math.max(R0 + DR, ...nodes.map(n => n.r)), [nodes])

  function draw() {
    const svg = svgRef.current; if (!svg) return
    const e = state.current, s = e.health, path = e.path
    // each subject sits inside the egg-shaped crown: the angle comes from the prerequisite order, the distance
    // from the fork from year and term (as a share of the way to the crown edge in that direction)
    const pos = (m: Node): Point => { const yr = m.s.year ?? 1, droop = (1 - s) * .34 * (yr / 5)
      const a = Math.PI * 1.5 + (m.ang - Math.PI * 1.5) * .92 + (m.ang < Math.PI * 1.5 ? -droop : droop), d = { x: Math.cos(a), y: Math.sin(a) }
      const k = (.5 + .42 * clamp01((m.r - R0) / Math.max(1, RMAX - R0))) * reach(ORIGIN, d)
      return { x: CX + d.x * k, y: FORK + d.y * k + (1 - s) * yr * 7 } }
    const op = (id: number) => path && !path.has(id) ? .22 : 1
    // off-path foliage and wood fade to a pale tint instead of transparency (no blotchy overlaps)
    const dim = (col: string, id: number) => path && !path.has(id) ? mix(col, FADE, .72) : col
    const bark = mix('#6e6259', '#7a5236', s), barkDark = mix(bark, '#2e1f14', .38), barkLight = mix(bark, '#e2bf92', .4)
    const tw = Math.max(14, Math.min(28, 9 + Math.sqrt(nodes.length) * 1.6)), bw = tw * 1.5 + 8
    // the leader: the trunk keeps going up into the crown, tapering; branches leave it at different heights
    const leader: Geo = { a: { x: CX, y: FORK + 12 }, c1: { x: CX - 5, y: FORK - 70 }, c2: { x: CX + 9, y: 340 }, b: { x: CX + 5, y: 205 + (1 - s) * 20 }, w0: tw * 2, w1: 3 }
    const onLeader = (t: number, ang: number): Point => { const q = bez(leader, t), lw = leader.w0 + (leader.w1 - leader.w0) * Math.pow(t, .85); return { x: q.x + Math.sign(Math.cos(ang)) * lw * .28, y: q.y } }
    let o = ''
    // sky, sun, clouds and hills (they fade with health); sky and ground go past the viewBox
    // so they fill the scene when it is taller or wider than the drawing
    o += `<defs><linearGradient id="sky" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="${H}"><stop offset="0" stop-color="${mix('#9aa3a8', '#d5e8ef', s)}"/><stop offset=".62" stop-color="${mix('#c9c0b2', '#f1f3e8', s)}"/><stop offset="1" stop-color="${mix('#c8a98a', '#f9e2b4', s)}"/></linearGradient>
      <radialGradient id="sun"><stop offset="0" stop-color="#f9dfae" stop-opacity="${(.9 * s).toFixed(2)}"/><stop offset="1" stop-color="#f9dfae" stop-opacity="0"/></radialGradient></defs>
      <rect x="${-W}" y="${-H}" width="${3 * W}" height="${2 * H}" fill="url(#sky)"/><rect x="${-W}" y="${H - 28}" width="${3 * W}" height="${H}" fill="${mix('#8f7f60', '#7a9c58', s)}"/><ellipse cx="${CX}" cy="${H - 120}" rx="400" ry="260" fill="url(#sun)"/>
      ${cloud(110, 120, 1.1, .35 + .45 * s)}${cloud(820, 86, 1.3, .35 + .45 * s)}${cloud(680, 190, .7, .25 + .35 * s)}
      <path d="M0 ${H - 92} C200 ${H - 132} 400 ${H - 132} 500 ${H - 102} C650 ${H - 72} 800 ${H - 132} ${W} ${H - 112} L${W} ${H} L0 ${H}Z" fill="${mix('#b7ab8f', '#a9c08a', s)}"/>
      <path d="M0 ${H - 58} C200 ${H - 84} 380 ${H - 76} 550 ${H - 60} C720 ${H - 46} 860 ${H - 80} ${W} ${H - 66} L${W} ${H} L0 ${H}Z" fill="${mix('#a39270', '#8fae6a', s)}"/>
      <path d="M0 ${H - 26} C250 ${H - 44} 450 ${H - 36} 620 ${H - 28} C800 ${H - 20} 900 ${H - 38} ${W} ${H - 30} L${W} ${H} L0 ${H}Z" fill="${mix('#8f7f60', '#7a9c58', s)}"/>
      <ellipse cx="${CX}" cy="${GROUND + 8}" rx="${150 + 60 * s}" ry="11" fill="${SHADE}" opacity=".16"/>`
    // roots: tapered shapes that flare out over the grass
    for (const [d, len, dy] of [[-1, 74, 10], [1, 82, 9], [-1, 40, 4], [1, 36, 5]] as const) {
      const x0 = CX + d * bw * .35, tip = CX + d * (bw + len)
      o += `<path d="M${fx(x0)} ${GROUND - 22}C${fx(CX + d * bw * .95)} ${GROUND - 6} ${fx(CX + d * (bw + len * .45))} ${GROUND - 2 + dy * .3} ${fx(tip)} ${GROUND + dy}Q${fx(CX + d * (bw + len * .3))} ${GROUND + 6 + dy * .3} ${fx(CX + d * bw * .2)} ${GROUND + 8}Z" fill="${bark}"/>
        <path d="M${fx(CX + d * bw * .8)} ${GROUND - 4}Q${fx(CX + d * (bw + len * .4))} ${GROUND + 2} ${fx(tip - d * 6)} ${GROUND + dy - 1}" stroke="${barkDark}" stroke-width="1.6" fill="none" opacity=".4" stroke-linecap="round"/>`
    }
    // trunk: base, shaded side, lit edge, bark grooves and a knot
    const hw = (y: number) => tw + (bw - tw) * Math.pow(clamp01((y - FORK) / (GROUND - FORK)), 1.8)
    o += `<path d="M${fx(CX - bw)} ${GROUND + 6}C${fx(CX - bw * .7)} ${GROUND - 46} ${fx(CX - tw * 1.1)} ${FORK + 70} ${fx(CX - tw)} ${FORK + 4}Q${CX} ${FORK - 12} ${fx(CX + tw)} ${FORK + 4}C${fx(CX + tw * 1.1)} ${FORK + 70} ${fx(CX + bw * .7)} ${GROUND - 46} ${fx(CX + bw)} ${GROUND + 6}Z" fill="${bark}"/>
      <path d="M${fx(CX + tw * .25)} ${FORK + 2}C${fx(CX + tw * .45)} ${FORK + 70} ${fx(CX + bw * .3)} ${GROUND - 46} ${fx(CX + bw * .35)} ${GROUND + 6}L${fx(CX + bw)} ${GROUND + 6}C${fx(CX + bw * .7)} ${GROUND - 46} ${fx(CX + tw * 1.1)} ${FORK + 70} ${fx(CX + tw)} ${FORK + 4}Z" fill="${barkDark}" opacity=".5"/>
      <path d="M${fx(CX - tw * .72)} ${FORK + 16}C${fx(CX - tw * .82)} ${FORK + 70} ${fx(CX - bw * .6)} ${GROUND - 60} ${fx(CX - bw * .66)} ${GROUND - 10}" stroke="${barkLight}" stroke-width="3.5" fill="none" opacity=".5" stroke-linecap="round"/>`
    for (const [fxr, y0, y1] of [[-.45, .12, .42], [-.12, .3, .7], [.18, .05, .3], [.4, .5, .85], [-.32, .6, .92], [.05, .78, .98]] as const) {
      const ya = FORK + (GROUND - FORK) * y0, yb = FORK + (GROUND - FORK) * y1
      o += `<path d="M${fx(CX + fxr * hw(ya))} ${fx(ya)}Q${fx(CX + fxr * hw(ya) * 1.25)} ${fx((ya + yb) / 2)} ${fx(CX + fxr * hw(yb))} ${fx(yb)}" stroke="${barkDark}" stroke-width="1.6" fill="none" opacity=".42" stroke-linecap="round"/>`
    }
    const ky = FORK + (GROUND - FORK) * .46
    o += `<ellipse cx="${fx(CX + tw * .2)}" cy="${fx(ky)}" rx="3.6" ry="5.4" fill="${barkDark}" opacity=".6"/><path d="M${fx(CX + tw * .2 - 5)} ${fx(ky - 7)}Q${fx(CX + tw * .2)} ${fx(ky - 11)} ${fx(CX + tw * .2 + 5)} ${fx(ky - 7)}" stroke="${barkLight}" stroke-width="1.4" fill="none" opacity=".5" stroke-linecap="round"/>`
    // the dry tree drops leaves on the grass (stable positions, the pile grows as health drops)
    const pileN = Math.round(Math.max(0, .82 - s) * 70)
    if (pileN) { const R = rng(91); for (let i = 0; i < pileN; i++) { const x = CX + (R() - .5) * 2 * (50 + R() * 250), y = GROUND - 3 + R() * 12, rot = R() * 360, k = .7 + R() * .4, col = mix('#c9b04a', '#9a6a3a', R()); o += leafPath(x, y, rot, k, col) } }

    // branch geometry: parents first, so each branch leaves its parent in the direction it was growing
    const geo = new Map<number, Geo>()
    for (const m of [...nodes].sort((x, y) => depth(x) - depth(y))) {
      const id = m.s.subject_id, b = pos(m), pg = m.parent ? geo.get(m.parent.s.subject_id) : undefined
      // first-level branches leave the leader: the more upright, the higher they start
      const a = pg ? pg.b : onLeader(.03 + (1 - Math.abs(Math.cos(m.ang))) * .34 + jitter(id + 7) * .05, m.ang)
      const inDir = pg ? unit(tan(pg, 1)) : unit({ x: Math.cos(m.ang) * .45, y: -1 })
      const w0 = thick(m), w1 = m.children.length ? Math.min(w0 * .9, Math.max(...m.children.map(thick))) : 1.3
      geo.set(id, shapeGeo(a, b, inDir, s, id, w0, w1))
    }
    e.geo = geo; e.trunk = { ...straight({ x: CX, y: GROUND - 44 }, { x: CX, y: FORK + 10 }), w0: tw * 2, w1: tw * 2 }

    // foliage: each subject gets a clump (a solid mass behind the wood plus lit puffs in front of it),
    // drawn in layers across the whole crown so neighbouring clumps merge into a few volumes
    const now = new Map<string, Leaf>(), back: string[] = [], shadow: string[] = [], body: string[] = [], shine: string[] = [], edge: string[] = []
    // the shared canopy goes first, so each subject's own foliage sits on top of it; it thins out as health drops
    const cdim = (c: string) => path ? mix(c, FADE, .72) : c, sag = (1 - s) * 8
    for (const p of CANOPY.back) { const v = clamp01((s - p.t * .9) / .08); if (v > 0) back.push(circle(p.x, p.y + sag, p.r * (.6 + .4 * v), cdim(mix(dried(CANOPY_GREENS[0], s), SHADE, .32)))) }
    CANOPY.front.forEach((p, i) => { const v = clamp01((s - p.t * .95) / .08); if (v <= 0) return
      const base = dried(CANOPY_GREENS[Math.floor(p.tone * 3)], s), col = mix(mix(base, SHADE, Math.max(0, (p.y - CY) / RV) * .3), '#b5d873', p.light * .3), r = p.r * v, y = p.y + sag
      now.set(`c${i}`, { x: p.x, y, rot: p.rot, k: 1, col })
      shadow.push(circle(p.x + 1.5, y + 2.5, r + .5, cdim(mix(col, SHADE, .26))))
      body.push(circle(p.x, y, r, cdim(col)))
      if (r > 10) shine.push(circle(p.x - r * .3, y - r * .34, r * .46, cdim(mix(col, SHINE, .15 + .3 * p.light))))
      if (p.tone < .25) { const a = p.rot * Math.PI / 180; edge.push(leafPath(p.x + Math.cos(a) * r, y + Math.sin(a) * r, p.rot + 90, .8 * v, cdim(mix(col, SHADE, .1)))) } })
    for (const m of nodes) { const id = m.s.subject_id, g = geo.get(id)!, sl = m.info?.dry ? Math.min(s, .3) : s
      const vis = (h: LeafSeed) => clamp01((sl - h.t * .95) / .08)
      const full = m.leaves.reduce((t, h) => t + vis(h), 0) / Math.max(1, m.leaves.length)
      if (full > 0) { const k = (.75 + m.leaves.length / 18 * .55) * Math.sqrt(full), mass = dim(mix(dried(GREENS[m.state][0], sl), SHADE, .18), id), { x, y } = g.b
        for (const [dx, dy, r] of [[0, -10, 25], [-19, 1, 18], [19, -1, 19], [-8, -24, 15], [10, -22, 16]] as const) back.push(circle(x + dx * k, y + dy * k, r * k, mass)) }
      m.branchLeaves.forEach((h, i) => { const v = vis(h); if (v <= 0) return
        const p = bez(g, h.f), col = dried(GREENS[m.state][Math.floor(h.v * 3)], sl)
        now.set(`${id}r${i}`, { x: p.x, y: p.y, rot: h.rot, k: h.k, col })
        edge.push(leafPath(p.x, p.y, h.rot, h.k * 1.05 * v, dim(col, id))) })
      m.leaves.forEach((h, i) => { const v = vis(h); if (v <= 0) return
        const p = { x: g.b.x + h.dx * .8, y: g.b.y + h.dy * .8 - 4 }, col = dried(GREENS[m.state][Math.floor(h.v * 3)], sl), r = (7 + h.k * 5.5) * v
        now.set(`${id}h${i}`, { x: p.x, y: p.y, rot: h.rot, k: h.k, col })
        shadow.push(circle(p.x + 1.5, p.y + 2.5, r + .5, dim(mix(col, SHADE, .26), id)))
        body.push(circle(p.x, p.y, r, dim(col, id)))
        if (r > 8) shine.push(circle(p.x - r * .3, p.y - r * .34, r * .48, dim(mix(col, SHINE, .4), id)))
        if (h.v < .3) { const a = h.rot * Math.PI / 180; edge.push(leafPath(p.x + Math.cos(a) * r, p.y + Math.sin(a) * r, h.rot + 90, .7 * v, dim(mix(col, SHADE, .1), id))) } }) }
    o += back.join('')

    // the leader and the inner branches (with a twig each), over the dark mass of the crown
    const innerWood = cdim(mix(bark, '#a8916f', .25))
    o += `<path d="${ribbon(leader, leader.w0, leader.w1)}" fill="${cdim(bark)}"/><path d="${ribbon(leader, leader.w0 * .26, leader.w1 * .26, .8, -1)}" fill="${cdim(barkLight)}" opacity=".5"/>`
    INNER.forEach((b, i) => {
      const a = onLeader(b.t, b.ang), ang = b.ang + (b.ang < Math.PI * 1.5 ? -1 : 1) * (1 - s) * .3, d = { x: Math.cos(ang), y: Math.sin(ang) }, L = reach(a, d) * b.rho
      const g = shapeGeo(a, { x: a.x + d.x * L, y: a.y + d.y * L + (1 - s) * 16 }, unit({ x: d.x * .4, y: -1 }), s, 300 + i, b.w, 1.1)
      const tp = bez(g, b.twig), td = unit(tan(g, b.twig)), ta = Math.atan2(td.y, td.x) + b.tAng, tdir = unit({ x: Math.cos(ta), y: Math.sin(ta) - .4 })
      const twig = shapeGeo(tp, { x: tp.x + tdir.x * L * .28, y: tp.y + tdir.y * L * .28 }, td, s, 400 + i, (b.w + (1.1 - b.w) * Math.pow(b.twig, .85)) * .7, .9)
      o += `<path d="${ribbon(g, g.w0, g.w1)}" fill="${innerWood}"/><path d="${ribbon(twig, twig.w0, twig.w1)}" fill="${innerWood}"/>` })

    // branches: heavy ones first; when a subject is picked, its path is drawn again over the crown with a glow
    const branchSvg = (m: Node, glow: boolean) => { const id = m.s.subject_id, g = geo.get(id)!
      const wood = dim(m.info?.dry ? '#8a7a68' : TAKEN.has(m.state) ? bark : mix(bark, '#a8916f', .4), id)
      let t = glow ? `<path d="${curve(g)}" stroke="#fff27a" stroke-width="${fx(g.w0 + 10)}" fill="none" stroke-linecap="round" opacity=".9"/>` : ''
      t += `<path d="${ribbon(g, g.w0, g.w1)}" fill="${wood}"/><circle cx="${fx(g.b.x)}" cy="${fx(g.b.y)}" r="${fx(g.w1 / 2)}" fill="${wood}"/>`
      if (g.w0 > 4) { const mt = unit(tan(g, .5)), side = -mt.y * -.6 + mt.x * -.8 > 0 ? 1 : -1
        t += `<path d="${ribbon(g, g.w0 * .28, g.w1 * .28, .8, side)}" fill="${dim(barkLight, id)}" opacity=".55"/>` }
      return t }
    const heavy = [...nodes].sort((x, y) => y.weight - x.weight)
    for (const m of heavy) o += branchSvg(m, false)
    o += shadow.join('') + body.join('') + shine.join('') + edge.join('')
    if (path) for (const m of heavy) if (path.has(m.s.subject_id)) o += branchSvg(m, !m.parent || path.has(m.parent.s.subject_id))

    // prerequisites other than the main branch: only when a subject is selected
    if (path) for (const m of nodes) for (const r of m.s.requires) { const p = nodes.find(x => x.s.subject_id === r.subject_id)
      if (p && p !== m.parent && path.has(m.s.subject_id) && path.has(r.subject_id)) { const a = geo.get(p.s.subject_id)!.b, b = geo.get(m.s.subject_id)!.b
        o += `<path d="M${fx(a.x)} ${fx(a.y)} Q${fx((a.x + b.x) / 2)} ${fx(Math.min(a.y, b.y) - 40)} ${fx(b.x)} ${fx(b.y)}" stroke="#2b2a22" stroke-width="1.5" stroke-dasharray="${r.condition === 'regular' ? '2 4' : '5 4'}" fill="none"/>` } }

    if (!(e.health < e.target - 1e-3) && !e.first) for (const [k, h] of e.visible) if (!now.has(k)) e.falling.push({ ...h, vy: .5 + Math.random() * .6, phase: Math.random() * 6, life: 0 })
    e.visible = now; e.first = false

    // the thesis on top of the crown: the final goal (drawn after the foliage so it is never covered)
    if (plan.final_goal) o += `<g opacity="${path ? .4 : 1}">
      <polygon points="${[...Array(10)].map((_, i) => { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? 6 : 13; return `${(CX + rr * Math.cos(a)).toFixed(1)},${(STAR_Y + rr * Math.sin(a)).toFixed(1)}` }).join(' ')}" fill="#f2c14e" stroke="#b8863b"/>
      <text x="${CX + 20}" y="${STAR_Y + 5}" font-size="12" font-weight="800" fill="#6f6a5c" stroke="#fffdf4" stroke-width="3" paint-order="stroke">${esc(plan.final_goal.name)}</text></g>`

    // the koala lives under the marks and labels, so it can never cover a subject's name
    o += `<g class="koala-slot" pointer-events="none" aria-hidden="true"></g>`

    // marks and names: what is approved stays even if the tree dries up; a halo keeps them readable over the foliage
    e.pills = []
    // every mark is drawn before any name, and names keep clear of marks too, so nothing covers a label
    const shown: Rect[] = nodes.map(m => { const p = geo.get(m.s.subject_id)!.b; return { x: p.x - 11, y: p.y - 13, w: 22, h: 24 } })
    let labelsSvg = ''
    for (const m of nodes) { const p = geo.get(m.s.subject_id)!.b, o2 = op(m.s.subject_id), id = m.s.subject_id
      o += `<circle cx="${fx(p.x)}" cy="${fx(p.y)}" r="11" fill="#fffdf4" opacity="${(.85 * o2).toFixed(2)}" stroke="#2b2a22" stroke-opacity=".1"/>`
      const flower = (c: string, center: string) => `<g opacity="${o2}">${[0, 72, 144, 216, 288].map(a => `<circle cx="${(p.x + 6 * Math.cos(a * Math.PI / 180)).toFixed(1)}" cy="${(p.y + 6 * Math.sin(a * Math.PI / 180)).toFixed(1)}" r="5" fill="${c}" stroke="#7a5236" stroke-width=".6"/>`).join('')}<circle cx="${fx(p.x)}" cy="${fx(p.y)}" r="3.2" fill="${center}"/></g>`
      if (m.state === 'approved') o += flower('#ffffff', '#f2c14e')
      else if (m.info?.flower) o += flower('#ffc2dc', '#d9822b')
      else if (m.state === 'regular') o += `<circle cx="${fx(p.x)}" cy="${fx(p.y)}" r="6" fill="#f2c14e" stroke="#b8863b" opacity="${o2}"/>`
      else if (m.state === 'enrolled') o += `<circle cx="${fx(p.x)}" cy="${fx(p.y)}" r="6.5" fill="#fff" stroke="#5b84b1" stroke-width="2.2" opacity="${o2}"/><circle cx="${fx(p.x)}" cy="${fx(p.y)}" r="2.6" fill="#5b84b1" opacity="${o2}"/>`
      else o += `<path d="M${fx(p.x)} ${fx(p.y + 6)}C${fx(p.x - 6)} ${fx(p.y)} ${fx(p.x - 4)} ${fx(p.y - 9)} ${fx(p.x)} ${fx(p.y - 12)}C${fx(p.x + 4)} ${fx(p.y - 9)} ${fx(p.x + 6)} ${fx(p.y)} ${fx(p.x)} ${fx(p.y + 6)}Z" fill="${m.state === 'available' ? '#c9e0b0' : '#ead9c4'}" stroke="${m.state === 'available' ? '#6f9866' : '#b99c80'}" opacity="${o2}"/>`
      const t = shortName(m.s.name), w = measure(t) + 18, h = 21, [fill, border, ink] = PILL[m.state], sel = id === e.sel, hidden = m.state === 'locked' && !sel && !path?.has(id)
      // visible names try a few spots around their mark (below, above, further down, to the sides) until one is free
      const clampX = (x: number) => Math.max(w / 2 + 6, Math.min(W - w / 2 - 6, x))
      const spots: Point[] = [[0, 22], [0, -26], [0, 44], [w / 2 + 14, 0], [-w / 2 - 14, 0], [0, -48], [w / 2 + 10, 24], [-w / 2 - 10, 24]].map(([dx, dy]) => ({ x: clampX(p.x + dx), y: p.y + dy }))
      const free = (q: Point) => !shown.some(r => overlap({ x: q.x - w / 2, y: q.y - h / 2, w, h: h + 2 }, r, 3))
      const { x: px, y } = spots.find(free) ?? spots[0]
      const box = { x: px - w / 2, y: y - h / 2, w, h: h + 2 }
      e.pills.push(box); shown.push(box)
      const neck = m.s.bottleneck && m.state !== 'approved', name = esc(m.s.name)
      labelsSvg += `<g class="node" data-id="${id}" opacity="${o2}" tabindex="0" role="button" aria-label="${name}"><title>${name}</title>
        <circle cx="${fx(p.x)}" cy="${fx(p.y)}" r="18" fill="transparent"/>
        <g class="pill${hidden ? ' hidden-label' : ''}"><rect x="${fx(px - w / 2)}" y="${fx(y - h / 2 + 2)}" width="${fx(w)}" height="${h}" rx="${h / 2}" fill="${SHADE}" opacity=".18"/>
        <rect x="${fx(px - w / 2)}" y="${fx(y - h / 2)}" width="${fx(w)}" height="${h}" rx="${h / 2}" fill="${fill}" stroke="${sel ? '#2b2a22' : neck ? '#c98a2b' : border}" stroke-width="${sel ? 2 : neck ? 1.4 : 1}"/>
        <text x="${fx(px)}" y="${fx(y + 4)}" text-anchor="middle" font-size="11" font-weight="700" fill="${ink}">${esc(t)}</text></g></g>` }
    o += labelsSvg
    for (const f of e.falling) o += leafPath(f.x, f.y, f.rot, f.k, f.col, f.onGround ? Math.max(0, 1 - (f.fade ?? 0)) : 1)
    svg.innerHTML = o
    // the koala element survives redraws: it is moved into the fresh slot and keeps its pose
    const slot = svg.querySelector('.koala-slot')
    if (slot) { e.koala.el ??= document.createElementNS('http://www.w3.org/2000/svg', 'g'); slot.appendChild(e.koala.el) }
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
      updateKoala(dt, still)
      raf = requestAnimationFrame(tick) }
    document.fonts.ready.then(() => { draw(); raf = requestAnimationFrame(tick) })
    return () => cancelAnimationFrame(raf)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, RMAX])

  return <svg ref={svgRef} className="tree-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMax meet" role="img" aria-label="Árbol del plan de estudios"
    onClick={ev => { const g = (ev.target as Element).closest('.node') as SVGGElement | null; const id = g ? Number(g.dataset.id) : null; onSelect(id === selected ? null : id) }}
    onKeyDown={ev => { if (ev.key === 'Enter' || ev.key === ' ') { const g = (ev.target as Element).closest('.node') as SVGGElement | null; if (g) { ev.preventDefault(); onSelect(Number(g.dataset.id)) } } }} />
}

// Continuous health for the drawing: the backend decides the state (`health.state`, with its
// thresholds and the exam season); within that state, the days since `last_activity` give the exact
// point, so the tree dries out little by little instead of in 3 jumps.
const BANDS: Record<HealthState, [number, number, number, number]> = { lush: [1, .86, 0, 5], wilted: [.75, .42, 5, 10], withered: [.35, .1, 10, 16] }
export function visualHealth(tree: Tree | null): number {
  if (!tree) return 1
  const [high, low, d0, d1] = BANDS[tree.health.state], last = tree.health.last_activity
  if (!last) return high
  const days = (Date.now() - new Date(last).getTime()) / 864e5, t = Math.max(0, Math.min(1, (days - d0) / (d1 - d0)))
  return high + (low - high) * t
}

// Koala mascot: geometry helpers and the flat drawing (dark brown outline, warm grey fur).
// Local coordinates: origin at the feet, about 37 units tall, drawn at 0.88 scale (~32px in the viewBox).
const straight = (a: Point, b: Point): Geo => ({ a, b, c1: { x: a.x + (b.x - a.x) / 3, y: a.y + (b.y - a.y) / 3 }, c2: { x: a.x + (b.x - a.x) * 2 / 3, y: a.y + (b.y - a.y) * 2 / 3 }, w0: 2, w1: 2 })
const overlap = (a: Rect, b: Rect, m: number) => a.x < b.x + b.w + m && b.x < a.x + a.w + m && a.y < b.y + b.h + m && b.y < a.y + a.h + m
const arcLength = (g: Geo, t0: number, t1: number) => { let l = 0, p = bez(g, t0); for (let i = 1; i <= 10; i++) { const q = bez(g, t0 + (t1 - t0) * i / 10); l += Math.hypot(q.x - p.x, q.y - p.y); p = q } return l }

const K_INK = '#4a3226', K_FUR = '#c9bfb4', K_LIGHT = '#e8e1d8', K_EAR = '#7b5a4a', K_BLUSH = '#e8a99b'
const K_LINE = `stroke="${K_INK}" stroke-width="1.5" stroke-linejoin="round"`
const ell = (cx: number, cy: number, rx: number, ry: number, rot = 0) =>
  `<ellipse cx="${fx(cx)}" cy="${fx(cy)}" rx="${rx}" ry="${ry}"${rot ? ` transform="rotate(${rot} ${fx(cx)} ${fx(cy)})"` : ''} fill="${K_FUR}" ${K_LINE}/>`

function koalaSvg(pose: KoalaPose, mood: KoalaMood, blink: boolean, frame: number, z: number) {
  const sw = frame ? 1.2 : -1.2, holding = pose === 'hug' || pose === 'climb', lift = pose === 'climb' ? sw * 1.5 : 0
  let o = ''
  if (pose === 'walk') o += ell(-4.5 + sw, -2.4, 3.3, 2.8) + ell(4.5 - sw, -2.4, 3.3, 2.8)
  else if (holding) o += ell(-5.5, -3.5 + lift, 3, 3.4) + ell(5.5, -3.5 - lift, 3, 3.4)
  else o += ell(-5.2, -2, 3.8, 2.6) + ell(5.2, -2, 3.8, 2.6)
  o += ell(0, -11, 9.5, 10) + `<ellipse cx="0" cy="-9.5" rx="5.6" ry="6.6" fill="${K_LIGHT}"/>`
  if (holding) o += ell(-5, -8.5 + lift, 5, 2.8, -12) + ell(5, -8.5 - lift, 5, 2.8, 12)
  else if (pose === 'walk') o += ell(-8, -11.5 + sw, 2.8, 4.8, 18) + ell(8, -11.5 - sw, 2.8, 4.8, -18)
  else o += ell(-7.6, -10.5, 2.8, 4.6, 22) + ell(7.6, -10.5, 2.8, 4.6, -22)
  for (const d of [-1, 1]) o += `<circle cx="${d * 9.2}" cy="-30.5" r="5.8" fill="${K_FUR}" ${K_LINE}/><circle cx="${d * 9.4}" cy="-30.2" r="3.1" fill="${K_EAR}"/>`
  o += `<ellipse cx="0" cy="-23.5" rx="10.8" ry="9.6" fill="${K_FUR}" ${K_LINE}/>`
  if (mood === 'happy') o += `<circle cx="-6.8" cy="-19.6" r="1.9" fill="${K_BLUSH}" opacity=".65"/><circle cx="6.8" cy="-19.6" r="1.9" fill="${K_BLUSH}" opacity=".65"/>`
  const eyeLine = `stroke="${K_INK}" stroke-width="1.2" fill="none" stroke-linecap="round"`
  if (mood === 'sleep') o += `<path d="M-5.2 -24.4Q-3.8 -22.8 -2.4 -24.4M2.4 -24.4Q3.8 -22.8 5.2 -24.4" ${eyeLine}/>`
  else if (blink) o += `<path d="M-5 -24.2H-2.6M2.6 -24.2H5" ${eyeLine}/>`
  else o += `<circle cx="-3.8" cy="-24.4" r="1.4" fill="${K_INK}"/><circle cx="3.8" cy="-24.4" r="1.4" fill="${K_INK}"/>`
  if (mood === 'sad') o += `<path d="M-5.8 -26.6L-2.8 -27.8M2.8 -27.8L5.8 -26.6" ${eyeLine}/>`
  o += `<ellipse cx="0" cy="-20.6" rx="2.5" ry="3.1" fill="${K_INK}"/><circle cx="-.8" cy="-21.8" r=".6" fill="${K_LIGHT}"/>`
  if (mood === 'happy') o += `<path d="M-2.4 -16.6Q0 -14.6 2.4 -16.6" ${eyeLine}/>`
  else if (mood === 'sad') o += `<path d="M-2.2 -15.2Q0 -16.8 2.2 -15.2" ${eyeLine}/>`
  else o += `<ellipse cx="0" cy="-15.8" rx=".9" ry="1.1" fill="${K_INK}"/>`
  if (mood === 'sleep') for (const ph of [z, (z + .5) % 1])
    o += `<text x="${fx(9 + ph * 4)}" y="${fx(-36 - ph * 9)}" font-size="${fx(6 + ph * 3)}" font-weight="800" fill="${K_INK}" opacity="${(1 - ph).toFixed(2)}">z</text>`
  return o
}
