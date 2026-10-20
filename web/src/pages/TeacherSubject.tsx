import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import ClassHealth, { HEALTH_HINT, HEALTH_LABEL, students, termOf } from '../components/ClassHealth'
import { teacherSubjectQuery } from '../lib/queries'
import type { ClassDetail } from '../lib/types'
import { ArrowLeft } from 'lucide-react'
import { Page, PageError, PageHeader, PageLoading } from '@/components/Page'
import { HealthBadge } from '@/components/StateBadge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

const ago = (iso: string | null) => { if (!iso) return 'nunca'; const d = Math.floor((Date.now() - new Date(iso).getTime()) / 864e5); return d <= 0 ? 'hoy' : d === 1 ? 'ayer' : `hace ${d} días` }
// dates come as YYYY-MM-DD; noon avoids the time zone moving them a day
const shortDate = (date: string) => new Date(`${date}T12:00`).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })
const percent = (x: number | null) => x == null ? '-' : `${Math.round(x * 100)}%`

function Weeks({ weeks }: { weeks: ClassDetail['weeks'] }) {
  const max = Math.max(1, ...weeks.map(w => w.exercises)), h = 120
  return (
    <div className="grid grid-cols-8 items-end gap-1.5 sm:gap-2">
      {weeks.map((w, i) => { const current = i === weeks.length - 1
        return (
          <div key={w.week} className="flex flex-col items-center gap-1 text-xs" title={`${w.exercises} ejercicios, ${students(w.active_students)} activos`}>
            <b className="text-sm tabular-nums">{w.exercises}</b>
            <i className={cn('w-full max-w-10 rounded-t-lg rounded-b-sm', current ? 'bg-primary' : 'bg-chart-2')} style={{ height: Math.max(3, (w.exercises / max) * h) }} />
            <span className="font-bold whitespace-nowrap text-muted-foreground">{current ? 'Esta' : shortDate(w.week)}</span>
            <small className="text-muted-foreground tabular-nums">{w.active_students} act.</small>
          </div>
        ) })}
    </div>
  )
}

