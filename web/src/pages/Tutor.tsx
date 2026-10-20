import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../lib/api'
import { conversationQuery, keys, queryClient } from '../lib/queries'
import { PhotoError, preparePhoto } from '../lib/photo'
import RichText, { TypedText } from '../components/RichText'
import { useSession } from '../lib/session'
import type { ChatMessage } from '../lib/types'
import { ArrowLeft, Camera, MessageSquarePlus, Send, Timer, X } from 'lucide-react'
import { useIsMobile } from '@/hooks/use-mobile'
import { Page, PageHeader } from '@/components/Page'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'

// The backend has no endpoint to list conversations: the browser keeps the ids the chat returns
// (with a title and a date) and each one is reloaded with GET /conversations/{id}.
interface Conversation { id: string; title: string; date: string; mockExam?: boolean }
interface MockExam { conversation: string | null; subject: string; minutes: number; start: number }

const load = <T,>(k: string, def: T): T => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) as T : def } catch { return def } }
const save = (k: string, v: unknown) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)) } catch { /* no storage */ } }
const when = (iso: string) => { const d = Math.floor((Date.now() - new Date(iso).getTime()) / 864e5); return d <= 0 ? 'hoy' : d === 1 ? 'ayer' : `hace ${d} días` }
const clock = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }

