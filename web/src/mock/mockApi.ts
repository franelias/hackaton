// Modo demo: implementa el contrato del backend en memoria, con el plan real de LCC.
// Se usa cuando no hay VITE_API_URL o Firebase configurado. `?salud=wilted|withered` cambia el estado.
import planJson from './plan.json'
import type { Api, ChatHandlers } from '../lib/api'
import type { Activity, Alert, ChatMessage, Plan, ScheduleResult, StudentSubject, SubjectState, Tree } from '../lib/types'

const plan = planJson as unknown as Plan
const espera = (ms: number) => new Promise(r => setTimeout(r, ms))
const salud = (new URLSearchParams(location.search).get('salud') as Tree['health']['state']) || 'lush'

// Ana: aprobó 1.er año casi completo y cursa 2.º
const estados = new Map<number, Exclude<SubjectState, 'available' | 'locked'>>([[1, 'approved'], [2, 'approved'], [3, 'approved'], [4, 'approved'], [6, 'regular'], [5, 'enrolled'], [8, 'enrolled']])
const hojas = new Map<number, number>([[5, 9], [8, 4], [1, 12], [2, 10], [3, 14], [4, 8], [6, 6]])
let studentId: string | null = 's-001'
let alertas: Alert[] = salud === 'lush' ? [] : [
  { id: 'al-1', level: salud === 'withered' ? 'high' : 'medium', type: 'inactivity', subject_id: 5, message: salud === 'withered' ? 'Hace 15 días que no pasás por acá. ¿Querés que te contactemos con un tutor o alguien de tu año?' : 'Se viene el parcial de Análisis Matemático II, ¿practicamos 1 ejercicio?', action: { type: salud === 'withered' ? 'contact_tutor' : 'open_tutor', subject_id: 5 } },
]

function arbol(): Tree {
  const subjects: StudentSubject[] = []
  for (const s of plan.subjects) {
    const st = estados.get(s.subject_id)
    const ok = (id: number, cond: string) => { const e = estados.get(id); return e === 'approved' || (cond === 'regular' && e === 'regular') }
    const state: SubjectState = st ?? (s.requires.every(r => ok(r.subject_id, r.condition)) ? 'available' : 'locked')
    if (state === 'locked') continue
    subjects.push({ subject_id: s.subject_id, state, leaves: hojas.get(s.subject_id) ?? 0, flower: s.subject_id === 8, dry: salud !== 'lush' && s.subject_id === 5 })
  }
  return { student_id: studentId ?? 's-001', career_id: plan.career_id, health: { state: salud, last_activity: new Date(Date.now() - (salud === 'lush' ? 1 : salud === 'wilted' ? 7 : 16) * 864e5).toISOString() }, streak: { weeks: salud === 'lush' ? 6 : 0, best: 8, wildcards: 1 }, subjects }
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
  h.onDone?.({ tree_changed: !simulacro, conversation_id: id })
}

export const mockApi: Api = {
  plan: async () => { await espera(150); return plan },
  me: async () => ({ student_id: studentId }),
  createStudent: async () => { studentId = 's-001'; return { student_id: studentId } },
  tree: async () => { await espera(150); return arbol() },
  alerts: async () => alertas,
  dismissAlert: async (_id, alertId) => { alertas = alertas.filter(a => a.id !== alertId) },
  setSubject: async (_id, subjectId, state) => { estados.set(subjectId, state); return arbol() },
  activity: async (_id, a: Activity) => { if (a.subject_id) hojas.set(a.subject_id, (hojas.get(a.subject_id) ?? 0) + 1); return arbol() },
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
