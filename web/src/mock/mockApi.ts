// Modo demo: implementa el contrato del backend en memoria, con el plan real de LCC.
// Se usa cuando no hay VITE_API_URL o Firebase configurado. La salud se calcula como en el backend
// (contratos §2.2): días desde la última actividad, <5 frondoso, desde 5 mustio, desde 10 marchito.
// Ana arranca con 11 días sin actividad; cualquier actividad ("Estudié hoy", un ejercicio) la revive.
import planJson from './plan.json'
import type { Api, ChatHandlers } from '../lib/api'
import type { Activity, Alert, ChatMessage, Plan, ScheduleResult, StudentSubject, SubjectState, Tree } from '../lib/types'

const plan = planJson as unknown as Plan
const espera = (ms: number) => new Promise(r => setTimeout(r, ms))

// Ana: aprobó 1.er año casi completo y cursa 2.º
const estados = new Map<number, Exclude<SubjectState, 'available' | 'locked'>>([[1, 'approved'], [2, 'approved'], [3, 'approved'], [4, 'approved'], [6, 'regular'], [5, 'enrolled'], [8, 'enrolled']])
const hojas = new Map<number, number>([[5, 9], [8, 4], [1, 12], [2, 10], [3, 14], [4, 8], [6, 6]])
let studentId: string | null = 's-001'
let ultimaActividad = Date.now() - 11 * 864e5
const descartadas = new Set<string>()
const diasSin = () => (Date.now() - ultimaActividad) / 864e5
const salud = (): Tree['health']['state'] => diasSin() >= 10 ? 'withered' : diasSin() >= 5 ? 'wilted' : 'lush'

// alertas de inactividad (contratos §2.3); una descartada no vuelve mientras el nivel sea el mismo
function calcularAlertas(): Alert[] {
  const d = diasSin(), a: Alert[] = []
  if (d >= 15) a.push({ id: 'al-3', level: 'high', type: 'inactivity', message: 'Hace 15 días que no pasás por acá. ¿Querés que te contactemos con un tutor o alguien de tu año?', action: { type: 'contact_tutor' } })
  else if (d >= 10) a.push({ id: 'al-2', level: 'medium', type: 'inactivity', subject_id: 5, message: 'Se viene el parcial de Análisis Matemático II, ¿practicamos 1 ejercicio?', action: { type: 'open_tutor', subject_id: 5 } })
  else if (d >= 5) a.push({ id: 'al-1', level: 'low', type: 'inactivity', message: 'Hace unos días que no estudiás. Un ejercicio corto alcanza para que tu árbol vuelva a crecer.', action: { type: 'open_tutor' } })
  return a.filter(x => !descartadas.has(x.id))
}

function arbol(): Tree {
  const est = salud()
  const subjects: StudentSubject[] = []
  for (const s of plan.subjects) {
    const st = estados.get(s.subject_id)
    const ok = (id: number, cond: string) => { const e = estados.get(id); return e === 'approved' || (cond === 'regular' && e === 'regular') }
    const state: SubjectState = st ?? (s.requires.every(r => ok(r.subject_id, r.condition)) ? 'available' : 'locked')
    if (state === 'locked') continue
    subjects.push({ subject_id: s.subject_id, state, leaves: hojas.get(s.subject_id) ?? 0, flower: s.subject_id === 8, dry: est === 'withered' && s.subject_id === 5 })
  }
  return { student_id: studentId ?? 's-001', career_id: plan.career_id, health: { state: est, last_activity: new Date(ultimaActividad).toISOString() }, streak: { weeks: est === 'lush' ? 1 : 0, best: 8, wildcards: 1 }, subjects }
}

const conversaciones = new Map<string, ChatMessage[]>()
let siguienteConv = 1

