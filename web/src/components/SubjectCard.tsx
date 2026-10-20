// A subject in detail: what it needs, what it unlocks, and how the student marks it. The tree's side
// panel and the Materias page both show it.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, X } from 'lucide-react'
import type { PlanSubject, SubjectState } from '@/lib/types'
import { SubjectBadge } from '@/components/StateBadge'
import GradeInput from '@/components/GradeInput'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

const STATE_LABEL: Record<SubjectState, string> = { approved: 'Aprobada', regular: 'Regular (debe el final)', enrolled: 'Cursando', available: 'La podés cursar', locked: 'Todavía no' }

export type Mark = 'approved' | 'regular' | 'enrolled'

export default function SubjectCard({ m, state, dry, grade, fails, stateOf, byId, busy, onChange, onClear, onExamDate, onTutor, onClose, onSelect, back, choice }: { m: PlanSubject; state: SubjectState; dry: boolean; grade: number | null; fails: number; stateOf: (id: number) => SubjectState; byId: Map<number, PlanSubject>; busy: boolean;
  // grade: the final's grade, given when marked approved
  onChange: (s: Mark, grade?: number) => void; onClear: () => void; onExamDate: (date: string) => void; onTutor: () => void; onClose?: () => void;
  // when given, the subjects it needs and unlocks are links to their own detail
  onSelect?: (id: number) => void
  // the close button is a back arrow (a page of its own on the phone) instead of an X (a side panel)
  back?: boolean
  // an Optativa: the electives it can take and the one the student picked
  choice?: { options: PlanSubject[]; picked: PlanSubject | null; onPick: (id: number | null) => void } }) {
  const [date, setDate] = useState('')
  const marked = state === 'enrolled' || state === 'regular' || state === 'approved'
  const name = (id: number) => onSelect ? <button type="button" className="text-left font-semibold underline-offset-2 hover:underline" onClick={() => onSelect(id)}>{byId.get(id)?.name}</button> : byId.get(id)?.name
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-1.5">
          <h2 className="text-lg leading-snug font-extrabold">{choice?.picked?.name ?? m.name}</h2>
          <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">{choice?.picked && `${m.name}, `}{m.year ? `${m.year}.º año, ${m.term}.º cuatrimestre` : 'Optativa'}<SubjectBadge state={state}>{STATE_LABEL[state]}</SubjectBadge></p>
        </div>
        {onClose && <Button variant="ghost" size="icon-sm" className="-mt-1 -mr-2" onClick={onClose} aria-label={back ? 'Volver' : 'Cerrar'}>{back ? <ArrowLeft /> : <X />}</Button>}
      </div>
      {dry && state !== 'approved' && <p className="rounded-xl bg-destructive/10 px-3 py-2 text-sm font-bold text-destructive">Su rama se está secando: tenés una alerta abierta sobre esta materia. Practicala para que vuelva a crecer.</p>}
      {choice && <div className="flex flex-col gap-2">
        <Label htmlFor="elective">¿Cuál cursás?</Label>
        <Select value={choice.picked ? String(choice.picked.subject_id) : 'none'} onValueChange={v => choice.onPick(v === 'none' ? null : Number(v))} disabled={busy}>
          <SelectTrigger id="elective" className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Todavía no la elegí</SelectItem>
            {choice.options.map(o => <SelectItem key={o.subject_id} value={String(o.subject_id)}>{o.name}{o.term ? ` (${o.term}.º cuat.)` : ''}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>}
      {m.bottleneck && <p className="rounded-xl bg-warning px-3 py-2 text-sm font-bold text-warning-foreground">Destraba {m.unlocks_total} materias: conviene no atrasarla.</p>}

      <section className="flex flex-col gap-1">
        <h3 className="text-xs font-extrabold text-muted-foreground">Necesita</h3>
        <ul className="flex flex-col text-sm">{m.requires.length ? m.requires.map(r => (
          <li key={r.subject_id} className="flex items-baseline justify-between gap-3 py-1">{name(r.subject_id)}
            <span className="shrink-0 text-xs text-muted-foreground">{r.condition === 'regular' ? 'regular' : 'aprobada'}, {STATE_LABEL[stateOf(r.subject_id)].toLowerCase()}</span></li>))
          : <li className="py-1 text-muted-foreground">Nada, se cursa desde el principio</li>}</ul>
      </section>
      <section className="flex flex-col gap-1">
        <h3 className="text-xs font-extrabold text-muted-foreground">Destraba</h3>
        <ul className="flex flex-col text-sm">{m.unlocks.length ? m.unlocks.map(u => <li key={u} className="py-1">{name(u)}</li>)
          : <li className="py-1 text-muted-foreground">Es de las últimas de la carrera</li>}</ul>
      </section>

      <div className="flex flex-col gap-3 border-t pt-4">
        <Button className="w-full" onClick={onTutor}>Practicar con el tutor</Button>
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-bold">Marcar como</span>
            {marked && <Button variant="ghost" size="sm" className="-mr-2 h-7 text-muted-foreground" onClick={onClear} disabled={busy}>{state === 'enrolled' ? 'Ya no la curso' : 'Desmarcar'}</Button>}
          </div>
          {/* tapping the marked option again also clears it */}
          <ToggleGroup type="single" variant="outline" size="sm" spacing={1} aria-label="Marcar como" value={marked ? state : ''}
            onValueChange={v => { if (v) onChange(v as Mark); else if (marked) onClear() }} disabled={busy}>
            <ToggleGroupItem value="enrolled">La curso</ToggleGroupItem><ToggleGroupItem value="regular">Regular</ToggleGroupItem><ToggleGroupItem value="approved">Aprobada</ToggleGroupItem>
          </ToggleGroup>
        </div>
        {state === 'approved' && <div className="flex items-center justify-between gap-2">
          <Label htmlFor="final-grade">Nota del final</Label>
          <GradeInput id="final-grade" value={grade} onSave={g => onChange('approved', g)} disabled={busy} />
        </div>}
        {fails > 0 && <p className="text-sm text-muted-foreground">{fails === 1 ? 'Tiene 1 aplazo' : `Tiene ${fails} aplazos`}. <Link to="/grades" className="font-semibold text-foreground underline-offset-2 hover:underline">Ver notas</Link></p>}
        {state === 'enrolled' && <form className="flex items-end gap-2" onSubmit={e => { e.preventDefault(); if (date) onExamDate(date) }}>
          <div className="flex flex-1 flex-col gap-2"><Label htmlFor="exam-date">Fecha del parcial</Label><Input id="exam-date" type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
          <Button variant="outline" className="h-10" disabled={!date || busy}>Anotar</Button></form>}
      </div>
    </div>
  )
}
