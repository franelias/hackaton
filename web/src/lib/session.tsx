import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { onAuthStateChanged, signOut, type User } from 'firebase/auth'
import { api, ApiError } from './api'
import { MOCK } from './config'
import { firebaseAuth } from './firebase'
import { withHealthOverride } from './healthOverride'
import { disablePush, syncPush } from './push'
import { keys, planQuery, queryClient } from './queries'
import type { Alert, Me, Plan, Tree } from './types'

interface Session {
  loading: boolean
  user: Pick<User, 'uid' | 'displayName' | 'email'> | null
  studentId: string | null
  teacherId: string | null
  plan: Plan | null
  tree: Tree | null
  alerts: Alert[]
  error: string | null
  setStudentId: (id: string) => void
  setTree: (t: Tree) => void
  refresh: () => Promise<void>
  logOut: () => Promise<void>
  reloadUser: () => void
}

const Ctx = createContext<Session | null>(null)
export const useSession = () => { const c = useContext(Ctx); if (!c) throw new Error('useSession outside <SessionProvider>'); return c }

const demoUser = { uid: 'demo', displayName: 'Ana', email: 'ana@arbol.demo' }
const noAlerts: Alert[] = []

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Session['user']>(MOCK ? demoUser : null)
  const [authReady, setAuthReady] = useState(MOCK)

  useEffect(() => { const a = firebaseAuth(); if (!a) return; return onAuthStateChanged(a, u => { setUser(u ? { uid: u.uid, displayName: u.displayName, email: u.email } : null); setAuthReady(true) }) }, [])
  // nothing cached survives a change of user
  const uid = user?.uid
  useEffect(() => { if (authReady && !uid) queryClient.clear() }, [authReady, uid])

  // signed in: does the user already have a student? is it a teacher?
  const me = useQuery({ queryKey: keys.me(uid ?? ''), queryFn: api.me, enabled: authReady && !!uid })
  const studentId = me.data?.student_id ?? null, teacherId = me.data?.teacher_id ?? null
  const tree = useQuery({ queryKey: keys.tree(studentId ?? ''), queryFn: () => api.tree(studentId!), enabled: !!studentId, select: withHealthOverride })
  const alerts = useQuery({ queryKey: keys.alerts(studentId ?? ''), queryFn: () => api.alerts(studentId!), enabled: !!studentId })
  // the plan is the one of the student's career; it is public and does not change
  const careerId = tree.data?.career_id
  const plan = useQuery({ ...planQuery(careerId ?? 0), enabled: careerId != null })

  const setStudentId = useCallback((id: string) => { if (uid) queryClient.setQueryData<Me>(keys.me(uid), m => ({ teacher_id: null, ...m, student_id: id })) }, [uid])
  const setTree = useCallback((t: Tree) => queryClient.setQueryData(keys.tree(t.student_id), t), [])
  const refresh = useCallback(async () => { await Promise.all([queryClient.invalidateQueries({ queryKey: ['tree'] }), queryClient.invalidateQueries({ queryKey: ['alerts'] })]) }, [])
  const reloadUser = useCallback(() => { const u = firebaseAuth()?.currentUser; if (u) setUser({ uid: u.uid, displayName: u.displayName, email: u.email }) }, [])

  // the mail is verified from a link in another tab: back here, the cached token
  // still says email_verified false and the backend would not see a teacher
  useEffect(() => {
    const check = async () => { const u = firebaseAuth()?.currentUser; if (!u || u.emailVerified || document.visibilityState !== 'visible') return
      await u.reload(); if (!u.emailVerified) return
      await u.getIdToken(true); reloadUser(); await queryClient.invalidateQueries({ queryKey: keys.me(u.uid) }) }
    const onVisible = () => { check().catch(() => { /* try again next time */ }) }
    document.addEventListener('visibilitychange', onVisible); window.addEventListener('focus', onVisible)
    return () => { document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('focus', onVisible) }
  }, [reloadUser])

  // on log out, this browser stops receiving this student's reminders
  const logOut = useCallback(async () => { const a = firebaseAuth(); if (studentId) await disablePush(studentId).catch(() => {}); if (a) await signOut(a); queryClient.clear() }, [studentId])
  useEffect(() => { if (studentId && !MOCK) syncPush(studentId).catch(() => { /* no push is fine */ }) }, [studentId])
  // expired or invalid token: back to the login; any other error is shown
  const failure = me.error ?? tree.error ?? alerts.error
  useEffect(() => { if (failure instanceof ApiError && failure.status === 401) logOut() }, [failure, logOut])
  const error = failure?.message ?? (plan.error ? `No pudimos cargar el plan: ${plan.error.message}` : null)

  const loading = !authReady || (!!uid && me.isPending)
  const v = useMemo<Session>(() => ({ loading, user, studentId, teacherId, plan: plan.data ?? null, tree: tree.data ?? null, alerts: alerts.data ?? noAlerts, error, setStudentId, setTree, refresh, logOut, reloadUser }),
    [loading, user, studentId, teacherId, plan.data, tree.data, alerts.data, error, setStudentId, setTree, refresh, logOut, reloadUser])
  return <Ctx.Provider value={v}>{children}</Ctx.Provider>
}