async function chat(body: { message: string; conversation_id?: string }, h: ChatHandlers) {
  const id = body.conversation_id ?? `c-${siguienteConv++}`, hist = conversaciones.get(id) ?? []
  const simulacro = /simulacro/i.test(body.message) && !/termin/i.test(body.message), corregir = /termin|corregime/i.test(body.message)
  await espera(300)
  if (simulacro) { h.onStatus?.({ tool: 'exercises', message: 'Buscando parciales de la cátedra…' }); await espera(800); h.onStatus?.({ tool: 'start_mock_exam', message: 'Arrancando el simulacro…' }) }
  else { h.onStatus?.({ tool: 'frequent_topics', message: 'Buscando los temas más tomados…' }); await espera(800); h.onStatus?.({ tool: 'exercises', message: 'Buscando parciales de años anteriores…' }) }
  await espera(800)
  const resp = simulacro
    ? 'Modo demo: este es un simulacro de ejemplo.\n\nEjercicio 1 (30 puntos). Calculá la integral doble de x·y sobre el triángulo de vértices (0,0), (1,0) y (0,1).\n\nEjercicio 2 (35 puntos). Usando coordenadas polares, calculá el área encerrada por r = 1 + cos θ.\n\nEjercicio 3 (35 puntos). Encontrá los extremos de f(x, y) = x² + y² − xy sobre el círculo x² + y² ≤ 1.\n\nCuando termines, mandame tus respuestas y tocá Entregar. Hasta entonces no te doy pistas.'
    : corregir ? 'Modo demo: tu nota sería 72/100. El ejercicio 1 está bien; en el 2 te faltó el factor r del jacobiano; en el 3 revisá el borde del círculo. ¿Repasamos el cambio a polares?'
    : `Estás en modo demo (sin backend), así que te respondo con un ejemplo.\n\nSobre "${body.message.slice(0, 80)}": en los parciales de Análisis Matemático II lo que más se toma es integrales dobles y cambio de variables. Arranquemos con un ejercicio del primer parcial 2023: calculá la integral de x·y sobre el triángulo de vértices (0,0), (1,0) y (0,1). ¿Querés una pista antes de empezar?`
  for (const parte of resp.match(/[^]{1,40}(\s|$)/g) ?? [resp]) { h.onText?.(parte); await espera(30) }
  conversaciones.set(id, [...hist, { role: 'user', text: body.message, created_at: new Date().toISOString() }, { role: 'assistant', text: resp, created_at: new Date().toISOString() }])
  ultimaActividad = Date.now(); descartadas.clear()   // un mensaje de chat cuenta como actividad
  h.onDone?.({ tree_changed: true, conversation_id: id })
}

export const mockApi: Api = {
  faculties: async () => [{ faculty_id: 'fceia', name: 'Facultad de Ciencias Exactas, Ingeniería y Agrimensura (UNR)', careers: [{ career_id: plan.career_id, name: plan.name }] }],
  plan: async () => { await espera(150); return plan },
  me: async () => ({ student_id: studentId }),
  createStudent: async () => { studentId = 's-001'; return { student_id: studentId } },
  tree: async () => { await espera(150); return arbol() },
  alerts: async () => calcularAlertas(),
  dismissAlert: async (_id, alertId) => { descartadas.add(alertId) },
  setSubject: async (_id, subjectId, state) => { estados.set(subjectId, state); return arbol() },
  setSubjects: async (_id, subjects) => { for (const s of subjects) estados.set(s.subject_id, s.state); return arbol() },
  activity: async (_id, a: Activity) => { ultimaActividad = Date.now(); descartadas.clear(); if (a.subject_id && a.type !== 'checkin') hojas.set(a.subject_id, (hojas.get(a.subject_id) ?? 0) + 1); return arbol() },
  conversation: async (_id, conversation_id) => ({ conversation_id, messages: conversaciones.get(conversation_id) ?? [] }),
  schedule: async (_sid, subject_ids) => {
    await espera(500)
    const nombre = (id: number) => plan.subjects.find(s => s.subject_id === id)?.name ?? `Materia ${id}`
    const franjas: [number, string, string][] = [[1, '08:00', '11:00'], [3, '08:00', '10:00'], [2, '14:00', '17:00'], [4, '14:00', '16:00'], [5, '18:00', '21:00'], [2, '18:00', '20:00']]
    const r: ScheduleResult = {
      options: [{ commissions: subject_ids.slice(0, 5).map((id, i) => ({ subject_id: id, name: nombre(id), commission: '', stale: false,
        classes: [franjas[i % franjas.length], franjas[(i + 3) % franjas.length]].map(([day, from, to]) => ({ day, from, to, campus: 'Sede Pellegrini', room: `${10 + i} Pell.` })) })), days_on_campus: 4, gap_hours: 1.5 }],
      scheduled_subject_ids: subject_ids.slice(0, 5), conflicts: [], suggest_postpone: [], not_enabled: [], without_schedule: [], warnings: ['Modo demo: horarios de ejemplo, no son los reales.'],
    }
    return r
  },
  chat,
}
