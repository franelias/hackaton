import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { createUserWithEmailAndPassword, sendPasswordResetEmail, signInWithEmailAndPassword, signInWithPopup, updateProfile } from 'firebase/auth'
import { firebaseAuth, googleProvider } from '../lib/firebase'
import { useSesion } from '../lib/session'

const errores: Record<string, string> = {
  'auth/invalid-credential': 'El mail o la contraseña no coinciden.',
  'auth/email-already-in-use': 'Ya hay una cuenta con ese mail. Probá entrar.',
  'auth/weak-password': 'La contraseña tiene que tener al menos 6 caracteres.',
  'auth/invalid-email': 'Ese mail no parece válido.',
  'auth/popup-closed-by-user': 'Cerraste la ventana de Google antes de terminar.',
}

export default function Login() {
  const { usuario, cargando } = useSesion()
  const [modo, setModo] = useState<'entrar' | 'crear'>('entrar')
  const [nombre, setNombre] = useState(''), [mail, setMail] = useState(''), [clave, setClave] = useState('')
  const [error, setError] = useState<string | null>(null), [enviando, setEnviando] = useState(false), [aviso, setAviso] = useState<string | null>(null)
  if (!cargando && usuario) return <Navigate to="/" replace />
  const auth = firebaseAuth()

  const correr = async (f: () => Promise<unknown>) => {
    setError(null); setEnviando(true)
    try { await f() } catch (e) { const code = (e as { code?: string }).code ?? ''; setError(errores[code] ?? 'No pudimos entrar. Probá de nuevo.') } finally { setEnviando(false) }
  }
  const olvide = () => { if (!auth) return; setAviso(null)
    if (!mail) { setError('Escribí tu mail arriba y te mandamos un link para elegir otra contraseña.'); return }
    correr(async () => { await sendPasswordResetEmail(auth, mail); setAviso(`Si hay una cuenta con ${mail}, te llega un mail con un link para elegir otra contraseña.`) }) }
  const enviar = (ev: FormEvent) => { ev.preventDefault(); if (!auth) return
    correr(async () => { if (modo === 'entrar') await signInWithEmailAndPassword(auth, mail, clave)
      else { const c = await createUserWithEmailAndPassword(auth, mail, clave); if (nombre) await updateProfile(c.user, { displayName: nombre }) } }) }

  return (
    <div className="entrada">
      <div className="entrada-caja">
        <h1>Árbol</h1>
        <p>Tu carrera, como un árbol que crece con lo que estudiás.</p>
        <button className="btn secundario ancho" disabled={!auth || enviando} onClick={() => auth && correr(() => signInWithPopup(auth, googleProvider))}>Entrar con Google</button>
        <div className="separador">o con tu mail</div>
        <form onSubmit={enviar}>
          {modo === 'crear' && <label>Tu nombre<input value={nombre} onChange={e => setNombre(e.target.value)} autoComplete="name" /></label>}
          <label>Mail<input type="email" required value={mail} onChange={e => setMail(e.target.value)} autoComplete="email" /></label>
          <label>Contraseña<input type="password" required minLength={6} value={clave} onChange={e => setClave(e.target.value)} autoComplete={modo === 'entrar' ? 'current-password' : 'new-password'} /></label>
          {error && <p className="error" role="alert">{error}</p>}
          {aviso && <p className="aviso" role="status">{aviso}</p>}
          <button className="btn ancho" disabled={!auth || enviando}>{modo === 'entrar' ? 'Entrar' : 'Crear cuenta'}</button>
          {modo === 'entrar' && <button type="button" className="enlace" disabled={!auth || enviando} onClick={olvide}>Me olvidé la contraseña</button>}
        </form>
        <button className="enlace" onClick={() => { setModo(modo === 'entrar' ? 'crear' : 'entrar'); setError(null) }}>
          {modo === 'entrar' ? '¿No tenés cuenta? Creala' : '¿Ya tenés cuenta? Entrá'}</button>
      </div>
    </div>
  )
}
