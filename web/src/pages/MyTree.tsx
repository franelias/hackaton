import { lazy, Suspense, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CircleAlert, Droplets, Flame, X } from 'lucide-react'
import { toast } from 'sonner'
import TreeView from '../components/TreeView'
import { hasWebGL } from '../components/webgl'
import { useDismissAlert, useTreeChange, type TreeChange } from '../lib/mutations'
import { useSession } from '../lib/session'
import type { Alert as StudentAlert, PlanSubject, SubjectState } from '../lib/types'
import { Page, PageError, PageHeader, PageLoading } from '@/components/Page'
import { SubjectBadge } from '@/components/StateBadge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'

const STATE_LABEL: Record<SubjectState, string> = { approved: 'Aprobada', regular: 'Regular (debe el final)', enrolled: 'Cursando', available: 'La podés cursar', locked: 'Todavía no' }
const HEALTH_LABEL = { lush: 'frondoso', wilted: 'mustio', withered: 'seco' }
// the marks the tree draws for each state (see TreeView)
const LEGEND: [string, string][] = [
  ['bg-white shadow-[inset_0_0_0_3px_#f2c14e,0_0_0_1px_#7a5236]', 'Aprobada'], ['bg-[#f2c14e]', 'Regular'], ['bg-white shadow-[inset_0_0_0_2.5px_#5b84b1]', 'Cursando'],
  ['bg-[#c9e0b0] shadow-[0_0_0_1px_#6f9866]', 'La podés cursar'], ['bg-[#ead9c4] shadow-[0_0_0_1px_#b99c80]', 'Todavía no'], ['bg-white shadow-[0_0_0_2px_#c98a2b]', 'Destraba mucho'], ['bg-[#c9a06a] shadow-[0_0_0_1px_#8a7258]', 'Rama seca: tiene una alerta'],
]

// three.js is loaded only when the 3D view is shown
const TreeView3D = lazy(() => import('../components/TreeView3D'))
const VIEW_KEY = 'arbol.view'

const ago = (iso: string | null) => { if (!iso) return null; const d = Math.floor((Date.now() - new Date(iso).getTime()) / 864e5); return d <= 0 ? 'hoy' : d === 1 ? 'ayer' : `hace ${d} días` }

