import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import ClassHealth, { students, termOf } from '../components/ClassHealth'
import { api } from '../lib/api'
import { keys, queryClient, teacherSubjectQuery } from '../lib/queries'

export default function TeacherHome() {
  const { data: teacher, error } = useQuery({ queryKey: keys.teacher, queryFn: api.teacher })
  // the detail of each subject, so opening one is instant
  useEffect(() => { for (const s of teacher?.subjects ?? []) queryClient.prefetchQuery(teacherSubjectQuery(s.subject_id)) }, [teacher])
  if (error && !teacher) return <div className="centered error">{error.message}</div>
  if (!teacher) return <div className="centered">Cargando tus cursos…</div>

  const atRisk = teacher.subjects.reduce((n, s) => n + s.health.withered, 0)
  return (
    <div className="page wide">
      <div className="greeting">
        <div>
          <h1>Hola, {teacher.name.split(' ')[0]}</h1>
          <p>{teacher.subjects.length === 0 ? 'Todavía no tenés materias cargadas. Pedile a la facultad que te asigne las que dictás.'
            : atRisk > 0 ? `Tenés ${atRisk === 1 ? '1 alumno' : `${atRisk} alumnos`} inactivos, sin practicar hace más de 10 días. Mirá quiénes son y escribiles a tiempo.`
            : 'Tus alumnos vienen practicando. Así va cada curso.'}</p>
        </div>
      </div>
      <div className="classes">
        {teacher.subjects.map(s => (
          <Link key={s.subject_id} to={`/teacher/subjects/${s.subject_id}`} className="card class-card">
            <div>
              <h2>{s.name}</h2>
              <p className="hint">{termOf(s)} · {students(s.students)}</p>
            </div>
            <ClassHealth health={s.health} />
            <p className={s.open_alerts ? 'alerts-count' : 'hint'}>{s.open_alerts === 0 ? 'Sin alertas abiertas' : s.open_alerts === 1 ? '1 alerta abierta' : `${s.open_alerts} alertas abiertas`}</p>
          </Link>
        ))}
      </div>
    </div>
  )
}
