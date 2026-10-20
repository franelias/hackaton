'use client'
// The career tree in 3D (three.js), modelled on a real broadleaf tree (a linden):
// - a short, thick trunk with a root flare, bark furrows and a central leader the branches grow from;
// - each subject is a branch that grows from its prerequisite (or from the leader, if it has none) and
//   ends at a point of the crown: the height comes from year and term, the angle around the trunk from
//   the prerequisite order (`layout`), so each branch stays close to the one that enables it;
// - an egg-shaped crown made of leaf clumps on an outer shell (real foliage is a shell, not a solid ball),
//   shaded darker inside and below and lighter where the sun hits it;
// - tapered branches as thick as what they hold up, twigs, and ascending inner branches that hold the clumps;
// - ~7000 leaves (InstancedMesh) that sway with the wind, dry out, fall to the grass and grow back;
// - approved subjects bloom (the flowers never fall);
// - labels do not overlap: every few frames their place on screen is computed and the lower priority
//   ones that collide are hidden (they show on hover).
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js'
import { dried, GREENS, layout, mix, pathOf, shortName, visualHealth, type Node } from './TreeView'
import type { Plan, Tree } from '../lib/types'

interface Props { plan: Plan; tree: Tree | null; selected: number | null; onSelect: (id: number | null) => void; allNames?: boolean }

const TRUNK_H = 2.7, CROWN_Y = 7.6, CROWN_RH = 4.7, CROWN_RV = 5.1, TOP = 12.4
const MARK: Record<string, number> = { approved: 0xffffff, regular: 0xf2c14e, enrolled: 0x5b84b1, available: 0xa9cf80, locked: 0xd9c4a8 }
const PRIORITY: Record<string, number> = { enrolled: 1, regular: 2, approved: 3, available: 4, locked: 5 }
const rng = (seed: number) => () => (seed = (seed * 16807) % 2147483647) / 2147483647

// crown half-width at a given height: wider in the lower middle, narrower towards the top (egg shape)
const crownRadiusAt = (y: number) => { const dy = (y - CROWN_Y) / CROWN_RV; return CROWN_RH * Math.sqrt(Math.max(.05, 1 - dy * dy)) * (1 - .14 * dy) }

// a tube whose radius follows radiusAt(t); `furrows` adds bark ridges running along it
function tube(curve: THREE.Curve<THREE.Vector3>, radiusAt: (t: number) => number, seg = 16, sides = 8, furrows = 0) {
  const g = new THREE.TubeGeometry(curve, seg, 1, sides), p = g.attributes.position as THREE.BufferAttribute, c = new THREE.Vector3(), v = new THREE.Vector3()
  for (let i = 0; i <= seg; i++) { curve.getPointAt(i / seg, c); const r = radiusAt(i / seg)
    for (let j = 0; j <= sides; j++) { const k = i * (sides + 1) + j, a = j / sides * Math.PI * 2
      const ridge = furrows ? 1 + furrows * (Math.sin(a * 9 + i * .11) * .6 + Math.sin(a * 23 - i * .07) * .4) : 1
      v.fromBufferAttribute(p, k).sub(c).multiplyScalar(r * ridge).add(c); p.setXYZ(k, v.x, v.y, v.z) } }
  p.needsUpdate = true; g.computeVertexNormals(); return g
}
const tapered = (curve: THREE.Curve<THREE.Vector3>, r0: number, r1: number, seg = 16, sides = 8) => tube(curve, t => r0 + (r1 - r0) * Math.pow(t, .8), seg, sides)

// bark: vertical furrows drawn on a canvas, used as colour and bump map
function barkTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d')!, R = rng(7)
  x.fillStyle = '#8a7360'; x.fillRect(0, 0, 256, 256)
  for (let i = 0; i < 140; i++) { const y = R() * 256, w = 1 + R() * 4; x.strokeStyle = `rgba(${R() < .5 ? '40,28,20' : '170,150,128'},${.25 + R() * .45})`; x.lineWidth = w
    x.beginPath(); x.moveTo(0, y); for (let s = 0; s <= 256; s += 16) x.lineTo(s, y + Math.sin(s * .05 + i) * 3 + (R() - .5) * 3); x.stroke() }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.repeat.set(3, 2); return t
}
// soft contact shadow under the crown (ambient occlusion on the grass)
function shadeTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d')!, g = x.createRadialGradient(64, 64, 4, 64, 64, 64)
  g.addColorStop(0, 'rgba(30,40,20,.55)'); g.addColorStop(.5, 'rgba(30,40,20,.22)'); g.addColorStop(1, 'rgba(30,40,20,0)'); x.fillStyle = g; x.fillRect(0, 0, 128, 128)
  return new THREE.CanvasTexture(c)
}