export default function MyTree() {
  const { plan, tree, alerts, studentId, user, error } = useSession()
  const nav = useNavigate()
  const [sel, setSel] = useState<number | null>(null)
  const [view, setView] = useState<'2d' | '3d'>(() => { try { const g = localStorage.getItem(VIEW_KEY); if (g === '2d' || g === '3d') return g } catch { /* no storage */ } return hasWebGL() ? '3d' : '2d' })
  const [allNames, setAllNames] = useState(false), [search, setSearch] = useState('')
  const changeView = (x: '2d' | '3d') => { setView(x); try { localStorage.setItem(VIEW_KEY, x) } catch { /* no storage */ } }
  // picking a subject from the list selects it, which highlights its prerequisite path
  const searchFor = (text: string) => { setSearch(text); const n = text.trim().toLowerCase(); const s = plan?.subjects.find(x => x.name.toLowerCase() === n); if (s) { setSel(s.subject_id); setSearch('') } }
  const treeChange = useTreeChange(studentId ?? ''), dismiss = useDismissAlert(studentId ?? '')
  const busy = treeChange.isPending
  const states = useMemo(() => new Map((tree?.subjects ?? []).map(s => [s.subject_id, s])), [tree])
  const stateOf = (id: number): SubjectState => states.get(id)?.state ?? 'locked'
  const byId = useMemo(() => new Map((plan?.subjects ?? []).map(s => [s.subject_id, s])), [plan])
  if (error && !tree) return <PageError message={error} />
  if (!plan || !tree || !studentId) return <PageLoading label="Cargando tu árbol" />

  const firstName = (user?.displayName ?? '').split(' ')[0]
  const health = tree.health.state
  const approvedCount = tree.subjects.filter(s => s.state === 'approved').length
  const total = plan.subjects.filter(s => !s.optional).length
  const enrolled = tree.subjects.filter(s => s.state === 'enrolled').map(s => byId.get(s.subject_id)!).filter(Boolean).sort((a, b) => b.unlocks_total - a.unlocks_total)
  const subtitle = health === 'lush' ? `Tu árbol está frondoso. Llevás ${approvedCount} de ${total} materias aprobadas.`
    : `Tu árbol está ${HEALTH_LABEL[health]}: tu última actividad fue ${ago(tree.health.last_activity)}. Lo que aprobaste sigue ahí.`

  const OK: Record<TreeChange['kind'], string> = { checkin: '¡Listo! Tu árbol recibió agua.', mark: 'Guardado.', exam: 'Anotamos la fecha del parcial.' }
  const apply = (c: TreeChange) => treeChange.mutate(c, { onSuccess: () => toast.success(OK[c.kind]), onError: e => toast.error(e.message) })
  const act = (a: StudentAlert) => { const t = a.action.type
    if (t === 'open_tutor') nav(`/tutor${a.action.subject_id ? `?subject=${a.action.subject_id}` : ''}`)
    else if (t === 'build_schedule') nav('/schedule')
    else if (t === 'contact_tutor') toast.success('Le avisamos a la tutoría de tu carrera. Te van a escribir al mail.')
    else toast('Las fechas de mesas todavía no están cargadas.') }
  const actionLabel: Record<StudentAlert['action']['type'], string> = { open_tutor: 'Practicar con el tutor', build_schedule: 'Armar horario', view_dates: 'Ver fechas', contact_tutor: 'Hablar con un tutor' }
  const streak = tree.streak.weeks

  const m = sel != null ? byId.get(sel) : null
  return (
    <Page className="max-w-[1600px] gap-5">
      <PageHeader title={`¡Buenas${firstName ? `, ${firstName}` : ''}!`} description={subtitle}>
        <div className="flex items-center gap-2.5 rounded-full border bg-card py-1.5 pr-4 pl-2">
          <span className="grid size-8 place-items-center rounded-full bg-[#fde3cf] text-[#d9682b] dark:bg-[#4a2c1a] dark:text-[#f5a46e]"><Flame className="size-4.5" /></span>
          <span className="leading-tight"><b className="block text-sm">{streak > 0 ? `${streak} ${streak === 1 ? 'semana' : 'semanas'}` : `Mejor: ${tree.streak.best}`}</b>
            <span className="text-xs text-muted-foreground">{streak > 0 ? 'de racha' : 'semanas de racha'}</span></span>
        </div>
        <Button size="lg" onClick={() => apply({ kind: 'checkin' })} disabled={busy}><Droplets data-icon="inline-start" />Estudié hoy</Button>
      </PageHeader>

      {/* the tree is the page; everything else lives in the side column */}
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_19rem] lg:gap-5">
        <Card className="relative gap-0 overflow-hidden rounded-3xl bg-[#eef0e4] py-0 ring-foreground/5">
          {view === '3d' ? <Suspense fallback={<div className="tree-3d loading">Preparando el árbol en 3D…</div>}><TreeView3D plan={plan} tree={tree} selected={sel} onSelect={setSel} allNames={allNames} /></Suspense>
            : <TreeView plan={plan} tree={tree} selected={sel} onSelect={setSel} />}
          {/* over the scene: 2D/3D, subject search and (3D) all names */}
          <div className="absolute top-4 left-4 z-10 flex flex-wrap items-center gap-2">
            <ToggleGroup type="single" variant="outline" size="sm" spacing={0} aria-label="Vista del árbol" className="bg-card/95" value={view} onValueChange={v => { if (v) changeView(v as '2d' | '3d') }}>
              <ToggleGroupItem value="2d">2D</ToggleGroupItem><ToggleGroupItem value="3d">3D</ToggleGroupItem>
            </ToggleGroup>
            <Input className="h-8 w-64 rounded-full bg-card/95" list="plan-subjects" value={search} onChange={e => searchFor(e.target.value)} placeholder="Buscar una materia…" aria-label="Buscar una materia" />
            <datalist id="plan-subjects">{plan.subjects.map(s => <option key={s.subject_id} value={s.name} />)}</datalist>
            {view === '3d' && <Label className="h-8 rounded-full border bg-card/95 px-3 text-sm"><Checkbox checked={allNames} onCheckedChange={v => setAllNames(v === true)} />Todos los nombres</Label>}
          </div>
        </Card>

        <aside className="flex flex-col gap-4 lg:sticky lg:top-6">
          {alerts.map(a => (
            <Alert key={a.id} role="status" className={cn('flex flex-col gap-3 rounded-2xl border-transparent px-4 py-3.5', a.level === 'high' ? 'bg-destructive/10' : 'bg-warning')}>
              <div className="flex gap-2.5">
                <CircleAlert className={cn('mt-0.5 size-4.5 shrink-0', a.level === 'high' ? 'text-destructive' : 'text-warning-foreground')} />
                <AlertDescription className="font-semibold text-pretty text-foreground">{a.message}</AlertDescription>
              </div>
              <div className="flex flex-wrap items-center gap-1 pl-7">
                <Button size="sm" onClick={() => act(a)}>{actionLabel[a.action.type]}</Button>
                <Button size="sm" variant="ghost" onClick={() => dismiss.mutate(a.id, { onError: e => toast.error(e.message) })}>Descartar</Button>
              </div>
            </Alert>))}

          <Card aria-live="polite" className="gap-4 rounded-2xl px-5 py-5">
            {m ? <SubjectCard key={m.subject_id} m={m} state={stateOf(m.subject_id)} dry={states.get(m.subject_id)?.dry ?? false} stateOf={stateOf} byId={byId} busy={busy}
                onChange={state => apply({ kind: 'mark', subjectId: m.subject_id, state })}
                onExamDate={date => apply({ kind: 'exam', subjectId: m.subject_id, date })}
                onTutor={() => nav(`/tutor?subject=${m.subject_id}`)} onClose={() => setSel(null)} />
              : <>
                  <h2 className="text-lg font-extrabold">Tu próximo paso</h2>
                  {enrolled[0] ? <><p className="text-pretty">Practicá un ejercicio de <b>{enrolled[0].name}</b>: destraba {enrolled[0].unlocks_total} materias.</p>
                    <Button className="w-full" onClick={() => nav(`/tutor?subject=${enrolled[0].subject_id}`)}>Practicar con el tutor</Button></>
                    : <p className="text-pretty">Marcá cuáles estás cursando para que te sugiramos qué practicar.</p>}
                  <p className="text-sm text-muted-foreground">Tocá cualquier materia del árbol para ver qué necesita y qué te destraba.</p>
                </>}
          </Card>

          <Card className="gap-3 rounded-2xl px-5 py-4">
            <h2 className="text-sm font-extrabold">Cómo leer el árbol</h2>
            <ul className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm font-semibold text-muted-foreground lg:grid-cols-1">
              {LEGEND.map(([dot, label]) => <li key={label} className="flex items-center gap-2"><i className={cn('inline-block size-3 shrink-0 rounded-full', dot)} />{label}</li>)}
            </ul>
          </Card>
        </aside>
      </div>
    </Page>
  )
}

