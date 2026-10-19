import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { onAuthStateChanged, signOut, type User } from 'firebase/auth'
import { api, ApiError } from './api'
import { CAREER_ID, MOCK } from './config'
import { firebaseAuth } from './firebase'
import type { Alert, Plan, Tree } from './types'

interface Sesion {
  cargando: boolean
  usuario: Pick<User, 'uid' | 'displayName' | 'email'> | null
  studentId: string | null
  plan: Plan | null
  tree: Tree | null
  alerts: Alert[]
  error: string | null
  setStudentId: (id: string) => void
  setTree: (t: Tree) => void
  refrescar: () => Promise<void>
  salir: () => Promise<void>
  recargarUsuario: () => void
}

const Ctx = createContext<Sesion | null>(null)
export const useSesion = () => { const c = useContext(Ctx); if (!c) throw new Error('useSesion fuera de <SesionProvider>'); return c }

const usuarioDemo = { uid: 'demo', displayName: 'Ana', email: 'ana@arbol.demo' }

export function SesionProvider({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<Sesion['usuario']>(MOCK ? usuarioDemo : null)
  const [authListo, setAuthListo] = useState(MOCK)
  const [studentId, setStudentId] = useState<string | null>(null)
  const [plan, setPlan] = useState<Plan | null>(null)
  const [tree, setTree] = useState<Tree | null>(null)
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { const a = firebaseAuth(); if (!a) return; return onAuthStateChanged(a, u => { setUsuario(u ? { uid: u.uid, displayName: u.displayName, email: u.email } : null); setAuthListo(true) }) }, [])

  // el plan es público y no cambia
  useEffect(() => { api.plan(CAREER_ID).then(setPlan).catch(e => setError(`No pudimos cargar el plan: ${e.message}`)) }, [])

  // con usuario: ¿ya tiene alumno?
  useEffect(() => {
    if (!authListo) return
    if (!usuario) { setStudentId(null); setTree(null); setCargando(false); return }
    setCargando(true)
    api.me().then(r => setStudentId(r.student_id)).catch(e => setError(e.message)).finally(() => setCargando(false))
  }, [authListo, usuario])

  const refrescar = useCallback(async () => {
    if (!studentId) return
    const [t, a] = await Promise.all([api.tree(studentId), api.alerts(studentId)])
    setTree(t); setAlerts(a)
  }, [studentId])
  const salir = useCallback(async () => { const a = firebaseAuth(); if (a) await signOut(a) }, [])
  const recargarUsuario = useCallback(() => { const u = firebaseAuth()?.currentUser; if (u) setUsuario({ uid: u.uid, displayName: u.displayName, email: u.email }) }, [])
  // token vencido o inválido: volver al login; cualquier otro error se muestra
  useEffect(() => { refrescar().catch(e => { if (e instanceof ApiError && e.status === 401) salir(); else setError(e.message) }) }, [refrescar, salir])

  const v = useMemo<Sesion>(() => ({ cargando: cargando || !authListo, usuario, studentId, plan, tree, alerts, error, setStudentId, setTree, refrescar, salir, recargarUsuario }),
    [cargando, authListo, usuario, studentId, plan, tree, alerts, error, refrescar, salir, recargarUsuario])
  return <Ctx.Provider value={v}>{children}</Ctx.Provider>
}
