// Server data cache (TanStack Query): a page already seen shows its data at once and refreshes it in
// the background. Every query key is here, so a change knows what to invalidate.
import { QueryClient } from '@tanstack/react-query'
import { api, ApiError } from './api'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      // 4xx errors (not found, forbidden, expired token) do not get better by retrying
      retry: (n, e) => n < 2 && !(e instanceof ApiError && e.status < 500),
    },
  },
})

export const keys = {
  faculties: ['faculties'],
  plan: (careerId: number) => ['plan', careerId],
  me: (uid: string) => ['me', uid],
  tree: (studentId: string) => ['tree', studentId],
  alerts: (studentId: string) => ['alerts', studentId],
  conversation: (studentId: string, id: string) => ['conversation', studentId, id],
  teacher: ['teacher'],
  teacherSubject: (subjectId: number) => ['teacher', 'subjects', subjectId],
}

// public data that does not change while the app is open
export const facultiesQuery = { queryKey: keys.faculties, queryFn: api.faculties, staleTime: Infinity }
export const planQuery = (careerId: number) => ({ queryKey: keys.plan(careerId), queryFn: () => api.plan(careerId), staleTime: Infinity })
export const teacherSubjectQuery = (subjectId: number) => ({ queryKey: keys.teacherSubject(subjectId), queryFn: () => api.teacherSubject(subjectId) })
