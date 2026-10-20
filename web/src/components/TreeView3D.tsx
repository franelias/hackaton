// The career tree in 3D (three.js), shaped like a real tree:
// - a trunk that narrows, roots that go into the grass and a central axis the branches grow from;
// - each subject is a branch that grows from its prerequisite (or from the axis, if it has none) and
//   ends at a point of the crown: the height comes from year and term, the angle around the trunk from
//   the prerequisite order (`layout`), so each branch stays close to the one that enables it;
// - tapered branches as thick as what they hold up, twigs, and inner branches without data that fill the crown;
// - ~4000 leaves (InstancedMesh) that move with the wind, dry out, fall to the grass and grow back;
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

const TRUNK_H = 3.2, CROWN_Y = 6.7, CROWN_RH = 5.4, CROWN_RV = 3.7, TOP = 10.2
const MARK: Record<string, number> = { approved: 0xffffff, regular: 0xf2c14e, enrolled: 0x5b84b1, available: 0xa9cf80, locked: 0xd9c4a8 }
const PRIORITY: Record<string, number> = { enrolled: 1, regular: 2, approved: 3, available: 4, locked: 5 }
const rng = (seed: number) => () => (seed = (seed * 16807) % 2147483647) / 2147483647

// a tube that narrows from r0 to r1 along the curve
function taperedTube(curve: THREE.Curve<THREE.Vector3>, r0: number, r1: number, seg = 16, sides = 8) {
  const g = new THREE.TubeGeometry(curve, seg, 1, sides), p = g.attributes.position as THREE.BufferAttribute, c = new THREE.Vector3(), v = new THREE.Vector3()
  for (let i = 0; i <= seg; i++) { curve.getPointAt(i / seg, c); const r = r0 + (r1 - r0) * Math.pow(i / seg, .8)
    for (let j = 0; j <= sides; j++) { const k = i * (sides + 1) + j; v.fromBufferAttribute(p, k).sub(c).multiplyScalar(r).add(c); p.setXYZ(k, v.x, v.y, v.z) } }
  p.needsUpdate = true; g.computeVertexNormals(); return g
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
    renderer.setPixelRatio(Math.min(2, devicePixelRatio)); renderer.setSize(width(), height()); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap
    el.appendChild(renderer.domElement)
    const labels = new CSS2DRenderer(); labels.setSize(width(), height())
    Object.assign(labels.domElement.style, { position: 'absolute', inset: '0', pointerEvents: 'none' }); el.appendChild(labels.domElement)
    const scene = new THREE.Scene(); scene.fog = new THREE.Fog(0xeef0e4, 30, 70)
    const camera = new THREE.PerspectiveCamera(36, width() / height(), .1, 300); camera.position.set(0, 6.4, 21)
    const controls = new OrbitControls(camera, renderer.domElement)
    Object.assign(controls, { target: new THREE.Vector3(0, 5.6, 0), enableDamping: true, enablePan: false, minDistance: 5, maxDistance: 32, maxPolarAngle: Math.PI * .5, autoRotate: !still, autoRotateSpeed: .35 })
    const hemi = new THREE.HemisphereLight(0xe3f0fa, 0x7f9c5a, 1.3); scene.add(hemi)
    const sun = new THREE.DirectionalLight(0xfff0d0, 2.4); sun.position.set(9, 18, 8); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -.0005
    Object.assign(sun.shadow.camera, { left: -12, right: 12, top: 14, bottom: -4, far: 50 }); scene.add(sun)
    const disposables: { dispose(): void }[] = []
    const mat = (o: THREE.MeshStandardMaterialParameters) => { const m = new THREE.MeshStandardMaterial({ roughness: .9, ...o }); disposables.push(m); return m }
    const geo = <G extends THREE.BufferGeometry>(g: G) => { disposables.push(g); return g }

    // ground: a grass clearing with soft hills
    const grass = mat({ color: 0x8fae6a }), farGrass = mat({ color: 0xa9c08a })
    const ground = new THREE.Mesh(geo(new THREE.CircleGeometry(14, 64)), grass); ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground)
    const far = new THREE.Mesh(geo(new THREE.CircleGeometry(90, 64)), farGrass); far.rotation.x = -Math.PI / 2; far.position.y = -.02; scene.add(far)
    for (let i = 0; i < 7; i++) { const a = i / 7 * Math.PI * 2 + .3, d = 24 + R() * 14, l = new THREE.Mesh(geo(new THREE.SphereGeometry(6 + R() * 6, 20, 12)), farGrass)
      l.scale.y = .25; l.position.set(Math.cos(a) * d, -.6, Math.sin(a) * d); scene.add(l) }

    // trunk, roots and central axis
    const bark = mat({ color: 0x6f4a32, roughness: 1 })
    const axisCurve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, -.2, 0), new THREE.Vector3(.12, TRUNK_H * .5, .06), new THREE.Vector3(-.07, TRUNK_H, 0), new THREE.Vector3(.09, CROWN_Y, -.05), new THREE.Vector3(0, TOP - .5, .04)])
    const axis = new THREE.Mesh(geo(taperedTube(axisCurve, .62, .07, 48, 16)), bark); axis.castShadow = true; axis.receiveShadow = true; scene.add(axis)
    for (let i = 0; i < 7; i++) { const a = i / 7 * Math.PI * 2 + R() * .5, d = 1.3 + R() * .8
      const c = new THREE.QuadraticBezierCurve3(new THREE.Vector3(Math.cos(a) * .2, .7, Math.sin(a) * .2), new THREE.Vector3(Math.cos(a) * .75, .06, Math.sin(a) * .75), new THREE.Vector3(Math.cos(a) * d, -.15, Math.sin(a) * d))
      const r = new THREE.Mesh(geo(taperedTube(c, .28, .04, 12, 8)), bark); r.castShadow = true; scene.add(r) }
    const onAxis = (y: number) => axisCurve.getPointAt(Math.max(0, Math.min(1, (y + .2) / (TOP - .3))))

    // where each subject ends in the crown (at health 1); the droop from health is applied later
    const maxYear = Math.max(...nodes.map(n => n.s.year ?? 1)), A0 = Math.min(...nodes.map(n => n.ang)), A1 = Math.max(...nodes.map(n => n.ang))
    const tip = new Map<number, THREE.Vector3>()
    for (const n of nodes) {
      const u = (((n.s.year ?? 1) - 1) * 2 + ((n.s.term ?? 1) - 1)) / Math.max(1, maxYear * 2 - 1)
      const y = TRUNK_H + 1 + u * (TOP - TRUNK_H - 1.6), dy = (y - CROWN_Y) / CROWN_RV
      const rh = CROWN_RH * Math.sqrt(Math.max(.1, 1 - dy * dy)) * (.84 + R() * .12)
      const phi = (n.ang - A0) / Math.max(.001, A1 - A0) * Math.PI * 2 * .94 + u * .7
      tip.set(n.s.subject_id, new THREE.Vector3(Math.sin(phi) * rh, y, Math.cos(phi) * rh))
    }
    const droop = (p: THREE.Vector3, s: number) => { const r = Math.hypot(p.x, p.z); return new THREE.Vector3(p.x, p.y - (1 - s) * (.3 + r * .2), p.z) }
    const pos = (m: Node, s: number) => droop(tip.get(m.s.subject_id)!, s)
    const start = (m: Node, s: number) => { if (m.parent) return pos(m.parent, s); const d = tip.get(m.s.subject_id)!; return onAxis(Math.min(d.y - 1.8, TRUNK_H + .4 + (d.y - TRUNK_H) * .35)) }
    const curveOf = (a: THREE.Vector3, b: THREE.Vector3, s: number) => { const h = new THREE.Vector3(b.x, 0, b.z).normalize()
      return new THREE.CubicBezierCurve3(a, a.clone().lerp(b, .35).addScaledVector(h, .35).add(new THREE.Vector3(0, .35, 0)), a.clone().lerp(b, .75).add(new THREE.Vector3(0, .2 - (1 - s) * .25, 0)), b) }
    // inner branches without data: they grow from the axis and fill the crown
    const inner = Array.from({ length: 34 }, (_, i) => { const y = TRUNK_H + .6 + R() * (TOP - TRUNK_H - 2.2), a = i * 2.39996 + R() * .4, dy = (y + .9 - CROWN_Y) / CROWN_RV
      const rh = CROWN_RH * Math.sqrt(Math.max(.1, 1 - dy * dy)) * (.45 + R() * .35); return { y, end: new THREE.Vector3(Math.sin(a) * rh, y + .8 + R() * .8, Math.cos(a) * rh) } })
    // twigs: they grow outwards from each branch (of a subject or inner)
    type Twig = { from: number | string; t: number; dir: THREE.Vector3; length: number }
    const twigs: Twig[] = [
      ...nodes.flatMap(m => Array.from({ length: m.state === 'locked' ? 2 : 3 + Math.floor(R() * 2) }, () => ({ from: m.s.subject_id, t: .4 + R() * .55, dir: new THREE.Vector3(R() - .5, .3 + R() * .5, R() - .5).normalize(), length: .6 + R() * .7 }))),
      ...inner.flatMap((_, i) => Array.from({ length: 3 }, () => ({ from: `i${i}`, t: .45 + R() * .5, dir: new THREE.Vector3(R() - .5, .3 + R() * .5, R() - .5).normalize(), length: .5 + R() * .6 }))) ]

    const branches = new THREE.Group(); scene.add(branches)
    const branchMat = new Map<number, THREE.MeshStandardMaterial>(), innerMat = mat({ color: 0x6f4a32, roughness: 1, transparent: true })
    const curves = new Map<number | string, THREE.Curve<THREE.Vector3>>(), twigTips: THREE.Vector3[] = []
    const buildBranches = (s: number) => {
      for (const c of [...branches.children]) { (c as THREE.Mesh).geometry.dispose(); branches.remove(c) }
      twigTips.length = 0; innerMat.color.set(mix('#6b625a', '#6f4a32', s))
      for (const m of nodes) { const c = curveOf(start(m, s), pos(m, s), s); curves.set(m.s.subject_id, c)
        const taken = ['approved', 'regular', 'enrolled'].includes(m.state), r0 = (taken ? .07 : .05) + Math.sqrt(m.weight) * .045
        let mm = branchMat.get(m.s.subject_id); if (!mm) { mm = mat({ color: 0x6f4a32, transparent: true, roughness: 1 }); branchMat.set(m.s.subject_id, mm) }
        mm.color.set(m.info?.dry ? '#857563' : mix('#6b625a', taken ? '#6f4a32' : '#866650', s))
        const t = new THREE.Mesh(taperedTube(c, r0, .03, 20, 8), mm); t.castShadow = true; t.userData.id = m.s.subject_id; branches.add(t) }
      inner.forEach((r, i) => { const c = curveOf(onAxis(r.y), droop(r.end, s), s); curves.set(`i${i}`, c)
        const t = new THREE.Mesh(taperedTube(c, .07, .02, 14, 7), innerMat); t.castShadow = true; branches.add(t) })
      for (const r of twigs) { const c = curves.get(r.from)!, a = c.getPointAt(r.t), b = a.clone().addScaledVector(r.dir, r.length).add(new THREE.Vector3(0, -(1 - s) * .25, 0))
        const t = new THREE.Mesh(taperedTube(new THREE.QuadraticBezierCurve3(a, a.clone().lerp(b, .5).add(new THREE.Vector3(0, .1, 0)), b), .032, .01, 6, 5), typeof r.from === 'number' ? branchMat.get(r.from)! : innerMat)
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
      const outwards = tip.get(id)!.clone().setY(0).normalize().multiplyScalar(.5).setY(.15)   // flowers, towards the edge of the crown
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
      star.position.set(0, TOP + .6, 0); scene.add(star)
      const d = document.createElement('div'); d.className = 'pill-3d goal'; d.textContent = plan.final_goal.name; const o = new CSS2DObject(d); o.center.set(.5, -.9); star.add(o) }

    // foliage: leaves of each subject, on the twigs and filling the crown
    const shape = new THREE.Shape(); shape.moveTo(0, -.5); shape.bezierCurveTo(.42, -.25, .38, .35, 0, .6); shape.bezierCurveTo(-.38, .35, -.42, -.25, 0, -.5)
    const leafGeo = geo(new THREE.ShapeGeometry(shape, 4)), leafMat = mat({ side: THREE.DoubleSide, roughness: .75, transparent: true })
    // state: 0 on the tree, 1 falling, 2 on the grass
    type Leaf = { m: Node | null; at: 'node' | 'twig' | 'crown'; idx: number; off: THREE.Vector3; rot: THREE.Euler; k: number; t: number; tone: number; phase: number; state: 0 | 1 | 2; p: THREE.Vector3; spin: number; fade: number; before: number }
    const leaves: Leaf[] = []
    const newLeaf = (m: Node | null, at: Leaf['at'], idx: number, radius: number, t: number): Leaf => ({ m, at, idx, t, off: new THREE.Vector3(R() - .5, R() - .4, R() - .5).normalize().multiplyScalar(radius * Math.cbrt(R())),
      rot: new THREE.Euler(R() * 6.3, R() * 6.3, R() * 6.3), k: .75 + R() * .6, tone: R(), phase: R() * 6.3, state: 0, p: new THREE.Vector3(), spin: 0, fade: 0, before: 0 })
    for (const m of nodes) { const extra = ['approved', 'regular', 'enrolled'].includes(m.state) ? 12 : 7
      for (const h of m.leaves) leaves.push(newLeaf(m, 'node', 0, .85, h.t)); for (let k = 0; k < extra; k++) leaves.push(newLeaf(m, 'node', 0, .95, .05 + R() * .9)) }
    twigs.forEach((r, i) => { const m = typeof r.from === 'number' ? nodes.find(n => n.s.subject_id === r.from)! : null; for (let k = 0; k < 13; k++) leaves.push(newLeaf(m, 'twig', i, .55, .05 + R() * .9)) })
    for (let i = 0; i < 1200; i++) { const h = newLeaf(null, 'crown', 0, 0, .05 + R() * .9), a = R() * Math.PI * 2, y = R() * 2 - 1, rr = Math.sqrt(1 - y * y) * (.5 + R() * .5)
      h.off.set(Math.sin(a) * rr * CROWN_RH * .97, CROWN_Y + .3 + y * CROWN_RV * .92, Math.cos(a) * rr * CROWN_RH * .97); leaves.push(h) }
    const mesh = new THREE.InstancedMesh(leafGeo, leafMat, leaves.length); mesh.castShadow = true; mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(mesh)
    const tmp = new THREE.Object3D(), color = new THREE.Color()
    const healthOf = (h: Leaf, s: number) => h.m?.info?.dry ? Math.min(s, .3) : s
    const visible = (h: Leaf, s: number) => Math.max(0, Math.min(1, (healthOf(h, s) - h.t * .95) / .08))
    const greens = (h: Leaf) => h.m ? GREENS[h.m.state] : ['#4c8a43', '#5f9a4e', '#6fa85a']
    const anchor = (h: Leaf, s: number) => h.at === 'node' ? markObj.get(h.m!.s.subject_id)!.position : h.at === 'twig' ? (twigTips[h.idx] ?? new THREE.Vector3()) : droop(h.off, s)

    const paintColors = (s: number) => { leaves.forEach((h, i) => mesh.setColorAt(i, color.set(dried(greens(h)[Math.floor(h.tone * 3)], healthOf(h, s))))); if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true }
    const sky = (s: number) => { el.style.background = `linear-gradient(${mix('#9aa3a8', '#cfe5ee', s)}, ${mix('#c9c0b2', '#f1f3e8', s)} 62%, ${mix('#c8a98a', '#f9e2b4', s)})`
      grass.color.set(mix('#a39270', '#8fae6a', s)); farGrass.color.set(mix('#b7ab8f', '#a9c08a', s)); (scene.fog as THREE.Fog).color.set(mix('#c9c0b2', '#eef0e4', s)); sun.intensity = 1.3 + 1.2 * s }

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

    let raf = 0, t0 = performance.now(), time = 0, first = true, frame = 0
    const tick = (t: number) => {
      const dt = Math.min(.05, (t - t0) / 1000); t0 = t; time += dt
      health += (v.target - health) * (still ? 1 : Math.min(1, dt / .7)); if (Math.abs(v.target - health) < .002) health = v.target
      if (Math.abs(health - drawnHealth) > .015 || first) { for (const m of nodes) markObj.get(m.s.subject_id)!.position.copy(pos(m, health))
        buildBranches(health); paintColors(health); sky(health); drawnHealth = health; v.dirty = true
        for (const f of flowers) { const p = twigTips[f.tip]; f.obj.position.copy(p).addScaledVector(p.clone().setY(0).normalize(), .55).add(f.obj.userData.off) }
        if (first) { for (const h of leaves) h.before = visible(h, health)
          for (const h of leaves) if (h.before === 0 && h.tone < .45) { h.state = 2; const b = anchor(h, health); h.p.set(b.x * .8 + (h.tone - .2) * 3, .02, b.z * .8 + (h.phase / 6.3 - .5) * 3) } } }
      if (v.dirty) updateSelection()
      const wind = still ? 0 : 1
      leaves.forEach((h, i) => {
        const vis = visible(h, health), b = anchor(h, health)
        if (h.state === 0 && vis <= 0 && h.before > 0 && !first && !still) { h.state = 1; h.p.copy(b); if (h.at !== 'crown') h.p.add(h.off); h.spin = 0 }
        if (h.state === 1 && vis > 0) h.state = 0
        if (h.state === 2 && v.target > .9) { h.fade += dt / .8; if (h.fade >= 1) { h.state = 0; h.fade = 0 } }
        if (h.state === 0) { tmp.position.copy(b); if (h.at !== 'crown') tmp.position.add(h.off)
          tmp.rotation.set(h.rot.x + Math.sin(time * 1.4 + h.phase) * .22 * wind, h.rot.y, h.rot.z + Math.cos(time * 1.1 + h.phase) * .18 * wind); tmp.scale.setScalar(h.k * .42 * vis) }
        else if (h.state === 1) { h.p.y -= dt * 1.1; h.p.x += Math.sin(time * 2 + h.phase) * dt * .6; h.spin += dt * 3; tmp.position.copy(h.p); tmp.rotation.set(h.spin, h.phase, h.spin * .6); tmp.scale.setScalar(h.k * .42)
          if (h.p.y <= .03) { h.state = 2; h.p.y = .02 } }
        else { tmp.position.copy(h.p); tmp.rotation.set(-Math.PI / 2, 0, h.phase); tmp.scale.setScalar(h.k * .42 * (1 - h.fade)) }
        h.before = vis; tmp.updateMatrix(); mesh.setMatrixAt(i, tmp.matrix) })
      mesh.instanceMatrix.needsUpdate = true
      if (star && !still) star.rotation.y += dt * .8
      // on picking a subject (by touching or searching it), the camera turns until it faces it
      if (v.fly && v.sel != null && markObj.has(v.sel)) { controls.autoRotate = false
        const p = markObj.get(v.sel)!.position, dir = new THREE.Vector3(p.x, 0, p.z).normalize(), dist = Math.max(11, Math.min(17, camera.position.distanceTo(controls.target)))
        const aim = new THREE.Vector3(p.x * .35, p.y - .3, p.z * .35), cam = aim.clone().addScaledVector(dir, dist).setY(p.y + 1.6), k = still ? 1 : Math.min(1, dt * 3)
        controls.target.lerp(aim, k); camera.position.lerp(cam, k); if (camera.position.distanceTo(cam) < .05) v.fly = false }
      controls.update(); renderer.render(scene, camera); labels.render(scene, camera)
      if (frame++ % 6 === 0) placeLabels()
      first = false; raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(raf); ro.disconnect(); controls.dispose()
      renderer.domElement.removeEventListener('pointerdown', onDown); renderer.domElement.removeEventListener('pointerup', onUp); renderer.domElement.removeEventListener('pointermove', onMove)
      for (const c of branches.children) (c as THREE.Mesh).geometry.dispose()
      disposables.forEach(d => d.dispose()); mesh.dispose(); renderer.dispose(); el.innerHTML = ''
    }
  }, [nodes, plan])

  return <div ref={host} className="tree-3d" role="img" aria-label="Árbol del plan de estudios en 3D. Arrastrá para girarlo." />
}
