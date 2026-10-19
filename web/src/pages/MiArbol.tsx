import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import TreeView from '../components/TreeView'
import { api } from '../lib/api'
import { useSesion } from '../lib/session'
import type { Alert, PlanSubject, SubjectState } from '../lib/types'

const ETIQUETA: Record<SubjectState, string> = { approved: 'Aprobada', regular: 'Regular (debe el final)', enrolled: 'Cursando', available: 'La podés cursar', locked: 'Todavía no' }
const SALUD = { lush: 'frondoso', wilted: 'mustio', withered: 'seco' }

const hace = (iso: string | null) => { if (!iso) return null; const d = Math.floor((Date.now() - new Date(iso).getTime()) / 864e5); return d <= 0 ? 'hoy' : d === 1 ? 'ayer' : `hace ${d} días` }

export default function MiArbol() {
  const { plan, tree, alerts, studentId, usuario, setTree, refrescar, error } = useSesion()
  const nav = useNavigate()
  const [sel, setSel] = useState<number | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)
  const estado = useMemo(() => new Map((tree?.subjects ?? []).map(s => [s.subject_id, s])), [tree])
  const est = (id: number): SubjectState => estado.get(id)?.state ?? 'locked'
  const por = useMemo(() => new Map((plan?.subjects ?? []).map(s => [s.subject_id, s])), [plan])
  if (error && !tree) return <div className="centrado error">{error}<br /><button className="btn secundario" onClick={() => location.reload()}>Reintentar</button></div>
  if (!plan || !tree || !studentId) return <div className="centrado">Cargando tu árbol…</div>

  const nombre = (usuario?.displayName ?? '').split(' ')[0]
  const salud = tree.health.state
  const aprobadas = tree.subjects.filter(s => s.state === 'approved').length
  const total = plan.subjects.filter(s => !s.optional).length
  const cursando = tree.subjects.filter(s => s.state === 'enrolled').map(s => por.get(s.subject_id)!).filter(Boolean).sort((a, b) => b.unlocks_total - a.unlocks_total)
  const sub = salud === 'lush' ? `Tu árbol está frondoso. Llevás ${aprobadas} de ${total} materias aprobadas.`
    : `Tu árbol está ${SALUD[salud]}: tu última actividad fue ${hace(tree.health.last_activity)}. Lo que aprobaste sigue ahí.`

  const correr = async (f: () => Promise<unknown>, ok?: string) => { setOcupado(true); setAviso(null)
    try { await f(); if (ok) setAviso(ok) } catch (e) { setAviso((e as Error).message) } finally { setOcupado(false) } }
  const regar = () => correr(async () => { setTree(await api.activity(studentId, { type: 'checkin' })); await refrescar() }, '¡Listo! Tu árbol recibió agua.')
  const accion = (a: Alert) => { const t = a.action.type
    if (t === 'open_tutor') nav(`/tutor${a.action.subject_id ? `?materia=${a.action.subject_id}` : ''}`)
    else if (t === 'build_schedule') nav('/horarios')
    else if (t === 'contact_tutor') setAviso('Le avisamos a la tutoría de tu carrera. Te van a escribir al mail.')
    else setAviso('Las fechas de mesas todavía no están cargadas.') }
  const textoAccion: Record<Alert['action']['type'], string> = { open_tutor: 'Practicar con el tutor', build_schedule: 'Armar horario', view_dates: 'Ver fechas', contact_tutor: 'Hablar con un tutor' }

  const m = sel != null ? por.get(sel) : null
  return (
    <div className="pagina">
      <header className="saludo">
        <div><h1>¡Buenas{nombre ? `, ${nombre}` : ''}!</h1><p>{sub}</p></div>
        <div className="dato"><svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2C14 7 19 9 19 15A7 7 0 0 1 5 15C5 11 8 9 8 6C10 8 10 10 11 11C12 8 11 5 12 2Z" fill="#f08a3c" /></svg>
          <div><b>{tree.streak.weeks > 0 ? `${tree.streak.weeks} semanas` : `Mejor: ${tree.streak.best}`}</b><span>{tree.streak.weeks > 0 ? 'de racha' : 'semanas de racha'}</span></div></div>
        <button className="btn" onClick={regar} disabled={ocupado}>Estudié hoy</button>
      </header>

      {alerts.map(a => (
        <div key={a.id} className={`alerta ${a.level}`} role="status">
          <p>{a.message}</p>
          <button className="btn chico" onClick={() => accion(a)}>{textoAccion[a.action.type]}</button>
          <button className="enlace" onClick={() => correr(async () => { await api.dismissAlert(studentId, a.id); await refrescar() })}>Descartar</button>
        </div>))}
      {aviso && <p className="aviso" role="status">{aviso}</p>}

      <div className="escena-arbol">
        <TreeView plan={plan} tree={tree} selected={sel} onSelect={setSel} />
        <div className="leyenda">
          <span><i className="flor" />Aprobada</span><span><i className="regular" />Regular</span><span><i className="cursando" />Cursando</span>
          <span><i className="disponible" />La podés cursar</span><span><i className="bloqueada" />Todavía no</span><span><i className="cuello" />Destraba mucho</span>
        </div>
        <aside className="panel" aria-live="polite">
          {m ? <FichaMateria m={m} estado={est(m.subject_id)} est={est} por={por} ocupado={ocupado}
              cambiar={s => correr(async () => { setTree(await api.setSubject(studentId, m.subject_id, s)); await refrescar() }, 'Guardado.')}
              parcial={fecha => correr(async () => { setTree(await api.activity(studentId, { type: 'exam', subject_id: m.subject_id, date: fecha })); await refrescar() }, 'Anotamos la fecha del parcial.')}
              tutor={() => nav(`/tutor?materia=${m.subject_id}`)} cerrar={() => setSel(null)} />
            : <div>
                <h2>Tu próximo paso</h2>
                {cursando[0] ? <><p>Practicá un ejercicio de <b>{cursando[0].name}</b>: destraba {cursando[0].unlocks_total} materias.</p>
                  <button className="btn ancho" onClick={() => nav(`/tutor?materia=${cursando[0].subject_id}`)}>Practicar con el tutor</button></>
                  : <p>Tocá una materia del árbol para ver qué necesita y qué te destraba, o marcá cuáles estás cursando.</p>}
                <p className="pista">Tocá cualquier materia para ver su camino de correlativas.</p>
              </div>}
        </aside>
      </div>
    </div>
  )
}

