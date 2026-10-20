import { useEffect, useState, type FormEvent } from 'react'
import { EmailAuthProvider, reauthenticateWithCredential, sendEmailVerification, sendPasswordResetEmail, updatePassword, updateProfile } from 'firebase/auth'
import { firebaseAuth } from '../lib/firebase'
import { api } from '../lib/api'
import { disablePush, enablePush, pushState, type PushState } from '../lib/push'
import { useSession } from '../lib/session'
import type { NotificationPrefs } from '../lib/types'

const ERRORS: Record<string, string> = {
  'auth/invalid-credential': 'La contraseña actual no es correcta.',
  'auth/wrong-password': 'La contraseña actual no es correcta.',
  'auth/weak-password': 'La contraseña nueva tiene que tener al menos 6 caracteres.',
  'auth/too-many-requests': 'Demasiados intentos. Probá de nuevo en unos minutos.',
  'auth/requires-recent-login': 'Por seguridad, volvé a entrar y probá de nuevo.',
  'push/denied': 'Sin tu permiso no podemos mandarte notificaciones.',
}
const errorText = (e: unknown) => ERRORS[(e as { code?: string }).code ?? ''] ?? 'No pudimos guardar el cambio. Probá de nuevo.'

export default function Account() {
  const { user, studentId, plan, logOut, reloadUser } = useSession()
  const auth = firebaseAuth(), u = auth?.currentUser ?? null
  const withPassword = u?.providerData.some(p => p.providerId === 'password') ?? false
  const withGoogle = u?.providerData.some(p => p.providerId === 'google.com') ?? false
  const [name, setName] = useState(user?.displayName ?? '')
  const [current, setCurrent] = useState(''), [next, setNext] = useState('')
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null)
  const [push, setPush] = useState<PushState | null>(null)

  useEffect(() => { if (!studentId) return; api.notifications(studentId).then(setPrefs).catch(() => {}); pushState().then(setPush).catch(() => setPush('unsupported')) }, [studentId])

  const run = async (f: () => Promise<unknown>, ok: string) => { setBusy(true); setNotice(null)
    try { await f(); setNotice({ ok: true, text: ok }) } catch (e) { setNotice({ ok: false, text: errorText(e) }) } finally { setBusy(false) } }
  const saveName = (e: FormEvent) => { e.preventDefault(); if (!u) return; run(async () => { await updateProfile(u, { displayName: name.trim() }); reloadUser() }, 'Guardamos tu nombre.') }
  const changeEmail = (email: boolean) => { if (!studentId) return
    run(async () => setPrefs(await api.setNotifications(studentId, { email })), email ? 'Te vamos a mandar los recordatorios por mail.' : 'Listo, no te mandamos más mails.') }
  const togglePush = () => { if (!studentId) return
    if (push === 'on') run(async () => { await disablePush(studentId); setPush('off') }, 'Este dispositivo ya no recibe notificaciones.')
    else run(async () => { const st = await enablePush(studentId); setPush(st); if (st !== 'on') throw Object.assign(new Error('permission'), { code: 'push/denied' }) }, 'Listo, te avisamos en este dispositivo.') }
  const changePassword = (e: FormEvent) => { e.preventDefault(); if (!u?.email) return
    run(async () => { await reauthenticateWithCredential(u, EmailAuthProvider.credential(u.email!, current)); await updatePassword(u, next); setCurrent(''); setNext('') }, 'Cambiamos tu contraseña.') }

  return (
    <div className="page account">
      <header className="greeting"><div><h1>Mi cuenta</h1><p>Tus datos de acceso.</p></div></header>
      {!u && <p className="notice">Estás en modo demo: estos datos no se pueden cambiar.</p>}
      {notice && <p className={notice.ok ? 'notice' : 'notice bad'} role="status">{notice.text}</p>}

      <section className="card">
        <h2>Tus datos</h2>
        <form className="form-row" onSubmit={saveName}>
          <label>Nombre<input value={name} onChange={e => setName(e.target.value)} disabled={!u} autoComplete="name" /></label>
          <button className="btn secondary" disabled={!u || busy || !name.trim() || name.trim() === (user?.displayName ?? '')}>Guardar</button>
        </form>
        <div className="info-row"><span>Mail</span><b>{user?.email ?? '—'}</b>
          {u && !u.emailVerified && withPassword && <button className="link" disabled={busy} onClick={() => run(() => sendEmailVerification(u), `Te mandamos un mail a ${u.email} para verificarlo.`)}>Verificar mail</button>}
          {u?.emailVerified && <span className="chip approved">Verificado</span>}</div>
        <div className="info-row"><span>Carrera</span><b>{plan?.name ?? '—'}</b></div>
        <div className="info-row"><span>Entrás con</span><b>{[withGoogle && 'Google', withPassword && 'mail y contraseña'].filter(Boolean).join(' y ') || '—'}</b></div>
      </section>

      {withPassword && <section className="card">
        <h2>Contraseña</h2>
        <form className="column-form" onSubmit={changePassword}>
          <label>Contraseña actual<input type="password" value={current} onChange={e => setCurrent(e.target.value)} autoComplete="current-password" required /></label>
          <label>Contraseña nueva<input type="password" value={next} onChange={e => setNext(e.target.value)} autoComplete="new-password" minLength={6} required /></label>
          <div className="button-row">
            <button className="btn" disabled={busy || !current || next.length < 6}>Cambiar contraseña</button>
            <button type="button" className="link" disabled={busy} onClick={() => auth && u?.email && run(() => sendPasswordResetEmail(auth, u.email!), `Te mandamos un link a ${u.email} para elegir una contraseña nueva.`)}>No me acuerdo la actual</button>
          </div>
        </form>
      </section>}
      {withGoogle && !withPassword && <section className="card"><h2>Contraseña</h2><p className="hint">Entrás con Google, así que la contraseña la manejás desde tu cuenta de Google.</p></section>}

      <section className="card">
        <h2>Recordatorios</h2>
        <p className="hint">Te avisamos cuando tu racha está por cortarse, tu árbol se está por marchitar, hace mucho que no estudiás una materia o se vienen las mesas y tenés finales pendientes. Como mucho uno por día.</p>
        <div className="info-row"><span>Mail</span>
          <label className="toggle"><input type="checkbox" checked={prefs?.email ?? false} disabled={!prefs || busy} onChange={e => changeEmail(e.target.checked)} />{prefs?.email ? 'Activados' : 'Apagados'}</label></div>
        <div className="info-row"><span>Este dispositivo</span>
          {push === 'unsupported' && <b className="hint">{u ? 'Este navegador no puede recibir notificaciones.' : 'No disponible en modo demo.'}</b>}
          {push === 'blocked' && <b className="hint">Bloqueaste las notificaciones de Árbol. Habilitalas desde la configuración del sitio en tu navegador.</b>}
          {(push === 'on' || push === 'off') && <><b>{push === 'on' ? 'Notificaciones activadas' : 'Sin notificaciones'}</b>
            <button className="link" disabled={busy} onClick={togglePush}>{push === 'on' ? 'Desactivar' : 'Activar'}</button></>}
        </div>
      </section>

      <section className="card">
        <h2>Cerrar sesión</h2>
        <p className="hint">Tu árbol queda guardado. Podés volver a entrar cuando quieras.</p>
        <button className="btn secondary" onClick={logOut} disabled={!u}>Cerrar sesión</button>
      </section>
    </div>
  )
}
