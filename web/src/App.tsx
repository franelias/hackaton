import { BrowserRouter, Navigate, NavLink, Outlet, Route, Routes } from 'react-router-dom'
import { MOCK } from './lib/config'
import { SessionProvider, useSession } from './lib/session'
import Login from './pages/Login'
import Onboarding from './pages/Onboarding'
import MyTree from './pages/MyTree'
import Tutor from './pages/Tutor'
import Schedule from './pages/Schedule'
import Account from './pages/Account'

function Logo() {
  return <svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true"><path d="M13.5 28C14 22 13 19 14 16h2c1 3 0 6 .5 12z" fill="#7a5236" /><circle cx="15" cy="12" r="10" fill="#456d42" /><circle cx="15" cy="10.5" r="9.5" fill="#55804f" /><circle cx="11.5" cy="7.5" r="3.5" fill="#6f9866" /></svg>
}

function Shell() {
  const { user, plan } = useSession()
  const icon = (d: string) => <svg viewBox="0 0 16 16" aria-hidden="true"><path d={d} /></svg>
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand"><Logo />Árbol</div>
        {plan && <div className="career">{plan.name}<small>FCEIA · UNR</small></div>}
        <nav>
          <NavLink to="/" end>{icon('M8 15V7M8 10 4 6M8 9l4-4')}Mi árbol</NavLink>
          <NavLink to="/tutor">{icon('M2 3h12v8H6l-4 3z')}Tutor</NavLink>
          <NavLink to="/schedule">{icon('M2 4h12v10H2zM2 7h12M6 4v10')}Horarios</NavLink>
        </nav>
        <NavLink to="/account" className="user">
          <span className="avatar">{(user?.displayName ?? user?.email ?? '?').slice(0, 1).toUpperCase()}</span>
          <div><b>{user?.displayName ?? user?.email}</b><small>{MOCK ? 'Modo demo' : 'Mi cuenta'}</small></div>
        </NavLink>
      </aside>
      <main className="content"><Outlet /></main>
    </div>
  )
}

function Guard() {
  const { loading, user, studentId, error } = useSession()
  if (loading) return <div className="centered">Cargando tu árbol…</div>
  if (!user) return <Navigate to="/login" replace />
  if (!studentId) return error ? <div className="centered error">{error}</div> : <Navigate to="/start" replace />
  return <Shell />
}

export default function App() {
  return (
    <SessionProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/start" element={<Onboarding />} />
          <Route element={<Guard />}>
            <Route index element={<MyTree />} />
            <Route path="tutor" element={<Tutor />} />
            <Route path="schedule" element={<Schedule />} />
            <Route path="account" element={<Account />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </SessionProvider>
  )
}
