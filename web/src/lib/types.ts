// Tipos del contrato backend → app (docs/contratos.md §2). Todo lo que viaja va en inglés.

export type Condition = 'approved' | 'regular'

export interface PlanSubject {
  subject_id: number
  code: string
  name: string
  year: number | null
  term: number | null
  requires: { subject_id: number; condition: Condition }[]
  unlocks: number[]
  unlocks_total: number
  bottleneck: boolean
  optional: boolean
  slack: number
  postpone_year_delay: number
}

export interface Plan {
  career_id: number
  name: string
  min_terms: number
  critical_path: number[]
  subjects: PlanSubject[]
  final_goal?: { subject_id: number; code: string; name: string; year: number; term: number; requires_all: boolean }
}

export interface Faculty {
  faculty_id: string
  name: string
  careers: { career_id: number; name: string }[]
}

export type SubjectState = 'approved' | 'regular' | 'enrolled' | 'available' | 'locked'
export type HealthState = 'lush' | 'wilted' | 'withered'

export interface StudentSubject {
  subject_id: number
  state: SubjectState
  leaves: number
  flower: boolean
  dry: boolean
}

export interface Tree {
  student_id: string
  career_id: number
  health: { state: HealthState; last_activity: string | null }
  streak: { weeks: number; best: number; wildcards: number }
  subjects: StudentSubject[]
}

export type AlertAction = 'open_tutor' | 'build_schedule' | 'view_dates' | 'contact_tutor'

export interface Alert {
  id: string
  level: 'low' | 'medium' | 'high'
  type: 'inactivity' | 'first_exam_missed'
  subject_id?: number
  message: string
  action: { type: AlertAction; subject_id?: number }
}

export type ActivityType = 'checkin' | 'exercise' | 'mock_exam' | 'exam'

export interface Activity {
  type: ActivityType
  subject_id?: number
  topic?: string
  result?: Record<string, unknown>
  date?: string
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  text: string
  created_at?: string
  // solo en la app: la foto que mandó el alumno en esta sesión (el historial del backend no la devuelve)
  imagen?: string
}

export interface ScheduleClass { day: number; from: string; to: string; campus?: string; room?: string; end_estimated?: boolean }
export interface ScheduleOption {
  commissions: { subject_id: number; name: string; commission: string; stale: boolean; classes: ScheduleClass[] }[]
  days_on_campus: number
  gap_hours: number
}
export interface ScheduleResult {
  options: ScheduleOption[]
  scheduled_subject_ids: number[]
  conflicts: { subject_ids: number[]; day: number; from: string; to: string }[]
  suggest_postpone: number[]
  not_enabled: { subject_id: number; name: string; missing: { subject_id: number; code: string; condition: Condition }[] }[]
  without_schedule: number[]
  warnings: string[]
}
export interface SchedulePreferences { shift?: 'morning' | 'afternoon' | 'evening'; free_days?: number[] }

export interface ApiErrorBody { error: { code: string; message: string } }
