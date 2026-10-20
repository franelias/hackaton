import { lazy, Suspense, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CircleAlert, Droplets, Flame } from 'lucide-react'
import { toast } from 'sonner'
import TreeView, { BOTTLENECK, DRY_BRANCH, PILL, mark } from '../components/TreeView'
import { hasWebGL } from '../components/webgl'
import { useDismissAlert, useTreeChange, type TreeChange } from '../lib/mutations'
import { isSlot, useElectives } from '../lib/electives'
import { useSession } from '../lib/session'
import type { Alert as StudentAlert, SubjectState } from '../lib/types'
import { Page, PageError, PageHeader, PageLoading } from '@/components/Page'
import SubjectCard from '@/components/SubjectCard'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'

const HEALTH_LABEL = { lush: 'frondoso', wilted: 'mustio', withered: 'seco' }
// the legend draws the same mark and name tag the tree uses for each state (see TreeView)
const LEGEND: [SubjectState, string][] = [['approved', 'Aprobada'], ['regular', 'Regular'], ['enrolled', 'Cursando'], ['available', 'La podés cursar'], ['locked', 'Todavía no']]

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
  const treeChange = useTreeChange(studentId ?? ''), dismiss = useDismissAlert(studentId ?? '')
  const busy = treeChange.isPending
  const states = useMemo(() => new Map((tree?.subjects ?? []).map(s => [s.subject_id, s])), [tree])
  const stateOf = (id: number): SubjectState => states.get(id)?.state ?? 'locked'
  const byId = useMemo(() => new Map((plan?.subjects ?? []).map(s => [s.subject_id, s])), [plan])
  const electives = useElectives(studentId ?? '', plan)
  if (error && !tree) return <PageError message={error} />
  if (!plan || !tree || !studentId) return <PageLoading label="Cargando tu árbol" />
  const treePlan = electives.treePlan ?? plan
  // picking a subject from the list selects it, which highlights its prerequisite path
  const searchFor = (text: string) => { setSearch(text); const n = text.trim().toLowerCase(); const s = treePlan.subjects.find(x => x.name.toLowerCase() === n); if (s) { setSel(s.subject_id); setSearch('') } }

  const firstName = (user?.displayName ?? '').split(' ')[0]
  const health = tree.health.state
  const approvedCount = tree.subjects.filter(s => s.state === 'approved').length
  const total = plan.subjects.filter(s => !s.optional).length
  const enrolled = tree.subjects.filter(s => s.state === 'enrolled').map(s => byId.get(s.subject_id)!).filter(Boolean).sort((a, b) => b.unlocks_total - a.unlocks_total)
  const subtitle = health === 'lush' ? `Tu árbol está frondoso. Llevás ${approvedCount} de ${total} materias aprobadas.`
    : `Tu árbol está ${HEALTH_LABEL[health]}: tu última actividad fue ${ago(tree.health.last_activity)}. Lo que aprobaste sigue ahí.`

  const OK: Record<TreeChange['kind'], string> = { checkin: '¡Listo! Tu árbol recibió agua.', mark: 'Guardado.', unmark: 'Listo, la desmarcamos.', exam: 'Anotamos la fecha del parcial.', fail: 'Anotamos el aplazo.', unfail: 'Borramos el aplazo.' }
  // one change can be several (an Optativa and its elective): one after the other, so the last tree has them all
  const run = async (cs: TreeChange[], ok: string) => { try { for (const c of cs) await treeChange.mutateAsync(c); toast.success(ok) } catch (e) { toast.error((e as Error).message) } }
  const apply = (c: TreeChange) => run(electives.expand(c), OK[c.kind])
  const act = (a: StudentAlert) => { const t = a.action.type
    if (t === 'open_tutor') nav(`/tutor${a.action.subject_id ? `?subject=${a.action.subject_id}` : ''}`)
    else if (t === 'build_schedule') nav('/schedule')
    else if (t === 'contact_tutor') toast.success('Le avisamos a la tutoría de tu carrera. Te van a escribir al mail.')
    else toast('Las fechas de mesas todavía no están cargadas.') }
  const actionLabel: Record<StudentAlert['action']['type'], string> = { open_tutor: 'Practicar con el tutor', build_schedule: 'Armar horario', view_dates: 'Ver fechas', contact_tutor: 'Hablar con un tutor' }
  const streak = tree.streak.weeks
  const counts = (electives.treePlan ?? plan).subjects.filter(x => !x.optional || ['approved', 'regular', 'enrolled'].includes(stateOf(x.subject_id))).reduce((c, x) => c.set(stateOf(x.subject_id), (c.get(stateOf(x.subject_id)) ?? 0) + 1), new Map<SubjectState, number>())

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
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_17rem] xl:gap-5">
        <Card className="tree-enter relative gap-0 overflow-hidden rounded-3xl bg-[#eef0e4] py-0 ring-foreground/5">
          {view === '3d' ? <Suspense fallback={<div className="tree-3d loading">Preparando el árbol en 3D…</div>}><TreeView3D plan={treePlan} tree={tree} selected={sel} onSelect={setSel} allNames={allNames} /></Suspense>
            : <TreeView plan={treePlan} tree={tree} selected={sel} onSelect={setSel} />}
          {/* over the scene: 2D/3D, subject search and (3D) all names */}
          <div className="absolute top-4 left-4 z-10 flex flex-wrap items-center gap-2">
            <ToggleGroup type="single" variant="outline" size="sm" spacing={0} aria-label="Vista del árbol" className="bg-card/95" value={view} onValueChange={v => { if (v) changeView(v as '2d' | '3d') }}>
              <ToggleGroupItem value="2d">2D</ToggleGroupItem><ToggleGroupItem value="3d">3D</ToggleGroupItem>
            </ToggleGroup>
            <Input className="h-8 w-64 rounded-full bg-card/95" list="plan-subjects" value={search} onChange={e => searchFor(e.target.value)} placeholder="Buscar una materia…" aria-label="Buscar una materia" />
            <datalist id="plan-subjects">{treePlan.subjects.map(s => <option key={s.subject_id} value={s.name} />)}</datalist>
            {view === '3d' && <Label className="h-8 rounded-full border bg-card/95 px-3 text-sm"><Checkbox checked={allNames} onCheckedChange={v => setAllNames(v === true)} />Todos los nombres</Label>}
          </div>
        </Card>

        <aside className="side-enter grid items-start gap-4 md:grid-cols-2 xl:sticky xl:top-6 xl:flex xl:flex-col">
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
            {m ? <SubjectCard key={m.subject_id} m={m} state={stateOf(m.subject_id)} dry={states.get(m.subject_id)?.dry ?? false} grade={states.get(m.subject_id)?.grade ?? null} fails={states.get(m.subject_id)?.fails?.length ?? 0} stateOf={stateOf} byId={byId} busy={busy}
                onChange={(state, grade) => apply({ kind: 'mark', subjectId: m.subject_id, state, grade })}
                onClear={() => apply({ kind: 'unmark', subjectId: m.subject_id })}
                onExamDate={date => apply({ kind: 'exam', subjectId: m.subject_id, date })}
                choice={isSlot(m) ? { options: electives.optionsFor(m.subject_id), picked: electives.pickOf(m.subject_id), onPick: e => run(electives.pick(m.subject_id, e, stateOf), 'Guardado.') } : undefined}
                onTutor={() => nav(`/tutor?subject=${electives.pickOf(m.subject_id)?.subject_id ?? m.subject_id}`)} onClose={() => setSel(null)} />
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
            <ul className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm font-semibold text-muted-foreground xl:grid-cols-1">
              {LEGEND.map(([st, label]) => { const [fill, border, text] = PILL[st]
                return <li key={st} className="flex items-center gap-2">
                  <Swatch svg={mark(st, 12, 14)} />
                  <span className={cn('rounded-full border-[1.5px] px-2.5 py-0.5 text-xs font-bold', st === 'locked' && 'border-dashed')} style={{ background: fill, borderColor: border, color: text }}>{label}</span>
                  <span className="ml-auto tabular-nums">{counts.get(st) ?? 0}</span>
                </li> })}
              <li className="flex items-center gap-2"><span className="w-6" /><span className="rounded-full border-2 bg-white px-2.5 py-0.5 text-xs font-bold text-[#3d4a37]" style={{ borderColor: BOTTLENECK }}>Destraba mucho</span></li>
              <li className="flex items-center gap-2"><Swatch svg={DRY_BRANCH} />Rama seca: tiene una alerta</li>
            </ul>
          </Card>
        </aside>
      </div>
    </Page>
  )
}

const Swatch = ({ svg }: { svg: string }) => <svg viewBox="0 0 24 24" className="size-6 shrink-0" aria-hidden dangerouslySetInnerHTML={{ __html: svg }} />

