---
flow: tutor-chat
owner: "@felisaga"
services: [web, backend, openrouter, fceia-api]
trigger: el alumno manda un mensaje (con o sin foto) en /tutor
outcome: la respuesta del tutor en pantalla, el turno guardado y el árbol actualizado
reviewed: 2026-10-20
---

# Chat con el tutor

Desde que el alumno manda un mensaje hasta que ve la respuesta y su árbol refleja lo que registró el tutor. Un request HTTP sostenido como SSE; nada en cola.

```mermaid
sequenceDiagram
    actor A as Alumno
    participant W as web
    participant B as backend
    participant O as OpenRouter
    participant F as API FCEIA

    A->>W: mensaje (+ foto, achicada a 1600 px)
    W->>B: POST /api/chat
    alt sin key, cuota agotada, conversación ajena o body inválido
        B-->>W: JSON 4xx / 503, sin stream
    else ok
        B-->>W: 200 text/event-stream
        loop hasta que el modelo responde sin tools (máx. 12 rondas)
            B->>O: chat completions (principal + fallbacks)
            O-->>B: tool calls
            B-->>W: event: status (por tool)
            alt tool de la FCEIA
                B->>F: GET (caché 1 h)
            else tool local
                B->>B: record_progress / view_my_tree / start_mock_exam
            end
        end
        alt el modelo falla
            B-->>W: event: error tutor_unavailable
            Note over B: no se guarda nada del turno
        else respuesta
            B->>B: guarda mensajes + actividad chat (una transacción)
            B-->>W: event: text (respuesta entera)
            B-->>W: event: done {tree_changed, conversation_id}
            W->>W: guarda conversation_id en localStorage
            W->>B: GET /tree + GET /alerts
        end
    end
```

## What each service does

- **web**: arma el mensaje, lee el stream con `fetch` (no `EventSource`, que no admite `POST`), simula el tipeo y guarda la lista de conversaciones en el navegador.
  → [web/docs/features/tutor-chat.md](../features/tutor-chat.md)
- **backend**: dueño del turno, las tools, los límites y el historial.
  → [backend/docs/features/tutor-chat.md](../../../backend/docs/features/tutor-chat.md)
- **OpenRouter**: externo. Elige entre el modelo principal y los fallbacks.
- **API FCEIA**: externa, solo lectura, a través de `fceia/tools`.
  → [fceia/docs/features/fceia-tools.md](../../../fceia/docs/features/fceia-tools.md)

## Rules between services

- `done` llega siempre una vez al final de un turno exitoso; `error` lo reemplaza si algo falla. La app cierra el mensaje con cualquiera de los dos.
- `tree_changed` hoy es siempre `true` (todo mensaje cuenta como actividad): la app vuelve a pedir árbol y alertas después de cada turno.
- El turno es atómico en backend: o quedan el mensaje del alumno, la respuesta y la actividad, o no queda nada. Un reintento desde la app no duplica.
- Lo que el tutor registra (`record_progress`) se guarda en el momento de la tool, antes del final del turno. Si después el modelo falla, el progreso queda y el mensaje no.
- La foto viaja al modelo pero no se guarda: al recargar la conversación la app muestra un texto en su lugar.

## Where it gets stuck

| Estado | Se cura solo | Quién lo recupera |
|---|---|---|
| El alumno cierra la pestaña a mitad del turno | sí: el contexto se cancela, no se guarda el turno; lo que ya registró `record_progress` queda | nadie |
| `record_progress` guardó y el turno falló | no se deshace: el árbol muestra progreso que el chat no menciona | nadie; es progreso real del alumno |
| Lista de conversaciones solo en `localStorage` | no: en otro navegador o tras limpiar datos, las conversaciones existen en backend pero la app no las lista | falta `GET /api/students/{id}/conversations` en backend |
