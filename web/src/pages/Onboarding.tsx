import { useMemo, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { CAREER_ID } from '../lib/config'
import { useSesion } from '../lib/session'
import type { PlanSubject } from '../lib/types'

type Marca = 'approved' | 'regular' | 'enrolled' | ''
const OPCIONES: [Marca, string][] = [['', 'Todavía no'], ['enrolled', 'La curso'], ['regular', 'Regular'], ['approved', 'Aprobada']]

// Paso 1: tu nombre. Paso 2: marcás lo que ya hiciste (si sos ingresante, nada).
export default function Onboarding() {
  const { usuario, studentId, plan, setStudentId, refrescar, cargando } = useSesion()
  const nav = useNavigate()
  const [paso, setPaso] = useState(1)
  const [nombre, setNombre] = useState(usuario?.displayName ?? '')
  const [marcas, setMarcas] = useState<Record<number, Marca>>({})
  const [id, setId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null), [enviando, setEnviando] = useState(false)
  const porAnio = useMemo(() => { const m = new Map<number, PlanSubject[]>()
    for (const s of plan?.subjects ?? []) if (!s.optional && s.year) m.set(s.year, [...(m.get(s.year) ?? []), s]); return [...m.entries()].sort((a, b) => a[0] - b[0]) }, [plan])

  if (cargando) return <div className="centrado">Cargando…</div>
  if (!usuario) return <Navigate to="/entrar" replace />
  if (studentId && paso === 1) return <Navigate to="/" replace />

  const crear = async () => { setEnviando(true); setError(null)
    try { const r = await api.createStudent(nombre.trim(), CAREER_ID); setId(r.student_id); setPaso(2) }
    catch (e) { setError((e as Error).message) } finally { setEnviando(false) } }
  const terminar = async () => { if (!id) return; setEnviando(true); setError(null)
    try { for (const [sid, est] of Object.entries(marcas)) if (est) await api.setSubject(id, Number(sid), est)
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
          <label>Carrera<input value={plan?.name ?? ''} readOnly /></label>
          {error && <p className="error" role="alert">{error}</p>}
          <button className="btn" disabled={!nombre.trim() || enviando} onClick={crear}>Seguir</button>
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
