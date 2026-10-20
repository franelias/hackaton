import { useState, type FormEvent, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { EmailAuthProvider, reauthenticateWithCredential, sendEmailVerification, sendPasswordResetEmail, updatePassword, updateProfile } from 'firebase/auth'
import { api } from '../lib/api'
import { API_URL } from '../lib/config'
import { firebaseAuth } from '../lib/firebase'
import { useSetNotifications } from '../lib/mutations'
import { disablePush, enablePush, type PushState } from '../lib/push'
import { keys, notificationsQuery, pushQuery, queryClient } from '../lib/queries'
import { useSession } from '../lib/session'
import { useTheme, type Theme } from '@/hooks/use-theme'
import { BadgeCheck, Copy } from 'lucide-react'
import { toast } from 'sonner'
import { Page, PageHeader } from '@/components/Page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

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
  const [busy, setBusy] = useState(false)
  // reminders are per student: a teacher who is not a student has none
  const prefs = useQuery({ ...notificationsQuery(studentId ?? ''), enabled: !!studentId }).data ?? null
  const push = useQuery({ ...pushQuery(studentId ?? ''), enabled: !!studentId }).data ?? null
  const setPush = (st: PushState) => { if (studentId) queryClient.setQueryData(keys.push(studentId), st) }
  const setNotifications = useSetNotifications(studentId ?? '')

  // the MCP token is shown once, right after generating it; it is never read back from the server
  const [mcpToken, setMcpToken] = useState<string | null>(null)
  const mcpCommand = `claude mcp add --transport http arbol ${API_URL || 'https://<host>'}/mcp --header "Authorization: Bearer ${mcpToken}"`
  const copy = (text: string, ok: string) => navigator.clipboard.writeText(text).then(() => toast.success(ok), () => toast.error('No pudimos copiarlo. Seleccionalo y copialo a mano.'))

  const { theme, setTheme } = useTheme()
  const run = async (f: () => Promise<unknown>, ok: string) => { setBusy(true)
    try { await f(); toast.success(ok) } catch (e) { toast.error(errorText(e)) } finally { setBusy(false) } }
  const saveName = (e: FormEvent) => { e.preventDefault(); if (!u) return; run(async () => { await updateProfile(u, { displayName: name.trim() }); reloadUser() }, 'Guardamos tu nombre.') }
  const changeEmail = (email: boolean) => { if (!studentId) return
    run(() => setNotifications.mutateAsync(email), email ? 'Te vamos a mandar los recordatorios por mail.' : 'Listo, no te mandamos más mails.') }
  const togglePush = () => { if (!studentId) return
    if (push === 'on') run(async () => { await disablePush(studentId); setPush('off') }, 'Este dispositivo ya no recibe notificaciones.')
    else run(async () => { const st = await enablePush(studentId); setPush(st); if (st !== 'on') throw Object.assign(new Error('permission'), { code: 'push/denied' }) }, 'Listo, te avisamos en este dispositivo.') }
  const generateMcpToken = () => { if (!studentId) return
    run(async () => { setMcpToken((await api.createMcpToken(studentId)).token) }, 'Listo, copiá el token ahora: no lo vas a poder ver de nuevo.') }
  const revokeMcpToken = () => { if (!studentId) return
    run(async () => { await api.revokeMcpToken(studentId); setMcpToken(null) }, 'Revocamos el token. Ya no funciona en ningún cliente.') }
  const changePassword = (e: FormEvent) => { e.preventDefault(); if (!u?.email) return
    run(async () => { await reauthenticateWithCredential(u, EmailAuthProvider.credential(u.email!, current)); await updatePassword(u, next); setCurrent(''); setNext('') }, 'Cambiamos tu contraseña.') }

  const card = 'max-w-3xl gap-5 rounded-2xl py-6'
  return (
    <Page>
      <PageHeader title="Mi cuenta" description="Tus datos de acceso, los recordatorios y cómo se ve Mamo." />
      {!u && <p role="status" className="max-w-3xl rounded-xl bg-accent px-4 py-3 text-sm font-bold text-accent-foreground">Estás en modo demo: estos datos no se pueden cambiar.</p>}

      <Card className={card}>
        <CardHeader className="px-6"><CardTitle className="text-lg font-extrabold">Tus datos</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-5 px-6">
          <form className="flex items-end gap-2" onSubmit={saveName}>
            <div className="flex flex-1 flex-col gap-2"><Label htmlFor="name">Nombre</Label><Input id="name" value={name} onChange={e => setName(e.target.value)} disabled={!u} autoComplete="name" /></div>
            <Button variant="outline" className="h-10" disabled={!u || busy || !name.trim() || name.trim() === (user?.displayName ?? '')}>Guardar</Button>
          </form>
          <dl className="flex flex-col divide-y border-t">
            <Row label="Mail"><span className="font-bold break-all">{user?.email ?? 'Sin mail'}</span>
              {u && !u.emailVerified && withPassword && <Button variant="link" className="h-auto px-0" disabled={busy} onClick={() => run(() => sendEmailVerification(u), `Te mandamos un mail a ${u.email} para verificarlo.`)}>Verificar mail</Button>}
              {u?.emailVerified && <Badge variant="outline" className="border-transparent bg-approved font-bold text-accent-foreground"><BadgeCheck />Verificado</Badge>}</Row>
            <Row label="Carrera"><span className="font-bold">{plan?.name ?? 'Sin carrera'}</span></Row>
            <Row label="Entrás con"><span className="font-bold">{[withGoogle && 'Google', withPassword && 'mail y contraseña'].filter(Boolean).join(' y ') || (u ? 'Sin datos' : 'Modo demo')}</span></Row>
          </dl>
        </CardContent>
      </Card>

      {withPassword && <Card className={card}>
        <CardHeader className="px-6"><CardTitle className="text-lg font-extrabold">Contraseña</CardTitle></CardHeader>
        <CardContent className="px-6">
          <form className="flex max-w-md flex-col gap-4" onSubmit={changePassword}>
            <div className="flex flex-col gap-2"><Label htmlFor="current">Contraseña actual</Label><Input id="current" type="password" value={current} onChange={e => setCurrent(e.target.value)} autoComplete="current-password" required /></div>
            <div className="flex flex-col gap-2"><Label htmlFor="next">Contraseña nueva</Label><Input id="next" type="password" value={next} onChange={e => setNext(e.target.value)} autoComplete="new-password" minLength={6} required aria-describedby="next-hint" />
              <p id="next-hint" className="text-xs text-muted-foreground">Al menos 6 caracteres.</p></div>
            <div className="flex flex-wrap items-center gap-4">
              <Button disabled={busy || !current || next.length < 6}>Cambiar contraseña</Button>
              <Button type="button" variant="link" className="h-auto px-0" disabled={busy} onClick={() => auth && u?.email && run(() => sendPasswordResetEmail(auth, u.email!), `Te mandamos un link a ${u.email} para elegir una contraseña nueva.`)}>No me acuerdo la actual</Button>
            </div>
          </form>
        </CardContent>
      </Card>}
      {withGoogle && !withPassword && <Card className={card}>
        <CardHeader className="px-6"><CardTitle className="text-lg font-extrabold">Contraseña</CardTitle>
          <CardDescription>Entrás con Google, así que la contraseña la manejás desde tu cuenta de Google.</CardDescription></CardHeader>
      </Card>}

      <Card className={card}>
        <CardHeader className="px-6"><CardTitle className="text-lg font-extrabold">Recordatorios</CardTitle>
          <CardDescription className="max-w-[65ch]">Te avisamos cuando tu racha está por cortarse, tu árbol se está por marchitar, hace mucho que no estudiás una materia o se vienen las mesas y tenés finales pendientes. Como mucho uno por día.</CardDescription></CardHeader>
        <CardContent className="px-6">
          <dl className="flex flex-col divide-y border-t">
            <Row label="Por mail">
              <Switch id="email-reminders" checked={prefs?.email ?? false} disabled={!prefs || busy} onCheckedChange={changeEmail} />
              <Label htmlFor="email-reminders" className="font-bold">{prefs?.email ? 'Activados' : 'Apagados'}</Label></Row>
            <Row label="Este dispositivo">
              {push === 'unsupported' && <span className="text-sm text-muted-foreground">{u ? 'Este navegador no puede recibir notificaciones.' : 'No disponible en modo demo.'}</span>}
              {push === 'blocked' && <span className="text-sm text-muted-foreground">Bloqueaste las notificaciones de Mamo. Habilitalas desde la configuración del sitio en tu navegador.</span>}
              {(push === 'on' || push === 'off') && <>
                <Switch id="push" checked={push === 'on'} disabled={busy} onCheckedChange={togglePush} />
                <Label htmlFor="push" className="font-bold">{push === 'on' ? 'Notificaciones activadas' : 'Sin notificaciones'}</Label></>}
            </Row>
          </dl>
        </CardContent>
      </Card>

      {studentId && <Card className={card}>
        <CardHeader className="px-6"><CardTitle className="text-lg font-extrabold">Conectar con Claude</CardTitle>
          <CardDescription className="max-w-[65ch]">Usá tu árbol desde tu propio Claude (Claude Desktop o Claude Code) y hacele las mismas preguntas que al tutor. Claude solo lee tu progreso: para que algo cuente en tu árbol, registralo acá. Generar un token nuevo invalida el anterior.</CardDescription></CardHeader>
        <CardContent className="flex flex-col gap-4 px-6">
          {mcpToken && <div className="flex flex-col gap-4">
            <p role="status" className="rounded-xl bg-accent px-4 py-3 text-sm font-bold text-accent-foreground">Este token se muestra una sola vez. Copiá el comando ahora; si lo perdés, generá otro.</p>
            <ol className="flex flex-col gap-4 text-sm [counter-reset:step] [&>li]:relative [&>li]:pl-8 [&>li]:[counter-increment:step] [&>li]:before:absolute [&>li]:before:left-0 [&>li]:before:top-0 [&>li]:before:flex [&>li]:before:size-6 [&>li]:before:items-center [&>li]:before:justify-center [&>li]:before:rounded-full [&>li]:before:bg-muted [&>li]:before:text-xs [&>li]:before:font-extrabold [&>li]:before:content-[counter(step)]">
              <li className="flex flex-col gap-2">
                <span className="font-bold">Copiá el comando</span>
                <div className="flex items-start gap-2">
                  <Input id="mcp-command" aria-label="Comando para conectar Claude" readOnly value={mcpCommand} className="font-mono text-xs" onFocus={e => e.currentTarget.select()} />
                  <Button type="button" variant="outline" size="icon" aria-label="Copiar comando" onClick={() => copy(mcpCommand, 'Copiamos el comando.')}><Copy /></Button>
                </div>
              </li>
              <li><span className="font-bold">Pegalo en tu terminal</span> y apretá Enter. Necesitás <a className="underline" href="https://claude.com/product/claude-code" target="_blank" rel="noreferrer">Claude Code</a> instalado; con eso Claude queda conectado a Mamo.</li>
              <li><span className="font-bold">Abrí Claude Code</span> y escribí <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">/mcp</code> para verificar que <b>arbol</b> aparece como conectado.</li>
              <li><span className="font-bold">Activá al tutor</span> escribiendo <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">/mcp__arbol__tutor</code>, o preguntá directo: &ldquo;¿cómo voy en Análisis?&rdquo; o &ldquo;dame un ejercicio de un parcial de Programación I&rdquo;.</li>
            </ol>
            <p className="text-xs text-muted-foreground">Claude solo lee tu progreso. Si resolvés ejercicios con él, registralos acá para que cuenten en tu árbol.</p>
          </div>}
          <div className="flex flex-wrap gap-3">
            <Button variant={mcpToken ? 'outline' : 'default'} disabled={!u || busy} onClick={generateMcpToken}>{mcpToken ? 'Generar otro token' : 'Generar token'}</Button>
            <Button variant="outline" disabled={!u || busy} onClick={revokeMcpToken}>Revocar</Button>
          </div>
        </CardContent>
      </Card>}

      <Card className={card}>
        <CardHeader className="px-6"><CardTitle className="text-lg font-extrabold">Apariencia</CardTitle>
          <CardDescription>Por defecto, Mamo usa el modo de tu dispositivo.</CardDescription></CardHeader>
        <CardContent className="px-6">
          <ToggleGroup type="single" variant="outline" size="sm" spacing={1} aria-label="Tema" value={theme} onValueChange={v => { if (v) setTheme(v as Theme) }}>
            <ToggleGroupItem value="system">Automático</ToggleGroupItem><ToggleGroupItem value="light">Claro</ToggleGroupItem><ToggleGroupItem value="dark">Oscuro</ToggleGroupItem>
          </ToggleGroup>
        </CardContent>
      </Card>

      <Card className={card}>
        <CardHeader className="px-6"><CardTitle className="text-lg font-extrabold">Cerrar sesión</CardTitle>
          <CardDescription>Tu árbol queda guardado. Podés volver a entrar cuando quieras.</CardDescription></CardHeader>
        <CardContent className="px-6"><Button variant="outline" onClick={logOut} disabled={!u}>Cerrar sesión</Button></CardContent>
      </Card>
    </Page>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:gap-4">
      <dt className="w-36 shrink-0 text-sm font-bold text-muted-foreground">{label}</dt>
      <dd className="flex min-w-0 flex-wrap items-center gap-3">{children}</dd>
    </div>
  )
}
