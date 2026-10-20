import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import ClassHealth, { students, termOf } from '../components/ClassHealth'
import { api } from '../lib/api'
import { keys, queryClient, teacherSubjectQuery } from '../lib/queries'
import { ChevronRight, GraduationCap } from 'lucide-react'
import { Page, PageError, PageHeader, PageLoading } from '@/components/Page'
import { cn } from '@/lib/utils'

export default function TeacherHome() {
  const { data: teacher, error } = useQuery({ queryKey: keys.teacher, queryFn: api.teacher })
  // the detail of each subject, so opening one is instant
  useEffect(() => { for (const s of teacher?.subjects ?? []) queryClient.prefetchQuery(teacherSubjectQuery(s.subject_id)) }, [teacher])
  if (error && !teacher) return <PageError message={error.message} />
  if (!teacher) return <PageLoading label="Cargando tus cursos" />

  const atRisk = teacher.subjects.reduce((n, s) => n + s.health.withered, 0)
  return (
    <Page>
      <PageHeader title={`Hola, ${teacher.name.split(' ')[0]}`} description={teacher.subjects.length === 0 ? undefined
        : atRisk > 0 ? `Tenés ${atRisk === 1 ? '1 alumno' : `${atRisk} alumnos`} inactivos, sin practicar hace más de 10 días. Mirá quiénes son y escribiles a tiempo.`
        : 'Tus alumnos vienen practicando. Así va cada curso.'} />
      {teacher.subjects.length === 0 ? (
        <div className="flex max-w-md flex-col items-start gap-3 rounded-2xl border border-dashed p-8">
          <span className="grid size-12 place-items-center rounded-full bg-accent text-accent-foreground"><GraduationCap /></span>
          <p className="font-bold">Todavía no tenés materias cargadas</p>
          <p className="text-sm text-muted-foreground">Pedile a la facultad que te asigne las que dictás y van a aparecer acá.</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {teacher.subjects.map(s => (
            <Link key={s.subject_id} to={`/teacher/subjects/${s.subject_id}`}
              className="group flex flex-col gap-5 rounded-2xl bg-card px-5 py-5 text-card-foreground ring-1 ring-foreground/10 outline-none transition-shadow hover:shadow-lg hover:shadow-foreground/5 hover:ring-primary/40 focus-visible:ring-3 focus-visible:ring-ring/50">
              <div className="flex items-start justify-between gap-3">
                <div className="flex flex-col gap-1">
                  <h2 className="text-lg leading-snug font-extrabold">{s.name}</h2>
                  <p className="text-sm text-muted-foreground">{termOf(s)}, {students(s.students)}</p>
                </div>
                <ChevronRight className="mt-1 size-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </div>
              <ClassHealth health={s.health} />
              <p className={cn('text-sm font-bold', s.open_alerts ? 'text-destructive' : 'text-muted-foreground')}>{s.open_alerts === 0 ? 'Sin alertas abiertas' : s.open_alerts === 1 ? '1 alerta abierta' : `${s.open_alerts} alertas abiertas`}</p>
            </Link>
          ))}
        </div>
      )}
    </Page>
  )
}
