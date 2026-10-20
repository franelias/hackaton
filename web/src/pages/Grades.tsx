import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Download, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useTreeChange, type TreeChange } from '../lib/mutations'
import { useElectives } from '../lib/electives'
import { formatGrade, summarize, validGrade } from '../lib/grades'
import { printAsPdf } from '../lib/print'
import { useSession } from '../lib/session'
import type { SubjectState } from '../lib/types'
import { Page, PageError, PageHeader, PageLoading } from '@/components/Page'
import { SubjectStateSelect } from '@/components/StateBadge'
import GradeInput from '@/components/GradeInput'
import GradesReport from '@/components/GradesReport'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

const SHORT: Record<SubjectState, string> = { approved: 'Aprobada', regular: 'Regular', enrolled: 'Cursando', available: 'La podés cursar', locked: 'Todavía no' }

function Stat({ label, value, children }: { label: string; value: ReactNode; children?: ReactNode }) {
  return (
    <Card className="gap-1.5 rounded-2xl px-5 py-4">
      <span className="text-xs font-extrabold text-muted-foreground">{label}</span>
      <span className="text-3xl leading-none font-extrabold tabular-nums">{value}</span>
      {children && <span className="text-sm text-muted-foreground">{children}</span>}
    </Card>
  )
}

export default function Grades() {
  const { plan, tree, studentId, user, error } = useSession()
  const treeChange = useTreeChange(studentId ?? '')
  const electives = useElectives(studentId ?? '', plan)
  const [failSubject, setFailSubject] = useState('')
  const [failGrade, setFailGrade] = useState('')
  const states = useMemo(() => new Map((tree?.subjects ?? []).map(s => [s.subject_id, s])), [tree])
  const view = electives.treePlan ?? plan
  const names = useMemo(() => new Map([...(plan?.subjects ?? []), ...(view?.subjects ?? [])].map(s => [s.subject_id, s.name])), [plan, view])
  if (error && !tree) return <PageError message={error} />
  if (!plan || !view || !tree || !studentId) return <PageLoading label="Cargando tus notas" />

  const stateOf = (id: number): SubjectState => states.get(id)?.state ?? 'locked'
  const r = summarize(view, tree)
  const busy = treeChange.isPending
  const run = async (cs: TreeChange[], ok: string) => { try { for (const c of cs) await treeChange.mutateAsync(c); toast.success(ok) } catch (e) { toast.error((e as Error).message) } }
  const setGrade = (subjectId: number, grade: number) => run(electives.expand({ kind: 'mark', subjectId, state: 'approved', grade }), 'Guardamos la nota.')
  const mark = (c: TreeChange) => run(electives.expand(c), c.kind === 'unmark' ? 'Listo, la desmarcamos.' : 'Guardado.')
  // an aplazo is only possible in a subject whose final you can take or already passed
  const failable = view.subjects.filter(s => stateOf(s.subject_id) === 'regular' || stateOf(s.subject_id) === 'approved')
  const addFail = () => {
    const g = Number(failGrade)
    if (!failSubject || !validGrade(g)) return
    run([{ kind: 'fail', subjectId: Number(failSubject), grade: g }], 'Anotamos el aplazo.').then(() => setFailGrade(''))
  }

  return (
    <>
    <GradesReport summary={r} student={user?.displayName || user?.email || 'Mi libreta'} career={plan.name} states={states} />
    <Page className="gap-5 print:hidden">
      <PageHeader title="Notas" description="Tu libreta: la nota de cada final, tus promedios y cuánto te falta para recibirte.">
        <Button variant="outline" onClick={() => printAsPdf('Mi libreta')}><Download data-icon="inline-start" />Descargar PDF</Button>
      </PageHeader>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Promedio" value={formatGrade(r.average)}>Con aplazos: <b className="text-foreground tabular-nums">{formatGrade(r.withFails)}</b></Stat>
        <Stat label="Avance" value={`${Math.round(r.done * 100)} %`}>
          <Progress value={r.done * 100} className="my-1.5" aria-label="Materias aprobadas" />
          {r.approved} de {r.total} materias
        </Stat>
        <Stat label="Te faltan" value={r.remaining}>{r.remaining === 1 ? 'materia' : 'materias'} para recibirte</Stat>
        <Stat label="Promedio máximo" value={formatGrade(r.remaining ? r.ifAll(10) : r.average)}>
          Con aplazos: <b className="text-foreground tabular-nums">{formatGrade(r.remaining ? r.ifAll(10, true) : r.withFails)}</b>
          <br />{r.remaining ? <>Sacando 10 en todas. Con 9: <b className="text-foreground tabular-nums">{formatGrade(r.ifAll(9))}</b></> : 'Ya no te quedan finales'}
        </Stat>
      </div>
      {r.ungraded > 0 && <p className="rounded-xl bg-warning px-4 py-2.5 text-sm font-bold text-warning-foreground">
        {r.ungraded === 1 ? 'Una materia aprobada no tiene nota' : `${r.ungraded} materias aprobadas no tienen nota`}: cargala para que cuente en el promedio.</p>}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-6">
        <div className="flex min-w-0 flex-col gap-4">
          {r.years.map(y => (
            <section key={y.year} className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="text-sm font-extrabold text-muted-foreground">{y.year ? `${y.year}.º año` : 'Sin año'}</h2>
                <span className="text-xs text-muted-foreground tabular-nums">{y.approved} de {y.subjects.length} aprobadas · promedio <b className="text-foreground">{formatGrade(y.average)}</b></span>
              </div>
              <Card className="gap-0 overflow-hidden rounded-2xl py-0">
                <ul className="divide-y">
                  {y.subjects.map(s => { const st = stateOf(s.subject_id)
                    return <li key={s.subject_id} className="flex items-center gap-3 px-4 py-2.5">
                      <Link to={`/subjects/${s.subject_id}`} className="min-w-0 flex-1 leading-snug font-bold underline-offset-2 hover:underline">{s.name}</Link>
                      {(states.get(s.subject_id)?.fails?.length ?? 0) > 0 && <span className="shrink-0 text-xs text-muted-foreground tabular-nums" title="Aplazos">
                        {states.get(s.subject_id)!.fails!.length} {states.get(s.subject_id)!.fails!.length === 1 ? 'aplazo' : 'aplazos'}</span>}
                      <SubjectStateSelect state={st} className="shrink-0" disabled={busy} aria-label={`Estado de ${s.name}`}
                        onMark={state => mark({ kind: 'mark', subjectId: s.subject_id, state })} onClear={() => mark({ kind: 'unmark', subjectId: s.subject_id })}>{SHORT[st]}</SubjectStateSelect>
                      {st === 'approved'
                        ? <GradeInput value={states.get(s.subject_id)?.grade ?? null} onSave={g => setGrade(s.subject_id, g)} disabled={busy} aria-label={`Nota de ${s.name}`} />
                        : <span className="w-16 shrink-0" aria-hidden="true" />}
                    </li> })}
                </ul>
              </Card>
            </section>))}
        </div>

        <Card className="gap-4 rounded-2xl px-5 py-5 lg:sticky lg:top-6">
          <div className="flex flex-col gap-1">
            <h2 className="font-extrabold">Aplazos</h2>
            <p className="text-sm text-muted-foreground">Los finales que no aprobaste. Cuentan en el promedio con aplazos.</p>
          </div>
          <ul className="flex flex-col text-sm">
            {r.fails.length ? r.fails.map(f => (
              <li key={f.id} className="flex items-center gap-2 py-1">
                <span className="min-w-0 flex-1 truncate">{names.get(f.subject_id)}</span>
                <b className="tabular-nums">{f.grade}</b>
                <Button variant="ghost" size="icon-sm" className="-mr-2 text-muted-foreground" onClick={() => run([{ kind: 'unfail', failId: f.id }], 'Borramos el aplazo.')} disabled={busy} aria-label={`Borrar aplazo de ${names.get(f.subject_id)}`}><Trash2 /></Button>
              </li>))
              : <li className="py-1 text-muted-foreground">No cargaste aplazos.</li>}
          </ul>
          <form className="flex flex-col gap-3 border-t pt-4" onSubmit={e => { e.preventDefault(); addFail() }}>
            <div className="flex flex-col gap-2">
              <Label htmlFor="fail-subject">Materia</Label>
              <Select value={failSubject} onValueChange={setFailSubject} disabled={busy || !failable.length}>
                <SelectTrigger id="fail-subject" className="w-full"><SelectValue placeholder={failable.length ? 'Elegí una materia' : 'Ninguna regular o aprobada'} /></SelectTrigger>
                <SelectContent>{failable.map(s => <SelectItem key={s.subject_id} value={String(s.subject_id)}>{s.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="flex items-end gap-2">
              <div className="flex flex-1 flex-col gap-2">
                <Label htmlFor="fail-grade">Nota</Label>
                <Input id="fail-grade" type="number" inputMode="numeric" min={1} max={10} step={1} value={failGrade} onChange={e => setFailGrade(e.target.value)} />
              </div>
              <Button variant="outline" className="h-10" disabled={busy || !failSubject || !validGrade(Number(failGrade))}>Agregar</Button>
            </div>
          </form>
        </Card>
      </div>
    </Page>
    </>
  )
}