export default function Tutor() {
  const { studentId, plan, tree, user, refresh } = useSession()
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate(), location = useLocation()
  // on the phone the list and the chat are two screens: ?chat is the chat one (so the back button returns to the list)
  const isMobile = useIsMobile(), chatOpen = params.has('chat')
  const focused = isMobile && chatOpen, listView = isMobile && !chatOpen
  const openChat = () => { if (isMobile && !chatOpen) setParams(p => { p.set('chat', ''); return p }, { state: { fromList: true } }) }
  const closeChat = () => { if (location.state?.fromList) navigate(-1); else setParams(p => { p.delete('chat'); return p }, { replace: true }) }
  const uid = user?.uid ?? 'anon', LIST_KEY = `arbol.conversations.${uid}`, EXAM_KEY = `arbol.mockExam.${uid}`
  const subject = plan?.subjects.find(s => s.subject_id === Number(params.get('subject')))
  const [list, setList] = useState<Conversation[]>(() => load(LIST_KEY, []))
  const [conversation, setConversation] = useState<string | null>(() => list[0]?.id ?? null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [text, setText] = useState(subject ? `Quiero practicar ${subject.name} para el parcial.` : '')
  const [status, setStatus] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  // the last reply is typed out only if it arrived now, not when it comes from the history
  const [animating, setAnimating] = useState(false)
  const [exam, setExam] = useState<MockExam | null>(() => load(EXAM_KEY, null))
  const [settingUpExam, setSettingUpExam] = useState(false)
  const [now, setNow] = useState(Date.now())
  const end = useRef<HTMLDivElement>(null)
  // photo for the next message (an already downsized data URL) and its error
  const [photo, setPhoto] = useState<string | null>(null), [photoError, setPhotoError] = useState<string | null>(null), [preparing, setPreparing] = useState(false)
  const [dragging, setDragging] = useState(false)
  const picker = useRef<HTMLInputElement>(null)
  const attach = async (file: Blob | null | undefined) => { if (!file) return; setPhotoError(null); setPreparing(true)
    try { setPhoto(await preparePhoto(file)) } catch (e) { setPhotoError(e instanceof PhotoError ? e.message : 'No pudimos usar esa imagen.') } finally { setPreparing(false) } }

  useEffect(() => save(LIST_KEY, list), [list, LIST_KEY])
  useEffect(() => save(EXAM_KEY, exam), [exam, EXAM_KEY])
  useEffect(() => { if (!exam) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t) }, [exam])
  const scrollDown = useCallback(() => { end.current?.scrollIntoView({ block: 'end' }) }, [])
  useEffect(() => { scrollDown() }, [messages, status, scrollDown])

  // open a saved conversation (a query: what was already seen shows at once, and a late reply for a chat
  // the user already left is ignored). The conversation just created by sending is already on screen,
  // with the photo: it is not reloaded until the user opens it again from the list.
  const justCreated = useRef<string | null>(null)
  const opened = conversation && conversation !== justCreated.current ? conversation : null
  const history = useQuery({ ...conversationQuery(studentId ?? '', opened ?? ''), enabled: !!studentId && !!opened && !sending })
  useEffect(() => { if (!opened) return; setAnimating(false); setMessages(history.data?.messages ?? []) }, [opened, history.data])
  const loadingConversation = !!opened && history.isPending
  const open = (id: string) => { openChat(); if (id === conversation) return; justCreated.current = null; setConversation(id) }

  const send = useCallback(async (msg: string, opts: { fresh?: boolean; mockExam?: boolean; image?: string | null } = {}) => {
    msg = msg.trim(); const image = opts.image ?? null; if ((!msg && !image) || !studentId || sending) return
    if (image) setPhoto(null)
    const use = opts.fresh ? null : conversation
    if (opts.fresh) setConversation(null)
    setText(''); setSending(true); setStatus('Pensando…')
    setMessages(m => [...(opts.fresh ? [] : m), { role: 'user', text: msg, ...(image ? { image } : {}) }, { role: 'assistant', text: '' }])
    const append = (d: string) => setMessages(m => { const c = [...m]; c[c.length - 1] = { ...c[c.length - 1], text: c[c.length - 1].text + d }; return c })
    await api.chat({ student_id: studentId, message: msg, ...(use ? { conversation_id: use } : {}), ...(image ? { image_base64: image } : {}) }, {
      onStatus: s => { setStatus(s.message); if (s.tool === 'start_mock_exam') setExam(x => x ? { ...x, start: Date.now() } : x) },
      onText: d => { setStatus(null); setAnimating(true); append(d) },
      onDone: d => {
        justCreated.current = d.conversation_id; setConversation(d.conversation_id)
        // the cached history of this conversation is one turn behind now
        queryClient.removeQueries({ queryKey: keys.conversation(studentId, d.conversation_id) })
        setList(l => l.some(c => c.id === d.conversation_id) ? l.map(c => c.id === d.conversation_id ? { ...c, date: new Date().toISOString() } : c)
          : [{ id: d.conversation_id, title: msg ? msg.slice(0, 60) : 'Foto de un ejercicio', date: new Date().toISOString(), mockExam: opts.mockExam }, ...l])
        setExam(x => x && !x.conversation && opts.mockExam ? { ...x, conversation: d.conversation_id } : x)
        if (d.tree_changed) refresh()
      },
      onError: e => append(e.code === 'tutor_unavailable' ? 'El tutor no está disponible ahora (falta configurar el modelo en el backend).' : `No pude responder: ${e.message}`),
    }).catch(e => append(`No pude responder: ${(e as Error).message}`))
    setStatus(null); setSending(false)
  }, [studentId, sending, conversation, refresh])

  const newConversation = () => { setConversation(null); setMessages([]); setAnimating(false) }
  const remove = (id: string) => { setList(l => l.filter(c => c.id !== id)); if (id === conversation) newConversation() }
  const submit = (ev?: FormEvent) => { ev?.preventDefault(); if ((text.trim() || photo) && !sending) openChat(); send(text, { image: photo }) }
  // the phone's list screen always writes a new conversation
  useEffect(() => { if (listView) { setConversation(null); setMessages([]); setAnimating(false) } }, [listView])

  // mock exam
  const examSubjects = useMemo(() => { const states = new Map((tree?.subjects ?? []).map(s => [s.subject_id, s.state]))
    return (plan?.subjects ?? []).filter(s => ['enrolled', 'regular', 'available'].includes(states.get(s.subject_id) ?? '')).sort((a, b) => (states.get(a.subject_id) === 'enrolled' ? -1 : 0) - (states.get(b.subject_id) === 'enrolled' ? -1 : 0)) }, [plan, tree])
  const startExam = (name: string, minutes: number) => { setSettingUpExam(false); openChat(); setExam({ conversation: null, subject: name, minutes, start: Date.now() })
    send(`Quiero hacer un simulacro de ${name} de ${minutes} minutos, con ejercicios al estilo de los parciales de la cátedra. Dame el enunciado completo y no me ayudes hasta que entregue.`, { fresh: true, mockExam: true }) }
  const remaining = exam ? exam.start + exam.minutes * 60000 - now : 0
  const handIn = () => { if (!exam) return; const inTime = remaining > 0; setExam(null)
    send(inTime ? 'Terminé el simulacro. Corregime las respuestas que te mandé y poneme una nota de 0 a 100.' : 'Se terminó el tiempo del simulacro. Corregime lo que te mandé y poneme una nota de 0 a 100.') }

  const suggestions = ['¿Qué temas se toman más en el parcial?', 'Dame un ejercicio de un parcial viejo', 'Armemos un plan hasta el parcial']
  const bubble = 'max-w-[85%] rounded-2xl px-4 py-3 break-words bubble-in'
  const thread = (
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-1 no-scrollbar" aria-busy={loadingConversation}>
        {loadingConversation && <div className="flex flex-col gap-3" role="status" aria-label="Cargando la conversación">
          {['user', 'assistant', 'user', 'assistant'].map((r, i) => <Skeleton key={i} className={cn('rounded-2xl', r === 'user' ? 'h-11 w-2/5 self-end' : 'h-24 w-3/4')} />)}</div>}
        {messages.length === 0 && !exam && !loadingConversation && <div className="m-auto flex max-w-lg flex-col items-center gap-4 px-2 text-center">
          <p className="text-lg font-extrabold">¿Por dónde arrancamos?</p>
          <p className="text-sm text-muted-foreground">Escribí tu duda o sacale una foto al ejercicio. También podés empezar por una de estas:</p>
          <div className="flex flex-wrap justify-center gap-2">{suggestions.map(s => <Button key={s} variant="outline" size="sm" onClick={() => setText(s)}>{s}</Button>)}</div>
        </div>}
        {messages.map((m, i) => m.text || m.role === 'user' ? (m.role === 'user'
          ? <div key={i} className={cn(bubble, 'self-end rounded-br-md bg-primary whitespace-pre-wrap text-primary-foreground', m.image && 'w-fit p-1.5')}>
              {m.image && <img className="mb-1 block max-h-72 max-w-[min(320px,100%)] rounded-xl bg-card" src={m.image} alt="Foto del ejercicio" />}
              {m.text ? <span className={cn(m.image && 'inline-block px-2 pt-1 pb-0.5')}>{m.text}</span> : !m.image && <span className="italic opacity-85">Foto de un ejercicio</span>}
            </div>
          : <div key={i} className={cn(bubble, 'rich self-start rounded-bl-md border bg-card')}>
              {animating && i === messages.length - 1 ? <TypedText text={m.text} onGrow={scrollDown} onDone={() => setAnimating(false)} /> : <RichText text={m.text} />}
            </div>) : null)}
        {status && <div className="flex items-center gap-2 self-start text-sm font-bold text-muted-foreground" role="status"><i className="pulse-dot size-2.5 rounded-full bg-primary" /><span key={status} className="shimmer-text">{status}</span></div>}
        <div ref={end} />
      </div>
  )
  const composer = (
      <form className={cn('flex flex-col gap-2 rounded-2xl border bg-card p-2 outline-2 outline-offset-4 outline-transparent transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/30', dragging && 'border-dashed border-primary bg-accent')} onSubmit={submit}
        onDragOver={e => { if ([...e.dataTransfer.items].some(i => i.kind === 'file')) { e.preventDefault(); setDragging(true) } }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false); attach(e.dataTransfer.files[0]) }}>
        {(photo || preparing || photoError) && <div className="flex items-center gap-3 px-1 pt-1">
          {preparing && <Skeleton className="h-20 w-32 rounded-xl" aria-label="Preparando la foto" />}
          {photo && <div className="relative"><img src={photo} alt="Foto que vas a mandar" className="h-20 max-w-40 rounded-xl border object-cover" />
            <Button type="button" variant="outline" size="icon-xs" className="absolute -top-2 -right-2 bg-card" onClick={() => setPhoto(null)} aria-label="Sacar la foto"><X /></Button></div>}
          {photoError && <span className="text-sm font-semibold text-destructive" role="alert">{photoError}</span>}
        </div>}
        <Textarea value={text} onChange={e => setText(e.target.value)} placeholder={exam ? 'Escribí tus respuestas o sacale una foto a tu hoja…' : 'Escribí tu duda, pegá un ejercicio o una captura…'} rows={exam ? 4 : 2} maxLength={8000}
          className="max-h-60 min-h-12 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0 dark:bg-transparent"
          onPaste={e => { const f = [...e.clipboardData.files].find(x => x.type.startsWith('image/')); if (f) { e.preventDefault(); attach(f) } }}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !exam) { e.preventDefault(); submit() } }} aria-label="Mensaje para el tutor" />
        <div className="flex items-center justify-between gap-2">
          <Button type="button" variant="ghost" size="icon" onClick={() => picker.current?.click()} disabled={sending || preparing} aria-label="Adjuntar una foto del ejercicio" title="Adjuntar una foto (también podés pegarla o arrastrarla)"><Camera /></Button>
          <input ref={picker} type="file" accept="image/*" hidden onChange={e => { attach(e.target.files?.[0]); e.target.value = '' }} />
          <Button disabled={(!text.trim() && !photo) || sending || preparing}>Enviar<Send data-icon="inline-end" /></Button>
        </div>
      </form>
  )
  const chat = <>{thread}{composer}</>

  if (exam) return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <header className="relative grid grid-cols-[1fr_auto] items-center gap-3 border-b bg-card px-4 py-3 md:grid-cols-[1fr_auto_1fr] md:px-7">
        <div className="min-w-0"><b className="block truncate text-base">Simulacro: {exam.subject}</b><span className="text-sm text-muted-foreground">{exam.minutes} minutos</span></div>
        <div className={cn('text-3xl font-extrabold tabular-nums md:text-4xl', remaining <= 0 ? 'text-destructive' : remaining < 5 * 60000 && 'text-warning-foreground')} role="timer" aria-live="off">{remaining > 0 ? clock(remaining) : 'Tiempo'}</div>
        <div className="col-span-2 flex items-center gap-2 md:col-span-1 md:justify-self-end">
          <Button onClick={handIn} disabled={sending}>Entregar</Button>
          <Button variant="ghost" onClick={() => setExam(null)}>Salir sin entregar</Button>
        </div>
        <div className="absolute inset-x-0 -bottom-px h-1 bg-border"><i className="block h-full bg-primary transition-[width] duration-1000 ease-linear" style={{ width: `${Math.min(100, 100 - (remaining / (exam.minutes * 600)))}%` }} /></div>
      </header>
      {remaining <= 0 && <p role="status" className="mx-4 mt-3 rounded-xl bg-warning px-4 py-2.5 text-sm font-bold text-warning-foreground md:mx-7">Se terminó el tiempo. Mandá lo que tengas y tocá Entregar para que el tutor lo corrija.</p>}
      <div className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col gap-3 px-4 pt-4 pb-6">{chat}</div>
    </div>
  )

  if (focused) return (
    <Page className="h-[calc(100dvh-3.5rem)] gap-3 py-3">
      <div className="flex min-w-0 items-center gap-1">
        <Button variant="ghost" size="icon" onClick={closeChat} aria-label="Volver a las conversaciones"><ArrowLeft /></Button>
        <b className="truncate">{list.find(c => c.id === conversation)?.title ?? 'Conversación nueva'}</b>
      </div>
      <section className="flex min-h-0 flex-1 flex-col gap-3">{chat}</section>
    </Page>
  )

  return (
    <Page className="h-[calc(100dvh-3.5rem)] gap-5 md:h-dvh">
      <PageHeader title="Tutor" description="Practicá con ejercicios de parciales reales de la FCEIA. Te da pistas antes que la solución.">
        <Button variant="outline" onClick={() => setSettingUpExam(true)}><Timer data-icon="inline-start" />Hacer un simulacro</Button>
      </PageHeader>
      <MockExamForm key={settingUpExam ? `open-${subject?.subject_id ?? ""}` : "closed"} open={settingUpExam} subjects={examSubjects.map(s => s.name)} initial={subject?.name} onStart={startExam} onCancel={() => setSettingUpExam(false)} />
      <div className={cn('grid min-h-0 flex-1 gap-4 md:grid-cols-[16rem_minmax(0,1fr)] md:grid-rows-1 md:gap-6', listView ? 'grid-rows-[minmax(0,1fr)_auto]' : 'grid-rows-[auto_minmax(0,1fr)]')}>
        <aside className={cn('flex min-h-0 flex-col gap-2 md:max-h-none', !listView && 'max-h-40')} aria-label="Conversaciones">
          <Button variant="secondary" className="w-full justify-start" onClick={() => { newConversation(); openChat() }}><MessageSquarePlus data-icon="inline-start" />Conversación nueva</Button>
          {list.length === 0 && <p className="px-3 py-2 text-sm text-muted-foreground">Tus conversaciones van a aparecer acá.</p>}
          <ul className="flex min-h-0 flex-col gap-0.5 overflow-y-auto">{list.map(c => (
            <li key={c.id} className={cn('group flex items-stretch rounded-xl hover:bg-muted', c.id === conversation && 'bg-accent hover:bg-accent')}>
              <button className="min-w-0 flex-1 rounded-xl px-3 py-2 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50" onClick={() => open(c.id)} aria-current={c.id === conversation || undefined}>
                <b className="block truncate text-sm">{c.title}</b><span className="text-xs text-muted-foreground">{c.mockExam ? 'Simulacro, ' : ''}{when(c.date)}</span></button>
              <Button variant="ghost" size="icon-sm" className="my-auto mr-1 opacity-0 group-hover:opacity-100 focus-visible:opacity-100" aria-label={`Quitar "${c.title}" de la lista`} onClick={() => remove(c.id)}><X /></Button>
            </li>))}</ul>
        </aside>
        <section className="flex min-h-0 flex-col gap-3">{listView ? composer : chat}</section>
      </div>
    </Page>
  )
}

