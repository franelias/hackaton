import { BrowserRouter, Navigate, NavLink, Outlet, Route, Routes } from 'react-router-dom'
import { MOCK } from './lib/config'
import { SesionProvider, useSesion } from './lib/session'
import Login from './pages/Login'
import Onboarding from './pages/Onboarding'
import MiArbol from './pages/MiArbol'
import Tutor from './pages/Tutor'
import Horarios from './pages/Horarios'
import Cuenta from './pages/Cuenta'

function Logo() {
  return <svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true"><path d="M13.5 28C14 22 13 19 14 16h2c1 3 0 6 .5 12z" fill="#7a5236" /><circle cx="15" cy="12" r="10" fill="#456d42" /><circle cx="15" cy="10.5" r="9.5" fill="#55804f" /><circle cx="11.5" cy="7.5" r="3.5" fill="#6f9866" /></svg>
}

function Marco() {
  const { usuario, plan } = useSesion()
  const icono = (d: string) => <svg viewBox="0 0 16 16" aria-hidden="true"><path d={d} /></svg>
  return (
    <div className="marco">
      <aside className="lateral">
        <div className="marca"><Logo />Árbol</div>
        {plan && <div className="carrera">{plan.name}<small>FCEIA · UNR</small></div>}
        <nav>
          <NavLink to="/" end>{icono('M8 15V7M8 10 4 6M8 9l4-4')}Mi árbol</NavLink>
          <NavLink to="/tutor">{icono('M2 3h12v8H6l-4 3z')}Tutor</NavLink>
          <NavLink to="/horarios">{icono('M2 4h12v10H2zM2 7h12M6 4v10')}Horarios</NavLink>
        </nav>
        <NavLink to="/cuenta" className="usuario">
          <span className="avatar">{(usuario?.displayName ?? usuario?.email ?? '?').slice(0, 1).toUpperCase()}</span>
          <div><b>{usuario?.displayName ?? usuario?.email}</b><small>{MOCK ? 'Modo demo' : 'Mi cuenta'}</small></div>
        </NavLink>
      </aside>
      <main className="contenido"><Outlet /></main>
    </div>
  )
}

function Guardia() {
  const { cargando, usuario, studentId, error } = useSesion()
  if (cargando) return <div className="centrado">Cargando tu árbol…</div>
  if (!usuario) return <Navigate to="/entrar" replace />
  if (!studentId) return error ? <div className="centrado error">{error}</div> : <Navigate to="/empezar" replace />
  return <Marco />
}

export default function App() {
  return (
    <SesionProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/entrar" element={<Login />} />
          <Route path="/empezar" element={<Onboarding />} />
          <Route element={<Guardia />}>
            <Route index element={<MiArbol />} />
            <Route path="tutor" element={<Tutor />} />
            <Route path="horarios" element={<Horarios />} />
            <Route path="cuenta" element={<Cuenta />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </SesionProvider>
  )
}
