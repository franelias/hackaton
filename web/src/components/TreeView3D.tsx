// El árbol de la carrera en 3D (three.js), con forma de árbol de verdad:
// - tronco que se afina, raíces que entran al pasto y un eje central del que salen las ramas;
// - cada materia es una rama que nace de su correlativa (o del eje, si no tiene) y termina en un
//   punto de la copa: la altura sale del año y cuatrimestre, el ángulo alrededor del tronco del orden
//   de las correlativas (`armar`), así cada rama queda cerca de la que la habilita;
// - ramas afinadas con grosor por lo que sostienen, ramitas, y ramas internas sin datos que llenan la copa;
// - ~4000 hojas (InstancedMesh) que se mueven con el viento, se secan, caen al pasto y rebrotan;
// - las materias aprobadas florecen (las flores no se caen);
// - las etiquetas no se pisan: cada tanto se calcula dónde caen en pantalla y se ocultan las de menos
//   prioridad que choquen (aparecen al pasar el mouse).
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js'
import { armar, caminoDe, corto, mix, saludVisual, seco, VERDES, type Nodo } from './TreeView'
import type { Plan, Tree } from '../lib/types'

interface Props { plan: Plan; tree: Tree | null; selected: number | null; onSelect: (id: number | null) => void; todas?: boolean }

const ALTO_TRONCO = 3.2, COPA_Y = 6.7, COPA_RH = 5.4, COPA_RV = 3.7, TOPE = 10.2
const MARCA: Record<string, number> = { approved: 0xffffff, regular: 0xf2c14e, enrolled: 0x5b84b1, available: 0xa9cf80, locked: 0xd9c4a8 }
const PRIORIDAD: Record<string, number> = { enrolled: 1, regular: 2, approved: 3, available: 4, locked: 5 }
const rng = (seed: number) => () => (seed = (seed * 16807) % 2147483647) / 2147483647

// tubo que se afina de r0 a r1 a lo largo de la curva
function tuboAfinado(curva: THREE.Curve<THREE.Vector3>, r0: number, r1: number, seg = 16, lados = 8) {
  const g = new THREE.TubeGeometry(curva, seg, 1, lados), p = g.attributes.position as THREE.BufferAttribute, c = new THREE.Vector3(), v = new THREE.Vector3()
  for (let i = 0; i <= seg; i++) { curva.getPointAt(i / seg, c); const r = r0 + (r1 - r0) * Math.pow(i / seg, .8)
    for (let j = 0; j <= lados; j++) { const k = i * (lados + 1) + j; v.fromBufferAttribute(p, k).sub(c).multiplyScalar(r).add(c); p.setXYZ(k, v.x, v.y, v.z) } }
  p.needsUpdate = true; g.computeVertexNormals(); return g
}

