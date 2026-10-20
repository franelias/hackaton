import { useMemo, useState } from 'react'
import { api } from '../lib/api'
import { useSession } from '../lib/session'
import type { ScheduleResult, SchedulePreferences } from '../lib/types'

const DAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
const COLORS = ['#cfe3c2', '#d9e6f4', '#f8e3b8', '#f3d3e0', '#d8d3f0', '#cde9e4', '#efd9c3']
const minutes = (h: string) => { const [a, b] = h.split(':').map(Number); return a * 60 + b }

export default function Schedule() {
  const { plan, tree, studentId } = useSession()
  const candidates = useMemo(() => {
    const states = new Map((tree?.subjects ?? []).map(s => [s.subject_id, s.state]))
    return (plan?.subjects ?? []).filter(s => ['enrolled', 'available'].includes(states.get(s.subject_id) ?? '')).sort((a, b) => b.unlocks_total - a.unlocks_total)
  }, [plan, tree])
  const [picked, setPicked] = useState<number[]>(() => (tree?.subjects ?? []).filter(s => s.state === 'enrolled').map(s => s.subject_id))
  const [shift, setShift] = useState<SchedulePreferences['shift'] | ''>('')
  const [freeDays, setFreeDays] = useState<number[]>([])
  const [result, setResult] = useState<ScheduleResult | null>(null), [option, setOption] = useState(0)
  const [error, setError] = useState<string | null>(null), [loading, setLoading] = useState(false)
  const nameOf = (id: number) => plan?.subjects.find(s => s.subject_id === id)?.name ?? `Materia ${id}`

  const build = async () => { if (!studentId) return; setLoading(true); setError(null)
    try { setResult(await api.schedule(studentId, picked, { ...(shift ? { shift } : {}), ...(freeDays.length ? { free_days: freeDays } : {}) })); setOption(0) }
    catch (e) { setError((e as Error).message) } finally { setLoading(false) } }

  const opt = result?.options[option]
  const classes = opt ? opt.commissions.flatMap((c, i) => c.classes.map(k => ({ ...k, name: c.name, color: COLORS[i % COLORS.length] }))) : []
  const from = Math.min(8 * 60, ...classes.map(c => minutes(c.from))), to = Math.max(20 * 60, ...classes.map(c => minutes(c.to)))
  const hours = Array.from({ length: Math.ceil((to - from) / 60) }, (_, i) => from / 60 + i)

  return (
    <div className="page">
      <header className="greeting"><div><h1>Armá tu horario</h1><p>Elegí las materias que querés cursar. Solo aparecen las que ya podés cursar por correlativas.</p></div></header>
      <div className="schedule">
        <aside className="list-box">
          <h2>Materias</h2>
          {candidates.length === 0 && <p className="hint">Todavía no hay materias habilitadas. Marcá en tu árbol las que aprobaste.</p>}
          {candidates.map(s => (
            <label key={s.subject_id} className="check"><input type="checkbox" checked={picked.includes(s.subject_id)} onChange={e => setPicked(e.target.checked ? [...picked, s.subject_id] : picked.filter(x => x !== s.subject_id))} />
              <span>{s.name}{s.bottleneck && <small>destraba {s.unlocks_total}</small>}</span></label>))}
          <h2>Preferencias</h2>
          <label>Turno<select value={shift} onChange={e => setShift(e.target.value as SchedulePreferences['shift'] | '')}><option value="">Me da igual</option><option value="morning">Mañana</option><option value="afternoon">Tarde</option><option value="evening">Noche</option></select></label>
          <p className="label">Días libres</p>
          <div className="segmented">{DAYS.slice(0, 5).map((d, i) => <button key={d} className={freeDays.includes(i + 1) ? 'on' : ''} onClick={() => setFreeDays(freeDays.includes(i + 1) ? freeDays.filter(x => x !== i + 1) : [...freeDays, i + 1])}>{d}</button>)}</div>
          <button className="btn full" disabled={!picked.length || loading} onClick={build}>{loading ? 'Armando…' : 'Armar horario'}</button>
          {error && <p className="error" role="alert">{error}</p>}
        </aside>
        <section className="grid-box">
          {!result ? <p className="hint centered">Elegí materias y tocá “Armar horario”.</p> : <>
            {result.options.length > 1 && <div className="segmented">{result.options.map((o, i) => <button key={i} className={i === option ? 'on' : ''} onClick={() => setOption(i)}>Opción {i + 1} · {o.days_on_campus} días · {o.gap_hours} h de hueco</button>)}</div>}
            {opt ? <div className="week-grid" style={{ gridTemplateRows: `28px repeat(${hours.length}, 44px)` }}>
              <div />{DAYS.map(d => <div key={d} className="day-header">{d}</div>)}
              {hours.map((h, i) => <div key={h} className="hour" style={{ gridRow: i + 2 }}>{h}:00</div>)}
              {classes.map((c, i) => { const top = (minutes(c.from) - from) / 60, height = (minutes(c.to) - minutes(c.from)) / 60
                return <div key={i} className="class-block" style={{ gridColumn: c.day + 1, gridRow: `${Math.floor(top) + 2} / span ${Math.ceil(top + height) - Math.floor(top)}`, background: c.color, marginTop: `${(top % 1) * 44}px` }}>
                  <b>{c.name}</b><span>{c.from}–{c.to}{c.end_estimated ? ' (aprox.)' : ''}</span>{c.room && <span>{c.room}</span>}</div> })}
            </div> : <p className="hint">No hay ninguna combinación posible con estas materias.</p>}
            {result.conflicts.length > 0 && <div className="note"><b>Se superponen:</b> {result.conflicts.map(c => c.subject_ids.map(nameOf).join(' y ')).join('; ')}.</div>}
            {result.suggest_postpone.length > 0 && <div className="note"><b>Te conviene postergar:</b> {result.suggest_postpone.map(nameOf).join(', ')}.</div>}
            {result.not_enabled.length > 0 && <div className="note"><b>Todavía no las podés cursar:</b> {result.not_enabled.map(n => `${n.name} (te falta ${n.missing.map(x => nameOf(x.subject_id)).join(', ')})`).join('; ')}.</div>}
            {result.without_schedule.length > 0 && <div className="note">Sin horarios publicados: {result.without_schedule.map(nameOf).join(', ')}.</div>}
            {result.warnings.map((w, i) => <div key={i} className="note muted">{w}</div>)}
          </>}
        </section>
      </div>
    </div>
  )
}
