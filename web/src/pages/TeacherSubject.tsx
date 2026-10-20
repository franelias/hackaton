import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import ClassHealth, { HEALTH_HINT, HEALTH_LABEL, students, termOf } from '../components/ClassHealth'
import { teacherSubjectQuery } from '../lib/queries'
import type { ClassDetail } from '../lib/types'

const ago = (iso: string | null) => { if (!iso) return 'nunca'; const d = Math.floor((Date.now() - new Date(iso).getTime()) / 864e5); return d <= 0 ? 'hoy' : d === 1 ? 'ayer' : `hace ${d} días` }
// dates come as YYYY-MM-DD; noon avoids the time zone moving them a day
const shortDate = (date: string) => new Date(`${date}T12:00`).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })
const percent = (x: number | null) => x == null ? '—' : `${Math.round(x * 100)}%`

function Weeks({ weeks }: { weeks: ClassDetail['weeks'] }) {
  const max = Math.max(1, ...weeks.map(w => w.exercises)), h = 120
  return (
    <div className="weeks">
      {weeks.map((w, i) => (
        <div key={w.week} className={i === weeks.length - 1 ? 'week current' : 'week'} title={`${w.exercises} ejercicios, ${students(w.active_students)} activos`}>
          <b>{w.exercises}</b>
          <i style={{ height: Math.max(3, (w.exercises / max) * h) }} />
          <span>{i === weeks.length - 1 ? 'Esta' : shortDate(w.week)}</span>
          <small>{w.active_students} act.</small>
        </div>
      ))}
    </div>
  )
}

export default function TeacherSubject() {
  const subjectId = Number(useParams().subjectId)
  const { data: detail, error } = useQuery(teacherSubjectQuery(subjectId))
  if (error && !detail) return <div className="centered error">{error.message}<br /><Link to="/teacher">Volver a mis cursos</Link></div>
  if (!detail) return <div className="centered">Cargando el curso…</div>

  const s = detail.summary
  return (
    <div className="page">
      <Link to="/teacher" className="back">← Mis cursos</Link>
      <div className="greeting">
        <div>
          <h1>{detail.name}</h1>
          <p>{termOf(detail)} · {students(s.students)} cursando</p>
        </div>
      </div>

      <div className="class-stats">
        <div className="card"><span className="hint">Activos esta semana</span><b>{s.active_this_week} <small>de {s.students}</small></b></div>
        <div className="card"><span className="hint">Ejercicios esta semana</span><b>{s.exercises_this_week}</b></div>
        <div className="card"><span className="hint">Alertas abiertas</span><b className={s.open_alerts ? 'bad' : ''}>{s.open_alerts}</b></div>
        <div className="card"><span className="hint">Situación de los alumnos</span><ClassHealth health={s.health} /></div>
      </div>

      <div className="class-grid">
        <section className="card">
          <h2>Actividad por semana</h2>
          <p className="hint">Ejercicios de esta materia y cuántos alumnos la practicaron.</p>
          <Weeks weeks={detail.weeks} />
        </section>
        <section className="card">
          <h2>Temas practicados</h2>
          {detail.topics.length === 0 ? <p className="hint">Todavía nadie practicó ejercicios de esta materia.</p> : (
            <ul className="topics">
              {detail.topics.map(t => {
                const rate = t.attempts ? t.correct / t.attempts : 0
                return (
                  <li key={t.topic}>
                    <div><b>{t.topic}</b><span>{t.attempts} ejercicios · {students(t.students)}</span></div>
                    <div className={rate < .5 ? 'rate low' : 'rate'}><i style={{ width: `${rate * 100}%` }} /></div>
                    <span className="rate-label">{percent(rate)} bien</span>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </div>

      <section className="card">
        <h2>Alumnos</h2>
        <p className="hint">Primero los que más necesitan una mano: con alertas, inactivos e irregulares.</p>
        {detail.students.length === 0 ? <p className="hint">Nadie marcó esta materia como cursando todavía.</p> : (
          <div className="table-scroll">
            <table className="students">
              <thead>
                <tr><th>Alumno</th><th>Estado</th><th>Ejercicios</th><th>Aciertos</th><th>Temas dominados</th><th>Mejor simulacro</th><th>Próximo parcial</th><th>Alertas</th></tr>
              </thead>
              <tbody>
                {detail.students.map(st => (
                  <tr key={st.student_id} className={st.alerts.some(a => a.level === 'high') ? 'at-risk' : ''}>
                    <td><b>{st.name}</b>{st.flower && <span className="tag flower" title="Aprobó un simulacro (60 o más)">listo para rendir</span>}{st.dry && <span className="tag dry">en riesgo en la materia</span>}</td>
                    <td><span className={`chip ${st.health.state}`} title={HEALTH_HINT[st.health.state]}>{HEALTH_LABEL[st.health.state]}</span><small>{st.health.last_activity ? `últ. actividad ${ago(st.health.last_activity)}` : 'sin actividad'}</small></td>
                    <td>{st.exercises}</td>
                    <td>{percent(st.correct_rate)}</td>
                    <td>{st.mastered_topics}</td>
                    <td>{st.best_mock_exam == null ? '—' : st.best_mock_exam}</td>
                    <td>{st.next_exam ? shortDate(st.next_exam) : '—'}</td>
                    <td className="alerts-cell">{st.alerts.length === 0 ? '—' : st.alerts.map((a, i) => <p key={i} className={a.level}>{a.message}</p>)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
