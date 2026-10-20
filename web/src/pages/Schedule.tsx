import { useMemo, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { api } from '../lib/api'
import { useSession } from '../lib/session'
import type { SchedulePreferences } from '../lib/types'
import { CalendarDays } from 'lucide-react'
import { InlineError, Page, PageHeader } from '@/components/Page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

const DAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
// one soft hue per commission; text stays dark on all of them, in both themes
const COLORS = ['#cfe3c2', '#d9e6f4', '#f8e3b8', '#f3d3e0', '#d8d3f0', '#cde9e4', '#efd9c3']
const SHIFTS: [string, string][] = [['any', 'Me da igual'], ['morning', 'Mañana'], ['afternoon', 'Tarde'], ['evening', 'Noche']]
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
  const [option, setOption] = useState(0)
  // a schedule is an answer to these choices, not data to keep: a mutation, not a query
  const schedule = useMutation({
    mutationFn: () => api.schedule(studentId!, picked, { ...(shift ? { shift } : {}), ...(freeDays.length ? { free_days: freeDays } : {}) }),
    onSuccess: () => setOption(0),
  })
  const result = schedule.data, loading = schedule.isPending, error = schedule.error?.message
  const nameOf = (id: number) => plan?.subjects.find(s => s.subject_id === id)?.name ?? `Materia ${id}`

  const build = () => { if (studentId) schedule.mutate() }

  const opt = result?.options[option]
  const classes = opt ? opt.commissions.flatMap((c, i) => c.classes.map(k => ({ ...k, name: c.name, color: COLORS[i % COLORS.length] }))) : []
  const from = Math.min(8 * 60, ...classes.map(c => minutes(c.from))), to = Math.max(20 * 60, ...classes.map(c => minutes(c.to)))
  const hours = Array.from({ length: Math.ceil((to - from) / 60) }, (_, i) => from / 60 + i)

  const notes = result ? [
    result.conflicts.length > 0 && <><b>Se superponen:</b> {result.conflicts.map(c => c.subject_ids.map(nameOf).join(' y ')).join('; ')}.</>,
    result.suggest_postpone.length > 0 && <><b>Te conviene postergar:</b> {result.suggest_postpone.map(nameOf).join(', ')}.</>,
    result.not_enabled.length > 0 && <><b>Todavía no las podés cursar:</b> {result.not_enabled.map(n => `${n.name} (te falta ${n.missing.map(x => nameOf(x.subject_id)).join(', ')})`).join('; ')}.</>,
    result.without_schedule.length > 0 && <><b>Sin horarios publicados:</b> {result.without_schedule.map(nameOf).join(', ')}.</>,
    ...result.warnings,
  ].filter(Boolean) : []

  return (
    <Page>
      <PageHeader title="Armá tu horario" description="Elegí las materias que querés cursar. Solo aparecen las que ya podés cursar por correlativas." />
      <div className="grid items-start gap-4 lg:grid-cols-[20rem_minmax(0,1fr)] lg:gap-6">
        <Card className="gap-6 rounded-2xl px-5 py-5">
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-3 text-base font-extrabold">Materias</legend>
            {candidates.length === 0 && <p className="text-sm text-muted-foreground">Todavía no hay materias habilitadas. Marcá en tu árbol las que aprobaste.</p>}
            {candidates.map(s => (
              <div key={s.subject_id} className="flex items-start gap-3">
                <Checkbox id={`subject-${s.subject_id}`} className="mt-0.5" checked={picked.includes(s.subject_id)} onCheckedChange={c => setPicked(c === true ? [...picked, s.subject_id] : picked.filter(x => x !== s.subject_id))} />
                <Label htmlFor={`subject-${s.subject_id}`} className="flex flex-wrap items-center gap-x-2 gap-y-1 leading-snug font-semibold">{s.name}
                  {s.bottleneck && <Badge variant="outline" className="border-transparent bg-warning font-bold text-warning-foreground">destraba {s.unlocks_total}</Badge>}</Label>
              </div>))}
          </fieldset>
          <div className="flex flex-col gap-4 border-t pt-5">
            <div className="flex flex-col gap-2">
              <Label htmlFor="shift">Turno</Label>
              <Select value={shift || 'any'} onValueChange={v => setShift(v === 'any' ? '' : v as SchedulePreferences['shift'])}>
                <SelectTrigger id="shift" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{SHIFTS.map(([v, t]) => <SelectItem key={v} value={v}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label>Días libres</Label>
              <ToggleGroup type="multiple" variant="outline" size="sm" spacing={1} aria-label="Días libres" value={freeDays.map(String)} onValueChange={v => setFreeDays(v.map(Number))}>
                {DAYS.slice(0, 5).map((d, i) => <ToggleGroupItem key={d} value={String(i + 1)}>{d}</ToggleGroupItem>)}
              </ToggleGroup>
            </div>
          </div>
          <Button size="lg" className="w-full" disabled={!picked.length || loading} onClick={build}>{loading ? 'Armando…' : 'Armar horario'}</Button>
          {error && <InlineError>{error}</InlineError>}
        </Card>

        <Card className="min-h-96 gap-4 rounded-2xl px-5 py-5">
          {loading ? <div role="status" aria-label="Armando tu horario" className="grid grid-cols-6 gap-2">{Array.from({ length: 12 }, (_, i) => <Skeleton key={i} className={i % 3 ? 'h-24' : 'h-14'} />)}</div>
          : !result ? <div className="m-auto flex max-w-xs flex-col items-center gap-3 py-16 text-center">
              <span className="grid size-12 place-items-center rounded-full bg-accent text-accent-foreground"><CalendarDays /></span>
              <p className="font-bold">Tu semana va a aparecer acá</p>
              <p className="text-sm text-muted-foreground">Elegí las materias a la izquierda y tocá Armar horario.</p>
            </div> : <>
            {result.options.length > 1 && <ToggleGroup type="single" variant="outline" size="sm" spacing={1} aria-label="Opciones" value={String(option)} onValueChange={v => { if (v) setOption(Number(v)) }}>
              {result.options.map((o, i) => <ToggleGroupItem key={i} value={String(i)}>Opción {i + 1}: {o.days_on_campus} días, {o.gap_hours} h de hueco</ToggleGroupItem>)}
            </ToggleGroup>}
            {opt ? <div className="-mx-5 overflow-x-auto px-5"><div className="relative grid min-w-[40rem] grid-cols-[3.25rem_repeat(6,minmax(0,1fr))] border-t" style={{ gridTemplateRows: `2rem repeat(${hours.length}, 44px)` }}>
              {DAYS.map((d, i) => <div key={d} className="row-start-1 py-1.5 text-center text-sm font-extrabold" style={{ gridColumn: i + 2 }}>{d}</div>)}
              {hours.map((h, i) => <div key={h} className="col-start-1 border-t pt-0.5 text-xs text-muted-foreground tabular-nums" style={{ gridRow: i + 2 }}>{h}:00</div>)}
              {hours.map((h, i) => <div key={`l${h}`} className="col-span-6 col-start-2 border-t border-dashed" style={{ gridRow: i + 2 }} aria-hidden="true" />)}
              {classes.map((c, i) => { const top = (minutes(c.from) - from) / 60, height = (minutes(c.to) - minutes(c.from)) / 60
                return <div key={i} className="z-[1] mx-0.5 flex flex-col overflow-hidden rounded-lg px-2 py-1 text-xs leading-tight text-[#2b2a22]" style={{ gridColumn: c.day + 1, gridRow: `${Math.floor(top) + 2} / span ${Math.ceil(top + height) - Math.floor(top)}`, background: c.color, marginTop: `${(top % 1) * 44}px` }}>
                  <b>{c.name}</b><span className="opacity-80">{c.from}-{c.to}{c.end_estimated ? ' (aprox.)' : ''}</span>{c.room && <span className="opacity-80">{c.room}</span>}</div> })}
            </div></div> : <p className="text-muted-foreground">No hay ninguna combinación posible con estas materias.</p>}
            {notes.length > 0 && <ul className="flex flex-col gap-2 text-sm">{notes.map((n, i) => <li key={i} className="rounded-xl bg-muted px-3 py-2">{n}</li>)}</ul>}
          </>}
        </Card>
      </div>
    </Page>
  )
}
