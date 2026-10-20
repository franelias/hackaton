import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { createUserWithEmailAndPassword, sendPasswordResetEmail, signInWithEmailAndPassword, signInWithPopup, updateProfile } from 'firebase/auth'
import { firebaseAuth, googleProvider } from '../lib/firebase'
import { useSession } from '../lib/session'
import Logo from '@/components/Logo'
import { InlineError } from '@/components/Page'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'

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
    <div className="grid min-h-dvh lg:grid-cols-[1fr_1.1fr]">
      <div className="flex flex-col justify-center px-4 py-10 sm:px-10">
        <div className="mx-auto flex w-full max-w-sm flex-col gap-6">
          <div className="flex flex-col gap-3">
            <span className="flex items-center gap-2 text-xl font-extrabold"><Logo size={26} />Mamo</span>
            <h1 className="text-3xl leading-tight font-extrabold tracking-tight">{mode === 'signIn' ? 'Entrá a tu árbol' : 'Creá tu cuenta'}</h1>
            <p className="text-muted-foreground">Tu carrera, como un árbol que crece con lo que estudiás.</p>
          </div>

          <Button variant="outline" size="lg" className="w-full" disabled={!auth || sending} onClick={() => auth && run(() => signInWithPopup(auth, googleProvider))}>
            <svg viewBox="0 0 48 48" className="size-5" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" /><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" /><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" /><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" /></svg>
            Entrar con Google
          </Button>

          <div className="flex items-center gap-3 text-sm text-muted-foreground"><Separator className="flex-1" />o con tu mail<Separator className="flex-1" /></div>

          <form onSubmit={submit} className="flex flex-col gap-4">
            {mode === 'signUp' && <div className="flex flex-col gap-2"><Label htmlFor="name">Tu nombre</Label><Input id="name" value={name} onChange={e => setName(e.target.value)} autoComplete="name" /></div>}
            <div className="flex flex-col gap-2"><Label htmlFor="email">Mail</Label><Input id="email" type="email" required value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" /></div>
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Contraseña</Label>
                {mode === 'signIn' && <Button type="button" variant="link" size="xs" className="h-auto px-0" disabled={!auth || sending} onClick={forgotPassword}>Me olvidé la contraseña</Button>}
              </div>
              <Input id="password" type="password" required minLength={6} value={password} onChange={e => setPassword(e.target.value)} autoComplete={mode === 'signIn' ? 'current-password' : 'new-password'} />
            </div>
            {error && <InlineError>{error}</InlineError>}
            {notice && <Alert role="status" className="border-transparent bg-accent"><AlertDescription className="text-accent-foreground">{notice}</AlertDescription></Alert>}
            <Button size="lg" className="w-full" disabled={!auth || sending}>{mode === 'signIn' ? 'Entrar' : 'Crear cuenta'}</Button>
          </form>

          <p className="text-center text-sm text-muted-foreground">
            {mode === 'signIn' ? '¿No tenés cuenta?' : '¿Ya tenés cuenta?'}{' '}
            <Button variant="link" className="h-auto px-0" onClick={() => { setMode(mode === 'signIn' ? 'signUp' : 'signIn'); setError(null) }}>
              {mode === 'signIn' ? 'Creala' : 'Entrá'}</Button>
          </p>
        </div>
      </div>
      {/* the same sky and hills as the tree, as the brand image */}
      <div aria-hidden="true" className="relative hidden overflow-hidden bg-[linear-gradient(#d5e8ef,#f1f3e8_60%,#f9e2b4)] lg:block">
        <svg viewBox="0 0 600 800" preserveAspectRatio="xMidYMax slice" className="absolute inset-0 size-full">
          <ellipse cx="300" cy="640" rx="320" ry="220" fill="#f9dfae" opacity=".55" />
          <path d="M0 640C140 600 260 600 330 630 430 670 520 610 600 620V800H0Z" fill="#a9c08a" />
          <path d="M0 700C140 676 260 684 370 700 480 714 540 684 600 690V800H0Z" fill="#8fae6a" />
          <path d="M276 720c4-90-2-140 10-200h28c12 60 6 110 10 200z" fill="#7a5236" />
          <circle cx="300" cy="430" r="150" fill="#456d42" /><circle cx="300" cy="410" r="142" fill="#55804f" /><circle cx="250" cy="360" r="56" fill="#6f9866" />
          <path d="M0 750C200 730 380 742 600 740V800H0Z" fill="#7a9c58" />
        </svg>
      </div>
    </div>
  )
}
