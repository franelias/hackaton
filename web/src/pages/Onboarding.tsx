import { useEffect, useMemo, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { api, type SubjectMark } from '../lib/api'
import { useSesion } from '../lib/session'
import type { Faculty, Plan, PlanSubject } from '../lib/types'

type Marca = 'approved' | 'regular' | 'enrolled' | ''
const OPCIONES: [Marca, string][] = [['', 'Todavía no'], ['enrolled', 'La curso'], ['regular', 'Regular'], ['approved', 'Aprobada']]

// Paso 1: tu nombre, facultad y carrera. Paso 2: marcás lo que ya hiciste (si sos ingresante, nada).
export default function Onboarding() {
  const { usuario, studentId, setStudentId, refrescar, cargando } = useSesion()
  const nav = useNavigate()
  const [paso, setPaso] = useState(1)
  const [nombre, setNombre] = useState(usuario?.displayName ?? '')
  const [facultades, setFacultades] = useState<Faculty[] | null>(null)
  const [facultadId, setFacultadId] = useState(''), [carreraId, setCarreraId] = useState<number | null>(null)
  const [plan, setPlan] = useState<Plan | null>(null)
  const [marcas, setMarcas] = useState<Record<number, Marca>>({})
  const [id, setId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null), [enviando, setEnviando] = useState(false)
  // con una sola opción, ya queda elegida
  useEffect(() => { api.faculties().then(fs => { setFacultades(fs); if (fs.length === 1) elegirFacultad(fs[0]) }).catch(e => setError(`No pudimos cargar las facultades: ${e.message}`)) }, [])
  const elegirFacultad = (f?: Faculty) => { setFacultadId(f?.faculty_id ?? ''); setCarreraId(f?.careers.length === 1 ? f.careers[0].career_id : null) }
  const carreras = facultades?.find(f => f.faculty_id === facultadId)?.careers ?? []
  const porAnio = useMemo(() => { const m = new Map<number, PlanSubject[]>()
    for (const s of plan?.subjects ?? []) if (!s.optional && s.year) m.set(s.year, [...(m.get(s.year) ?? []), s]); return [...m.entries()].sort((a, b) => a[0] - b[0]) }, [plan])

  if (cargando) return <div className="centrado">Cargando…</div>
  if (!usuario) return <Navigate to="/entrar" replace />
  if (studentId && paso === 1) return <Navigate to="/" replace />

  const crear = async () => { if (carreraId == null) return; setEnviando(true); setError(null)
    // si el alumno ya se creó y falló el plan, reintentar no lo vuelve a crear
    try { const sid = id ?? (await api.createStudent(nombre.trim(), facultadId, carreraId)).student_id; setId(sid); setPlan(await api.plan(carreraId)); setPaso(2) }
    catch (e) { setError((e as Error).message) } finally { setEnviando(false) } }
  // todas las marcas en un solo pedido
  const terminar = async () => { if (!id) return; setEnviando(true); setError(null)
    try { const subjects = Object.entries(marcas).flatMap(([sid, state]): SubjectMark[] => state ? [{ subject_id: Number(sid), state }] : [])
      if (subjects.length) await api.setSubjects(id, subjects)
      setStudentId(id); await refrescar(); nav('/', { replace: true }) }
    catch (e) { setError((e as Error).message) } finally { setEnviando(false) } }

  return (
    <div className="onboarding">
      <div className="pasos" aria-label={`Paso ${paso} de 2`}><i className={paso >= 1 ? 'hecho' : ''} /><i className={paso >= 2 ? 'hecho' : ''} /></div>
      {paso === 1 ? (
        <section className="caja">
          <h1>Plantemos tu árbol</h1>
          <p>Vas a ver tu carrera como un árbol: cada materia es una rama que nace de sus correlativas.</p>
          <label>¿Cómo te llamás?<input value={nombre} onChange={e => setNombre(e.target.value)} autoFocus /></label>
          <label>Facultad
            <select value={facultadId} disabled={!facultades || id != null} onChange={e => elegirFacultad(facultades?.find(f => f.faculty_id === e.target.value))}>
              <option value="" disabled>{facultades ? 'Elegí tu facultad' : 'Cargando…'}</option>
              {facultades?.map(f => <option key={f.faculty_id} value={f.faculty_id}>{f.name}</option>)}
            </select>
          </label>
          <label>Carrera
            <select value={carreraId ?? ''} disabled={!facultadId || id != null} onChange={e => setCarreraId(Number(e.target.value))}>
              <option value="" disabled>{facultadId ? 'Elegí tu carrera' : 'Primero elegí la facultad'}</option>
              {carreras.map(c => <option key={c.career_id} value={c.career_id}>{c.name}</option>)}
            </select>
          </label>
          {error && <p className="error" role="alert">{error}</p>}
          <button className="btn" disabled={!nombre.trim() || carreraId == null || enviando} onClick={crear}>Seguir</button>
        </section>
      ) : (
        <section className="caja ancha">
          <h1>¿Qué ya hiciste?</h1>
          <p>Marcá las materias que ya aprobaste, las que tenés regulares (te falta el final) y las que estás cursando. Si recién empezás, tocá Listo.</p>
          {porAnio.map(([anio, subs]) => (
            <fieldset key={anio}><legend>{anio}.º año</legend>
              {subs.map(s => (
                <div className="fila-materia" key={s.subject_id}>
                  <span>{s.name}</span>
                  <div className="segmentos" role="radiogroup" aria-label={s.name}>
                    {OPCIONES.map(([v, t]) => <button key={v} role="radio" aria-checked={(marcas[s.subject_id] ?? '') === v} className={(marcas[s.subject_id] ?? '') === v ? 'on' : ''} onClick={() => setMarcas({ ...marcas, [s.subject_id]: v })}>{t}</button>)}
                  </div>
                </div>))}
            </fieldset>))}
          {error && <p className="error" role="alert">{error}</p>}
          <button className="btn" disabled={enviando} onClick={terminar}>{enviando ? 'Guardando…' : 'Listo, ver mi árbol'}</button>
        </section>
      )}
    </div>
  )
}
