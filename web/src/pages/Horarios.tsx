import { useMemo, useState } from 'react'
import { api } from '../lib/api'
import { useSesion } from '../lib/session'
import type { ScheduleResult, SchedulePreferences } from '../lib/types'

const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
const COLORES = ['#cfe3c2', '#d9e6f4', '#f8e3b8', '#f3d3e0', '#d8d3f0', '#cde9e4', '#efd9c3']
const min = (h: string) => { const [a, b] = h.split(':').map(Number); return a * 60 + b }

export default function Horarios() {
  const { plan, tree, studentId } = useSesion()
  const candidatas = useMemo(() => {
    const est = new Map((tree?.subjects ?? []).map(s => [s.subject_id, s.state]))
    return (plan?.subjects ?? []).filter(s => ['enrolled', 'available'].includes(est.get(s.subject_id) ?? '')).sort((a, b) => b.unlocks_total - a.unlocks_total)
  }, [plan, tree])
  const [elegidas, setElegidas] = useState<number[]>(() => (tree?.subjects ?? []).filter(s => s.state === 'enrolled').map(s => s.subject_id))
  const [turno, setTurno] = useState<SchedulePreferences['shift'] | ''>('')
  const [libres, setLibres] = useState<number[]>([])
  const [r, setR] = useState<ScheduleResult | null>(null), [opcion, setOpcion] = useState(0)
  const [error, setError] = useState<string | null>(null), [cargando, setCargando] = useState(false)
  const nombre = (id: number) => plan?.subjects.find(s => s.subject_id === id)?.name ?? `Materia ${id}`

  const armar = async () => { if (!studentId) return; setCargando(true); setError(null)
    try { setR(await api.schedule(studentId, elegidas, { ...(turno ? { shift: turno } : {}), ...(libres.length ? { free_days: libres } : {}) })); setOpcion(0) }
    catch (e) { setError((e as Error).message) } finally { setCargando(false) } }

  const op = r?.options[opcion]
  const clases = op ? op.commissions.flatMap((c, i) => c.classes.map(k => ({ ...k, nombre: c.name, color: COLORES[i % COLORES.length] }))) : []
  const desde = Math.min(8 * 60, ...clases.map(c => min(c.from))), hasta = Math.max(20 * 60, ...clases.map(c => min(c.to)))
  const horas = Array.from({ length: Math.ceil((hasta - desde) / 60) }, (_, i) => desde / 60 + i)

  return (
    <div className="pagina">
      <header className="saludo"><div><h1>Armá tu horario</h1><p>Elegí las materias que querés cursar. Solo aparecen las que ya podés cursar por correlativas.</p></div></header>
      <div className="horarios">
        <aside className="caja-lista">
          <h2>Materias</h2>
          {candidatas.length === 0 && <p className="pista">Todavía no hay materias habilitadas. Marcá en tu árbol las que aprobaste.</p>}
          {candidatas.map(s => (
            <label key={s.subject_id} className="check"><input type="checkbox" checked={elegidas.includes(s.subject_id)} onChange={e => setElegidas(e.target.checked ? [...elegidas, s.subject_id] : elegidas.filter(x => x !== s.subject_id))} />
              <span>{s.name}{s.bottleneck && <small>destraba {s.unlocks_total}</small>}</span></label>))}
          <h2>Preferencias</h2>
          <label>Turno<select value={turno} onChange={e => setTurno(e.target.value as SchedulePreferences['shift'] | '')}><option value="">Me da igual</option><option value="morning">Mañana</option><option value="afternoon">Tarde</option><option value="evening">Noche</option></select></label>
          <p className="etiqueta">Días libres</p>
          <div className="segmentos">{DIAS.slice(0, 5).map((d, i) => <button key={d} className={libres.includes(i + 1) ? 'on' : ''} onClick={() => setLibres(libres.includes(i + 1) ? libres.filter(x => x !== i + 1) : [...libres, i + 1])}>{d}</button>)}</div>
          <button className="btn ancho" disabled={!elegidas.length || cargando} onClick={armar}>{cargando ? 'Armando…' : 'Armar horario'}</button>
          {error && <p className="error" role="alert">{error}</p>}
        </aside>
        <section className="grilla-caja">
          {!r ? <p className="pista centrado">Elegí materias y tocá “Armar horario”.</p> : <>
            {r.options.length > 1 && <div className="segmentos">{r.options.map((o, i) => <button key={i} className={i === opcion ? 'on' : ''} onClick={() => setOpcion(i)}>Opción {i + 1} · {o.days_on_campus} días · {o.gap_hours} h de hueco</button>)}</div>}
            {op ? <div className="grilla" style={{ gridTemplateRows: `28px repeat(${horas.length}, 44px)` }}>
              <div />{DIAS.map(d => <div key={d} className="cab-dia">{d}</div>)}
              {horas.map((h, i) => <div key={h} className="hora" style={{ gridRow: i + 2 }}>{h}:00</div>)}
              {clases.map((c, i) => { const top = (min(c.from) - desde) / 60, alto = (min(c.to) - min(c.from)) / 60
                return <div key={i} className="clase" style={{ gridColumn: c.day + 1, gridRow: `${Math.floor(top) + 2} / span ${Math.ceil(top + alto) - Math.floor(top)}`, background: c.color, marginTop: `${(top % 1) * 44}px` }}>
                  <b>{c.nombre}</b><span>{c.from}–{c.to}{c.end_estimated ? ' (aprox.)' : ''}</span>{c.room && <span>{c.room}</span>}</div> })}
            </div> : <p className="pista">No hay ninguna combinación posible con estas materias.</p>}
            {r.conflicts.length > 0 && <div className="nota"><b>Se superponen:</b> {r.conflicts.map(c => c.subject_ids.map(nombre).join(' y ')).join('; ')}.</div>}
            {r.suggest_postpone.length > 0 && <div className="nota"><b>Te conviene postergar:</b> {r.suggest_postpone.map(nombre).join(', ')}.</div>}
            {r.not_enabled.length > 0 && <div className="nota"><b>Todavía no las podés cursar:</b> {r.not_enabled.map(n => `${n.name} (te falta ${n.missing.map(x => nombre(x.subject_id)).join(', ')})`).join('; ')}.</div>}
            {r.without_schedule.length > 0 && <div className="nota">Sin horarios publicados: {r.without_schedule.map(nombre).join(', ')}.</div>}
            {r.warnings.map((w, i) => <div key={i} className="nota suave">{w}</div>)}
          </>}
        </section>
      </div>
    </div>
  )
}
