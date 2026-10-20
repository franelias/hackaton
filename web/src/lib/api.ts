// Backend API client (docs/contratos.md). Sends the Firebase ID token with every request.
import { API_URL, MOCK } from './config'
import { firebaseAuth } from './firebase'
import { mockApi } from '../mock/mockApi'
import type { Activity, Alert, ApiErrorBody, ChatMessage, ClassDetail, Faculty, Me, NotificationPrefs, Plan, ScheduleResult, SchedulePreferences, SubjectState, Teacher, Tree } from './types'

export class ApiError extends Error {
  status: number
  code: string
  constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code }
}

async function token(): Promise<string | null> {
  const u = firebaseAuth()?.currentUser
  return u ? u.getIdToken() : null
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const t = await token()
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}), ...init.headers },
  })
  if (!res.ok) {
    let code = 'http_' + res.status, message = res.statusText
    try { const b = (await res.json()) as ApiErrorBody; code = b.error.code; message = b.error.message } catch { /* empty body */ }
    throw new ApiError(res.status, code, message)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export interface ChatHandlers {
  onStatus?: (s: { tool?: string; message: string }) => void
  onText?: (delta: string) => void
  onDone?: (d: { tree_changed: boolean; conversation_id: string }) => void
  onError?: (e: { code: string; message: string }) => void
}

// POST /api/chat answers with SSE; EventSource does not support POST, so it is read with fetch + a reader.
async function chat(body: { student_id: string; message: string; conversation_id?: string; image_base64?: string }, h: ChatHandlers, signal?: AbortSignal) {
  const t = await token()
  const res = await fetch(`${API_URL}/api/chat`, { method: 'POST', signal, headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', ...(t ? { Authorization: `Bearer ${t}` } : {}) }, body: JSON.stringify(body) })
  if (!res.ok || !res.body) {
    let e = { code: 'http_' + res.status, message: 'No pudimos hablar con el tutor.' }
    try { e = ((await res.json()) as ApiErrorBody).error } catch { /* no body */ }
    h.onError?.(e); return
  }
  const reader = res.body.getReader(), dec = new TextDecoder()
  let buf = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let i
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, i); buf = buf.slice(i + 2)
      let event = 'message', data = ''
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim()
        else if (line.startsWith('data:')) data += line.slice(5).trim()
      }
      if (!data) continue
      const d = JSON.parse(data)
      if (event === 'status') h.onStatus?.(d)
      else if (event === 'text') h.onText?.(d.delta)
      else if (event === 'done') h.onDone?.(d)
      else if (event === 'error') h.onError?.(d.error ?? d)
    }
  }
}

export type SubjectMark = { subject_id: number; state: Exclude<SubjectState, 'available' | 'locked'> }

const real = {
  faculties: () => request<Faculty[]>('/api/faculties'),
  plan: (careerId: number) => request<Plan>(`/api/careers/${careerId}/plan`),
  me: () => request<Me>('/api/me'),
  createStudent: (name: string, faculty_id: string, career_id: number) => request<{ student_id: string }>('/api/students', { method: 'POST', body: JSON.stringify({ name, faculty_id, career_id }) }),
  tree: (id: string) => request<Tree>(`/api/students/${id}/tree`),
  alerts: (id: string) => request<Alert[]>(`/api/students/${id}/alerts`),
  dismissAlert: (id: string, alertId: string) => request<void>(`/api/students/${id}/alerts/${alertId}/dismiss`, { method: 'POST' }),
  setSubject: (id: string, subjectId: number, state: SubjectMark['state']) => request<Tree>(`/api/students/${id}/subjects/${subjectId}`, { method: 'PUT', body: JSON.stringify({ state }) }),
  setSubjects: (id: string, subjects: SubjectMark[]) => request<Tree>(`/api/students/${id}/subjects`, { method: 'PUT', body: JSON.stringify({ subjects }) }),
  activity: (id: string, a: Activity) => request<Tree>(`/api/students/${id}/activity`, { method: 'POST', body: JSON.stringify(a) }),
  conversation: (id: string, conversationId: string) => request<{ conversation_id: string; messages: ChatMessage[] }>(`/api/students/${id}/conversations/${conversationId}`),
  notifications: (id: string) => request<NotificationPrefs>(`/api/students/${id}/notifications`),
  setNotifications: (id: string, prefs: Partial<NotificationPrefs>) => request<NotificationPrefs>(`/api/students/${id}/notifications`, { method: 'PUT', body: JSON.stringify(prefs) }),
  addPushToken: (id: string, token: string) => request<void>(`/api/students/${id}/push-tokens`, { method: 'POST', body: JSON.stringify({ token }) }),
  removePushToken: (id: string, token: string) => request<void>(`/api/students/${id}/push-tokens/${encodeURIComponent(token)}`, { method: 'DELETE' }),
  schedule: (student_id: string, subject_ids: number[], preferences?: SchedulePreferences) => request<ScheduleResult>('/api/schedule', { method: 'POST', body: JSON.stringify({ student_id, subject_ids, preferences }) }),
  teacher: () => request<Teacher>('/api/teacher'),
  teacherSubject: (subjectId: number) => request<ClassDetail>(`/api/teacher/subjects/${subjectId}`),
  chat,
}

export type Api = typeof real
export const api: Api = MOCK ? mockApi : real
