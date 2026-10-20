import { useEffect, useMemo, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { api, type SubjectMark } from '../lib/api'
import { facultiesQuery, planQuery, queryClient } from '../lib/queries'
import { useSession } from '../lib/session'
import type { Faculty, Plan, PlanSubject } from '../lib/types'

type Mark = 'approved' | 'regular' | 'enrolled' | ''
const OPTIONS: [Mark, string][] = [['', 'Todavía no'], ['enrolled', 'La curso'], ['regular', 'Regular'], ['approved', 'Aprobada']]

// Step 1: name, faculty and career. Step 2: mark what you have already done (nothing, if you are new).
export default function Onboarding() {
  const { user, studentId, setStudentId, refresh, loading } = useSession()
  const nav = useNavigate()
  const [step, setStep] = useState(1)
  const [name, setName] = useState(user?.displayName ?? '')
  const [faculties, setFaculties] = useState<Faculty[] | null>(null)
  const [facultyId, setFacultyId] = useState(''), [careerId, setCareerId] = useState<number | null>(null)
  const [plan, setPlan] = useState<Plan | null>(null)
  const [marks, setMarks] = useState<Record<number, Mark>>({})
  const [id, setId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null), [sending, setSending] = useState(false)
  // with a single option, it is picked already
  useEffect(() => { queryClient.fetchQuery(facultiesQuery).then(fs => { setFaculties(fs); if (fs.length === 1) pickFaculty(fs[0]) }).catch(e => setError(`No pudimos cargar las facultades: ${e.message}`)) }, [])
  const pickFaculty = (f?: Faculty) => { setFacultyId(f?.faculty_id ?? ''); setCareerId(f?.careers.length === 1 ? f.careers[0].career_id : null) }
  const careers = faculties?.find(f => f.faculty_id === facultyId)?.careers ?? []
  const byYear = useMemo(() => { const m = new Map<number, PlanSubject[]>()
    for (const s of plan?.subjects ?? []) if (!s.optional && s.year) m.set(s.year, [...(m.get(s.year) ?? []), s]); return [...m.entries()].sort((a, b) => a[0] - b[0]) }, [plan])

  if (loading) return <div className="centered">Cargando…</div>
  if (!user) return <Navigate to="/login" replace />
  if (studentId && step === 1) return <Navigate to="/" replace />

  const create = async () => { if (careerId == null) return; setSending(true); setError(null)
    // if the student was created and the plan failed, retrying does not create it again
    try { const sid = id ?? (await api.createStudent(name.trim(), facultyId, careerId)).student_id; setId(sid); setPlan(await queryClient.fetchQuery(planQuery(careerId))); setStep(2) }
    catch (e) { setError((e as Error).message) } finally { setSending(false) } }
  // all marks in a single request
  const finish = async () => { if (!id) return; setSending(true); setError(null)
    try { const subjects = Object.entries(marks).flatMap(([sid, state]): SubjectMark[] => state ? [{ subject_id: Number(sid), state }] : [])
      if (subjects.length) await api.setSubjects(id, subjects)
      setStudentId(id); await refresh(); nav('/', { replace: true }) }
    catch (e) { setError((e as Error).message) } finally { setSending(false) } }

  return (
    <div className="onboarding">
      <div className="steps" aria-label={`Paso ${step} de 2`}><i className={step >= 1 ? 'done' : ''} /><i className={step >= 2 ? 'done' : ''} /></div>
      {step === 1 ? (
        <section className="box">
          <h1>Plantemos tu árbol</h1>
          <p>Vas a ver tu carrera como un árbol: cada materia es una rama que nace de sus correlativas.</p>
          <label>¿Cómo te llamás?<input value={name} onChange={e => setName(e.target.value)} autoFocus /></label>
          <label>Facultad
            <select value={facultyId} disabled={!faculties || id != null} onChange={e => pickFaculty(faculties?.find(f => f.faculty_id === e.target.value))}>
              <option value="" disabled>{faculties ? 'Elegí tu facultad' : 'Cargando…'}</option>
              {faculties?.map(f => <option key={f.faculty_id} value={f.faculty_id}>{f.name}</option>)}
            </select>
          </label>
          <label>Carrera
            <select value={careerId ?? ''} disabled={!facultyId || id != null} onChange={e => setCareerId(Number(e.target.value))}>
              <option value="" disabled>{facultyId ? 'Elegí tu carrera' : 'Primero elegí la facultad'}</option>
              {careers.map(c => <option key={c.career_id} value={c.career_id}>{c.name}</option>)}
            </select>
          </label>
          {error && <p className="error" role="alert">{error}</p>}
          <button className="btn" disabled={!name.trim() || careerId == null || sending} onClick={create}>Seguir</button>
        </section>
      ) : (
        <section className="box wide">
          <h1>¿Qué ya hiciste?</h1>
          <p>Marcá las materias que ya aprobaste, las que tenés regulares (te falta el final) y las que estás cursando. Si recién empezás, tocá Listo.</p>
          {byYear.map(([year, subs]) => (
            <fieldset key={year}><legend>{year}.º año</legend>
              {subs.map(s => (
                <div className="subject-row" key={s.subject_id}>
                  <span>{s.name}</span>
                  <div className="segmented" role="radiogroup" aria-label={s.name}>
                    {OPTIONS.map(([v, t]) => <button key={v} role="radio" aria-checked={(marks[s.subject_id] ?? '') === v} className={(marks[s.subject_id] ?? '') === v ? 'on' : ''} onClick={() => setMarks({ ...marks, [s.subject_id]: v })}>{t}</button>)}
                  </div>
                </div>))}
            </fieldset>))}
          {error && <p className="error" role="alert">{error}</p>}
          <button className="btn" disabled={sending} onClick={finish}>{sending ? 'Guardando…' : 'Listo, ver mi árbol'}</button>
        </section>
      )}
    </div>
  )
}
