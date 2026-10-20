// Changes to the student's data (TanStack Query mutations). Each one leaves the cache as the server has it.
import { useMutation } from '@tanstack/react-query'
import { api, type SubjectMark } from './api'
import { keys, queryClient } from './queries'
import type { Alert } from './types'

export type TreeChange =
  | { kind: 'checkin' }
  | { kind: 'mark'; subjectId: number; state: SubjectMark['state'] }
  | { kind: 'exam'; subjectId: number; date: string }

const change = (studentId: string, c: TreeChange) => c.kind === 'mark' ? api.setSubject(studentId, c.subjectId, c.state)
  : api.activity(studentId, c.kind === 'checkin' ? { type: 'checkin' } : { type: 'exam', subject_id: c.subjectId, date: c.date })

// the API answers with the new tree, which goes straight into the cache; the alerts may have changed
export function useTreeChange(studentId: string) {
  return useMutation({
    mutationFn: (c: TreeChange) => change(studentId, c),
    onSuccess: t => { queryClient.setQueryData(keys.tree(t.student_id), t); return queryClient.invalidateQueries({ queryKey: keys.alerts(t.student_id) }) },
  })
}

// the alert leaves the list at once; if the server fails, it comes back
export function useDismissAlert(studentId: string) {
  const key = keys.alerts(studentId)
  return useMutation({
    mutationFn: (alertId: string) => api.dismissAlert(studentId, alertId),
    onMutate: async alertId => { await queryClient.cancelQueries({ queryKey: key }); const before = queryClient.getQueryData<Alert[]>(key)
      queryClient.setQueryData<Alert[]>(key, a => a?.filter(x => x.id !== alertId)); return { before } },
    onError: (_e, _id, ctx) => { if (ctx?.before) queryClient.setQueryData(key, ctx.before) },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  })
}

export function useSetNotifications(studentId: string) {
  return useMutation({
    mutationFn: (email: boolean) => api.setNotifications(studentId, { email }),
    onSuccess: prefs => queryClient.setQueryData(keys.notifications(studentId), prefs),
  })
}
