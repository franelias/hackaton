import { lazy, Suspense, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import TreeView from '../components/TreeView'
import { hasWebGL } from '../components/webgl'
import { api } from '../lib/api'
import { queryClient } from '../lib/queries'
import { useSession } from '../lib/session'
import type { Alert, Plan, PlanSubject, SubjectState, Tree } from '../lib/types'

// three.js is loaded only when the 3D view is shown
const TreeView3D = lazy(() => import('../components/TreeView3D'))
const VIEW_KEY = 'arbol.view'

const STATE_LABEL: Record<SubjectState, string> = { approved: 'Aprobada', regular: 'Regular (debe el final)', enrolled: 'Cursando', available: 'La podés cursar', locked: 'Todavía no' }
const HEALTH_LABEL = { lush: 'frondoso', wilted: 'mustio', withered: 'seco' }

const ago = (iso: string | null) => { if (!iso) return null; const d = Math.floor((Date.now() - new Date(iso).getTime()) / 864e5); return d <= 0 ? 'hoy' : d === 1 ? 'ayer' : `hace ${d} días` }

export default function MyTree() {
  const { plan, tree, alerts, studentId, user, setTree, refresh, error } = useSession()
  const nav = useNavigate()
  const [sel, setSel] = useState<number | null>(null)
  const [view, setView] = useState<'2d' | '3d'>(() => { try { const g = localStorage.getItem(VIEW_KEY); if (g === '2d' || g === '3d') return g } catch { /* no storage */ } return hasWebGL() ? '3d' : '2d' })
  const [allNames, setAllNames] = useState(false), [search, setSearch] = useState('')
  const searchFor = (text: string) => { setSearch(text); const n = text.trim().toLowerCase(); const m = plan?.subjects.find(s => s.name.toLowerCase() === n); if (m) { setSel(m.subject_id); setSearch('') } }
  const changeView = (x: '2d' | '3d') => { setView(x); try { localStorage.setItem(VIEW_KEY, x) } catch { /* no storage */ } }
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const states = useMemo(() => new Map((tree?.subjects ?? []).map(s => [s.subject_id, s])), [tree])
  const stateOf = (id: number): SubjectState => states.get(id)?.state ?? 'locked'
  const byId = useMemo(() => new Map((plan?.subjects ?? []).map(s => [s.subject_id, s])), [plan])
  if (error && !tree) return <div className="centered error">{error}<br /><button className="btn secondary" onClick={() => location.reload()}>Reintentar</button></div>
  if (!plan || !tree || !studentId) return <div className="centered">Cargando tu árbol…</div>

  const firstName = (user?.displayName ?? '').split(' ')[0]
  const health = tree.health.state
  const approvedCount = tree.subjects.filter(s => s.state === 'approved').length
  const total = plan.subjects.filter(s => !s.optional).length
  const enrolled = tree.subjects.filter(s => s.state === 'enrolled').map(s => byId.get(s.subject_id)!).filter(Boolean).sort((a, b) => b.unlocks_total - a.unlocks_total)
  const subtitle = health === 'lush' ? `Tu árbol está frondoso. Llevás ${approvedCount} de ${total} materias aprobadas.`
    : `Tu árbol está ${HEALTH_LABEL[health]}: tu última actividad fue ${ago(tree.health.last_activity)}. Lo que aprobaste sigue ahí.`

  // the API already returned the new tree; only the alerts may have changed
  const refreshAlerts = () => { queryClient.invalidateQueries({ queryKey: ['alerts'] }) }
  const run = async (f: () => Promise<unknown>, ok?: string) => { setBusy(true); setNotice(null)
    try { await f(); if (ok) setNotice(ok) } catch (e) { setNotice((e as Error).message) } finally { setBusy(false) } }
  const checkIn = () => run(async () => { setTree(await api.activity(studentId, { type: 'checkin' })); refreshAlerts() }, '¡Listo! Tu árbol recibió agua.')
  const act = (a: Alert) => { const t = a.action.type
    if (t === 'open_tutor') nav(`/tutor${a.action.subject_id ? `?subject=${a.action.subject_id}` : ''}`)
    else if (t === 'build_schedule') nav('/schedule')
    else if (t === 'contact_tutor') setNotice('Le avisamos a la tutoría de tu carrera. Te van a escribir al mail.')
    else setNotice('Las fechas de mesas todavía no están cargadas.') }
  const actionLabel: Record<Alert['action']['type'], string> = { open_tutor: 'Practicar con el tutor', build_schedule: 'Armar horario', view_dates: 'Ver fechas', contact_tutor: 'Hablar con un tutor' }

  const m = sel != null ? byId.get(sel) : null
  return (
    <div className="page tree-page">
      <header className="greeting">
        <div><h1>¡Buenas{firstName ? `, ${firstName}` : ''}!</h1><p>{subtitle}</p></div>
        <div className="stat"><svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2C14 7 19 9 19 15A7 7 0 0 1 5 15C5 11 8 9 8 6C10 8 10 10 11 11C12 8 11 5 12 2Z" fill="#f08a3c" /></svg>
          <div><b>{tree.streak.weeks > 0 ? `${tree.streak.weeks} ${tree.streak.weeks === 1 ? 'semana' : 'semanas'}` : `Mejor: ${tree.streak.best}`}</b><span>{tree.streak.weeks > 0 ? 'de racha' : 'semanas de racha'}</span></div></div>
        <button className="btn" onClick={checkIn} disabled={busy}>Estudié hoy</button>
      </header>

      {alerts.map(a => (
        <div key={a.id} className={`alert ${a.level}`} role="status">
          <p>{a.message}</p>
          <button className="btn small" onClick={() => act(a)}>{actionLabel[a.action.type]}</button>
          <button className="link" onClick={() => run(async () => { await api.dismissAlert(studentId, a.id); await refresh() })}>Descartar</button>
        </div>))}
      {notice && <p className="notice" role="status">{notice}</p>}

      <div className="tree-and-panel">
        <div className="tree-scene">
          {view === '3d' ? <Suspense fallback={<div className="tree-3d loading">Preparando el árbol en 3D…</div>}><TreeView3D plan={plan} tree={tree} selected={sel} onSelect={setSel} allNames={allNames} /></Suspense>
            : <TreeView plan={plan} tree={tree} selected={sel} onSelect={setSel} />}
          <div className="scene-toolbar">
            <div className="view-toggle segmented" role="group" aria-label="Vista del árbol">{(['2d', '3d'] as const).map(x => <button key={x} className={view === x ? 'on' : ''} onClick={() => changeView(x)}>{x.toUpperCase()}</button>)}</div>
            <input className="subject-search" list="plan-subjects" value={search} onChange={e => searchFor(e.target.value)} placeholder="Buscar una materia…" aria-label="Buscar una materia" />
            <datalist id="plan-subjects">{plan.subjects.map(s => <option key={s.subject_id} value={s.name} />)}</datalist>
            {view === '3d' && <label className="all-names"><input type="checkbox" checked={allNames} onChange={e => setAllNames(e.target.checked)} />Todos los nombres</label>}
          </div>
          <div className="legend">
            <span><i className="flower" />Aprobada</span><span><i className="regular" />Regular</span><span><i className="enrolled" />Cursando</span>
            <span><i className="available" />La podés cursar</span><span><i className="locked" />Todavía no</span><span><i className="bottleneck" />Destraba mucho</span>
          </div>
        </div>
          <aside className="panel" aria-live="polite">
            {m ? <SubjectCard m={m} state={stateOf(m.subject_id)} stateOf={stateOf} byId={byId} busy={busy}
                onChange={s => run(async () => { setTree(await api.setSubject(studentId, m.subject_id, s)); refreshAlerts() }, 'Guardado.')}
                onExamDate={date => run(async () => { setTree(await api.activity(studentId, { type: 'exam', subject_id: m.subject_id, date })); refreshAlerts() }, 'Anotamos la fecha del parcial.')}
                onTutor={() => nav(`/tutor?subject=${m.subject_id}`)} onClose={() => setSel(null)} />
              : <div>
                  <h2>Tu próximo paso</h2>
                  {enrolled[0] ? <><p>Practicá un ejercicio de <b>{enrolled[0].name}</b>: destraba {enrolled[0].unlocks_total} materias.</p>
                    <button className="btn full" onClick={() => nav(`/tutor?subject=${enrolled[0].subject_id}`)}>Practicar con el tutor</button></>
                    : <p>Tocá una materia del árbol para ver qué necesita y qué te destraba, o marcá cuáles estás cursando.</p>}
                  <p className="hint">Tocá cualquier materia para ver su camino de correlativas.</p>
                </div>}
          </aside>
      </div>
      <Summary plan={plan} tree={tree} onPractice={id => nav(`/tutor?subject=${id}`)} />
    </div>
  )
}

function SubjectCard({ m, state, stateOf, byId, busy, onChange, onExamDate, onTutor, onClose }: { m: PlanSubject; state: SubjectState; stateOf: (id: number) => SubjectState; byId: Map<number, PlanSubject>; busy: boolean;
  onChange: (s: 'approved' | 'regular' | 'enrolled') => void; onExamDate: (date: string) => void; onTutor: () => void; onClose: () => void }) {
  const [date, setDate] = useState('')
  return (
    <div className="subject-card">
      <button className="close" onClick={onClose} aria-label="Cerrar">×</button>
      <h2>{m.name}</h2>
      <p className="meta">{m.year ? `${m.year}.º año, ${m.term}.º cuatrimestre` : 'Optativa'} · <span className={`chip ${state}`}>{STATE_LABEL[state]}</span></p>
      {m.bottleneck && <p className="bottleneck">Destraba {m.unlocks_total} materias: conviene no atrasarla.</p>}
      <h3>Necesita</h3>
      <ul>{m.requires.length ? m.requires.map(r => <li key={r.subject_id}>{byId.get(r.subject_id)?.name}<span>{r.condition === 'regular' ? 'regular' : 'aprobada'} · {STATE_LABEL[stateOf(r.subject_id)].toLowerCase()}</span></li>) : <li>Nada, se cursa desde el principio</li>}</ul>
      <h3>Destraba</h3>
      <ul>{m.unlocks.length ? m.unlocks.map(u => <li key={u}>{byId.get(u)?.name}</li>) : <li>Es de las últimas de la carrera</li>}</ul>
      <div className="actions">
        <button className="btn full" onClick={onTutor}>Practicar con el tutor</button>
        <div className="segmented" role="group" aria-label="Marcar como">
          {(['enrolled', 'regular', 'approved'] as const).map(s => <button key={s} disabled={busy} className={state === s ? 'on' : ''} onClick={() => onChange(s)}>{{ enrolled: 'La curso', regular: 'Regular', approved: 'Aprobada' }[s]}</button>)}
        </div>
        {(state === 'enrolled') && <form className="row" onSubmit={e => { e.preventDefault(); if (date) onExamDate(date) }}>
          <label>Fecha del parcial<input type="date" value={date} onChange={e => setDate(e.target.value)} /></label><button className="btn small secondary" disabled={!date || busy}>Anotar</button></form>}
      </div>
    </div>
  )
}

// Under the tree: three cards computed from the plan and the student's tree (no new endpoints).
function Summary({ plan, tree, onPractice }: { plan: Plan; tree: Tree; onPractice: (id: number) => void }) {
  const info = new Map(tree.subjects.map(s => [s.subject_id, s]))
  const done = (id: number) => info.get(id)?.state === 'approved'
  const core = plan.subjects.filter(s => !s.optional && s.year)
  const years = [...new Set(core.map(s => s.year!))].sort((a, b) => a - b)
  // minimum terms left: the longest prerequisite chain among what is not approved
  const memo = new Map<number, number>(), byId = new Map(plan.subjects.map(s => [s.subject_id, s]))
  const chain = (id: number): number => { if (done(id)) return 0; if (memo.has(id)) return memo.get(id)!
    const s = byId.get(id); const l = 1 + Math.max(0, ...(s?.requires ?? []).map(r => chain(r.subject_id))); memo.set(id, l); return l }
  const termsLeft = Math.max(0, ...core.map(s => chain(s.subject_id)))
  const enrolled = tree.subjects.filter(s => s.state === 'enrolled').map(s => ({ s, p: byId.get(s.subject_id)! })).filter(x => x.p)
  const unlocking = core.filter(s => !done(s.subject_id)).sort((a, b) => b.unlocks_total - a.unlocks_total).slice(0, 4)
  const maxUnlocks = unlocking[0]?.unlocks_total || 1
  return (
    <div className="summary">
      <section className="card">
        <h2>Tu avance</h2>
        {years.map(y => { const inYear = core.filter(s => s.year === y), ok = inYear.filter(s => done(s.subject_id)).length
          return <div key={y} className="bar-row"><span>{y}.º año</span><div className="bar"><i style={{ width: `${100 * ok / inYear.length}%` }} /></div><b className="num">{ok}/{inYear.length}</b></div> })}
        <p className="hint">{termsLeft ? `Por correlativas, te faltan al menos ${termsLeft} cuatrimestres para terminar.` : '¡Terminaste todas las materias del plan!'}</p>
      </section>
      <section className="card">
        <h2>Cursando ahora</h2>
        {enrolled.length === 0 && <p className="hint">Marcá en el árbol las materias que estás cursando.</p>}
        {enrolled.map(({ s, p }) => (
          <div key={s.subject_id} className="enrolled-row">
            <div><b>{p.name}</b><span>{s.leaves} {s.leaves === 1 ? 'ejercicio practicado' : 'ejercicios practicados'}{s.flower ? ' · lista para rendir' : ''}{s.dry ? ' · se está secando' : ''}</span></div>
            <button className="btn small secondary" onClick={() => onPractice(s.subject_id)}>Practicar</button>
          </div>))}
      </section>
      <section className="card">
        <h2>Lo que más destraba</h2>
        {unlocking.map(s => <div key={s.subject_id} className="bar-row wide"><span>{s.name}</span><div className="bar"><i style={{ width: `${100 * s.unlocks_total / maxUnlocks}%` }} /></div><b className="num">{s.unlocks_total}</b></div>)}
        <p className="hint">Cantidad de materias que dependen de cada una. Conviene no atrasarlas.</p>
      </section>
    </div>
  )
}