function FichaMateria({ m, estado, est, por, ocupado, cambiar, parcial, tutor, cerrar }: { m: PlanSubject; estado: SubjectState; est: (id: number) => SubjectState; por: Map<number, PlanSubject>; ocupado: boolean;
  cambiar: (s: 'approved' | 'regular' | 'enrolled') => void; parcial: (fecha: string) => void; tutor: () => void; cerrar: () => void }) {
  const [fecha, setFecha] = useState('')
  return (
    <div className="ficha">
      <button className="cerrar" onClick={cerrar} aria-label="Cerrar">×</button>
      <h2>{m.name}</h2>
      <p className="meta">{m.year ? `${m.year}.º año, ${m.term}.º cuatrimestre` : 'Optativa'} · <span className={`chip ${estado}`}>{ETIQUETA[estado]}</span></p>
      {m.bottleneck && <p className="cuello">Destraba {m.unlocks_total} materias: conviene no atrasarla.</p>}
      <h3>Necesita</h3>
      <ul>{m.requires.length ? m.requires.map(r => <li key={r.subject_id}>{por.get(r.subject_id)?.name}<span>{r.condition === 'regular' ? 'regular' : 'aprobada'} · {ETIQUETA[est(r.subject_id)].toLowerCase()}</span></li>) : <li>Nada, se cursa desde el principio</li>}</ul>
      <h3>Destraba</h3>
      <ul>{m.unlocks.length ? m.unlocks.map(u => <li key={u}>{por.get(u)?.name}</li>) : <li>Es de las últimas de la carrera</li>}</ul>
      <div className="acciones">
        <button className="btn ancho" onClick={tutor}>Practicar con el tutor</button>
        <div className="segmentos" role="group" aria-label="Marcar como">
          {(['enrolled', 'regular', 'approved'] as const).map(s => <button key={s} disabled={ocupado} className={estado === s ? 'on' : ''} onClick={() => cambiar(s)}>{{ enrolled: 'La curso', regular: 'Regular', approved: 'Aprobada' }[s]}</button>)}
        </div>
        {(estado === 'enrolled') && <form className="fila" onSubmit={e => { e.preventDefault(); if (fecha) parcial(fecha) }}>
          <label>Fecha del parcial<input type="date" value={fecha} onChange={e => setFecha(e.target.value)} /></label><button className="btn chico secundario" disabled={!fecha || ocupado}>Anotar</button></form>}
      </div>
    </div>
  )
}