// Mamo in 3D, in the same flat style as the 2D one: warm grey fur, dark brown ears and nose, and a dark
// outline made with slightly larger back-facing copies of each part. About 0.6 units tall, origin at the seat.
type MamoPose = 'walk' | 'climb' | 'sit' | 'hug' | 'sleep'
type MamoMood = 'happy' | 'sad' | 'sleep'
function buildMamo(mat: (o: THREE.MeshStandardMaterialParameters) => THREE.MeshStandardMaterial, geo: <G extends THREE.BufferGeometry>(g: G) => G, keep: { dispose(): void }[]) {
  const ball = geo(new THREE.SphereGeometry(1, 20, 14)), arc = geo(new THREE.TorusGeometry(.024, .006, 6, 14, Math.PI))
  const fur = mat({ color: 0xc9bfb4, roughness: .95 }), light = mat({ color: 0xe8e1d8, roughness: .95 }), ink = mat({ color: 0x4a3226, roughness: .45 }), earInk = mat({ color: 0x7b5a4a, roughness: .95 })
  const blushMat = mat({ color: 0xe8a99b, roughness: 1, transparent: true, opacity: .8 })
  const line = new THREE.MeshBasicMaterial({ color: 0x4a3226, side: THREE.BackSide }); keep.push(line)
  const root = new THREE.Group(), body = new THREE.Group(), head = new THREE.Group(); root.add(body)
  type V3 = [number, number, number]
  const part = (parent: THREE.Object3D, m: THREE.Material, p: V3, k: V3, outline = true, off: V3 = [0, 0, 0]) => {
    const g = new THREE.Group(); g.position.set(...p)
    const s = new THREE.Mesh(ball, m); s.scale.set(...k); s.position.set(...off); s.castShadow = true; g.add(s)
    if (outline) { const o = new THREE.Mesh(ball, line); o.scale.set(k[0] + .014, k[1] + .014, k[2] + .014); o.position.set(...off); g.add(o) }
    parent.add(g); return g }
  part(body, fur, [0, .17, 0], [.15, .17, .13])
  part(body, light, [0, .15, .085], [.095, .115, .055], false)
  const legL = part(body, fur, [-.085, .07, .04], [.06, .045, .075], true, [0, -.03, .03]), legR = part(body, fur, [.085, .07, .04], [.06, .045, .075], true, [0, -.03, .03])
  const armL = part(body, fur, [-.12, .27, .05], [.045, .085, .045], true, [0, -.06, .02]), armR = part(body, fur, [.12, .27, .05], [.045, .085, .045], true, [0, -.06, .02])
  head.position.set(0, .4, .02); body.add(head)
  part(head, fur, [0, 0, 0], [.17, .15, .14])
  const eyes: THREE.Object3D[] = [], blushes: THREE.Object3D[] = [], brows: THREE.Object3D[] = []
  for (const d of [-1, 1]) {
    part(head, fur, [d * .15, .11, -.01], [.075, .075, .04]); part(head, earInk, [d * .152, .11, .025], [.045, .045, .018], false)
    eyes.push(part(head, ink, [d * .065, .035, .122], [.016, .016, .014], false))
    blushes.push(part(head, blushMat, [d * .105, -.03, .1], [.026, .016, .01], false))
    const b = part(head, ink, [d * .068, .075, .108], [.03, .006, .006], false); b.rotation.z = -d * .35; brows.push(b)
  }
  part(head, ink, [0, -.01, .13], [.034, .046, .03], false)
  const mouth = new THREE.Mesh(arc, ink); mouth.position.z = .124; head.add(mouth)
  const zzEl = document.createElement('div'); zzEl.className = 'mamo-zz'; zzEl.setAttribute('aria-hidden', 'true'); zzEl.innerHTML = '<span>z</span><span>z</span>'
  const zz = new CSS2DObject(zzEl); zz.position.set(.16, .2, 0); head.add(zz)

  const set = (pose: MamoPose, mood: MamoMood, phase: number, blink: boolean) => {
    const sw = Math.sin(phase)
    for (const l of [armL, armR, legL, legR]) l.rotation.set(0, 0, 0)
    head.rotation.set(0, 0, 0); body.position.y = 0
    if (pose === 'walk') { armL.rotation.x = sw * .7; armR.rotation.x = -sw * .7; legL.rotation.x = -sw * .6; legR.rotation.x = sw * .6; body.position.y = Math.abs(sw) * .018 }
    else if (pose === 'climb') { armL.rotation.x = 2.7 + sw * .35; armR.rotation.x = 2.7 - sw * .35; legL.rotation.x = .5 - sw * .3; legR.rotation.x = .5 + sw * .3 }
    else if (pose === 'hug') { armL.rotation.set(.9, 0, -.5); armR.rotation.set(.9, 0, .5); legL.rotation.x = .4; legR.rotation.x = .4 }
    else { armL.rotation.set(-.6, 0, .25); armR.rotation.set(-.6, 0, -.25); legL.rotation.x = -1.2; legR.rotation.x = -1.2; if (pose === 'sleep') head.rotation.set(.35, 0, .18) }
    blushes.forEach(b => (b.visible = mood === 'happy')); brows.forEach(b => (b.visible = mood === 'sad'))
    mouth.visible = mood !== 'sleep'; mouth.rotation.z = mood === 'happy' ? Math.PI : 0; mouth.position.y = mood === 'happy' ? -.06 : -.088
    const shut = mood === 'sleep' || blink; eyes.forEach(e => e.scale.setY(shut ? .18 : 1))
    zz.visible = mood === 'sleep'
  }
  return { root, set }
}