function SubjectCard({ m, state, dry, stateOf, byId, busy, onChange, onExamDate, onTutor, onClose }: { m: PlanSubject; state: SubjectState; dry: boolean; stateOf: (id: number) => SubjectState; byId: Map<number, PlanSubject>; busy: boolean;
  onChange: (s: 'approved' | 'regular' | 'enrolled') => void; onExamDate: (date: string) => void; onTutor: () => void; onClose: () => void }) {
  const [date, setDate] = useState('')
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-1.5">
          <h2 className="text-lg leading-snug font-extrabold">{m.name}</h2>
          <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">{m.year ? `${m.year}.º año, ${m.term}.º cuatrimestre` : 'Optativa'}<SubjectBadge state={state}>{STATE_LABEL[state]}</SubjectBadge></p>
        </div>
        <Button variant="ghost" size="icon-sm" className="-mt-1 -mr-2" onClick={onClose} aria-label="Cerrar"><X /></Button>
      </div>
      {dry && state !== 'approved' && <p className="rounded-xl bg-destructive/10 px-3 py-2 text-sm font-bold text-destructive">Su rama se está secando: tenés una alerta abierta sobre esta materia. Practicala para que vuelva a crecer.</p>}
      {m.bottleneck && <p className="rounded-xl bg-warning px-3 py-2 text-sm font-bold text-warning-foreground">Destraba {m.unlocks_total} materias: conviene no atrasarla.</p>}

      <section className="flex flex-col gap-1">
        <h3 className="text-xs font-extrabold text-muted-foreground">Necesita</h3>
        <ul className="flex flex-col text-sm">{m.requires.length ? m.requires.map(r => (
          <li key={r.subject_id} className="flex items-baseline justify-between gap-3 py-1">{byId.get(r.subject_id)?.name}
            <span className="shrink-0 text-xs text-muted-foreground">{r.condition === 'regular' ? 'regular' : 'aprobada'}, {STATE_LABEL[stateOf(r.subject_id)].toLowerCase()}</span></li>))
          : <li className="py-1 text-muted-foreground">Nada, se cursa desde el principio</li>}</ul>
      </section>
      <section className="flex flex-col gap-1">
        <h3 className="text-xs font-extrabold text-muted-foreground">Destraba</h3>
        <ul className="flex flex-col text-sm">{m.unlocks.length ? m.unlocks.map(u => <li key={u} className="py-1">{byId.get(u)?.name}</li>)
          : <li className="py-1 text-muted-foreground">Es de las últimas de la carrera</li>}</ul>
      </section>

      <div className="flex flex-col gap-3 border-t pt-4">
        <Button className="w-full" onClick={onTutor}>Practicar con el tutor</Button>
        <div className="flex flex-col gap-2">
          <span className="text-sm font-bold">Marcar como</span>
          <ToggleGroup type="single" variant="outline" size="sm" spacing={1} aria-label="Marcar como" value={['enrolled', 'regular', 'approved'].includes(state) ? state : ''}
            onValueChange={v => { if (v) onChange(v as 'approved' | 'regular' | 'enrolled') }} disabled={busy}>
            <ToggleGroupItem value="enrolled">La curso</ToggleGroupItem><ToggleGroupItem value="regular">Regular</ToggleGroupItem><ToggleGroupItem value="approved">Aprobada</ToggleGroupItem>
          </ToggleGroup>
        </div>
        {state === 'enrolled' && <form className="flex items-end gap-2" onSubmit={e => { e.preventDefault(); if (date) onExamDate(date) }}>
          <div className="flex flex-1 flex-col gap-2"><Label htmlFor="exam-date">Fecha del parcial</Label><Input id="exam-date" type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
          <Button variant="outline" className="h-10" disabled={!date || busy}>Anotar</Button></form>}
      </div>
    </div>
  )
}
