import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../lib/api'
import { PhotoError, preparePhoto } from '../lib/photo'
import RichText, { TypedText } from '../components/RichText'
import { useSession } from '../lib/session'
import type { ChatMessage } from '../lib/types'

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
  const [params] = useSearchParams()
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
  const [loadingConversation, setLoadingConversation] = useState(false)
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

  // open a saved conversation; if the user switches chats before it arrives, the old reply is dropped.
  // The conversation just created by sending is already on screen (with the photo): it is not reloaded.
  const justCreated = useRef<string | null>(null)
  useEffect(() => { if (!studentId || !conversation || sending || conversation === justCreated.current) return
    let current = true
    setAnimating(false); setMessages([]); setLoadingConversation(true)
    api.conversation(studentId, conversation).then(r => { if (current) setMessages(r.messages) }).catch(() => { if (current) setMessages([]) })
      .finally(() => { if (current) setLoadingConversation(false) })
    return () => { current = false; setLoadingConversation(false) } }, [studentId, conversation]) // eslint-disable-line react-hooks/exhaustive-deps

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
  const submit = (ev?: FormEvent) => { ev?.preventDefault(); send(text, { image: photo }) }

  // mock exam
  const examSubjects = useMemo(() => { const states = new Map((tree?.subjects ?? []).map(s => [s.subject_id, s.state]))
    return (plan?.subjects ?? []).filter(s => ['enrolled', 'regular', 'available'].includes(states.get(s.subject_id) ?? '')).sort((a, b) => (states.get(a.subject_id) === 'enrolled' ? -1 : 0) - (states.get(b.subject_id) === 'enrolled' ? -1 : 0)) }, [plan, tree])
  const startExam = (name: string, minutes: number) => { setSettingUpExam(false); setExam({ conversation: null, subject: name, minutes, start: Date.now() })
    send(`Quiero hacer un simulacro de ${name} de ${minutes} minutos, con ejercicios al estilo de los parciales de la cátedra. Dame el enunciado completo y no me ayudes hasta que entregue.`, { fresh: true, mockExam: true }) }
  const remaining = exam ? exam.start + exam.minutes * 60000 - now : 0
  const handIn = () => { if (!exam) return; const inTime = remaining > 0; setExam(null)
    send(inTime ? 'Terminé el simulacro. Corregime las respuestas que te mandé y poneme una nota de 0 a 100.' : 'Se terminó el tiempo del simulacro. Corregime lo que te mandé y poneme una nota de 0 a 100.') }

  const suggestions = ['¿Qué temas se toman más en el parcial?', 'Dame un ejercicio de un parcial viejo', 'Armemos un plan hasta el parcial']
  const chat = (
    <>
      <div className="chat" aria-busy={loadingConversation}>
        {loadingConversation && <div className="skeletons" role="status" aria-label="Cargando la conversación">{['user', 'assistant', 'user', 'assistant'].map((r, i) => <div key={i} className={`bubble ${r} skeleton`} />)}</div>}
        {messages.length === 0 && !exam && !loadingConversation && <div className="empty"><p>¿Por dónde arrancamos?</p><div className="suggestions">{suggestions.map(s => <button key={s} onClick={() => setText(s)}>{s}</button>)}</div></div>}
        {messages.map((m, i) => m.text || m.role === 'user' ? <div key={i} className={`bubble ${m.role}`}>{m.role === 'user' ? <>{m.image && <img className="message-photo" src={m.image} alt="Foto del ejercicio" />}{m.text || (!m.image && <span className="photo-placeholder">Foto de un ejercicio</span>)}</>
          : animating && i === messages.length - 1 ? <TypedText text={m.text} onGrow={scrollDown} onDone={() => setAnimating(false)} /> : <RichText text={m.text} />}</div> : null)}
        {status && <div className="tutor-status" role="status"><i /><span key={status}>{status}</span></div>}
        <div ref={end} />
      </div>
      <form className={`composer${dragging ? ' dropping' : ''}`} onSubmit={submit}
        onDragOver={e => { if ([...e.dataTransfer.items].some(i => i.kind === 'file')) { e.preventDefault(); setDragging(true) } }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false); attach(e.dataTransfer.files[0]) }}>
        {(photo || preparing || photoError) && <div className="attachment">
          {preparing && <span className="hint">Preparando la foto…</span>}
          {photo && <><img src={photo} alt="Foto que vas a mandar" /><button type="button" className="remove-photo" onClick={() => setPhoto(null)} aria-label="Sacar la foto">×</button></>}
          {photoError && <span className="error" role="alert">{photoError}</span>}
        </div>}
        <div className="composer-row">
          <button type="button" className="btn secondary attach" onClick={() => picker.current?.click()} disabled={sending || preparing} aria-label="Adjuntar una foto del ejercicio" title="Adjuntar una foto (también podés pegarla o arrastrarla)">
            <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h2l1.2-1.6h4.6L13.5 5h2A1.5 1.5 0 0 1 17 6.5v8a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 14.5z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /><circle cx="10" cy="10.5" r="3" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>
          </button>
          <input ref={picker} type="file" accept="image/*" hidden onChange={e => { attach(e.target.files?.[0]); e.target.value = '' }} />
          <textarea value={text} onChange={e => setText(e.target.value)} placeholder={exam ? 'Escribí tus respuestas o sacale una foto a tu hoja…' : 'Escribí tu duda, pegá un ejercicio o una captura…'} rows={exam ? 4 : 2} maxLength={8000}
            onPaste={e => { const f = [...e.clipboardData.files].find(x => x.type.startsWith('image/')); if (f) { e.preventDefault(); attach(f) } }}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !exam) { e.preventDefault(); submit() } }} aria-label="Mensaje para el tutor" />
          <button className="btn" disabled={(!text.trim() && !photo) || sending || preparing}>Enviar</button>
        </div>
      </form>
    </>
  )

  if (exam) return (
    <div className="mock-exam">
      <header className="exam-bar">
        <div><b>Simulacro · {exam.subject}</b><span>{exam.minutes} minutos</span></div>
        <div className={`clock ${remaining <= 0 ? 'over' : remaining < 5 * 60000 ? 'low' : ''}`} role="timer" aria-live="off">{remaining > 0 ? clock(remaining) : 'Tiempo'}</div>
        <div className="button-row"><button className="btn" onClick={handIn} disabled={sending}>Entregar</button>
          <button className="link" onClick={() => setExam(null)}>Salir sin entregar</button></div>
        <div className="progress"><i style={{ width: `${Math.min(100, 100 - (remaining / (exam.minutes * 600)))}%` }} /></div>
      </header>
      {remaining <= 0 && <p className="notice">Se terminó el tiempo. Mandá lo que tengas y tocá Entregar para que el tutor lo corrija.</p>}
      <div className="exam-body">{chat}</div>
    </div>
  )

  return (
    <div className="page tutor">
      <header className="greeting"><div><h1>Tutor</h1><p>Practicá con ejercicios de parciales reales de la FCEIA. Te da pistas antes que la solución.</p></div>
        <button className="btn secondary" onClick={() => setSettingUpExam(true)}>Hacer un simulacro</button></header>
      {settingUpExam && <MockExamForm subjects={examSubjects.map(s => s.name)} initial={subject?.name} onStart={startExam} onCancel={() => setSettingUpExam(false)} />}
      <div className="tutor-body">
        <aside className="conversations" aria-label="Conversaciones">
          <button className="btn full" onClick={newConversation}>Conversación nueva</button>
          {list.length === 0 && <p className="hint">Tus conversaciones van a aparecer acá.</p>}
          <ul>{list.map(c => (
            <li key={c.id} className={c.id === conversation ? 'on' : ''}>
              <button onClick={() => setConversation(c.id)}><b>{c.title}</b><span>{c.mockExam ? 'Simulacro · ' : ''}{when(c.date)}</span></button>
              <button className="remove" aria-label={`Quitar "${c.title}" de la lista`} onClick={() => remove(c.id)}>×</button>
            </li>))}</ul>
        </aside>
        <section className="conversation">{chat}</section>
      </div>
    </div>
  )
}

function MockExamForm({ subjects, initial, onStart, onCancel }: { subjects: string[]; initial?: string; onStart: (subject: string, minutes: number) => void; onCancel: () => void }) {
  const [subject, setSubject] = useState(initial && subjects.includes(initial) ? initial : subjects[0] ?? '')
  const [minutes, setMinutes] = useState(90)
  return (
    <form className="card exam-form" onSubmit={e => { e.preventDefault(); if (subject) onStart(subject, minutes) }}>
      <h2>Simulacro de parcial</h2>
      <p className="hint">El tutor arma un parcial al estilo de la cátedra y corre el reloj. Al entregar, te lo corrige.</p>
      <label>Materia<select value={subject} onChange={e => setSubject(e.target.value)}>{subjects.map(o => <option key={o}>{o}</option>)}</select></label>
      <div><span className="label">Tiempo</span><div className="segmented">{[30, 60, 90, 120].map(m => <button type="button" key={m} className={minutes === m ? 'on' : ''} onClick={() => setMinutes(m)}>{m} min</button>)}</div></div>
      <div className="button-row"><button className="btn" disabled={!subject}>Empezar</button><button type="button" className="link" onClick={onCancel}>Cancelar</button></div>
    </form>
  )
}