export default function TreeView3D({ plan, tree, selected, onSelect, allNames = false }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const nodes = useMemo(() => layout(plan, tree), [plan, tree])
  // names shown without searching: what is being taken and its related subjects (what it needs and what it unlocks)
  const focus = useMemo(() => { const s = new Set<number>(), byId = new Map(plan.subjects.map(x => [x.subject_id, x]))
    for (const t of tree?.subjects ?? []) if (t.state === 'enrolled') { s.add(t.subject_id); byId.get(t.subject_id)?.requires.forEach(r => s.add(r.subject_id)); byId.get(t.subject_id)?.unlocks.forEach(u => s.add(u)) }
    return s }, [plan, tree])
  const live = useRef({ target: visualHealth(tree), path: null as Set<number> | null, sel: selected, dirty: true, onSelect, focus, allNames, fly: false })
  live.current.focus = focus; live.current.allNames = allNames
  live.current.onSelect = onSelect
  useEffect(() => { live.current.target = visualHealth(tree) }, [tree])
  useEffect(() => { live.current.path = pathOf(plan, selected); live.current.sel = selected; live.current.dirty = true; live.current.fly = selected != null }, [plan, selected])
  useEffect(() => { live.current.dirty = true }, [focus, allNames])

  useEffect(() => {
    const el = host.current; if (!el) return
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches, v = live.current, R = rng(31)
    let health = v.target, drawnHealth = -1
    const width = () => el.clientWidth, height = () => el.clientHeight

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(2, devicePixelRatio)); renderer.setSize(width(), height())
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15
    el.appendChild(renderer.domElement)
    const labels = new CSS2DRenderer(); labels.setSize(width(), height())
    Object.assign(labels.domElement.style, { position: 'absolute', inset: '0', pointerEvents: 'none' }); el.appendChild(labels.domElement)
    const scene = new THREE.Scene(); scene.fog = new THREE.Fog(0xe6eef0, 34, 80)
    const camera = new THREE.PerspectiveCamera(36, width() / height(), .1, 300); camera.position.set(0, 6.4, 21.5)
    const controls = new OrbitControls(camera, renderer.domElement)
    Object.assign(controls, { target: new THREE.Vector3(0, 6.4, 0), enableDamping: true, enablePan: false, minDistance: 6, maxDistance: 34, maxPolarAngle: Math.PI * .5, autoRotate: !still, autoRotateSpeed: .3 })
    const hemi = new THREE.HemisphereLight(0xd8ecff, 0x6f8a4a, 1.1); scene.add(hemi)
    const sun = new THREE.DirectionalLight(0xfff1d6, 2.6); sun.position.set(10, 18, 9); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -.0004; sun.shadow.normalBias = .02
    Object.assign(sun.shadow.camera, { left: -11, right: 11, top: 16, bottom: -6, far: 60 }); scene.add(sun)
    const sunDir = sun.position.clone().normalize()
    const disposables: { dispose(): void }[] = []
    const mat = (o: THREE.MeshStandardMaterialParameters) => { const m = new THREE.MeshStandardMaterial({ roughness: .9, ...o }); disposables.push(m); return m }
    const geo = <G extends THREE.BufferGeometry>(g: G) => { disposables.push(g); return g }

    // ground: a grass meadow with soft hills, grass blades and a contact shadow under the tree
    const grass = mat({ color: 0x8aa862 }), farGrass = mat({ color: 0xa3bb84 })
    const ground = new THREE.Mesh(geo(new THREE.CircleGeometry(16, 64)), grass); ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground)
    const far = new THREE.Mesh(geo(new THREE.CircleGeometry(90, 64)), farGrass); far.rotation.x = -Math.PI / 2; far.position.y = -.02; scene.add(far)
    for (let i = 0; i < 7; i++) { const a = i / 7 * Math.PI * 2 + .3, d = 26 + R() * 14, l = new THREE.Mesh(geo(new THREE.SphereGeometry(6 + R() * 6, 20, 12)), farGrass)
      l.scale.y = .25; l.position.set(Math.cos(a) * d, -.6, Math.sin(a) * d); scene.add(l) }
    const aoTex = shadeTexture(); disposables.push(aoTex)
    const ao = new THREE.Mesh(geo(new THREE.PlaneGeometry(9, 9)), new THREE.MeshBasicMaterial({ map: aoTex, transparent: true, depthWrite: false }))
    disposables.push(ao.material as THREE.Material); ao.rotation.x = -Math.PI / 2; ao.position.y = .015; scene.add(ao)
    const bladeGeo = geo(new THREE.ConeGeometry(.028, .32, 3).translate(0, .16, 0)), bladeMat = mat({ color: 0xffffff, roughness: 1 })
    const blades = new THREE.InstancedMesh(bladeGeo, bladeMat, 3600); blades.receiveShadow = true
    { const o = new THREE.Object3D(), c = new THREE.Color()
      for (let i = 0; i < blades.count; i++) { const a = R() * Math.PI * 2, d = 1.2 + Math.sqrt(R()) * 13.5
        o.position.set(Math.cos(a) * d, 0, Math.sin(a) * d); o.rotation.set((R() - .5) * .5, R() * 6.3, (R() - .5) * .5); o.scale.set(1, .6 + R() * .9, 1); o.updateMatrix()
        blades.setMatrixAt(i, o.matrix); blades.setColorAt(i, c.set(['#6f9448', '#7fa352', '#91b25e', '#a3bf6c'][Math.floor(R() * 4)])) } }
    scene.add(blades)

    // trunk with root flare and furrowed bark, surface roots and the central leader
    const barkTex = barkTexture(); disposables.push(barkTex)
    const bark = mat({ color: 0xa88a72, roughness: 1, map: barkTex, bumpMap: barkTex, bumpScale: 2.5 })
    const axisCurve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, -.2, 0), new THREE.Vector3(.1, TRUNK_H * .5, .05), new THREE.Vector3(-.06, TRUNK_H, 0), new THREE.Vector3(.08, CROWN_Y, -.05), new THREE.Vector3(0, TOP - .6, .04)])
    const trunkRadius = (t: number) => .07 + .6 * Math.pow(1 - t, 1.6) + .55 * Math.exp(-t * 28)
    const axis = new THREE.Mesh(geo(tube(axisCurve, trunkRadius, 64, 20, .035)), bark); axis.castShadow = true; axis.receiveShadow = true; scene.add(axis)
    for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2 + R() * .6, d = 1.1 + R() * .7
      const c = new THREE.QuadraticBezierCurve3(new THREE.Vector3(Math.cos(a) * .25, .55, Math.sin(a) * .25), new THREE.Vector3(Math.cos(a) * .7, .05, Math.sin(a) * .7), new THREE.Vector3(Math.cos(a) * d, -.12, Math.sin(a) * d))
      const r = new THREE.Mesh(geo(tapered(c, .3, .05, 12, 8)), bark); r.castShadow = true; r.receiveShadow = true; scene.add(r) }
    const axisT = (y: number) => Math.max(0, Math.min(1, (y + .2) / (TOP - .4)))
    const onAxis = (y: number) => axisCurve.getPointAt(axisT(y))

    // where each subject ends in the crown (at health 1); the droop from health is applied later
    const maxYear = Math.max(...nodes.map(n => n.s.year ?? 1)), A0 = Math.min(...nodes.map(n => n.ang)), A1 = Math.max(...nodes.map(n => n.ang))
    const tip = new Map<number, THREE.Vector3>()
    for (const n of nodes) {
      const u = (((n.s.year ?? 1) - 1) * 2 + ((n.s.term ?? 1) - 1)) / Math.max(1, maxYear * 2 - 1)
      const y = TRUNK_H + 1.4 + u * (TOP - TRUNK_H - 2.4), rh = crownRadiusAt(y) * (.82 + R() * .12)
      const phi = (n.ang - A0) / Math.max(.001, A1 - A0) * Math.PI * 2 * .94 + u * .7
      tip.set(n.s.subject_id, new THREE.Vector3(Math.sin(phi) * rh, y, Math.cos(phi) * rh))
    }
    const droop = (p: THREE.Vector3, s: number) => { const r = Math.hypot(p.x, p.z); return new THREE.Vector3(p.x, p.y - (1 - s) * (.3 + r * .2), p.z) }
    const pos = (m: Node, s: number) => droop(tip.get(m.s.subject_id)!, s)
    const rootY = (m: Node) => { const d = tip.get(m.s.subject_id)!; return Math.min(d.y - 2, TRUNK_H + .3 + (d.y - TRUNK_H) * .35) }
    const start = (m: Node, s: number) => m.parent ? pos(m.parent, s) : onAxis(rootY(m))
    // branches leave at a steep angle and bend outwards (ascending, like a linden)
    const curveOf = (a: THREE.Vector3, b: THREE.Vector3, s: number) => { const h = new THREE.Vector3(b.x - a.x, 0, b.z - a.z).normalize()
      return new THREE.CubicBezierCurve3(a, a.clone().lerp(b, .3).addScaledVector(h, -.15).add(new THREE.Vector3(0, .55, 0)), a.clone().lerp(b, .72).add(new THREE.Vector3(0, .3 - (1 - s) * .3, 0)), b) }

    // leaf clumps: they sit on the outer shell of the crown
    const clumps = Array.from({ length: 330 }, () => {
      const y = R() * 2 - 1, a = R() * Math.PI * 2, xz = Math.sqrt(1 - y * y), dir = new THREE.Vector3(Math.sin(a) * xz, y, Math.cos(a) * xz)
      const shell = .74 + Math.sqrt(R()) * .26, cy = CROWN_Y + y * CROWN_RV * shell, rh = crownRadiusAt(cy) / Math.max(.2, xz) * xz * shell
      return { dir, c: new THREE.Vector3(dir.x * rh, cy, dir.z * rh), size: .55 + R() * .45 } }).filter(c => c.c.y > TRUNK_H + 1.3)
    // inner branches without data: they grow from the leader up to some clumps and hold them
    const inner = clumps.filter((_, i) => i % 7 === 0).map(c => { const end = c.c.clone().multiplyScalar(.82); end.y = c.c.y - .3; return { y: Math.max(TRUNK_H + .2, end.y - 2.2 - R() * 1.6), end } })
    // twigs: they grow outwards from each branch (of a subject or inner)
    type Twig = { from: number | string; t: number; dir: THREE.Vector3; length: number }
    const twigs: Twig[] = [
      ...nodes.flatMap(m => Array.from({ length: m.state === 'locked' ? 2 : 3 + Math.floor(R() * 2) }, () => ({ from: m.s.subject_id, t: .4 + R() * .55, dir: new THREE.Vector3(R() - .5, .35 + R() * .5, R() - .5).normalize(), length: .6 + R() * .7 }))),
      ...inner.flatMap((_, i) => Array.from({ length: 3 }, () => ({ from: `i${i}`, t: .45 + R() * .5, dir: new THREE.Vector3(R() - .5, .35 + R() * .5, R() - .5).normalize(), length: .5 + R() * .6 }))) ]

    const branches = new THREE.Group(); scene.add(branches)
    const branchMat = new Map<number, THREE.MeshStandardMaterial>(), innerMat = mat({ color: 0x9a7c64, roughness: 1, map: barkTex, transparent: true })
    const curves = new Map<number | string, THREE.Curve<THREE.Vector3>>(), twigTips: THREE.Vector3[] = [], radii = new Map<string, [number, number]>()
    const buildBranches = (s: number) => {
      for (const c of [...branches.children]) { (c as THREE.Mesh).geometry.dispose(); branches.remove(c) }
      twigTips.length = 0; innerMat.color.set(mix('#8a837c', '#9a7c64', s))
      for (const m of nodes) { const c = curveOf(start(m, s), pos(m, s), s); curves.set(m.s.subject_id, c)
        const taken = ['approved', 'regular', 'enrolled'].includes(m.state), r0 = (taken ? .08 : .06) + Math.sqrt(m.weight) * .05; radii.set(String(m.s.subject_id), [r0, .03])
        let mm = branchMat.get(m.s.subject_id); if (!mm) { mm = mat({ color: 0x9a7c64, transparent: true, roughness: 1, map: barkTex }); branchMat.set(m.s.subject_id, mm) }
        mm.color.set(m.info?.dry ? '#857563' : mix('#8a837c', taken ? '#9a7c64' : '#a5876c', s))
        const t = new THREE.Mesh(tapered(c, r0, .03, 20, 8), mm); t.castShadow = true; t.receiveShadow = true; t.userData.id = m.s.subject_id; branches.add(t) }
      inner.forEach((r, i) => { const c = curveOf(onAxis(r.y), droop(r.end, s), s); curves.set(`i${i}`, c); radii.set(`i${i}`, [.09, .025])
        const t = new THREE.Mesh(tapered(c, .09, .025, 14, 7), innerMat); t.castShadow = true; t.receiveShadow = true; branches.add(t) })
      for (const r of twigs) { const c = curves.get(r.from)!, a = c.getPointAt(r.t), b = a.clone().addScaledVector(r.dir, r.length).add(new THREE.Vector3(0, -(1 - s) * .25, 0))
        const t = new THREE.Mesh(tapered(new THREE.QuadraticBezierCurve3(a, a.clone().lerp(b, .5).add(new THREE.Vector3(0, .1, 0)), b), .032, .01, 6, 5), typeof r.from === 'number' ? branchMat.get(r.from)! : innerMat)
        t.castShadow = true; branches.add(t); twigTips.push(b) } }

    // each subject's mark and the zones to touch
    const marks = new THREE.Group(), touchable: THREE.Mesh[] = []; scene.add(marks)
    const petalGeo = geo(new THREE.SphereGeometry(.07, 10, 8)), budGeo = geo(new THREE.SphereGeometry(.09, 10, 8)), touchGeo = geo(new THREE.SphereGeometry(.5, 8, 6))
    const invisible = new THREE.MeshBasicMaterial({ visible: false }); disposables.push(invisible)
    const whitePetal = mat({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: .35 }), pinkPetal = mat({ color: 0xffb3d1, emissive: 0xffb3d1, emissiveIntensity: .3 })
    const flowerCenter = mat({ color: 0xf2c14e, emissive: 0xf2c14e, emissiveIntensity: .35 })
    const flower = (petal: THREE.Material, k = 1) => { const g = new THREE.Group()
      for (let i = 0; i < 5; i++) { const p = new THREE.Mesh(petalGeo, petal), a = i / 5 * Math.PI * 2; p.scale.set(.9 * k, .9 * k, .35 * k); p.position.set(Math.cos(a) * .085 * k, Math.sin(a) * .085 * k, 0); g.add(p) }
      const c = new THREE.Mesh(petalGeo, flowerCenter); c.scale.setScalar(.7 * k); g.add(c); g.rotation.set(R() * 3, R() * 3, R() * 3); return g }
    const markObj = new Map<number, THREE.Object3D>(), labelEl = new Map<number, HTMLDivElement>()
    for (const m of nodes) {
      const g = new THREE.Group(), id = m.s.subject_id
      const outwards = tip.get(id)!.clone().setY(0).normalize().multiplyScalar(.5).setY(.15)
      if (m.state === 'approved') { const f = flower(whitePetal, 2.2); f.position.copy(outwards); g.add(f) }
      else if (m.info?.flower) { const f = flower(pinkPetal, 2); f.position.copy(outwards); g.add(f) }
      else { const y = new THREE.Mesh(budGeo, mat({ color: MARK[m.state], emissive: MARK[m.state], emissiveIntensity: m.state === 'enrolled' ? .4 : .1 })); y.scale.set(1, 1.5, 1); g.add(y) }
      const touch = new THREE.Mesh(touchGeo, invisible); touch.userData.id = id; g.add(touch); touchable.push(touch)
      marks.add(g); markObj.set(id, g)
      const div = document.createElement('div'); div.className = `pill-3d ${m.state}${m.s.bottleneck && m.state !== 'approved' ? ' bottleneck' : ''}`; div.textContent = shortName(m.s.name); div.title = m.s.name
      const obj = new CSS2DObject(div); obj.center.set(.5, -.7); g.add(obj); labelEl.set(id, div)
    }
    // approved subjects bloom: flowers at the tips of their twigs (they never fall)
    const flowers: { obj: THREE.Object3D; tip: number }[] = []
    twigs.forEach((r, i) => { const m = typeof r.from === 'number' ? nodes.find(n => n.s.subject_id === r.from) : null
      if (m && (m.state === 'approved' || m.info?.flower)) for (let k = 0; k < 3; k++) { const f = flower(m.state === 'approved' ? whitePetal : pinkPetal, 1.4); f.userData.off = new THREE.Vector3(R() - .5, R() - .2, R() - .5).multiplyScalar(.35); scene.add(f); flowers.push({ obj: f, tip: i }) } })
    let star: THREE.Mesh | null = null
    if (plan.final_goal) { star = new THREE.Mesh(geo(new THREE.OctahedronGeometry(.3)), mat({ color: 0xf2c14e, emissive: 0xf2c14e, emissiveIntensity: .5, metalness: .2 }))
      star.position.set(0, TOP + .9, 0); scene.add(star)
      const d = document.createElement('div'); d.className = 'pill-3d goal'; d.textContent = plan.final_goal.name; const o = new CSS2DObject(d); o.center.set(.5, -.9); star.add(o) }

    // foliage: a slightly cupped leaf with a pointed tip
    const shape = new THREE.Shape(); shape.moveTo(0, -.5); shape.bezierCurveTo(.46, -.3, .42, .3, 0, .62); shape.bezierCurveTo(-.42, .3, -.46, -.3, 0, -.5)
    const leafShape = new THREE.ShapeGeometry(shape, 5); { const p = leafShape.attributes.position as THREE.BufferAttribute; for (let i = 0; i < p.count; i++) p.setZ(i, -p.getX(i) * p.getX(i) * .5 + p.getY(i) * .08); leafShape.computeVertexNormals() }
    const leafGeo = geo(leafShape), leafMat = mat({ side: THREE.DoubleSide, roughness: .65, transparent: true })
    // state: 0 on the tree, 1 falling, 2 on the grass
    type Leaf = { m: Node | null; at: 'node' | 'twig' | 'crown'; idx: number; off: THREE.Vector3; rot: THREE.Euler; k: number; t: number; tone: number; phase: number; state: 0 | 1 | 2; p: THREE.Vector3; spin: number; fade: number; before: number }
    const leaves: Leaf[] = []
    const newLeaf = (m: Node | null, at: Leaf['at'], idx: number, radius: number, t: number): Leaf => ({ m, at, idx, t, off: new THREE.Vector3(R() - .5, R() - .4, R() - .5).normalize().multiplyScalar(radius * Math.cbrt(R())),
      rot: new THREE.Euler(R() * 6.3, R() * 6.3, R() * 6.3), k: .7 + R() * .55, tone: R(), phase: R() * 6.3, state: 0, p: new THREE.Vector3(), spin: 0, fade: 0, before: 0 })
    for (const m of nodes) { const extra = ['approved', 'regular', 'enrolled'].includes(m.state) ? 14 : 8
      for (const h of m.leaves) leaves.push(newLeaf(m, 'node', 0, .85, h.t)); for (let k = 0; k < extra; k++) leaves.push(newLeaf(m, 'node', 0, .95, .05 + R() * .9)) }
    twigs.forEach((r, i) => { const m = typeof r.from === 'number' ? nodes.find(n => n.s.subject_id === r.from)! : null; for (let k = 0; k < 10; k++) leaves.push(newLeaf(m, 'twig', i, .55, .05 + R() * .9)) })
    // clump leaves face outwards (towards the light), flattened against the shell, with some random tilt
    const q = new THREE.Quaternion(), qz = new THREE.Quaternion(), Z = new THREE.Vector3(0, 0, 1), n = new THREE.Vector3()
    for (const c of clumps) for (let k = 0; k < 17; k++) {
      const h = newLeaf(null, 'crown', 0, 0, .05 + R() * .9), o = new THREE.Vector3(R() - .5, R() - .5, R() - .5).normalize().multiplyScalar(c.size * Math.cbrt(R()))
      o.addScaledVector(c.dir, -o.dot(c.dir) * .5); h.off.copy(c.c).add(o)
      n.copy(c.dir).add(new THREE.Vector3(R() - .5, R() * .8, R() - .5)).normalize(); q.setFromUnitVectors(Z, n).multiply(qz.setFromAxisAngle(Z, R() * 6.3)); h.rot.setFromQuaternion(q)
      leaves.push(h) }
    const mesh = new THREE.InstancedMesh(leafGeo, leafMat, leaves.length); mesh.castShadow = true; mesh.receiveShadow = true; mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(mesh)
    const tmp = new THREE.Object3D(), color = new THREE.Color(), sunTint = new THREE.Color('#d4df73'), shadeTint = new THREE.Color('#2f5a2c'), at = new THREE.Vector3()
    const healthOf = (h: Leaf, s: number) => h.m?.info?.dry ? Math.min(s, .3) : s
    const visible = (h: Leaf, s: number) => Math.max(0, Math.min(1, (healthOf(h, s) - h.t * .95) / .08))
    const greens = (h: Leaf) => h.m ? GREENS[h.m.state] : ['#4c8a43', '#5f9a4e', '#6fa85a']
    const anchor = (h: Leaf, s: number) => h.at === 'node' ? markObj.get(h.m!.s.subject_id)!.position : h.at === 'twig' ? (twigTips[h.idx] ?? new THREE.Vector3()) : droop(h.off, s)

    // leaves inside and under the crown are darker; the ones facing the sun turn yellow-green
    const paintColors = (s: number) => { leaves.forEach((h, i) => {
      at.copy(anchor(h, s)); if (h.at !== 'crown') at.add(h.off)
      n.set(at.x / CROWN_RH, (at.y - CROWN_Y) / CROWN_RV, at.z / CROWN_RH); const rad = Math.min(1, n.length()); n.normalize()
      const lit = Math.max(0, n.dot(sunDir)), hs = healthOf(h, s)
      color.set(dried(greens(h)[Math.floor(h.tone * 3)], hs)).lerp(shadeTint, (1 - rad) * .45 * hs + Math.max(0, -n.y) * .15 * hs).lerp(sunTint, lit * rad * .38 * hs)
      mesh.setColorAt(i, color) }); if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true }
    const sky = (s: number) => { el.style.background = `linear-gradient(${mix('#9aa3a8', '#bcdcef', s)}, ${mix('#c9c0b2', '#eef3ec', s)} 62%, ${mix('#c8a98a', '#f6e6c0', s)})`
      grass.color.set(mix('#a39270', '#8aa862', s)); farGrass.color.set(mix('#b7ab8f', '#a3bb84', s)); bladeMat.color.set(mix('#c2ad80', '#ffffff', s))
      ;(scene.fog as THREE.Fog).color.set(mix('#c9c0b2', '#e6eef0', s)); sun.intensity = 1.4 + 1.2 * s }

    const updateSelection = () => { const { path, sel } = v
      for (const m of nodes) { const id = m.s.subject_id, on = !path || path.has(id), mm = branchMat.get(id)!
        mm.opacity = on ? 1 : .2; mm.emissive.set(path?.has(id) && path.size > 1 ? 0xffd84a : 0x000000); mm.emissiveIntensity = .6
        const d = labelEl.get(id)!; d.classList.toggle('dimmed', !on); d.classList.toggle('selected', id === sel); d.classList.toggle('hidden', !v.allNames && !v.focus.has(id) && !path?.has(id)) }
      innerMat.opacity = v.path ? .25 : 1; leafMat.opacity = path ? .3 : 1; v.dirty = false }

    // labels without overlapping: on screen, first the higher priority ones and the closest to the camera
    const sizes = new Map<number, { w: number; h: number }>(), p2 = new THREE.Vector3()
    const placeLabels = () => { const W = width(), H = height(), placed: { x0: number; y0: number; x1: number; y1: number }[] = []
      const list = nodes.map(m => { const id = m.s.subject_id, d = labelEl.get(id)!, o = markObj.get(id)!
        o.getWorldPosition(p2); const dist = p2.distanceTo(camera.position); p2.project(camera)
        let t = sizes.get(id); if (!t || !t.w) { t = { w: d.offsetWidth, h: d.offsetHeight }; sizes.set(id, t) }
        const pr = id === v.sel ? 0 : v.path?.has(id) ? .5 : d.classList.contains('hidden') ? 9 : PRIORITY[m.state] ?? 5
        return { d, pr, dist, x: (p2.x + 1) / 2 * W, y: (1 - p2.y) / 2 * H + t.h * .7 + 6, w: t.w, h: t.h, behind: p2.z > 1 } })
        .sort((a, b) => a.pr - b.pr || a.dist - b.dist)
      for (const e of list) { const r = { x0: e.x - e.w / 2 - 3, y0: e.y - e.h / 2 - 2, x1: e.x + e.w / 2 + 3, y1: e.y + e.h / 2 + 2 }
        const hits = e.pr >= 9 || e.behind || placed.some(q => r.x0 < q.x1 && r.x1 > q.x0 && r.y0 < q.y1 && r.y1 > q.y0)
        e.d.classList.toggle('covered', hits); if (!hits) placed.push(r) } }

    const ray = new THREE.Raycaster(), pointer = new THREE.Vector2(); let down: { x: number; y: number } | null = null
    const idAt = (ev: PointerEvent) => { const r = renderer.domElement.getBoundingClientRect(); pointer.set((ev.clientX - r.left) / r.width * 2 - 1, -(ev.clientY - r.top) / r.height * 2 + 1)
      ray.setFromCamera(pointer, camera); const hit = ray.intersectObjects([...touchable, ...branches.children.filter(c => c.userData.id != null)], false)[0]; return hit ? hit.object.userData.id as number : null }
    const onDown = (ev: PointerEvent) => { down = { x: ev.clientX, y: ev.clientY }; controls.autoRotate = false; v.fly = false }
    const onUp = (ev: PointerEvent) => { if (down && Math.hypot(ev.clientX - down.x, ev.clientY - down.y) < 6) { const id = idAt(ev); v.onSelect(id === v.sel ? null : id) } down = null }
    const onMove = (ev: PointerEvent) => { const id = down ? null : idAt(ev); renderer.domElement.style.cursor = id != null ? 'pointer' : 'grab'; labelEl.forEach((d, k) => d.classList.toggle('hover', k === id)) }
    renderer.domElement.addEventListener('pointerdown', onDown); renderer.domElement.addEventListener('pointerup', onUp); renderer.domElement.addEventListener('pointermove', onMove)
    const ro = new ResizeObserver(() => { camera.aspect = width() / height(); camera.updateProjectionMatrix(); renderer.setSize(width(), height()); labels.setSize(width(), height()) }); ro.observe(el)

    // Mamo, the koala: walks along the branches and the trunk following their curves, rests a while (sitting,
    // leaning on the trunk, blinking) and goes somewhere else; sad on a wilted tree, asleep on a dry one
    const mamo = buildMamo(mat, geo, disposables); scene.add(mamo.root)
    type Seg = { k: string; t0: number; t1: number }
    const byId = new Map(nodes.map(n => [n.s.subject_id, n]))
    // edge keys: 'axis' (trunk and leader), a subject id, or 'i<n>' for an inner branch; t=0 sits on the parent edge
    const curveAt = (k: string) => k === 'axis' ? axisCurve : curves.get(k[0] === 'i' ? k : Number(k))
    const parentOf = (k: string): { k: string; t: number } | null => {
      if (k === 'axis') return null
      if (k[0] === 'i') return { k: 'axis', t: axisT(inner[Number(k.slice(1))].y) }
      const m = byId.get(Number(k)); if (!m) return null
      return m.parent ? { k: String(m.parent.s.subject_id), t: 1 } : { k: 'axis', t: axisT(rootY(m)) } }
    const chainOf = (k: string) => { const out = [k]; for (let p = parentOf(k); p; p = parentOf(p.k)) out.push(p.k); return out }
    const route = (from: string, t: number, to: string, u: number): Seg[] => {
      const up = chainOf(from), down = chainOf(to), c = up.find(k => down.includes(k)) ?? 'axis', segs: Seg[] = []
      let cur = from, ct = t
      while (cur !== c) { segs.push({ k: cur, t0: ct, t1: 0 }); const p = parentOf(cur); if (!p) break; cur = p.k; ct = p.t }
      const branch = down.slice(0, down.indexOf(c)).reverse()
      segs.push({ k: c, t0: ct, t1: branch.length ? parentOf(branch[0])!.t : u })
      for (const k of branch) segs.push({ k, t0: 0, t1: k === to ? u : 1 })
      return segs.filter(g => Math.abs(g.t1 - g.t0) > 1e-3) }
    const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))
    const angleOf = (k: string) => { const c = curveAt(k); if (!c || k === 'axis') return K.side; const e = c.getPointAt(1); return Math.atan2(e.x, e.z) }
    // resting spots stay low (trunk, first-level and inner branches near their base), where the foliage does not hide him
    const restKeys = [...nodes.filter(m => !m.parent || m.weight >= 3).map(m => String(m.s.subject_id)), ...inner.map((_, i) => `i${i}`)]
    const pickSpot = (branchOnly = false) => !branchOnly && Math.random() < .35
      ? { k: 'axis', t: axisT(.9 + Math.random() * (TRUNK_H + .3)), side: Math.random() * Math.PI * 2 }
      : { k: restKeys[Math.floor(Math.random() * restKeys.length)], t: .08 + Math.random() * .36, side: NaN }
    const K = { k: 'axis', t: axisT(1.5), route: [] as Seg[], d: 0, wait: 1.5, rest: 'sit' as 'sit' | 'hug', side: .5, restSide: .5, heading: .5, clock: 0, blinkAt: 2, blinkEnd: 0, placed: false }
    const kp = new THREE.Vector3(), kt = new THREE.Vector3()
    const updateMamo = (dt: number) => {
      const mood: MamoMood = health < .38 ? 'sleep' : health < .8 ? 'sad' : 'happy'
      if (!K.placed) { if (still) { const sp = pickSpot(true); K.k = sp.k; K.t = sp.t } K.placed = true }
      let dir: THREE.Vector3 | null = null
      if (!still) {
        K.clock += dt
        const seg = K.route[0], c = seg && curveAt(seg.k)
        if (seg && !c) K.route = []
        else if (seg && c) {
          K.d += dt * (mood === 'happy' ? .42 : .26)
          const f = Math.min(1, K.d / Math.max(.01, c.getLength() * Math.abs(seg.t1 - seg.t0)))
          K.k = seg.k; K.t = seg.t0 + (seg.t1 - seg.t0) * f
          dir = c.getTangentAt(Math.max(0, Math.min(1, K.t)), kt).multiplyScalar(seg.t1 > seg.t0 ? 1 : -1)
          if (f >= 1) { const prev = K.route.shift()!; K.d = 0
            if (K.route[0]?.k === 'axis' && prev.k !== 'axis') K.side = angleOf(prev.k)
            if (!K.route.length) { K.wait = 2.5 + Math.random() * 4.5; K.rest = Math.random() < .5 ? 'sit' : 'hug' } }
        } else if (mood !== 'sleep') {
          K.wait -= dt
          if (K.wait <= 0) { const sp = pickSpot(); K.restSide = Number.isNaN(sp.side) ? K.side : sp.side; K.route = route(K.k, K.t, sp.k, sp.t); K.d = 0; if (!K.route.length) K.wait = 2 }
        }
        // on the trunk he turns around it towards the branch he is heading to
        if (K.k === 'axis') { const next = K.route.find(g => g.k !== 'axis'); K.side += wrap((next ? angleOf(next.k) : K.restSide) - K.side) * Math.min(1, dt * 1.6) }
        if (K.clock > K.blinkAt) { K.blinkEnd = K.clock + .15; K.blinkAt = K.clock + 2.2 + Math.random() * 3 }
      }
      let c = curveAt(K.k); if (!c) { K.k = 'axis'; K.route = []; c = axisCurve }
      const t = Math.max(0, Math.min(1, K.t)); c.getPointAt(t, kp)
      const moving = !!dir && K.route.length > 0, onTrunk = K.k === 'axis'
      const pose: MamoPose = moving ? (Math.abs(dir!.y) > .72 ? 'climb' : 'walk') : mood === 'sleep' ? 'sleep' : onTrunk ? 'hug' : K.rest
      let face: number
      if (onTrunk) { kp.x += Math.sin(K.side) * (trunkRadius(t) + .05); kp.z += Math.cos(K.side) * (trunkRadius(t) + .05); kp.y -= .28; face = K.side }
      else { const [r0, r1] = radii.get(K.k) ?? [.06, .03]; kp.y += (r0 + (r1 - r0) * Math.pow(t, .8)) * .9
        face = moving && Math.hypot(dir!.x, dir!.z) > .2 ? Math.atan2(dir!.x, dir!.z) : Math.atan2(kp.x, kp.z) }
      K.heading = still ? face : K.heading + wrap(face - K.heading) * Math.min(1, dt * 6)
      mamo.root.position.copy(kp); mamo.root.rotation.y = K.heading
      mamo.set(pose, mood, moving ? K.clock * 9 : 0, !still && K.clock < K.blinkEnd)
    }

    let raf = 0, t0 = performance.now(), time = 0, first = true, frame = 0
    const tick = (t: number) => {
      const dt = Math.min(.05, (t - t0) / 1000); t0 = t; time += dt
      health += (v.target - health) * (still ? 1 : Math.min(1, dt / .7)); if (Math.abs(v.target - health) < .002) health = v.target
      if (Math.abs(health - drawnHealth) > .015 || first) { for (const m of nodes) markObj.get(m.s.subject_id)!.position.copy(pos(m, health))
        buildBranches(health); paintColors(health); sky(health); drawnHealth = health; v.dirty = true
        for (const f of flowers) { const p = twigTips[f.tip]; f.obj.position.copy(p).addScaledVector(p.clone().setY(0).normalize(), .55).add(f.obj.userData.off) }
        if (first) { for (const h of leaves) h.before = visible(h, health)
          for (const h of leaves) if (h.before === 0 && h.tone < .45) { h.state = 2; const b = anchor(h, health); h.p.set(b.x * .8 + (h.tone - .2) * 3, .03, b.z * .8 + (h.phase / 6.3 - .5) * 3) } } }
      if (v.dirty) updateSelection()
      const wind = still ? 0 : 1, gust = .6 + .4 * Math.sin(time * .23)
      leaves.forEach((h, i) => {
        const vis = visible(h, health), b = anchor(h, health)
        if (h.state === 0 && vis <= 0 && h.before > 0 && !first && !still) { h.state = 1; h.p.copy(b); if (h.at !== 'crown') h.p.add(h.off); h.spin = 0 }
        if (h.state === 1 && vis > 0) h.state = 0
        if (h.state === 2 && v.target > .9) { h.fade += dt / .8; if (h.fade >= 1) { h.state = 0; h.fade = 0 } }
        if (h.state === 0) { tmp.position.copy(b); if (h.at !== 'crown') tmp.position.add(h.off)
          // the whole crown sways together (higher leaves more), and each leaf flutters on top
          const sway = wind * gust * Math.sin(time * .8 + tmp.position.y * .18) * .045 * Math.max(0, tmp.position.y - TRUNK_H); tmp.position.x += sway; tmp.position.z += sway * .4
          tmp.rotation.set(h.rot.x + Math.sin(time * 1.6 + h.phase) * .2 * wind * gust, h.rot.y, h.rot.z + Math.cos(time * 1.3 + h.phase) * .16 * wind * gust); tmp.scale.setScalar(h.k * .36 * vis) }
        else if (h.state === 1) { h.p.y -= dt * 1.1; h.p.x += Math.sin(time * 2 + h.phase) * dt * .6; h.spin += dt * 3; tmp.position.copy(h.p); tmp.rotation.set(h.spin, h.phase, h.spin * .6); tmp.scale.setScalar(h.k * .36)
          if (h.p.y <= .04) { h.state = 2; h.p.y = .03 } }
        else { tmp.position.copy(h.p); tmp.rotation.set(-Math.PI / 2, 0, h.phase); tmp.scale.setScalar(h.k * .36 * (1 - h.fade)) }
        h.before = vis; tmp.updateMatrix(); mesh.setMatrixAt(i, tmp.matrix) })
      mesh.instanceMatrix.needsUpdate = true
      if (star && !still) star.rotation.y += dt * .8
      // on picking a subject (by touching or searching it), the camera turns until it faces it
      if (v.fly && v.sel != null && markObj.has(v.sel)) { controls.autoRotate = false
        const p = markObj.get(v.sel)!.position, dir = new THREE.Vector3(p.x, 0, p.z).normalize(), dist = Math.max(12, Math.min(18, camera.position.distanceTo(controls.target)))
        const aim = new THREE.Vector3(p.x * .35, p.y - .3, p.z * .35), cam = aim.clone().addScaledVector(dir, dist).setY(p.y + 1.6), k = still ? 1 : Math.min(1, dt * 3)
        controls.target.lerp(aim, k); camera.position.lerp(cam, k); if (camera.position.distanceTo(cam) < .05) v.fly = false }
      updateMamo(dt)
      controls.update(); renderer.render(scene, camera); labels.render(scene, camera)
      if (frame++ % 6 === 0) placeLabels()
      first = false; raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(raf); ro.disconnect(); controls.dispose()
      renderer.domElement.removeEventListener('pointerdown', onDown); renderer.domElement.removeEventListener('pointerup', onUp); renderer.domElement.removeEventListener('pointermove', onMove)
      for (const c of branches.children) (c as THREE.Mesh).geometry.dispose()
      disposables.forEach(d => d.dispose()); mesh.dispose(); blades.dispose(); renderer.dispose(); el.innerHTML = ''
    }
  }, [nodes, plan])

  return <div ref={host} className="tree-3d" role="img" aria-label="Árbol del plan de estudios en 3D. Arrastrá para girarlo." />
}
