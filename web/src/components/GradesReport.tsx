// The libreta as a printed sheet (A4, portrait): who, which career, the averages, how the grades spread, and every
// subject by year with its state, grade and aplazos. It only shows when printing; the Notas page prints it as PDF.
// It mounts next to the app, not inside it, so the print hides the whole app (menu, floating buttons) behind it.
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import Logo from '@/components/Logo'
import { formatGrade, type Summary } from '@/lib/grades'
import type { StudentSubject, SubjectState } from '@/lib/types'

const STATE: Record<SubjectState, { label: string; dot: string }> = {
  approved: { label: 'Aprobada', dot: 'bg-primary' },
  regular: { label: 'Regular', dot: 'bg-chart-3' },
  enrolled: { label: 'Cursando', dot: 'bg-chart-5' },
  available: { label: 'Pendiente', dot: 'bg-border' },
  locked: { label: 'Pendiente', dot: 'bg-border' },
}
const PASSING = [4, 5, 6, 7, 8, 9, 10]

function Kpi({ label, value, children }: { label: string; value: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border px-3.5 py-3">
      <span className="text-[9px] font-extrabold tracking-[0.14em] text-muted-foreground uppercase">{label}</span>
      <span className="text-2xl leading-none font-extrabold tabular-nums">{value}</span>
      {children && <span className="text-[10px] text-muted-foreground">{children}</span>}
    </div>
  )
}

export default function GradesReport({ summary: r, student, career, states }: {
  summary: Summary; student: string; career: string; states: Map<number, StudentSubject>
}) {
  const grades = [...states.values()].filter(s => s.state === 'approved' && s.grade != null).map(s => s.grade!)
  const counts = PASSING.map(g => grades.filter(x => x === g).length)
  const top = Math.max(1, ...counts)
  const today = new Date().toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' })

  return createPortal(
    <article className="grades-report hidden text-[11px] leading-snug text-foreground print:block">
      <header className="flex items-start justify-between gap-6 border-b-2 border-primary pb-4">
        <div className="flex flex-col gap-1">
          <span className="text-[9px] font-extrabold tracking-[0.2em] text-primary uppercase">Libreta académica</span>
          <h1 className="text-3xl leading-tight font-extrabold tracking-tight">{student}</h1>
          <p className="text-sm text-muted-foreground">{career}</p>
        </div>
        <div className="flex flex-col items-end gap-1 text-right">
          <span className="flex items-center gap-1.5 text-base font-extrabold text-primary"><Logo size={22} />Árbol</span>
          <span className="text-[10px] text-muted-foreground">Emitida el {today}</span>
        </div>
      </header>

      <section className="mt-5 grid grid-cols-4 gap-2.5">
        <Kpi label="Promedio" value={formatGrade(r.average)}>Con aplazos: <b className="text-foreground tabular-nums">{formatGrade(r.withFails)}</b></Kpi>
        <Kpi label="Avance" value={`${Math.round(r.done * 100)} %`}>
          <span className="my-1 block h-1.5 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-primary" style={{ width: `${r.done * 100}%` }} /></span>
          {r.approved} de {r.total} materias
        </Kpi>
        <Kpi label="Te faltan" value={r.remaining}>{r.remaining === 1 ? 'materia' : 'materias'} para recibirte</Kpi>
        <Kpi label="Promedio máximo" value={formatGrade(r.remaining ? r.ifAll(10) : r.average)}>
          Con aplazos: <b className="text-foreground tabular-nums">{formatGrade(r.remaining ? r.ifAll(10, true) : r.withFails)}</b>
        </Kpi>
      </section>

      <section className="mt-5 grid grid-cols-[minmax(0,1fr)_13rem] gap-6 break-inside-avoid">
        <div className="flex flex-col gap-2">
          <h2 className="text-[9px] font-extrabold tracking-[0.14em] text-muted-foreground uppercase">Distribución de notas</h2>
          <div className="flex h-20 items-end gap-1.5 border-b">
            {PASSING.map((g, i) => (
              <div key={g} className="flex flex-1 flex-col items-center justify-end gap-0.5">
                {counts[i] > 0 && <span className="text-[9px] font-bold tabular-nums">{counts[i]}</span>}
                <span className="block w-full rounded-t bg-primary" style={{ height: `${(counts[i] / top) * 3.75}rem`, opacity: 0.45 + 0.55 * (i / (PASSING.length - 1)) }} />
              </div>))}
          </div>
          <div className="flex gap-1.5">{PASSING.map(g => <span key={g} className="flex-1 text-center text-[9px] font-bold text-muted-foreground tabular-nums">{g}</span>)}</div>
        </div>
        <div className="flex flex-col gap-2">
          <h2 className="text-[9px] font-extrabold tracking-[0.14em] text-muted-foreground uppercase">Por año</h2>
          <ul className="flex flex-col gap-1.5">
            {r.years.map(y => (
              <li key={y.year} className="flex items-center gap-2">
                <span className="w-12 shrink-0 font-bold">{y.year ? `${y.year}.º año` : 'Sin año'}</span>
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-primary" style={{ width: `${(y.approved / y.subjects.length) * 100}%` }} /></span>
                <b className="w-8 shrink-0 text-right tabular-nums">{formatGrade(y.average)}</b>
              </li>))}
          </ul>
        </div>
      </section>

      {r.years.map(y => (
        <section key={y.year} className="mt-5">
          <div className="flex items-baseline justify-between gap-3 border-b pb-1 break-after-avoid">
            <h2 className="text-sm font-extrabold">{y.year ? `${y.year}.º año` : 'Sin año'}</h2>
            <span className="text-[10px] text-muted-foreground tabular-nums">{y.approved} de {y.subjects.length} aprobadas · promedio <b className="text-foreground">{formatGrade(y.average)}</b></span>
          </div>
          <table className="w-full border-collapse">
            <tbody>
              {y.subjects.map(s => { const st = states.get(s.subject_id), state = st?.state ?? 'locked', fails = st?.fails ?? []
                return <tr key={s.subject_id} className="border-b border-border/60 break-inside-avoid">
                  <td className="w-14 py-1.5 pr-2 text-[9px] text-muted-foreground tabular-nums">{s.code}</td>
                  <td className="py-1.5 pr-2 font-bold">{s.name}</td>
                  <td className="py-1.5 pr-2 text-[10px] whitespace-nowrap text-muted-foreground">{fails.length > 0 && `Aplazos: ${fails.map(f => f.grade).join(', ')}`}</td>
                  <td className="w-20 py-1.5 pr-2 text-[10px] whitespace-nowrap"><span className={`mr-1.5 inline-block size-1.5 rounded-full align-middle ${STATE[state].dot}`} />{STATE[state].label}</td>
                  <td className="w-8 py-1.5 text-right text-sm font-extrabold tabular-nums">{state === 'approved' ? st?.grade ?? '—' : ''}</td>
                </tr> })}
            </tbody>
          </table>
        </section>))}

      <footer className="mt-6 flex justify-between gap-4 border-t pt-2 text-[9px] text-muted-foreground break-inside-avoid">
        <span>{r.ungraded > 0 ? `${r.ungraded === 1 ? 'Una materia aprobada no tiene' : `${r.ungraded} materias aprobadas no tienen`} nota cargada y no cuenta en los promedios.` : 'Los promedios cuentan todas las materias aprobadas.'}</span>
        <span>Documento informativo generado por Árbol, sin validez oficial.</span>
      </footer>
    </article>,
    document.body,
  )
}
