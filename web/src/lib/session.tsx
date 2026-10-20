import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { onAuthStateChanged, signOut, type User } from 'firebase/auth'
import { api, ApiError } from './api'
import { MOCK } from './config'
import { firebaseAuth } from './firebase'
import type { Alert, Plan, Tree } from './types'

interface Session {
  loading: boolean
  user: Pick<User, 'uid' | 'displayName' | 'email'> | null
  studentId: string | null
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

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Session['user']>(MOCK ? demoUser : null)
  const [authReady, setAuthReady] = useState(MOCK)
  const [studentId, setStudentId] = useState<string | null>(null)
  const [plan, setPlan] = useState<Plan | null>(null)
  const [tree, setTree] = useState<Tree | null>(null)
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { const a = firebaseAuth(); if (!a) return; return onAuthStateChanged(a, u => { setUser(u ? { uid: u.uid, displayName: u.displayName, email: u.email } : null); setAuthReady(true) }) }, [])

  // the plan is the one of the student's career; it is public and does not change
  const careerId = tree?.career_id
  useEffect(() => { if (careerId == null) return; api.plan(careerId).then(setPlan).catch(e => setError(`No pudimos cargar el plan: ${e.message}`)) }, [careerId])

  // signed in: does the user already have a student?
  useEffect(() => {
    if (!authReady) return
    if (!user) { setStudentId(null); setTree(null); setLoading(false); return }
    setLoading(true)
    api.me().then(r => setStudentId(r.student_id)).catch(e => setError(e.message)).finally(() => setLoading(false))
  }, [authReady, user])

  const refresh = useCallback(async () => {
    if (!studentId) return
    const [t, a] = await Promise.all([api.tree(studentId), api.alerts(studentId)])
    setTree(t); setAlerts(a)
  }, [studentId])
  const logOut = useCallback(async () => { const a = firebaseAuth(); if (a) await signOut(a) }, [])
  const reloadUser = useCallback(() => { const u = firebaseAuth()?.currentUser; if (u) setUser({ uid: u.uid, displayName: u.displayName, email: u.email }) }, [])
  // expired or invalid token: back to the login; any other error is shown
  useEffect(() => { refresh().catch(e => { if (e instanceof ApiError && e.status === 401) logOut(); else setError(e.message) }) }, [refresh, logOut])

  const v = useMemo<Session>(() => ({ loading: loading || !authReady, user, studentId, plan, tree, alerts, error, setStudentId, setTree, refresh, logOut, reloadUser }),
    [loading, authReady, user, studentId, plan, tree, alerts, error, refresh, logOut, reloadUser])
  return <Ctx.Provider value={v}>{children}</Ctx.Provider>
}
