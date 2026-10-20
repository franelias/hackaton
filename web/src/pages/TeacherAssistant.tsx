import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Check, Copy, MessageSquarePlus, Send, X } from 'lucide-react'
import RichText, { TypedText } from '../components/RichText'
import { api } from '../lib/api'
import { keys, queryClient } from '../lib/queries'
import { useSession } from '../lib/session'
import type { ChatMessage } from '../lib/types'
import { Page, PageHeader } from '@/components/Page'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

// The teacher's assistant (contract §2.6): exams, practice sheets and rubrics from the faculty's
// real exams. Like the tutor, the browser keeps the list of conversations.
interface Conversation { id: string; title: string; date: string }

const load = <T,>(k: string, def: T): T => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) as T : def } catch { return def } }
const save = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* no storage */ } }
const when = (iso: string) => { const d = Math.floor((Date.now() - new Date(iso).getTime()) / 864e5); return d <= 0 ? 'hoy' : d === 1 ? 'ayer' : `hace ${d} días` }

export default function TeacherAssistant() {
  const { user } = useSession()
  const LIST_KEY = `arbol.teacherConversations.${user?.uid ?? 'anon'}`
  const { data: teacher } = useQuery({ queryKey: keys.teacher, queryFn: api.teacher })
  const [list, setList] = useState<Conversation[]>(() => load(LIST_KEY, []))
  const [conversation, setConversation] = useState<string | null>(() => list[0]?.id ?? null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [text, setText] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  // the last reply is typed out only if it arrived now, not when it comes from the history
  const [animating, setAnimating] = useState(false)
  const [loadingConversation, setLoadingConversation] = useState(false)
  const [copied, setCopied] = useState<number | null>(null)
  const end = useRef<HTMLDivElement>(null)

  useEffect(() => save(LIST_KEY, list), [list, LIST_KEY])
  const scrollDown = useCallback(() => { end.current?.scrollIntoView({ block: 'end' }) }, [])
  useEffect(() => { scrollDown() }, [messages, status, scrollDown])

  // open a saved conversation; the one just created by sending is already on screen
  const justCreated = useRef<string | null>(null)
  useEffect(() => { if (!conversation || sending || conversation === justCreated.current) return
    let current = true
    setAnimating(false); setMessages([]); setLoadingConversation(true)
    queryClient.fetchQuery({ queryKey: keys.teacherConversation(conversation), queryFn: () => api.teacherConversation(conversation) })
      .then(r => { if (current) setMessages(r.messages) }).catch(() => { if (current) setMessages([]) })
      .finally(() => { if (current) setLoadingConversation(false) })
    return () => { current = false; setLoadingConversation(false) } }, [conversation]) // eslint-disable-line react-hooks/exhaustive-deps

  const send = useCallback(async (msg: string) => {
    msg = msg.trim(); if (!msg || sending) return
    setText(''); setSending(true); setStatus('Pensando…')
    setMessages(m => [...m, { role: 'user', text: msg }, { role: 'assistant', text: '' }])
    const append = (d: string) => setMessages(m => { const c = [...m]; c[c.length - 1] = { ...c[c.length - 1], text: c[c.length - 1].text + d }; return c })
    await api.teacherChat({ message: msg, ...(conversation ? { conversation_id: conversation } : {}) }, {
      onStatus: s => setStatus(s.message),
      onText: d => { setStatus(null); setAnimating(true); append(d) },
      onDone: d => {
        justCreated.current = d.conversation_id; setConversation(d.conversation_id)
        queryClient.removeQueries({ queryKey: keys.teacherConversation(d.conversation_id) })
        setList(l => l.some(c => c.id === d.conversation_id) ? l.map(c => c.id === d.conversation_id ? { ...c, date: new Date().toISOString() } : c)
          : [{ id: d.conversation_id, title: msg.slice(0, 60), date: new Date().toISOString() }, ...l])
      },
      onError: e => append(e.code === 'tutor_unavailable' ? 'El asistente no está disponible ahora (falta configurar el modelo en el backend).' : `No pude responder: ${e.message}`),
    }).catch(e => append(`No pude responder: ${(e as Error).message}`))
    setStatus(null); setSending(false)
  }, [sending, conversation])

  const newConversation = () => { setConversation(null); setMessages([]); setAnimating(false) }
  const open = (id: string) => { if (id === conversation) return; justCreated.current = null; setConversation(id) }
  const remove = (id: string) => { setList(l => l.filter(c => c.id !== id)); if (id === conversation) newConversation() }
  const submit = (ev?: FormEvent) => { ev?.preventDefault(); send(text) }
  const copy = async (i: number) => { try { await navigator.clipboard.writeText(messages[i].text); setCopied(i); setTimeout(() => setCopied(c => c === i ? null : c), 1500) } catch { /* no clipboard */ } }

  const first = teacher?.subjects[0]?.name ?? 'mi materia'
  const suggestions = [`Armame un parcial de ${first} con los temas que más se toman`, `¿Qué temas se tomaron más en los parciales de ${first}?`, `Hacé una guía de 5 ejercicios de ${first}, de menor a mayor dificultad`]
  const bubble = 'max-w-[85%] rounded-2xl px-4 py-3 break-words bubble-in'

  return (
    <Page className="h-[calc(100dvh-3.5rem)] gap-5 md:h-dvh">
      <PageHeader title="Asistente" description="Armá exámenes, guías y criterios de corrección a partir de los parciales reales de la FCEIA." />
      <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] gap-4 md:grid-cols-[16rem_minmax(0,1fr)] md:grid-rows-1 md:gap-6">
        <aside className="flex max-h-40 min-h-0 flex-col gap-2 md:max-h-none" aria-label="Conversaciones">
          <Button variant="secondary" className="w-full justify-start" onClick={newConversation}><MessageSquarePlus data-icon="inline-start" />Conversación nueva</Button>
          {list.length === 0 && <p className="px-3 py-2 text-sm text-muted-foreground">Tus conversaciones van a aparecer acá.</p>}
          <ul className="flex min-h-0 flex-col gap-0.5 overflow-y-auto">{list.map(c => (
            <li key={c.id} className={cn('group flex items-stretch rounded-xl hover:bg-muted', c.id === conversation && 'bg-accent hover:bg-accent')}>
              <button className="min-w-0 flex-1 rounded-xl px-3 py-2 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50" onClick={() => open(c.id)} aria-current={c.id === conversation || undefined}>
                <b className="block truncate text-sm">{c.title}</b><span className="text-xs text-muted-foreground">{when(c.date)}</span></button>
              <Button variant="ghost" size="icon-sm" className="my-auto mr-1 opacity-0 group-hover:opacity-100 focus-visible:opacity-100" aria-label={`Quitar "${c.title}" de la lista`} onClick={() => remove(c.id)}><X /></Button>
            </li>))}</ul>
        </aside>

        <section className="flex min-h-0 flex-col gap-3">
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-1 no-scrollbar" aria-busy={loadingConversation}>
            {loadingConversation && <div className="flex flex-col gap-3" role="status" aria-label="Cargando la conversación">
              {['user', 'assistant', 'user', 'assistant'].map((r, i) => <Skeleton key={i} className={cn('rounded-2xl', r === 'user' ? 'h-11 w-2/5 self-end' : 'h-24 w-3/4')} />)}</div>}
            {messages.length === 0 && !loadingConversation && <div className="m-auto flex max-w-lg flex-col items-center gap-4 px-2 text-center">
              <p className="text-lg font-extrabold">¿Qué preparamos?</p>
              <div className="flex flex-wrap justify-center gap-2">{suggestions.map(s => <Button key={s} variant="outline" size="sm" className="h-auto py-1.5 whitespace-normal" onClick={() => setText(s)}>{s}</Button>)}</div>
            </div>}
            {messages.map((m, i) => !m.text ? null : m.role === 'user'
              ? <div key={i} className={cn(bubble, 'self-end rounded-br-md bg-primary whitespace-pre-wrap text-primary-foreground')}>{m.text}</div>
              : <div key={i} className={cn(bubble, 'rich self-start rounded-bl-md border bg-card')}>
                  {animating && i === messages.length - 1 ? <TypedText text={m.text} onGrow={scrollDown} onDone={() => setAnimating(false)} /> : <RichText text={m.text} />}
                  {!(sending && i === messages.length - 1) && <Button variant="ghost" size="sm" className="mt-2 -ml-2 text-muted-foreground" onClick={() => copy(i)}>
                    {copied === i ? <><Check data-icon="inline-start" />Copiado</> : <><Copy data-icon="inline-start" />Copiar</>}</Button>}
                </div>)}
            {status && <div className="flex items-center gap-2 self-start text-sm font-bold text-muted-foreground" role="status"><i className="pulse-dot size-2.5 rounded-full bg-primary" /><span key={status} className="shimmer-text">{status}</span></div>}
            <div ref={end} />
          </div>
          <form className="flex flex-col gap-2 rounded-2xl border bg-card p-2 transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/30" onSubmit={submit}>
            <Textarea value={text} onChange={e => setText(e.target.value)} placeholder="Pedí un examen, una guía o una resolución…" rows={2} maxLength={8000}
              className="max-h-60 min-h-12 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0 dark:bg-transparent"
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() } }} aria-label="Mensaje para el asistente" />
            <div className="flex justify-end"><Button disabled={!text.trim() || sending}>Enviar<Send data-icon="inline-end" /></Button></div>
          </form>
        </section>
      </div>
    </Page>
  )
}
