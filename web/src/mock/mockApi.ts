// Demo mode: implements the backend contract in memory, with the real LCC plan.
// Used when there is no VITE_API_URL or Firebase config. Health comes from the days since the last
// activity, with the backend thresholds (internal/tree/health.go): 5 days wilted, 10 withered. Ana starts
// with 11 days without activity; any activity ("Estudié hoy", an exercise, a chat message) revives her.
import planJson from './plan.json'
import { ApiError, type Api, type ChatHandlers } from '../lib/api'
import { mockClass, mockTeacher } from './classes'
import type { Activity, Alert, ChatMessage, Fail, NotificationPrefs, Plan, ScheduleResult, StudentSubject, SubjectState, Tree } from '../lib/types'

const plan = planJson as unknown as Plan
const wait = (ms: number) => new Promise(r => setTimeout(r, ms))
const day = 864e5
let lastActivity = Date.now() - 11 * day
const inactiveDays = () => (Date.now() - lastActivity) / day
const healthOf = (): Tree['health']['state'] => inactiveDays() >= 10 ? 'withered' : inactiveDays() >= 5 ? 'wilted' : 'lush'

// Ana: passed almost all of 1st year and is taking 2nd-year subjects
const states = new Map<number, Exclude<SubjectState, 'available' | 'locked'>>([[1, 'approved'], [2, 'approved'], [3, 'approved'], [4, 'approved'], [6, 'regular'], [5, 'enrolled'], [8, 'enrolled']])
const leaves = new Map<number, number>([[5, 9], [8, 4], [1, 12], [2, 10], [3, 14], [4, 8], [6, 6]])
// the finals she passed, and one she failed before passing
const grades = new Map<number, number>([[1, 8], [2, 9], [3, 7], [4, 10]])
const fails = new Map<number, Fail[]>([[3, [{ id: 1, grade: 4 }]]])
let nextFail = 2
let studentId: string | null = 's-001'
const dismissed = new Set<string>()
// inactivity alerts (contract §2.3); a dismissed one does not come back while the level is the same
function alerts(): Alert[] {
  const d = inactiveDays(), a: Alert[] = []
  if (d >= 15) a.push({ id: 'al-3', level: 'high', type: 'inactivity', message: 'Hace 15 días que no pasás por acá. ¿Querés que te contactemos con un tutor o alguien de tu año?', action: { type: 'contact_tutor' } })
  else if (d >= 10) a.push({ id: 'al-2', level: 'medium', type: 'inactivity', subject_id: 5, message: 'Se viene el parcial de Análisis Matemático II, ¿practicamos 1 ejercicio?', action: { type: 'open_tutor', subject_id: 5 } })
  else if (d >= 5) a.push({ id: 'al-1', level: 'low', type: 'inactivity', message: 'Hace unos días que no estudiás. Un ejercicio corto alcanza para que tu árbol vuelva a crecer.', action: { type: 'open_tutor' } })
  return a.filter(x => !dismissed.has(x.id))
}

function buildTree(): Tree {
  const health = healthOf()
  const subjects: StudentSubject[] = []
  for (const s of plan.subjects) {
    const st = states.get(s.subject_id)
    const ok = (id: number, cond: string) => { const e = states.get(id); return e === 'approved' || (cond === 'regular' && e === 'regular') }
    const state: SubjectState = st ?? (s.requires.every(r => ok(r.subject_id, r.condition)) ? 'available' : 'locked')
    if (state === 'locked') continue
    subjects.push({ subject_id: s.subject_id, state, leaves: leaves.get(s.subject_id) ?? 0, flower: s.subject_id === 8, dry: health === 'withered' && s.subject_id === 5,
      ...(state === 'approved' && grades.has(s.subject_id) ? { grade: grades.get(s.subject_id) } : {}), ...(fails.get(s.subject_id)?.length ? { fails: fails.get(s.subject_id) } : {}) })
  }
  return { student_id: studentId ?? 's-001', career_id: plan.career_id, health: { state: health, last_activity: new Date(lastActivity).toISOString() }, streak: { weeks: health === 'lush' ? 1 : 0, best: 8, wildcards: 1 }, subjects }
}

let notificationPrefs: NotificationPrefs = { push: true, email: true }

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
  lastActivity = Date.now(); dismissed.clear()   // a chat message counts as activity
  h.onDone?.({ tree_changed: true, conversation_id: id })
}

export const mockApi: Api = {
  faculties: async () => [{ faculty_id: 'fceia', name: 'Facultad de Ciencias Exactas, Ingeniería y Agrimensura (UNR)', careers: [{ career_id: plan.career_id, name: plan.name }] }],
  plan: async () => { await wait(150); return plan },
  me: async () => ({ student_id: studentId, teacher_id: 't-1' }),
  createStudent: async () => { studentId = 's-001'; return { student_id: studentId } },
  tree: async () => { await wait(150); return buildTree() },
  alerts: async () => alerts(),
  dismissAlert: async (_id, alertId) => { dismissed.add(alertId) },
  // like the backend: a grade only lives while approved, and without one the old one stays
  setSubject: async (_id, subjectId, state, grade) => { states.set(subjectId, state); if (state !== 'approved') grades.delete(subjectId); else if (grade != null) grades.set(subjectId, grade); return buildTree() },
  clearSubject: async (_id, subjectId) => { states.delete(subjectId); grades.delete(subjectId); return buildTree() },
  addFail: async (_id, subjectId, grade) => { fails.set(subjectId, [...(fails.get(subjectId) ?? []), { id: nextFail++, grade }]); return buildTree() },
  removeFail: async (_id, failId) => { for (const [k, v] of fails) fails.set(k, v.filter(f => f.id !== failId)); return buildTree() },
  setSubjects: async (_id, subjects) => { for (const s of subjects) { states.set(s.subject_id, s.state); if (s.state !== 'approved') grades.delete(s.subject_id) } return buildTree() },
  activity: async (_id, a: Activity) => { lastActivity = Date.now(); dismissed.clear(); if (a.subject_id && a.type !== 'checkin') leaves.set(a.subject_id, (leaves.get(a.subject_id) ?? 0) + 1); return buildTree() },
  conversation: async (_id, conversation_id) => ({ conversation_id, messages: conversations.get(conversation_id) ?? [] }),
  notifications: async () => notificationPrefs,
  setNotifications: async (_id, prefs) => { notificationPrefs = { ...notificationPrefs, ...prefs }; return notificationPrefs },
  addPushToken: async () => {},
  removePushToken: async () => {},
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
  teacher: async () => { await wait(200); return mockTeacher(plan) },
  teacherSubject: async (subjectId) => { await wait(200); const c = mockClass(plan, subjectId); if (!c) throw new ApiError(404, 'not_found', 'no dictás esa materia'); return c },
  chat,
}
