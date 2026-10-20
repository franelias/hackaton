import { useMemo, useState } from 'react'
import { api } from '../lib/api'
import { useSession } from '../lib/session'
import type { ScheduleResult, SchedulePreferences } from '../lib/types'

const DAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
const COLORS = ['#cfe3c2', '#d9e6f4', '#f8e3b8', '#f3d3e0', '#d8d3f0', '#cde9e4', '#efd9c3']
const minutes = (h: string) => { const [a, b] = h.split(':').map(Number); return a * 60 + b }
const HOUR = 44   // px per hour in the grid
const WEEKDAYS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo']

// The schedule tool writes its warnings in English for the model; these are the ones the student sees.
function warningText(w: string, nameOf: (id: number) => string, freeDays: number[]): string {
  let m: RegExpMatchArray | null
  if (/no combination keeps the requested free days/.test(w)) return `No encontramos horarios que te dejen libre el ${freeDays.map(d => WEEKDAYS[d - 1]).join(' ni el ')}: lo armamos sin ese día libre.`
  if ((m = w.match(/^subject (\d+) (has no \S+ schedule|only has its latest published schedule)/))) return `${nameOf(Number(m[1]))}: usamos el último horario publicado, puede estar desactualizado.`
  if ((m = w.match(/^subject (\d+) has classes without an end time; (\d+) minutes were assumed/))) return `${nameOf(Number(m[1]))}: algunas clases no tienen hora de fin; calculamos ${m[2]} minutos.`
  if ((m = w.match(/^subject (\d+): (\d+) classes without a commission label were ignored/))) return `${nameOf(Number(m[1]))}: dejamos afuera ${m[2]} clases sin comisión.`
  if ((m = w.match(/^day (\d+): (\d+) min between subject (\d+) \((.*), ends \S+\) and subject (\d+) \((.*), starts \S+\)/)))
    return `El ${WEEKDAYS[Number(m[1]) - 1]} tenés ${m[2]} minutos para ir de ${nameOf(Number(m[3]))} (${m[4]}) a ${nameOf(Number(m[5]))} (${m[6]}).`
  if (/the search was cut short/.test(w)) return 'Cortamos la búsqueda antes de terminar: puede haber mejores opciones.'
  if (/no subset of the subjects fits/.test(w)) return 'No entra ninguna combinación de estas materias en la semana.'
  return w
}

// the classes of a day go side by side when they overlap: each one takes the first free lane
function lanes<T extends { from: string; to: string }>(cs: T[]): (T & { lane: number; of: number })[] {
  const ends: number[] = []
  const placed = [...cs].sort((a, b) => minutes(a.from) - minutes(b.from)).map(c => {
    let lane = ends.findIndex(e => e <= minutes(c.from)); if (lane < 0) lane = ends.length
    ends[lane] = minutes(c.to); return { ...c, lane } })
  return placed.map(c => ({ ...c, of: ends.length }))
}

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
  // Saturday only when a picked subject has classes that day (in any of the options)
  const days = DAYS.slice(0, result?.options.some(o => o.commissions.some(c => c.classes.some(k => k.day === 6))) ? 6 : 5)
  const freeDaysIgnored = result?.warnings.some(w => /no combination keeps the requested free days/.test(w)) ?? false

  return (
    <div className="page wide">
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
            {freeDaysIgnored && <div className="note warn">{warningText('no combination keeps the requested free days', nameOf, freeDays)}</div>}
            {opt ? <div className="week-grid" style={{ '--days': days.length, '--hour': `${HOUR}px` } as React.CSSProperties}>
              <div className="week-head"><span />{days.map(d => <span key={d}>{d}</span>)}</div>
              <div className="week-body" style={{ height: hours.length * HOUR }}>
                <div className="hours">{hours.map(h => <span key={h}>{h}:00</span>)}</div>
                {days.map((d, i) => (
                  <div key={d} className="day-col">
                    {lanes(classes.filter(c => c.day === i + 1)).map((c, j) => (
                      <div key={j} className="class-block" style={{ top: (minutes(c.from) - from) / 60 * HOUR, height: (minutes(c.to) - minutes(c.from)) / 60 * HOUR,
                        left: `calc(${100 * c.lane / c.of}% + 3px)`, width: `calc(${100 / c.of}% - 6px)`, background: c.color }}>
                        <b>{c.name}</b><span>{c.from}–{c.to}{c.end_estimated ? ' (aprox.)' : ''}</span>{c.room && <span>{c.room}</span>}</div>))}
                  </div>))}
              </div>
            </div> : <p className="hint">No hay ninguna combinación posible con estas materias.</p>}
            {result.conflicts.length > 0 && <div className="note"><b>Se superponen:</b> {result.conflicts.map(c => c.subject_ids.map(nameOf).join(' y ')).join('; ')}.</div>}
            {result.suggest_postpone.length > 0 && <div className="note"><b>Te conviene postergar:</b> {result.suggest_postpone.map(nameOf).join(', ')}.</div>}
            {result.not_enabled.length > 0 && <div className="note"><b>Todavía no las podés cursar:</b> {result.not_enabled.map(n => `${n.name} (te falta ${n.missing.map(x => nameOf(x.subject_id)).join(', ')})`).join('; ')}.</div>}
            {result.without_schedule.length > 0 && <div className="note">Sin horarios publicados: {result.without_schedule.map(nameOf).join(', ')}.</div>}
            {result.warnings.filter(w => !/no combination keeps the requested free days/.test(w)).map((w, i) => <div key={i} className="note muted">{warningText(w, nameOf, freeDays)}</div>)}
          </>}
        </section>
      </div>
    </div>
  )
}