export default function TreeView3D({ plan, tree, selected, onSelect, todas = false }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const nodos = useMemo(() => armar(plan, tree), [plan, tree])
  // nombres que se ven sin buscar: lo que se cursa y sus relacionadas (lo que necesita y lo que destraba)
  const foco = useMemo(() => { const s = new Set<number>(), por = new Map(plan.subjects.map(x => [x.subject_id, x]))
    for (const t of tree?.subjects ?? []) if (t.state === 'enrolled') { s.add(t.subject_id); por.get(t.subject_id)?.requires.forEach(r => s.add(r.subject_id)); por.get(t.subject_id)?.unlocks.forEach(u => s.add(u)) }
    return s }, [plan, tree])
  const vivo = useRef({ objetivo: saludVisual(tree), marca: null as Set<number> | null, sel: selected, sucio: true, onSelect, foco, todas, volar: false })
  vivo.current.foco = foco; vivo.current.todas = todas
  vivo.current.onSelect = onSelect
  useEffect(() => { vivo.current.objetivo = saludVisual(tree) }, [tree])
  useEffect(() => { vivo.current.marca = caminoDe(plan, selected); vivo.current.sel = selected; vivo.current.sucio = true; vivo.current.volar = selected != null }, [plan, selected])
  useEffect(() => { vivo.current.sucio = true }, [foco, todas])

  useEffect(() => {
    const el = host.current; if (!el) return
    const quieto = matchMedia('(prefers-reduced-motion: reduce)').matches, v = vivo.current, R = rng(31)
    let salud = v.objetivo, saludDibujada = -1
    const ancho = () => el.clientWidth, alto = () => el.clientHeight

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(2, devicePixelRatio)); renderer.setSize(ancho(), alto()); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap
    el.appendChild(renderer.domElement)
    const etiquetas = new CSS2DRenderer(); etiquetas.setSize(ancho(), alto())
    Object.assign(etiquetas.domElement.style, { position: 'absolute', inset: '0', pointerEvents: 'none' }); el.appendChild(etiquetas.domElement)
    const scene = new THREE.Scene(); scene.fog = new THREE.Fog(0xeef0e4, 30, 70)
    const camara = new THREE.PerspectiveCamera(36, ancho() / alto(), .1, 300); camara.position.set(0, 6.4, 21)
    const controles = new OrbitControls(camara, renderer.domElement)
    Object.assign(controles, { target: new THREE.Vector3(0, 5.6, 0), enableDamping: true, enablePan: false, minDistance: 5, maxDistance: 32, maxPolarAngle: Math.PI * .5, autoRotate: !quieto, autoRotateSpeed: .35 })
    const hemi = new THREE.HemisphereLight(0xe3f0fa, 0x7f9c5a, 1.3); scene.add(hemi)
    const sol = new THREE.DirectionalLight(0xfff0d0, 2.4); sol.position.set(9, 18, 8); sol.castShadow = true; sol.shadow.mapSize.set(2048, 2048); sol.shadow.bias = -.0005
    Object.assign(sol.shadow.camera, { left: -12, right: 12, top: 14, bottom: -4, far: 50 }); scene.add(sol)
    const descartar: { dispose(): void }[] = []
    const mat = (o: THREE.MeshStandardMaterialParameters) => { const m = new THREE.MeshStandardMaterial({ roughness: .9, ...o }); descartar.push(m); return m }
    const geo = <G extends THREE.BufferGeometry>(g: G) => { descartar.push(g); return g }

    // suelo: un claro de pasto con lomas suaves
    const pasto = mat({ color: 0x8fae6a }), pastoLejos = mat({ color: 0xa9c08a })
    const suelo = new THREE.Mesh(geo(new THREE.CircleGeometry(14, 64)), pasto); suelo.rotation.x = -Math.PI / 2; suelo.receiveShadow = true; scene.add(suelo)
    const lejos = new THREE.Mesh(geo(new THREE.CircleGeometry(90, 64)), pastoLejos); lejos.rotation.x = -Math.PI / 2; lejos.position.y = -.02; scene.add(lejos)
    for (let i = 0; i < 7; i++) { const a = i / 7 * Math.PI * 2 + .3, d = 24 + R() * 14, l = new THREE.Mesh(geo(new THREE.SphereGeometry(6 + R() * 6, 20, 12)), pastoLejos)
      l.scale.y = .25; l.position.set(Math.cos(a) * d, -.6, Math.sin(a) * d); scene.add(l) }

    // tronco, raíces y eje central
    const corteza = mat({ color: 0x6f4a32, roughness: 1 })
    const ejeCurva = new THREE.CatmullRomCurve3([new THREE.Vector3(0, -.2, 0), new THREE.Vector3(.12, ALTO_TRONCO * .5, .06), new THREE.Vector3(-.07, ALTO_TRONCO, 0), new THREE.Vector3(.09, COPA_Y, -.05), new THREE.Vector3(0, TOPE - .5, .04)])
    const eje = new THREE.Mesh(geo(tuboAfinado(ejeCurva, .62, .07, 48, 16)), corteza); eje.castShadow = true; eje.receiveShadow = true; scene.add(eje)
    for (let i = 0; i < 7; i++) { const a = i / 7 * Math.PI * 2 + R() * .5, d = 1.3 + R() * .8
      const c = new THREE.QuadraticBezierCurve3(new THREE.Vector3(Math.cos(a) * .2, .7, Math.sin(a) * .2), new THREE.Vector3(Math.cos(a) * .75, .06, Math.sin(a) * .75), new THREE.Vector3(Math.cos(a) * d, -.15, Math.sin(a) * d))
      const r = new THREE.Mesh(geo(tuboAfinado(c, .28, .04, 12, 8)), corteza); r.castShadow = true; scene.add(r) }
    const enEje = (y: number) => ejeCurva.getPointAt(Math.max(0, Math.min(1, (y + .2) / (TOPE - .3))))

    // dónde termina cada materia en la copa (con salud 1); la caída por salud se aplica después
    const maxAnio = Math.max(...nodos.map(n => n.s.year ?? 1)), A0 = Math.min(...nodos.map(n => n.ang)), A1 = Math.max(...nodos.map(n => n.ang))
    const destino = new Map<number, THREE.Vector3>()
    for (const n of nodos) {
      const u = (((n.s.year ?? 1) - 1) * 2 + ((n.s.term ?? 1) - 1)) / Math.max(1, maxAnio * 2 - 1)
      const y = ALTO_TRONCO + 1 + u * (TOPE - ALTO_TRONCO - 1.6), dy = (y - COPA_Y) / COPA_RV
      const rh = COPA_RH * Math.sqrt(Math.max(.1, 1 - dy * dy)) * (.84 + R() * .12)
      const phi = (n.ang - A0) / Math.max(.001, A1 - A0) * Math.PI * 2 * .94 + u * .7
      destino.set(n.s.subject_id, new THREE.Vector3(Math.sin(phi) * rh, y, Math.cos(phi) * rh))
    }
    const caer = (p: THREE.Vector3, s: number) => { const r = Math.hypot(p.x, p.z); return new THREE.Vector3(p.x, p.y - (1 - s) * (.3 + r * .2), p.z) }
    const pos = (m: Nodo, s: number) => caer(destino.get(m.s.subject_id)!, s)
    const inicio = (m: Nodo, s: number) => { if (m.par) return pos(m.par, s); const d = destino.get(m.s.subject_id)!; return enEje(Math.min(d.y - 1.8, ALTO_TRONCO + .4 + (d.y - ALTO_TRONCO) * .35)) }
    const curvaDe = (a: THREE.Vector3, b: THREE.Vector3, s: number) => { const h = new THREE.Vector3(b.x, 0, b.z).normalize()
      return new THREE.CubicBezierCurve3(a, a.clone().lerp(b, .35).addScaledVector(h, .35).add(new THREE.Vector3(0, .35, 0)), a.clone().lerp(b, .75).add(new THREE.Vector3(0, .2 - (1 - s) * .25, 0)), b) }
    // ramas internas sin datos: salen del eje y llenan la copa
    const internas = Array.from({ length: 34 }, (_, i) => { const y = ALTO_TRONCO + .6 + R() * (TOPE - ALTO_TRONCO - 2.2), a = i * 2.39996 + R() * .4, dy = (y + .9 - COPA_Y) / COPA_RV
      const rh = COPA_RH * Math.sqrt(Math.max(.1, 1 - dy * dy)) * (.45 + R() * .35); return { y, fin: new THREE.Vector3(Math.sin(a) * rh, y + .8 + R() * .8, Math.cos(a) * rh) } })
    // ramitas: salen de cada rama (de materia o interna) hacia afuera
    type Ramita = { de: number | string; t: number; dir: THREE.Vector3; largo: number }
    const ramitas: Ramita[] = [
      ...nodos.flatMap(m => Array.from({ length: m.est === 'locked' ? 2 : 3 + Math.floor(R() * 2) }, () => ({ de: m.s.subject_id, t: .4 + R() * .55, dir: new THREE.Vector3(R() - .5, .3 + R() * .5, R() - .5).normalize(), largo: .6 + R() * .7 }))),
      ...internas.flatMap((_, i) => Array.from({ length: 3 }, () => ({ de: `i${i}`, t: .45 + R() * .5, dir: new THREE.Vector3(R() - .5, .3 + R() * .5, R() - .5).normalize(), largo: .5 + R() * .6 }))) ]

    const ramas = new THREE.Group(); scene.add(ramas)
    const matRama = new Map<number, THREE.MeshStandardMaterial>(), matInterna = mat({ color: 0x6f4a32, roughness: 1, transparent: true })
    const curvas = new Map<number | string, THREE.Curve<THREE.Vector3>>(), puntas: THREE.Vector3[] = []
    const armarRamas = (s: number) => {
      for (const c of [...ramas.children]) { (c as THREE.Mesh).geometry.dispose(); ramas.remove(c) }
      puntas.length = 0; matInterna.color.set(mix('#6b625a', '#6f4a32', s))
      for (const m of nodos) { const c = curvaDe(inicio(m, s), pos(m, s), s); curvas.set(m.s.subject_id, c)
        const hecha = ['approved', 'regular', 'enrolled'].includes(m.est), r0 = (hecha ? .07 : .05) + Math.sqrt(m.peso) * .045
        let mm = matRama.get(m.s.subject_id); if (!mm) { mm = mat({ color: 0x6f4a32, transparent: true, roughness: 1 }); matRama.set(m.s.subject_id, mm) }
        mm.color.set(m.info?.dry ? '#857563' : mix('#6b625a', hecha ? '#6f4a32' : '#866650', s))
        const t = new THREE.Mesh(tuboAfinado(c, r0, .03, 20, 8), mm); t.castShadow = true; t.userData.id = m.s.subject_id; ramas.add(t) }
      internas.forEach((r, i) => { const c = curvaDe(enEje(r.y), caer(r.fin, s), s); curvas.set(`i${i}`, c)
        const t = new THREE.Mesh(tuboAfinado(c, .07, .02, 14, 7), matInterna); t.castShadow = true; ramas.add(t) })
      for (const r of ramitas) { const c = curvas.get(r.de)!, a = c.getPointAt(r.t), b = a.clone().addScaledVector(r.dir, r.largo).add(new THREE.Vector3(0, -(1 - s) * .25, 0))
        const t = new THREE.Mesh(tuboAfinado(new THREE.QuadraticBezierCurve3(a, a.clone().lerp(b, .5).add(new THREE.Vector3(0, .1, 0)), b), .032, .01, 6, 5), typeof r.de === 'number' ? matRama.get(r.de)! : matInterna)
        t.castShadow = true; ramas.add(t); puntas.push(b) } }

    // marcas de cada materia y zonas para tocar
    const marcas = new THREE.Group(), tocables: THREE.Mesh[] = []; scene.add(marcas)
    const geoPetalo = geo(new THREE.SphereGeometry(.07, 10, 8)), geoYema = geo(new THREE.SphereGeometry(.09, 10, 8)), geoToque = geo(new THREE.SphereGeometry(.5, 8, 6))
    const invisible = new THREE.MeshBasicMaterial({ visible: false }); descartar.push(invisible)
    const petaloBlanco = mat({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: .35 }), petaloRosa = mat({ color: 0xffb3d1, emissive: 0xffb3d1, emissiveIntensity: .3 })
    const centroFlor = mat({ color: 0xf2c14e, emissive: 0xf2c14e, emissiveIntensity: .35 })
    const flor = (petalo: THREE.Material, k = 1) => { const g = new THREE.Group()
      for (let i = 0; i < 5; i++) { const p = new THREE.Mesh(geoPetalo, petalo), a = i / 5 * Math.PI * 2; p.scale.set(.9 * k, .9 * k, .35 * k); p.position.set(Math.cos(a) * .085 * k, Math.sin(a) * .085 * k, 0); g.add(p) }
      const c = new THREE.Mesh(geoPetalo, centroFlor); c.scale.setScalar(.7 * k); g.add(c); g.rotation.set(R() * 3, R() * 3, R() * 3); return g }
    const objMarca = new Map<number, THREE.Object3D>(), objEtiqueta = new Map<number, HTMLDivElement>()
    for (const m of nodos) {
      const g = new THREE.Group(), id = m.s.subject_id
      const afuera = destino.get(id)!.clone().setY(0).normalize().multiplyScalar(.5).setY(.15)   // las flores, hacia el borde de la copa
      if (m.est === 'approved') { const f = flor(petaloBlanco, 2.2); f.position.copy(afuera); g.add(f) }
      else if (m.info?.flower) { const f = flor(petaloRosa, 2); f.position.copy(afuera); g.add(f) }
      else { const y = new THREE.Mesh(geoYema, mat({ color: MARCA[m.est], emissive: MARCA[m.est], emissiveIntensity: m.est === 'enrolled' ? .4 : .1 })); y.scale.set(1, 1.5, 1); g.add(y) }
      const toque = new THREE.Mesh(geoToque, invisible); toque.userData.id = id; g.add(toque); tocables.push(toque)
      marcas.add(g); objMarca.set(id, g)
      const div = document.createElement('div'); div.className = `pild3d ${m.est}${m.s.bottleneck && m.est !== 'approved' ? ' cuello' : ''}`; div.textContent = corto(m.s.name); div.title = m.s.name
      const obj = new CSS2DObject(div); obj.center.set(.5, -.7); g.add(obj); objEtiqueta.set(id, div)
    }
    // las aprobadas florecen: flores en las puntas de sus ramitas (no se caen nunca)
    const flores: { obj: THREE.Object3D; punta: number }[] = []
    ramitas.forEach((r, i) => { const m = typeof r.de === 'number' ? nodos.find(n => n.s.subject_id === r.de) : null
      if (m && (m.est === 'approved' || m.info?.flower)) for (let k = 0; k < 3; k++) { const f = flor(m.est === 'approved' ? petaloBlanco : petaloRosa, 1.4); f.userData.off = new THREE.Vector3(R() - .5, R() - .2, R() - .5).multiplyScalar(.35); scene.add(f); flores.push({ obj: f, punta: i }) } })
    let estrella: THREE.Mesh | null = null
    if (plan.final_goal) { estrella = new THREE.Mesh(geo(new THREE.OctahedronGeometry(.3)), mat({ color: 0xf2c14e, emissive: 0xf2c14e, emissiveIntensity: .5, metalness: .2 }))
      estrella.position.set(0, TOPE + .6, 0); scene.add(estrella)
      const d = document.createElement('div'); d.className = 'pild3d meta'; d.textContent = plan.final_goal.name; const o = new CSS2DObject(d); o.center.set(.5, -.9); estrella.add(o) }

    // follaje: hojas de cada materia, en las ramitas y relleno de la copa
    const forma = new THREE.Shape(); forma.moveTo(0, -.5); forma.bezierCurveTo(.42, -.25, .38, .35, 0, .6); forma.bezierCurveTo(-.38, .35, -.42, -.25, 0, -.5)
    const geoHoja = geo(new THREE.ShapeGeometry(forma, 4)), matHoja = mat({ side: THREE.DoubleSide, roughness: .75, transparent: true })
    type Hoja = { m: Nodo | null; donde: 'nodo' | 'ramita' | 'copa'; idx: number; off: THREE.Vector3; rot: THREE.Euler; k: number; t: number; tono: number; fase: number; estado: 0 | 1 | 2; p: THREE.Vector3; giro: number; borrar: number; antes: number }
    const hojas: Hoja[] = []
    const nueva = (m: Nodo | null, donde: Hoja['donde'], idx: number, radio: number, t: number): Hoja => ({ m, donde, idx, t, off: new THREE.Vector3(R() - .5, R() - .4, R() - .5).normalize().multiplyScalar(radio * Math.cbrt(R())),
      rot: new THREE.Euler(R() * 6.3, R() * 6.3, R() * 6.3), k: .75 + R() * .6, tono: R(), fase: R() * 6.3, estado: 0, p: new THREE.Vector3(), giro: 0, borrar: 0, antes: 0 })
    for (const m of nodos) { const extra = ['approved', 'regular', 'enrolled'].includes(m.est) ? 12 : 7
      for (const h of m.hojas) hojas.push(nueva(m, 'nodo', 0, .85, h.t)); for (let k = 0; k < extra; k++) hojas.push(nueva(m, 'nodo', 0, .95, .05 + R() * .9)) }
    ramitas.forEach((r, i) => { const m = typeof r.de === 'number' ? nodos.find(n => n.s.subject_id === r.de)! : null; for (let k = 0; k < 13; k++) hojas.push(nueva(m, 'ramita', i, .55, .05 + R() * .9)) })
    for (let i = 0; i < 1200; i++) { const h = nueva(null, 'copa', 0, 0, .05 + R() * .9), a = R() * Math.PI * 2, y = R() * 2 - 1, rr = Math.sqrt(1 - y * y) * (.5 + R() * .5)
      h.off.set(Math.sin(a) * rr * COPA_RH * .97, COPA_Y + .3 + y * COPA_RV * .92, Math.cos(a) * rr * COPA_RH * .97); hojas.push(h) }
    const malla = new THREE.InstancedMesh(geoHoja, matHoja, hojas.length); malla.castShadow = true; malla.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(malla)
    const tmp = new THREE.Object3D(), color = new THREE.Color()
    const saludDe = (h: Hoja, s: number) => h.m?.info?.dry ? Math.min(s, .3) : s
    const visible = (h: Hoja, s: number) => Math.max(0, Math.min(1, (saludDe(h, s) - h.t * .95) / .08))
    const verdes = (h: Hoja) => h.m ? VERDES[h.m.est] : ['#4c8a43', '#5f9a4e', '#6fa85a']
    const base = (h: Hoja, s: number) => h.donde === 'nodo' ? objMarca.get(h.m!.s.subject_id)!.position : h.donde === 'ramita' ? (puntas[h.idx] ?? new THREE.Vector3()) : caer(h.off, s)

    const pintarColores = (s: number) => { hojas.forEach((h, i) => malla.setColorAt(i, color.set(seco(verdes(h)[Math.floor(h.tono * 3)], saludDe(h, s))))); if (malla.instanceColor) malla.instanceColor.needsUpdate = true }
    const cielo = (s: number) => { el.style.background = `linear-gradient(${mix('#9aa3a8', '#cfe5ee', s)}, ${mix('#c9c0b2', '#f1f3e8', s)} 62%, ${mix('#c8a98a', '#f9e2b4', s)})`
      pasto.color.set(mix('#a39270', '#8fae6a', s)); pastoLejos.color.set(mix('#b7ab8f', '#a9c08a', s)); (scene.fog as THREE.Fog).color.set(mix('#c9c0b2', '#eef0e4', s)); sol.intensity = 1.3 + 1.2 * s }

    const actualizarSeleccion = () => { const { marca, sel } = v
      for (const m of nodos) { const id = m.s.subject_id, en = !marca || marca.has(id), mm = matRama.get(id)!
        mm.opacity = en ? 1 : .2; mm.emissive.set(marca?.has(id) && marca.size > 1 ? 0xffd84a : 0x000000); mm.emissiveIntensity = .6
        const d = objEtiqueta.get(id)!; d.classList.toggle('apagada', !en); d.classList.toggle('sel', id === sel); d.classList.toggle('oculta', !v.todas && !v.foco.has(id) && !marca?.has(id)) }
      matInterna.opacity = v.marca ? .25 : 1; matHoja.opacity = marca ? .3 : 1; v.sucio = false }

    // etiquetas sin pisarse: en pantalla, primero las de más prioridad y más cerca de la cámara
    const tam = new Map<number, { w: number; h: number }>(), p2 = new THREE.Vector3()
    const acomodarEtiquetas = () => { const W = ancho(), H = alto(), puestas: { x0: number; y0: number; x1: number; y1: number }[] = []
      const lista = nodos.map(m => { const id = m.s.subject_id, d = objEtiqueta.get(id)!, o = objMarca.get(id)!
        o.getWorldPosition(p2); const dist = p2.distanceTo(camara.position); p2.project(camara)
        let t = tam.get(id); if (!t || !t.w) { t = { w: d.offsetWidth, h: d.offsetHeight }; tam.set(id, t) }
        const pr = id === v.sel ? 0 : v.marca?.has(id) ? .5 : d.classList.contains('oculta') ? 9 : PRIORIDAD[m.est] ?? 5
        return { d, pr, dist, x: (p2.x + 1) / 2 * W, y: (1 - p2.y) / 2 * H + t.h * .7 + 6, w: t.w, h: t.h, atras: p2.z > 1 } })
        .sort((a, b) => a.pr - b.pr || a.dist - b.dist)
      for (const e of lista) { const r = { x0: e.x - e.w / 2 - 3, y0: e.y - e.h / 2 - 2, x1: e.x + e.w / 2 + 3, y1: e.y + e.h / 2 + 2 }
        const choca = e.pr >= 9 || e.atras || puestas.some(q => r.x0 < q.x1 && r.x1 > q.x0 && r.y0 < q.y1 && r.y1 > q.y0)
        e.d.classList.toggle('tapada', choca); if (!choca) puestas.push(r) } }

    const ray = new THREE.Raycaster(), puntero = new THREE.Vector2(); let abajo: { x: number; y: number } | null = null
    const idEn = (ev: PointerEvent) => { const r = renderer.domElement.getBoundingClientRect(); puntero.set((ev.clientX - r.left) / r.width * 2 - 1, -(ev.clientY - r.top) / r.height * 2 + 1)
      ray.setFromCamera(puntero, camara); const hit = ray.intersectObjects([...tocables, ...ramas.children.filter(c => c.userData.id != null)], false)[0]; return hit ? hit.object.userData.id as number : null }
    const alBajar = (ev: PointerEvent) => { abajo = { x: ev.clientX, y: ev.clientY }; controles.autoRotate = false; v.volar = false }
    const alSubir = (ev: PointerEvent) => { if (abajo && Math.hypot(ev.clientX - abajo.x, ev.clientY - abajo.y) < 6) { const id = idEn(ev); v.onSelect(id === v.sel ? null : id) } abajo = null }
    const alMover = (ev: PointerEvent) => { const id = abajo ? null : idEn(ev); renderer.domElement.style.cursor = id != null ? 'pointer' : 'grab'; objEtiqueta.forEach((d, k) => d.classList.toggle('hover', k === id)) }
    renderer.domElement.addEventListener('pointerdown', alBajar); renderer.domElement.addEventListener('pointerup', alSubir); renderer.domElement.addEventListener('pointermove', alMover)
    const ro = new ResizeObserver(() => { camara.aspect = ancho() / alto(); camara.updateProjectionMatrix(); renderer.setSize(ancho(), alto()); etiquetas.setSize(ancho(), alto()) }); ro.observe(el)

    let raf = 0, t0 = performance.now(), tiempo = 0, primero = true, cuadro = 0
    const tic = (t: number) => {
      const dt = Math.min(.05, (t - t0) / 1000); t0 = t; tiempo += dt
      salud += (v.objetivo - salud) * (quieto ? 1 : Math.min(1, dt / .7)); if (Math.abs(v.objetivo - salud) < .002) salud = v.objetivo
      if (Math.abs(salud - saludDibujada) > .015 || primero) { for (const m of nodos) objMarca.get(m.s.subject_id)!.position.copy(pos(m, salud))
        armarRamas(salud); pintarColores(salud); cielo(salud); saludDibujada = salud; v.sucio = true
        for (const f of flores) { const p = puntas[f.punta]; f.obj.position.copy(p).addScaledVector(p.clone().setY(0).normalize(), .55).add(f.obj.userData.off) }
        if (primero) { for (const h of hojas) h.antes = visible(h, salud)
          for (const h of hojas) if (h.antes === 0 && h.tono < .45) { h.estado = 2; const b = base(h, salud); h.p.set(b.x * .8 + (h.tono - .2) * 3, .02, b.z * .8 + (h.fase / 6.3 - .5) * 3) } } }
      if (v.sucio) actualizarSeleccion()
      const viento = quieto ? 0 : 1
      hojas.forEach((h, i) => {
        const vis = visible(h, salud), b = base(h, salud)
        if (h.estado === 0 && vis <= 0 && h.antes > 0 && !primero && !quieto) { h.estado = 1; h.p.copy(b); if (h.donde !== 'copa') h.p.add(h.off); h.giro = 0 }
        if (h.estado === 1 && vis > 0) h.estado = 0
        if (h.estado === 2 && v.objetivo > .9) { h.borrar += dt / .8; if (h.borrar >= 1) { h.estado = 0; h.borrar = 0 } }
        if (h.estado === 0) { tmp.position.copy(b); if (h.donde !== 'copa') tmp.position.add(h.off)
          tmp.rotation.set(h.rot.x + Math.sin(tiempo * 1.4 + h.fase) * .22 * viento, h.rot.y, h.rot.z + Math.cos(tiempo * 1.1 + h.fase) * .18 * viento); tmp.scale.setScalar(h.k * .42 * vis) }
        else if (h.estado === 1) { h.p.y -= dt * 1.1; h.p.x += Math.sin(tiempo * 2 + h.fase) * dt * .6; h.giro += dt * 3; tmp.position.copy(h.p); tmp.rotation.set(h.giro, h.fase, h.giro * .6); tmp.scale.setScalar(h.k * .42)
          if (h.p.y <= .03) { h.estado = 2; h.p.y = .02 } }
        else { tmp.position.copy(h.p); tmp.rotation.set(-Math.PI / 2, 0, h.fase); tmp.scale.setScalar(h.k * .42 * (1 - h.borrar)) }
        h.antes = vis; tmp.updateMatrix(); malla.setMatrixAt(i, tmp.matrix) })
      malla.instanceMatrix.needsUpdate = true
      if (estrella && !quieto) estrella.rotation.y += dt * .8
      // al elegir una materia (tocándola o buscándola), la cámara gira hasta tenerla de frente
      if (v.volar && v.sel != null && objMarca.has(v.sel)) { controles.autoRotate = false
        const p = objMarca.get(v.sel)!.position, dir = new THREE.Vector3(p.x, 0, p.z).normalize(), dist = Math.max(11, Math.min(17, camara.position.distanceTo(controles.target)))
        const blanco = new THREE.Vector3(p.x * .35, p.y - .3, p.z * .35), cam = blanco.clone().addScaledVector(dir, dist).setY(p.y + 1.6), k = quieto ? 1 : Math.min(1, dt * 3)
        controles.target.lerp(blanco, k); camara.position.lerp(cam, k); if (camara.position.distanceTo(cam) < .05) v.volar = false }
      controles.update(); renderer.render(scene, camara); etiquetas.render(scene, camara)
      if (cuadro++ % 6 === 0) acomodarEtiquetas()
      primero = false; raf = requestAnimationFrame(tic)
    }
    raf = requestAnimationFrame(tic)

    return () => {
      cancelAnimationFrame(raf); ro.disconnect(); controles.dispose()
      renderer.domElement.removeEventListener('pointerdown', alBajar); renderer.domElement.removeEventListener('pointerup', alSubir); renderer.domElement.removeEventListener('pointermove', alMover)
      for (const c of ramas.children) (c as THREE.Mesh).geometry.dispose()
      descartar.forEach(d => d.dispose()); malla.dispose(); renderer.dispose(); el.innerHTML = ''
    }
  }, [nodos, plan])

  return <div ref={host} className="arbol3d" role="img" aria-label="Árbol del plan de estudios en 3D. Arrastrá para girarlo." />
}
