import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import RichText, { TypedText } from '../components/RichText'
import { api } from '../lib/api'
import { keys, queryClient } from '../lib/queries'
import { useSession } from '../lib/session'
import type { ChatMessage } from '../lib/types'

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
  const remove = (id: string) => { setList(l => l.filter(c => c.id !== id)); if (id === conversation) newConversation() }
  const submit = (ev?: FormEvent) => { ev?.preventDefault(); send(text) }
  const copy = async (i: number) => { try { await navigator.clipboard.writeText(messages[i].text); setCopied(i); setTimeout(() => setCopied(c => c === i ? null : c), 1500) } catch { /* no clipboard */ } }

  const first = teacher?.subjects[0]?.name ?? 'mi materia'
  const suggestions = [`Armame un parcial de ${first} con los temas que más se toman`, `¿Qué temas se tomaron más en los parciales de ${first}?`, `Hacé una guía de 5 ejercicios de ${first}, de menor a mayor dificultad`]

  return (
    <div className="page tutor wide">
      <header className="greeting"><div><h1>Asistente</h1><p>Armá exámenes, guías y criterios de corrección a partir de los parciales reales de la FCEIA.</p></div></header>
      <div className="tutor-body">
        <aside className="conversations" aria-label="Conversaciones">
          <button className="btn full" onClick={newConversation}>Conversación nueva</button>
          {list.length === 0 && <p className="hint">Tus conversaciones van a aparecer acá.</p>}
          <ul>{list.map(c => (
            <li key={c.id} className={c.id === conversation ? 'on' : ''}>
              <button onClick={() => setConversation(c.id)}><b>{c.title}</b><span>{when(c.date)}</span></button>
              <button className="remove" aria-label={`Quitar "${c.title}" de la lista`} onClick={() => remove(c.id)}>×</button>
            </li>))}</ul>
        </aside>
        <section className="conversation">
          <div className="chat" aria-busy={loadingConversation}>
            {loadingConversation && <div className="skeletons" role="status" aria-label="Cargando la conversación">{['user', 'assistant', 'user', 'assistant'].map((r, i) => <div key={i} className={`bubble ${r} skeleton`} />)}</div>}
            {messages.length === 0 && !loadingConversation && <div className="empty"><p>¿Qué preparamos?</p><div className="suggestions">{suggestions.map(s => <button key={s} onClick={() => setText(s)}>{s}</button>)}</div></div>}
            {messages.map((m, i) => !m.text ? null : m.role === 'user' ? <div key={i} className="bubble user">{m.text}</div> : (
              <div key={i} className="bubble assistant">
                {animating && i === messages.length - 1 ? <TypedText text={m.text} onGrow={scrollDown} onDone={() => setAnimating(false)} /> : <RichText text={m.text} />}
                {!(sending && i === messages.length - 1) && <button className="link copy" onClick={() => copy(i)}>{copied === i ? 'Copiado' : 'Copiar'}</button>}
              </div>))}
            {status && <div className="tutor-status" role="status"><i /><span key={status}>{status}</span></div>}
            <div ref={end} />
          </div>
          <form className="composer" onSubmit={submit}>
            <div className="composer-row">
              <textarea value={text} onChange={e => setText(e.target.value)} placeholder="Pedí un examen, una guía o una resolución…" rows={2} maxLength={8000}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() } }} aria-label="Mensaje para el asistente" />
              <button className="btn" disabled={!text.trim() || sending}>Enviar</button>
            </div>
          </form>
        </section>
      </div>
    </div>
  )
}
