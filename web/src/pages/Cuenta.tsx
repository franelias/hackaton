import { useState, type FormEvent } from 'react'
import { EmailAuthProvider, reauthenticateWithCredential, sendEmailVerification, sendPasswordResetEmail, updatePassword, updateProfile } from 'firebase/auth'
import { firebaseAuth } from '../lib/firebase'
import { useSesion } from '../lib/session'

const ERRORES: Record<string, string> = {
  'auth/invalid-credential': 'La contraseña actual no es correcta.',
  'auth/wrong-password': 'La contraseña actual no es correcta.',
  'auth/weak-password': 'La contraseña nueva tiene que tener al menos 6 caracteres.',
  'auth/too-many-requests': 'Demasiados intentos. Probá de nuevo en unos minutos.',
  'auth/requires-recent-login': 'Por seguridad, volvé a entrar y probá de nuevo.',
}
const msg = (e: unknown) => ERRORES[(e as { code?: string }).code ?? ''] ?? 'No pudimos guardar el cambio. Probá de nuevo.'

export default function Cuenta() {
  const { usuario, plan, salir, recargarUsuario } = useSesion()
  const auth = firebaseAuth(), u = auth?.currentUser ?? null
  const conClave = u?.providerData.some(p => p.providerId === 'password') ?? false
  const conGoogle = u?.providerData.some(p => p.providerId === 'google.com') ?? false
  const [nombre, setNombre] = useState(usuario?.displayName ?? '')
  const [actual, setActual] = useState(''), [nueva, setNueva] = useState('')
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null)
  const [ocupado, setOcupado] = useState(false)

  const correr = async (f: () => Promise<unknown>, ok: string) => { setOcupado(true); setAviso(null)
    try { await f(); setAviso({ ok: true, texto: ok }) } catch (e) { setAviso({ ok: false, texto: msg(e) }) } finally { setOcupado(false) } }
  const guardarNombre = (e: FormEvent) => { e.preventDefault(); if (!u) return; correr(async () => { await updateProfile(u, { displayName: nombre.trim() }); recargarUsuario() }, 'Guardamos tu nombre.') }
  const cambiarClave = (e: FormEvent) => { e.preventDefault(); if (!u?.email) return
    correr(async () => { await reauthenticateWithCredential(u, EmailAuthProvider.credential(u.email!, actual)); await updatePassword(u, nueva); setActual(''); setNueva('') }, 'Cambiamos tu contraseña.') }

  return (
    <div className="pagina cuenta">
      <header className="saludo"><div><h1>Mi cuenta</h1><p>Tus datos de acceso.</p></div></header>
      {!u && <p className="aviso">Estás en modo demo: estos datos no se pueden cambiar.</p>}
      {aviso && <p className={aviso.ok ? 'aviso' : 'aviso mal'} role="status">{aviso.texto}</p>}

      <section className="tarjeta">
        <h2>Tus datos</h2>
        <form className="fila-form" onSubmit={guardarNombre}>
          <label>Nombre<input value={nombre} onChange={e => setNombre(e.target.value)} disabled={!u} autoComplete="name" /></label>
          <button className="btn secundario" disabled={!u || ocupado || !nombre.trim() || nombre.trim() === (usuario?.displayName ?? '')}>Guardar</button>
        </form>
        <div className="dato-fila"><span>Mail</span><b>{usuario?.email ?? '—'}</b>
          {u && !u.emailVerified && conClave && <button className="enlace" disabled={ocupado} onClick={() => correr(() => sendEmailVerification(u), `Te mandamos un mail a ${u.email} para verificarlo.`)}>Verificar mail</button>}
          {u?.emailVerified && <span className="chip approved">Verificado</span>}</div>
        <div className="dato-fila"><span>Carrera</span><b>{plan?.name ?? '—'}</b></div>
        <div className="dato-fila"><span>Entrás con</span><b>{[conGoogle && 'Google', conClave && 'mail y contraseña'].filter(Boolean).join(' y ') || '—'}</b></div>
      </section>

      {conClave && <section className="tarjeta">
        <h2>Contraseña</h2>
        <form className="columna-form" onSubmit={cambiarClave}>
          <label>Contraseña actual<input type="password" value={actual} onChange={e => setActual(e.target.value)} autoComplete="current-password" required /></label>
          <label>Contraseña nueva<input type="password" value={nueva} onChange={e => setNueva(e.target.value)} autoComplete="new-password" minLength={6} required /></label>
          <div className="fila-botones">
            <button className="btn" disabled={ocupado || !actual || nueva.length < 6}>Cambiar contraseña</button>
            <button type="button" className="enlace" disabled={ocupado} onClick={() => auth && u?.email && correr(() => sendPasswordResetEmail(auth, u.email!), `Te mandamos un link a ${u.email} para elegir una contraseña nueva.`)}>No me acuerdo la actual</button>
          </div>
        </form>
      </section>}
      {conGoogle && !conClave && <section className="tarjeta"><h2>Contraseña</h2><p className="pista">Entrás con Google, así que la contraseña la manejás desde tu cuenta de Google.</p></section>}

      <section className="tarjeta">
        <h2>Cerrar sesión</h2>
        <p className="pista">Tu árbol queda guardado. Podés volver a entrar cuando quieras.</p>
        <button className="btn secundario" onClick={salir} disabled={!u}>Cerrar sesión</button>
      </section>
    </div>
  )
}
