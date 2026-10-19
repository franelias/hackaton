import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../lib/api'
import Texto, { TextoQueAparece } from '../components/Texto'
import { useSesion } from '../lib/session'
import type { ChatMessage } from '../lib/types'

// El backend no tiene un endpoint para listar conversaciones: guardamos en el navegador los ids que
// devuelve el chat (con un título y la fecha) y cada una se recarga con GET /conversations/{id}.
interface Conversacion { id: string; titulo: string; fecha: string; simulacro?: boolean }
interface Simulacro { conv: string | null; materia: string; minutos: number; inicio: number }

const leer = <T,>(k: string, def: T): T => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) as T : def } catch { return def } }
const guardar = (k: string, v: unknown) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)) } catch { /* sin storage */ } }
const cuando = (iso: string) => { const d = Math.floor((Date.now() - new Date(iso).getTime()) / 864e5); return d <= 0 ? 'hoy' : d === 1 ? 'ayer' : `hace ${d} días` }
const reloj = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }

export default function Tutor() {
  const { studentId, plan, tree, usuario, refrescar } = useSesion()
  const [params] = useSearchParams()
  const uid = usuario?.uid ?? 'anon', CLAVE_LISTA = `arbol.conversaciones.${uid}`, CLAVE_SIM = `arbol.simulacro.${uid}`
  const materia = plan?.subjects.find(s => s.subject_id === Number(params.get('materia')))
  const [lista, setLista] = useState<Conversacion[]>(() => leer(CLAVE_LISTA, []))
  const [conv, setConv] = useState<string | null>(() => lista[0]?.id ?? null)
  const [mensajes, setMensajes] = useState<ChatMessage[]>([])
  const [texto, setTexto] = useState(materia ? `Quiero practicar ${materia.name} para el parcial.` : '')
  const [estado, setEstado] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  // la última respuesta se muestra de a poco solo si llegó ahora, no si viene del historial
  const [animando, setAnimando] = useState(false)
  const [cargandoConv, setCargandoConv] = useState(false)
  const [sim, setSim] = useState<Simulacro | null>(() => leer(CLAVE_SIM, null))
  const [armandoSim, setArmandoSim] = useState(false)
  const [ahora, setAhora] = useState(Date.now())
  const fin = useRef<HTMLDivElement>(null)

  useEffect(() => guardar(CLAVE_LISTA, lista), [lista, CLAVE_LISTA])
  useEffect(() => guardar(CLAVE_SIM, sim), [sim, CLAVE_SIM])
  useEffect(() => { if (!sim) return; const t = setInterval(() => setAhora(Date.now()), 1000); return () => clearInterval(t) }, [sim])
  const bajar = useCallback(() => { fin.current?.scrollIntoView({ block: 'end' }) }, [])
  useEffect(() => { bajar() }, [mensajes, estado, bajar])

  // abrir una conversación guardada; si se cambia de chat antes de que llegue, la respuesta vieja se descarta
  useEffect(() => { if (!studentId || !conv || enviando) return
    let vigente = true
    setAnimando(false); setMensajes([]); setCargandoConv(true)
    api.conversation(studentId, conv).then(r => { if (vigente) setMensajes(r.messages) }).catch(() => { if (vigente) setMensajes([]) })
      .finally(() => { if (vigente) setCargandoConv(false) })
    return () => { vigente = false; setCargandoConv(false) } }, [studentId, conv]) // eslint-disable-line react-hooks/exhaustive-deps

  const enviar = useCallback(async (msg: string, opciones: { nueva?: boolean; simulacro?: boolean } = {}) => {
    msg = msg.trim(); if (!msg || !studentId || enviando) return
    const usar = opciones.nueva ? null : conv
    if (opciones.nueva) setConv(null)
    setTexto(''); setEnviando(true); setEstado('Pensando…')
    setMensajes(m => [...(opciones.nueva ? [] : m), { role: 'user', text: msg }, { role: 'assistant', text: '' }])
    const agregar = (d: string) => setMensajes(m => { const c = [...m]; c[c.length - 1] = { ...c[c.length - 1], text: c[c.length - 1].text + d }; return c })
    await api.chat({ student_id: studentId, message: msg, ...(usar ? { conversation_id: usar } : {}) }, {
      onStatus: s => { setEstado(s.message); if (s.tool === 'start_mock_exam') setSim(x => x ? { ...x, inicio: Date.now() } : x) },
      onText: d => { setEstado(null); setAnimando(true); agregar(d) },
      onDone: d => {
        setConv(d.conversation_id)
        setLista(l => l.some(c => c.id === d.conversation_id) ? l.map(c => c.id === d.conversation_id ? { ...c, fecha: new Date().toISOString() } : c)
          : [{ id: d.conversation_id, titulo: msg.slice(0, 60), fecha: new Date().toISOString(), simulacro: opciones.simulacro }, ...l])
        setSim(x => x && !x.conv && opciones.simulacro ? { ...x, conv: d.conversation_id } : x)
        if (d.tree_changed) refrescar()
      },
      onError: e => agregar(e.code === 'tutor_unavailable' ? 'El tutor no está disponible ahora (falta configurar el modelo en el backend).' : `No pude responder: ${e.message}`),
    }).catch(e => agregar(`No pude responder: ${(e as Error).message}`))
    setEstado(null); setEnviando(false)
  }, [studentId, enviando, conv, refrescar])

  const nueva = () => { setConv(null); setMensajes([]); setAnimando(false) }
  const quitar = (id: string) => { setLista(l => l.filter(c => c.id !== id)); if (id === conv) nueva() }
  const enviarForm = (ev?: FormEvent) => { ev?.preventDefault(); enviar(texto) }

  // simulacro
  const opcionesSim = useMemo(() => { const est = new Map((tree?.subjects ?? []).map(s => [s.subject_id, s.state]))
    return (plan?.subjects ?? []).filter(s => ['enrolled', 'regular', 'available'].includes(est.get(s.subject_id) ?? '')).sort((a, b) => (est.get(a.subject_id) === 'enrolled' ? -1 : 0) - (est.get(b.subject_id) === 'enrolled' ? -1 : 0)) }, [plan, tree])
  const empezarSim = (mat: string, minutos: number) => { setArmandoSim(false); setSim({ conv: null, materia: mat, minutos, inicio: Date.now() })
    enviar(`Quiero hacer un simulacro de ${mat} de ${minutos} minutos, con ejercicios al estilo de los parciales de la cátedra. Dame el enunciado completo y no me ayudes hasta que entregue.`, { nueva: true, simulacro: true }) }
  const restante = sim ? sim.inicio + sim.minutos * 60000 - ahora : 0
  const entregar = () => { if (!sim) return; const conTiempo = restante > 0; setSim(null)
    enviar(conTiempo ? 'Terminé el simulacro. Corregime las respuestas que te mandé y poneme una nota de 0 a 100.' : 'Se terminó el tiempo del simulacro. Corregime lo que te mandé y poneme una nota de 0 a 100.') }

  const sugerencias = ['¿Qué temas se toman más en el parcial?', 'Dame un ejercicio de un parcial viejo', 'Armemos un plan hasta el parcial']
  const chat = (
    <>
      <div className="chat" aria-busy={cargandoConv}>
        {cargandoConv && <div className="esqueletos" role="status" aria-label="Cargando la conversación">{['user', 'assistant', 'user', 'assistant'].map((r, i) => <div key={i} className={`burbuja ${r} esqueleto`} />)}</div>}
        {mensajes.length === 0 && !sim && !cargandoConv && <div className="vacio"><p>¿Por dónde arrancamos?</p><div className="sugerencias">{sugerencias.map(s => <button key={s} onClick={() => setTexto(s)}>{s}</button>)}</div></div>}
        {mensajes.map((m, i) => m.text || m.role === 'user' ? <div key={i} className={`burbuja ${m.role}`}>{m.role === 'user' ? m.text
          : animando && i === mensajes.length - 1 ? <TextoQueAparece texto={m.text} alCrecer={bajar} alTerminar={() => setAnimando(false)} /> : <Texto texto={m.text} />}</div> : null)}
        {estado && <div className="estado-tutor" role="status"><i /><span key={estado}>{estado}</span></div>}
        <div ref={fin} />
      </div>
      <form className="escribir" onSubmit={enviarForm}>
        <textarea value={texto} onChange={e => setTexto(e.target.value)} placeholder={sim ? 'Escribí tus respuestas…' : 'Escribí tu duda o pegá un ejercicio…'} rows={sim ? 4 : 2}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !sim) { e.preventDefault(); enviarForm() } }} aria-label="Mensaje para el tutor" />
        <button className="btn" disabled={!texto.trim() || enviando}>Enviar</button>
      </form>
    </>
  )

  if (sim) return (
    <div className="simulacro">
      <header className="barra-sim">
        <div><b>Simulacro · {sim.materia}</b><span>{sim.minutos} minutos</span></div>
        <div className={`reloj ${restante <= 0 ? 'fin' : restante < 5 * 60000 ? 'poco' : ''}`} role="timer" aria-live="off">{restante > 0 ? reloj(restante) : 'Tiempo'}</div>
        <div className="fila-botones"><button className="btn" onClick={entregar} disabled={enviando}>Entregar</button>
          <button className="enlace" onClick={() => setSim(null)}>Salir sin entregar</button></div>
        <div className="progreso"><i style={{ width: `${Math.min(100, 100 - (restante / (sim.minutos * 600)))}%` }} /></div>
      </header>
      {restante <= 0 && <p className="aviso">Se terminó el tiempo. Mandá lo que tengas y tocá Entregar para que el tutor lo corrija.</p>}
      <div className="sim-cuerpo">{chat}</div>
    </div>
  )

  return (
    <div className="pagina tutor">
      <header className="saludo"><div><h1>Tutor</h1><p>Practicá con ejercicios de parciales reales de la FCEIA. Te da pistas antes que la solución.</p></div>
        <button className="btn secundario" onClick={() => setArmandoSim(true)}>Hacer un simulacro</button></header>
      {armandoSim && <FormSimulacro opciones={opcionesSim.map(s => s.name)} inicial={materia?.name} empezar={empezarSim} cancelar={() => setArmandoSim(false)} />}
      <div className="tutor-cuerpo">
        <aside className="conversaciones" aria-label="Conversaciones">
          <button className="btn ancho" onClick={nueva}>Conversación nueva</button>
          {lista.length === 0 && <p className="pista">Tus conversaciones van a aparecer acá.</p>}
          <ul>{lista.map(c => (
            <li key={c.id} className={c.id === conv ? 'on' : ''}>
              <button onClick={() => setConv(c.id)}><b>{c.titulo}</b><span>{c.simulacro ? 'Simulacro · ' : ''}{cuando(c.fecha)}</span></button>
              <button className="quitar" aria-label={`Quitar "${c.titulo}" de la lista`} onClick={() => quitar(c.id)}>×</button>
            </li>))}</ul>
        </aside>
        <section className="conversacion">{chat}</section>
      </div>
    </div>
  )
}

function FormSimulacro({ opciones, inicial, empezar, cancelar }: { opciones: string[]; inicial?: string; empezar: (m: string, min: number) => void; cancelar: () => void }) {
  const [mat, setMat] = useState(inicial && opciones.includes(inicial) ? inicial : opciones[0] ?? '')
  const [min, setMin] = useState(90)
  return (
    <form className="tarjeta form-sim" onSubmit={e => { e.preventDefault(); if (mat) empezar(mat, min) }}>
      <h2>Simulacro de parcial</h2>
      <p className="pista">El tutor arma un parcial al estilo de la cátedra y corre el reloj. Al entregar, te lo corrige.</p>
      <label>Materia<select value={mat} onChange={e => setMat(e.target.value)}>{opciones.map(o => <option key={o}>{o}</option>)}</select></label>
      <div><span className="etiqueta">Tiempo</span><div className="segmentos">{[30, 60, 90, 120].map(m => <button type="button" key={m} className={min === m ? 'on' : ''} onClick={() => setMin(m)}>{m} min</button>)}</div></div>
      <div className="fila-botones"><button className="btn" disabled={!mat}>Empezar</button><button type="button" className="enlace" onClick={cancelar}>Cancelar</button></div>
    </form>
  )
}