export default function TeacherSubject() {
  const subjectId = Number(useParams().subjectId)
  const { data: detail, error } = useQuery(teacherSubjectQuery(subjectId))
  if (error && !detail) return <PageError message={error.message} action={<Button variant="outline" asChild><Link to="/teacher">Volver a mis cursos</Link></Button>} />
  if (!detail) return <PageLoading label="Cargando el curso" />

  const s = detail.summary
  const stat = (label: string, value: ReactNode) => (
    <Card className="gap-1.5 rounded-2xl px-5 py-4"><span className="text-sm font-semibold text-muted-foreground">{label}</span>{value}</Card>)
  return (
    <Page>
      <Button variant="ghost" size="sm" asChild className="-ml-3 self-start"><Link to="/teacher"><ArrowLeft data-icon="inline-start" />Mis cursos</Link></Button>
      <PageHeader title={detail.name} description={`${termOf(detail)}, ${students(s.students)} cursando`} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-[repeat(3,minmax(0,1fr))_minmax(0,1.6fr)]">
        {stat('Activos esta semana', <b className="text-3xl leading-none font-extrabold tabular-nums">{s.active_this_week} <small className="text-base font-bold text-muted-foreground">de {s.students}</small></b>)}
        {stat('Ejercicios esta semana', <b className="text-3xl leading-none font-extrabold tabular-nums">{s.exercises_this_week}</b>)}
        {stat('Alertas abiertas', <b className={cn('text-3xl leading-none font-extrabold tabular-nums', s.open_alerts > 0 && 'text-destructive')}>{s.open_alerts}</b>)}
        <div className="col-span-2 lg:col-span-1">{stat('Situación de los alumnos', <ClassHealth health={s.health} />)}</div>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Card className="gap-5 rounded-2xl py-5">
          <CardHeader className="px-5"><CardTitle className="text-lg font-extrabold">Actividad por semana</CardTitle>
            <CardDescription>Ejercicios de esta materia y cuántos alumnos la practicaron.</CardDescription></CardHeader>
          <CardContent className="px-5"><Weeks weeks={detail.weeks} /></CardContent>
        </Card>
        <Card className="gap-4 rounded-2xl py-5">
          <CardHeader className="px-5"><CardTitle className="text-lg font-extrabold">Temas practicados</CardTitle></CardHeader>
          <CardContent className="px-5">
            {detail.topics.length === 0 ? <p className="text-sm text-muted-foreground">Todavía nadie practicó ejercicios de esta materia.</p> : (
              <ul className="flex flex-col divide-y">
                {detail.topics.map(t => {
                  const rate = t.attempts ? t.correct / t.attempts : 0
                  return (
                    <li key={t.topic} className="grid grid-cols-[minmax(0,1fr)_5rem_3.5rem] items-center gap-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_7rem_4rem]">
                      <div className="min-w-0"><b className="block truncate text-sm">{t.topic}</b><span className="text-xs text-muted-foreground">{t.attempts} ejercicios, {students(t.students)}</span></div>
                      <div className="h-2 overflow-hidden rounded-full"><i className={cn('block h-full rounded-full', rate < .5 ? 'bg-wilted' : 'bg-lush')} style={{ width: `${rate * 100}%` }} /></div>
                      <span className="text-right text-sm font-bold tabular-nums">{percent(rate)} bien</span>
                    </li>
                  )
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="gap-4 rounded-2xl py-5">
        <CardHeader className="px-5"><CardTitle className="text-lg font-extrabold">Alumnos</CardTitle>
          <CardDescription>Primero los que más necesitan una mano: con alertas, inactivos e irregulares.</CardDescription></CardHeader>
        <CardContent className="px-0">
          {detail.students.length === 0 ? <p className="px-5 text-sm text-muted-foreground">Nadie marcó esta materia como cursando todavía.</p> : (
            <Table>
              <TableHeader>
                <TableRow>{['Alumno', 'Estado', 'Ejercicios', 'Aciertos', 'Temas dominados', 'Mejor simulacro', 'Próximo parcial', 'Alertas'].map((h, i) =>
                  <TableHead key={h} className={cn('text-xs font-extrabold text-muted-foreground', i === 0 && 'pl-5', i === 7 && 'pr-5', i >= 2 && i <= 5 && 'text-right')}>{h}</TableHead>)}</TableRow>
              </TableHeader>
              <TableBody>
                {detail.students.map(st => (
                  <TableRow key={st.student_id} className={cn('align-top', st.alerts.some(a => a.level === 'high') && 'bg-destructive/5 hover:bg-destructive/10')}>
                    <TableCell className="pl-5"><div className="flex flex-wrap items-center gap-1.5"><b>{st.name}</b>
                      {st.flower && <Badge variant="outline" className="border-transparent bg-regular font-bold text-warning-foreground" title="Aprobó un simulacro (60 o más)">listo para rendir</Badge>}
                      {st.dry && <Badge variant="outline" className="border-transparent bg-withered/15 font-bold text-withered">en riesgo en la materia</Badge>}</div></TableCell>
                    <TableCell><Tooltip><TooltipTrigger asChild><HealthBadge state={st.health.state} tabIndex={0}>{HEALTH_LABEL[st.health.state]}</HealthBadge></TooltipTrigger><TooltipContent>{HEALTH_HINT[st.health.state]}</TooltipContent></Tooltip>
                      <small className="mt-1 block text-xs text-muted-foreground">{st.health.last_activity ? `últ. actividad ${ago(st.health.last_activity)}` : 'sin actividad'}</small></TableCell>
                    <TableCell className="text-right tabular-nums">{st.exercises}</TableCell>
                    <TableCell className="text-right tabular-nums">{percent(st.correct_rate)}</TableCell>
                    <TableCell className="text-right tabular-nums">{st.mastered_topics}</TableCell>
                    <TableCell className="text-right tabular-nums">{st.best_mock_exam == null ? '-' : st.best_mock_exam}</TableCell>
                    <TableCell className="tabular-nums">{st.next_exam ? shortDate(st.next_exam) : '-'}</TableCell>
                    <TableCell className="min-w-56 pr-5 whitespace-normal">{st.alerts.length === 0 ? <span className="text-muted-foreground">-</span>
                      : <div className="flex flex-col gap-1">{st.alerts.map((a, i) => <p key={i} className={cn('text-sm font-semibold', a.level === 'high' && 'text-destructive')}>{a.message}</p>)}</div>}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </Page>
  )
}