function MockExamForm({ open, subjects, initial, onStart, onCancel }: { open: boolean; subjects: string[]; initial?: string; onStart: (subject: string, minutes: number) => void; onCancel: () => void }) {
  const [subject, setSubject] = useState(initial && subjects.includes(initial) ? initial : subjects[0] ?? '')
  const [minutes, setMinutes] = useState(90)
  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onCancel() }}>
      <DialogContent className="rounded-2xl sm:max-w-md">
        <form className="flex flex-col gap-5" onSubmit={e => { e.preventDefault(); if (subject) onStart(subject, minutes) }}>
          <DialogHeader>
            <DialogTitle className="text-xl font-extrabold">Simulacro de parcial</DialogTitle>
            <DialogDescription>El tutor arma un parcial al estilo de la cátedra y corre el reloj. Al entregar, te lo corrige.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="exam-subject">Materia</Label>
            {subjects.length ? <Select value={subject} onValueChange={setSubject}>
              <SelectTrigger id="exam-subject" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{subjects.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
            </Select> : <p className="text-sm text-muted-foreground">Marcá en tu árbol qué materias estás cursando para poder hacer un simulacro.</p>}
          </div>
          <div className="flex flex-col gap-2">
            <Label>Tiempo</Label>
            <ToggleGroup type="single" variant="outline" size="sm" spacing={1} aria-label="Tiempo" value={String(minutes)} onValueChange={v => { if (v) setMinutes(Number(v)) }}>
              {[30, 60, 90, 120].map(m => <ToggleGroupItem key={m} value={String(m)}>{m} min</ToggleGroupItem>)}
            </ToggleGroup>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onCancel}>Cancelar</Button>
            <Button disabled={!subject}>Empezar</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
