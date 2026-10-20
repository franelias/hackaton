// Demo mode: implements the backend contract in memory, with the real LCC plan.
// Used when there is no VITE_API_URL or Firebase config. `?health=wilted|withered` changes the state.
import planJson from './plan.json'
import type { Api, ChatHandlers } from '../lib/api'
import type { Activity, Alert, ChatMessage, Plan, ScheduleResult, StudentSubject, SubjectState, Tree } from '../lib/types'

const plan = planJson as unknown as Plan
const wait = (ms: number) => new Promise(r => setTimeout(r, ms))
const health = (new URLSearchParams(location.search).get('health') as Tree['health']['state']) || 'lush'

// Ana: passed almost all of 1st year and is taking 2nd-year subjects
const states = new Map<number, Exclude<SubjectState, 'available' | 'locked'>>([[1, 'approved'], [2, 'approved'], [3, 'approved'], [4, 'approved'], [6, 'regular'], [5, 'enrolled'], [8, 'enrolled']])
const leaves = new Map<number, number>([[5, 9], [8, 4], [1, 12], [2, 10], [3, 14], [4, 8], [6, 6]])
let studentId: string | null = 's-001'
let alerts: Alert[] = health === 'lush' ? [] : [
  { id: 'al-1', level: health === 'withered' ? 'high' : 'medium', type: 'inactivity', subject_id: 5, message: health === 'withered' ? 'Hace 15 días que no pasás por acá. ¿Querés que te contactemos con un tutor o alguien de tu año?' : 'Se viene el parcial de Análisis Matemático II, ¿practicamos 1 ejercicio?', action: { type: health === 'withered' ? 'contact_tutor' : 'open_tutor', subject_id: 5 } },
]

function buildTree(): Tree {
  const subjects: StudentSubject[] = []
  for (const s of plan.subjects) {
    const st = states.get(s.subject_id)
    const ok = (id: number, cond: string) => { const e = states.get(id); return e === 'approved' || (cond === 'regular' && e === 'regular') }
    const state: SubjectState = st ?? (s.requires.every(r => ok(r.subject_id, r.condition)) ? 'available' : 'locked')
    if (state === 'locked') continue
    subjects.push({ subject_id: s.subject_id, state, leaves: leaves.get(s.subject_id) ?? 0, flower: s.subject_id === 8, dry: health !== 'lush' && s.subject_id === 5 })
  }
  return { student_id: studentId ?? 's-001', career_id: plan.career_id, health: { state: health, last_activity: new Date(Date.now() - (health === 'lush' ? 1 : health === 'wilted' ? 7 : 16) * 864e5).toISOString() }, streak: { weeks: health === 'lush' ? 6 : 0, best: 8, wildcards: 1 }, subjects }
}

const conversations = new Map<string, ChatMessage[]>()
let nextConversation = 1

