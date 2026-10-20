import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { BookOpen, ChevronRight, Search } from 'lucide-react'
import { toast } from 'sonner'
import { useTreeChange, type TreeChange } from '../lib/mutations'
import { isSlot, useElectives } from '../lib/electives'
import { useSession } from '../lib/session'
import type { PlanSubject, SubjectState } from '../lib/types'
import { Page, PageError, PageHeader, PageLoading } from '@/components/Page'
import { SubjectBadge } from '@/components/StateBadge'
import SubjectCard from '@/components/SubjectCard'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'

const FILTERS: [SubjectState | 'all', string][] = [['all', 'Todas'], ['enrolled', 'Cursando'], ['available', 'La podés cursar'], ['regular', 'Regulares'], ['approved', 'Aprobadas'], ['locked', 'Todavía no']]
const SHORT: Record<SubjectState, string> = { approved: 'Aprobada', regular: 'Regular', enrolled: 'Cursando', available: 'La podés cursar', locked: 'Todavía no' }
// accents and case do not matter when searching: "analisis" finds "Análisis"
const fold = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()

export default function Subjects() {
  const { plan, tree, studentId, error } = useSession()
  const nav = useNavigate()
  const { subjectId } = useParams()
  const sel = subjectId ? Number(subjectId) : null
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<SubjectState | 'all'>('all')
  const treeChange = useTreeChange(studentId ?? '')
  const states = useMemo(() => new Map((tree?.subjects ?? []).map(s => [s.subject_id, s])), [tree])
  const stateOf = (id: number): SubjectState => states.get(id)?.state ?? 'locked'
  const byId = useMemo(() => new Map((plan?.subjects ?? []).map(s => [s.subject_id, s])), [plan])
  const electives = useElectives(studentId ?? '', plan)
  if (error && !tree) return <PageError message={error} />
  if (!plan || !tree || !studentId) return <PageLoading label="Cargando tus materias" />

  const OK: Record<TreeChange['kind'], string> = { checkin: '¡Listo! Tu árbol recibió agua.', mark: 'Guardado.', unmark: 'Listo, la desmarcamos.', exam: 'Anotamos la fecha del parcial.', fail: 'Anotamos el aplazo.', unfail: 'Borramos el aplazo.' }
  // one change can be several (an Optativa and its elective): one after the other, so the last tree has them all
  const run = async (cs: TreeChange[], ok: string) => { try { for (const c of cs) await treeChange.mutateAsync(c); toast.success(ok) } catch (e) { toast.error((e as Error).message) } }
  const apply = (c: TreeChange) => run(electives.expand(c), OK[c.kind])
  const open = (id: number | null) => nav(id == null ? '/subjects' : `/subjects/${id}`)

  const q = fold(query.trim())
  const count = (f: SubjectState | 'all') => plan.subjects.filter(s => f === 'all' || stateOf(s.subject_id) === f).length
  const shown = plan.subjects.filter(s => (filter === 'all' || stateOf(s.subject_id) === filter) && (!q || fold(s.name).includes(q) || fold(s.code).includes(q)))
  // by year and term as the plan lays them out; the optional ones at the end
  const groups = [...shown.reduce((g, s) => { const k = s.year ?? 0; return g.set(k, [...(g.get(k) ?? []), s]) }, new Map<number, PlanSubject[]>())]
    .sort(([a], [b]) => (a || 99) - (b || 99))
    .map(([year, list]) => [year, list.sort((a, b) => (a.term ?? 0) - (b.term ?? 0) || a.name.localeCompare(b.name))] as const)
  const m = sel != null ? byId.get(sel) : undefined

  return (
    <Page className="gap-5">
      <PageHeader title="Materias" description="Todas las materias de tu carrera. Entrá a cada una para ver sus correlativas y marcar si la estás cursando." />
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-6">
        {/* on the phone a chosen subject takes the whole screen; the list comes back with the arrow */}
        <div className={cn('flex min-w-0 flex-col gap-4', m && 'hidden lg:flex')}>
          <div className="flex flex-col gap-3">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input type="search" placeholder="Buscar por nombre o código" aria-label="Buscar materia" className="pl-9" value={query} onChange={e => setQuery(e.target.value)} />
            </div>
            <ToggleGroup type="single" variant="outline" size="sm" spacing={1} aria-label="Mostrar" className="flex-wrap justify-start" value={filter} onValueChange={v => { if (v) setFilter(v as SubjectState | 'all') }}>
              {FILTERS.map(([f, label]) => <ToggleGroupItem key={f} value={f}>{label}<span className="text-muted-foreground tabular-nums">{count(f)}</span></ToggleGroupItem>)}
            </ToggleGroup>
          </div>

          {groups.length === 0 && <Card className="items-center rounded-2xl px-5 py-10 text-center text-muted-foreground">No hay materias que coincidan.</Card>}
          {groups.map(([year, list]) => (
            <section key={year} className="flex flex-col gap-2">
              <h2 className="text-sm font-extrabold text-muted-foreground">{year ? `${year}.º año` : 'Optativas'}</h2>
              <Card className="gap-0 overflow-hidden rounded-2xl py-0">
                <ul className="divide-y">
                  {list.map(s => { const st = stateOf(s.subject_id)
                    return <li key={s.subject_id}>
                      <button type="button" onClick={() => open(s.subject_id)} aria-current={s.subject_id === sel ? 'true' : undefined}
                        className={cn('flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none', s.subject_id === sel && 'bg-muted')}>
                        <span className="flex min-w-0 flex-1 flex-col gap-1">
                          <span className="leading-snug font-bold">{s.name}{electives.pickOf(s.subject_id) && <span className="font-semibold text-muted-foreground">: {electives.pickOf(s.subject_id)!.name}</span>}</span>
                          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                            {s.code}{s.term ? ` · ${s.term}.º cuatrimestre` : ''}
                            {s.bottleneck && <Badge variant="outline" className="border-transparent bg-warning font-bold text-warning-foreground">Destraba {s.unlocks_total}</Badge>}
                          </span>
                        </span>
                        <SubjectBadge state={st} className="shrink-0">{SHORT[st]}</SubjectBadge>
                        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                      </button>
                    </li> })}
                </ul>
              </Card>
            </section>))}
        </div>

        <Card aria-live="polite" className={cn('gap-4 rounded-2xl px-5 py-5 lg:sticky lg:top-6', !m && 'hidden lg:flex')}>
          {m ? <SubjectCard key={m.subject_id} m={m} state={stateOf(m.subject_id)} dry={states.get(m.subject_id)?.dry ?? false} grade={states.get(m.subject_id)?.grade ?? null} fails={states.get(m.subject_id)?.fails?.length ?? 0} stateOf={stateOf} byId={byId} busy={treeChange.isPending}
              onChange={(state, grade) => apply({ kind: 'mark', subjectId: m.subject_id, state, grade })}
                onClear={() => apply({ kind: 'unmark', subjectId: m.subject_id })}
              onExamDate={date => apply({ kind: 'exam', subjectId: m.subject_id, date })}
                choice={isSlot(m) ? { options: electives.optionsFor(m.subject_id), picked: electives.pickOf(m.subject_id), onPick: e => run(electives.pick(m.subject_id, e, stateOf), 'Guardado.') } : undefined}
              onTutor={() => nav(`/tutor?subject=${electives.pickOf(m.subject_id)?.subject_id ?? m.subject_id}`)} onClose={() => open(null)} onSelect={open} back />
            : <div className="flex flex-col items-center gap-3 py-10 text-center">
                <span className="grid size-12 place-items-center rounded-full bg-accent text-accent-foreground"><BookOpen /></span>
                <p className="font-bold">Elegí una materia</p>
                <p className="text-sm text-muted-foreground">Vas a ver qué necesita, qué te destraba y podés marcar si la cursás.</p>
              </div>}
        </Card>
      </div>
    </Page>
  )
}
