// Types of the backend → app contract (docs/contratos.md §2).

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
  // app only: the photo the student sent in this session (the backend history does not return it)
  image?: string
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

// Teacher view (§2.6)
export interface Me { student_id: string | null; teacher_id: string | null }
export interface HealthCount { lush: number; wilted: number; withered: number }
export interface TaughtSubject { subject_id: number; career_id: number; name: string; year: number | null; term: number | null }
export interface Teacher {
  teacher_id: string
  name: string
  subjects: (TaughtSubject & { students: number; health: HealthCount; open_alerts: number })[]
}
export interface ClassStudent {
  student_id: string
  name: string
  health: { state: HealthState; last_activity: string | null }
  exercises: number
  correct_rate: number | null
  mastered_topics: number
  best_mock_exam: number | null
  flower: boolean
  dry: boolean
  next_exam: string | null
  alerts: { type: Alert['type']; level: Alert['level']; message: string }[]
}
export interface ClassDetail extends TaughtSubject {
  summary: { students: number; health: HealthCount; active_this_week: number; exercises_this_week: number; open_alerts: number }
  students: ClassStudent[]
  weeks: { week: string; exercises: number; active_students: number }[]
  topics: { topic: string; attempts: number; correct: number; students: number }[]
}