async function chat(body: { message: string; conversation_id?: string; image_base64?: string }, h: ChatHandlers) {
  const id = body.conversation_id ?? `c-${nextConversation++}`, hist = conversations.get(id) ?? []
  const mockExam = /simulacro/i.test(body.message) && !/termin/i.test(body.message), grade = /termin|corregime/i.test(body.message)
  await wait(300)
  if (mockExam) { h.onStatus?.({ tool: 'exercises', message: 'Buscando parciales de la cátedra…' }); await wait(800); h.onStatus?.({ tool: 'start_mock_exam', message: 'Arrancando el simulacro…' }) }
  else { h.onStatus?.({ tool: 'frequent_topics', message: 'Buscando los temas más tomados…' }); await wait(800); h.onStatus?.({ tool: 'exercises', message: 'Buscando parciales de años anteriores…' }) }
  await wait(800)
  const reply = body.image_base64 && !mockExam && !grade
    ? "Modo demo: recibí tu foto. Con el backend real, el tutor la lee y te ayuda con ese ejercicio. Por ejemplo: veo una integral doble; antes de resolverla, ¿cómo describirías la región de integración?"
    : mockExam
    ? 'Modo demo: este es un simulacro de ejemplo.\n\nEjercicio 1 (30 puntos). Calculá la integral doble de x·y sobre el triángulo de vértices (0,0), (1,0) y (0,1).\n\nEjercicio 2 (35 puntos). Usando coordenadas polares, calculá el área encerrada por r = 1 + cos θ.\n\nEjercicio 3 (35 puntos). Encontrá los extremos de f(x, y) = x² + y² − xy sobre el círculo x² + y² ≤ 1.\n\nCuando termines, mandame tus respuestas y tocá Entregar. Hasta entonces no te doy pistas.'
    : grade ? 'Modo demo: tu nota sería 72/100. El ejercicio 1 está bien; en el 2 te faltó el factor r del jacobiano; en el 3 revisá el borde del círculo. ¿Repasamos el cambio a polares?'
    : `Estás en modo demo (sin backend), así que te respondo con un ejemplo.\n\nSobre "${body.message.slice(0, 80)}": en los parciales de Análisis Matemático II lo que más se toma es integrales dobles y cambio de variables. Arranquemos con un ejercicio del primer parcial 2023: calculá la integral de x·y sobre el triángulo de vértices (0,0), (1,0) y (0,1). ¿Querés una pista antes de empezar?`
  for (const chunk of reply.match(/[^]{1,40}(\s|$)/g) ?? [reply]) { h.onText?.(chunk); await wait(30) }
  conversations.set(id, [...hist, { role: 'user', text: body.message, created_at: new Date().toISOString() }, { role: 'assistant', text: reply, created_at: new Date().toISOString() }])
  h.onDone?.({ tree_changed: !mockExam, conversation_id: id })
}

export const mockApi: Api = {
  faculties: async () => [{ faculty_id: 'fceia', name: 'Facultad de Ciencias Exactas, Ingeniería y Agrimensura (UNR)', careers: [{ career_id: plan.career_id, name: plan.name }] }],
  plan: async () => { await wait(150); return plan },
  me: async () => ({ student_id: studentId }),
  createStudent: async () => { studentId = 's-001'; return { student_id: studentId } },
  tree: async () => { await wait(150); return buildTree() },
  alerts: async () => alerts,
  dismissAlert: async (_id, alertId) => { alerts = alerts.filter(a => a.id !== alertId) },
  setSubject: async (_id, subjectId, state) => { states.set(subjectId, state); return buildTree() },
  setSubjects: async (_id, subjects) => { for (const s of subjects) states.set(s.subject_id, s.state); return buildTree() },
  activity: async (_id, a: Activity) => { if (a.subject_id) leaves.set(a.subject_id, (leaves.get(a.subject_id) ?? 0) + 1); return buildTree() },
  conversation: async (_id, conversation_id) => ({ conversation_id, messages: conversations.get(conversation_id) ?? [] }),
  schedule: async (_sid, subject_ids) => {
    await wait(500)
    const subjectName = (id: number) => plan.subjects.find(s => s.subject_id === id)?.name ?? `Materia ${id}`
    const slots: [number, string, string][] = [[1, '08:00', '11:00'], [3, '08:00', '10:00'], [2, '14:00', '17:00'], [4, '14:00', '16:00'], [5, '18:00', '21:00'], [2, '18:00', '20:00']]
    const r: ScheduleResult = {
      options: [{ commissions: subject_ids.slice(0, 5).map((id, i) => ({ subject_id: id, name: subjectName(id), commission: '', stale: false,
        classes: [slots[i % slots.length], slots[(i + 3) % slots.length]].map(([day, from, to]) => ({ day, from, to, campus: 'Sede Pellegrini', room: `${10 + i} Pell.` })) })), days_on_campus: 4, gap_hours: 1.5 }],
      scheduled_subject_ids: subject_ids.slice(0, 5), conflicts: [], suggest_postpone: [], not_enabled: [], without_schedule: [], warnings: ['Modo demo: horarios de ejemplo, no son los reales.'],
    }
    return r
  },
  chat,
}
