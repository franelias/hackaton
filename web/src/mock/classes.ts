// Demo mode, teacher view (§2.6): the classes of Laura Méndez, the same shape the seed creates.
import type { ClassDetail, ClassStudent, HealthCount, Plan, Teacher } from '../lib/types'

const day = 864e5
const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * day).toISOString()
const civil = (daysAhead: number) => new Date(Date.now() + daysAhead * day).toISOString().slice(0, 10)
const monday = (weeksAgo: number) => { const d = new Date(Date.now() - weeksAgo * 7 * day); d.setDate(d.getDate() - (d.getDay() + 6) % 7); return d.toISOString().slice(0, 10) }

const inactivity = { type: 'inactivity' as const, level: 'high' as const, message: 'Hace más de dos semanas que no practica.' }

// [name, health, days since last activity, exercises, correct rate, mastered, best mock, flower, next exam in days, alerts]
type Row = [string, ClassStudent['health']['state'], number | null, number, number | null, number, number | null, boolean, number | null, ClassStudent['alerts']]
const rows: Record<number, Row[]> = {
  2: [
    ['Hugo', 'withered', null, 0, null, 0, null, false, null, [inactivity]],
    ['Eli', 'withered', 20, 4, .25, 0, null, false, null, [inactivity]],
    ['Dani', 'wilted', 6, 6, .5, 0, null, false, 10, []],
    ['Facu', 'lush', 1, 15, .27, 0, 38, false, 10, []],
    ['Gabi', 'lush', 2, 12, 1, 2, null, false, 10, []],
    ['Ana', 'lush', 0, 11, .55, 1, null, false, 10, []],
    ['Caro', 'lush', 0, 24, .75, 3, 81, true, 10, []],
  ],
  12: [
    ['Beto', 'withered', 12, 8, .62, 1, null, false, null, [{ type: 'first_exam_missed', level: 'high', message: 'No rindió el primer parcial de Lógica (hace 3 días).' }, inactivity]],
    ['Juan', 'wilted', 8, 6, .5, 0, null, false, null, []],
    ['Inés', 'lush', 1, 15, .73, 2, 70, true, null, []],
  ],
}
const topics: Record<number, ClassDetail['topics']> = {
  2: [{ topic: 'límites', attempts: 23, correct: 15, students: 6 }, { topic: 'continuidad', attempts: 21, correct: 12, students: 6 }, { topic: 'función inversa', attempts: 17, correct: 9, students: 5 }, { topic: 'derivadas', attempts: 11, correct: 6, students: 4 }],
  12: [{ topic: 'consecuencia semántica y contraejemplos', attempts: 11, correct: 7, students: 3 }, { topic: 'modelos de lógica de predicados', attempts: 10, correct: 7, students: 3 }, { topic: 'validez de secuentes (árboles y pruebas lineales)', attempts: 8, correct: 4, students: 2 }],
}
const weekly: Record<number, [number, number][]> = {
  2: [[0, 0], [3, 2], [9, 4], [14, 5], [12, 5], [16, 5], [11, 4], [9, 4]],
  12: [[2, 1], [3, 2], [5, 2], [6, 3], [4, 2], [3, 2], [3, 1], [2, 1]],
}

function students(subjectId: number): ClassStudent[] {
  return (rows[subjectId] ?? []).map(([name, state, idle, exercises, correct_rate, mastered_topics, best_mock_exam, flower, exam, alerts], i) => ({
    student_id: `s-${String(subjectId * 10 + i).padStart(3, '0')}`, name, health: { state, last_activity: idle == null ? null : iso(idle) },
    exercises, correct_rate, mastered_topics, best_mock_exam, flower, dry: alerts.some(a => a.type === 'first_exam_missed'), next_exam: exam == null ? null : civil(exam), alerts,
  }))
}

function health(list: ClassStudent[]): HealthCount {
  const h = { lush: 0, wilted: 0, withered: 0 }
  for (const s of list) h[s.health.state]++
  return h
}

function info(plan: Plan, subjectId: number) {
  const s = plan.subjects.find(x => x.subject_id === subjectId)
  return { subject_id: subjectId, career_id: plan.career_id, name: s?.name ?? `Materia ${subjectId}`, year: s?.year ?? null, term: s?.term ?? null }
}

export function mockTeacher(plan: Plan): Teacher {
  return {
    teacher_id: 't-1', name: 'Laura Méndez',
    subjects: Object.keys(rows).map(Number).map(id => { const list = students(id); return { ...info(plan, id), students: list.length, health: health(list), open_alerts: list.reduce((n, s) => n + s.alerts.length, 0) } }),
  }
}

export function mockClass(plan: Plan, subjectId: number): ClassDetail | null {
  if (!rows[subjectId]) return null
  const list = students(subjectId), weeks = weekly[subjectId].map(([exercises, active_students], i) => ({ week: monday(7 - i), exercises, active_students }))
  return {
    ...info(plan, subjectId),
    summary: { students: list.length, health: health(list), active_this_week: weeks[7].active_students, exercises_this_week: weeks[7].exercises, open_alerts: list.reduce((n, s) => n + s.alerts.length, 0) },
    students: list, weeks, topics: topics[subjectId],
  }
}
