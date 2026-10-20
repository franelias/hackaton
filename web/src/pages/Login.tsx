import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { createUserWithEmailAndPassword, sendPasswordResetEmail, signInWithEmailAndPassword, signInWithPopup, updateProfile } from 'firebase/auth'
import { firebaseAuth, googleProvider } from '../lib/firebase'
import { useSession } from '../lib/session'

const errorMessages: Record<string, string> = {
  'auth/invalid-credential': 'El mail o la contraseña no coinciden.',
  'auth/email-already-in-use': 'Ya hay una cuenta con ese mail. Probá entrar.',
  'auth/weak-password': 'La contraseña tiene que tener al menos 6 caracteres.',
  'auth/invalid-email': 'Ese mail no parece válido.',
  'auth/popup-closed-by-user': 'Cerraste la ventana de Google antes de terminar.',
}

export default function Login() {
  const { user, loading } = useSession()
  const [mode, setMode] = useState<'signIn' | 'signUp'>('signIn')
  const [name, setName] = useState(''), [email, setEmail] = useState(''), [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null), [sending, setSending] = useState(false), [notice, setNotice] = useState<string | null>(null)
  if (!loading && user) return <Navigate to="/" replace />
  const auth = firebaseAuth()

  const run = async (f: () => Promise<unknown>) => {
    setError(null); setSending(true)
    try { await f() } catch (e) { const code = (e as { code?: string }).code ?? ''; setError(errorMessages[code] ?? 'No pudimos entrar. Probá de nuevo.') } finally { setSending(false) }
  }
  const forgotPassword = () => { if (!auth) return; setNotice(null)
    if (!email) { setError('Escribí tu mail arriba y te mandamos un link para elegir otra contraseña.'); return }
    run(async () => { await sendPasswordResetEmail(auth, email); setNotice(`Si hay una cuenta con ${email}, te llega un mail con un link para elegir otra contraseña.`) }) }
  const submit = (ev: FormEvent) => { ev.preventDefault(); if (!auth) return
    run(async () => { if (mode === 'signIn') await signInWithEmailAndPassword(auth, email, password)
      else { const c = await createUserWithEmailAndPassword(auth, email, password); if (name) await updateProfile(c.user, { displayName: name }) } }) }

  return (
    <div className="login">
      <div className="login-box">
        <h1>Árbol</h1>
        <p>Tu carrera, como un árbol que crece con lo que estudiás.</p>
        <button className="btn secondary full" disabled={!auth || sending} onClick={() => auth && run(() => signInWithPopup(auth, googleProvider))}>Entrar con Google</button>
        <div className="divider">o con tu mail</div>
        <form onSubmit={submit}>
          {mode === 'signUp' && <label>Tu name<input value={name} onChange={e => setName(e.target.value)} autoComplete="name" /></label>}
          <label>Mail<input type="email" required value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" /></label>
          <label>Contraseña<input type="password" required minLength={6} value={password} onChange={e => setPassword(e.target.value)} autoComplete={mode === 'signIn' ? 'current-password' : 'new-password'} /></label>
          {error && <p className="error" role="alert">{error}</p>}
          {notice && <p className="notice" role="status">{notice}</p>}
          <button className="btn full" disabled={!auth || sending}>{mode === 'signIn' ? 'Entrar' : 'Crear cuenta'}</button>
          {mode === 'signIn' && <button type="button" className="link" disabled={!auth || sending} onClick={forgotPassword}>Me olvidé la contraseña</button>}
        </form>
        <button className="link" onClick={() => { setMode(mode === 'signIn' ? 'signUp' : 'signIn'); setError(null) }}>
          {mode === 'signIn' ? '¿No tenés cuenta? Creala' : '¿Ya tenés cuenta? Entrá'}</button>
      </div>
    </div>
  )
}
