// Cliente de la API del backend (docs/contratos.md). Manda el ID token de Firebase en cada pedido.
import { API_URL, MOCK } from './config'
import { firebaseAuth } from './firebase'
import { mockApi } from '../mock/mockApi'
import type { Activity, Alert, ApiErrorBody, ChatMessage, Plan, ScheduleResult, SchedulePreferences, SubjectState, Tree } from './types'

export class ApiError extends Error {
  status: number
  code: string
  constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code }
}

async function token(): Promise<string | null> {
  const u = firebaseAuth()?.currentUser
  return u ? u.getIdToken() : null
}

async function pedir<T>(ruta: string, init: RequestInit = {}): Promise<T> {
  const t = await token()
  const res = await fetch(`${API_URL}${ruta}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}), ...init.headers },
  })
  if (!res.ok) {
    let code = 'http_' + res.status, message = res.statusText
    try { const b = (await res.json()) as ApiErrorBody; code = b.error.code; message = b.error.message } catch { /* cuerpo vacío */ }
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

// POST /api/chat responde SSE; EventSource no soporta POST, así que se lee con fetch + reader.
async function chat(body: { student_id: string; message: string; conversation_id?: string; image_base64?: string }, h: ChatHandlers, signal?: AbortSignal) {
  const t = await token()
  const res = await fetch(`${API_URL}/api/chat`, { method: 'POST', signal, headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', ...(t ? { Authorization: `Bearer ${t}` } : {}) }, body: JSON.stringify(body) })
  if (!res.ok || !res.body) {
    let e = { code: 'http_' + res.status, message: 'No pudimos hablar con el tutor.' }
    try { e = ((await res.json()) as ApiErrorBody).error } catch { /* sin cuerpo */ }
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
      const bloque = buf.slice(0, i); buf = buf.slice(i + 2)
      let evento = 'message', data = ''
      for (const linea of bloque.split('\n')) {
        if (linea.startsWith('event:')) evento = linea.slice(6).trim()
        else if (linea.startsWith('data:')) data += linea.slice(5).trim()
      }
      if (!data) continue
      const d = JSON.parse(data)
      if (evento === 'status') h.onStatus?.(d)
      else if (evento === 'text') h.onText?.(d.delta)
      else if (evento === 'done') h.onDone?.(d)
      else if (evento === 'error') h.onError?.(d.error ?? d)
    }
  }
}

const real = {
  plan: (careerId: number) => pedir<Plan>(`/api/careers/${careerId}/plan`),
  me: () => pedir<{ student_id: string | null }>('/api/me'),
  createStudent: (name: string, career_id: number) => pedir<{ student_id: string }>('/api/students', { method: 'POST', body: JSON.stringify({ name, career_id }) }),
  tree: (id: string) => pedir<Tree>(`/api/students/${id}/tree`),
  alerts: (id: string) => pedir<Alert[]>(`/api/students/${id}/alerts`),
  dismissAlert: (id: string, alertId: string) => pedir<void>(`/api/students/${id}/alerts/${alertId}/dismiss`, { method: 'POST' }),
  setSubject: (id: string, subjectId: number, state: Exclude<SubjectState, 'available' | 'locked'>) => pedir<Tree>(`/api/students/${id}/subjects/${subjectId}`, { method: 'PUT', body: JSON.stringify({ state }) }),
  activity: (id: string, a: Activity) => pedir<Tree>(`/api/students/${id}/activity`, { method: 'POST', body: JSON.stringify(a) }),
  conversation: (id: string, conversationId: string) => pedir<{ conversation_id: string; messages: ChatMessage[] }>(`/api/students/${id}/conversations/${conversationId}`),
  schedule: (student_id: string, subject_ids: number[], preferences?: SchedulePreferences) => pedir<ScheduleResult>('/api/schedule', { method: 'POST', body: JSON.stringify({ student_id, subject_ids, preferences }) }),
  chat,
}

export type Api = typeof real
export const api: Api = MOCK ? mockApi : real
