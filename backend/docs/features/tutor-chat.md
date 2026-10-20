---
service: backend
status: active
owner: "@eugeniobergia"
flows: [tutor-chat]
consumes: []
publishes: []
config: [OPENROUTER_API_KEY, TUTOR_MODEL, TUTOR_FALLBACK_MODELS, FCEIA_API_BASE]
reviewed: 2026-10-20
---

# Tutor IA (chat)

Un tutor que conoce el árbol del alumno, busca parciales reales y materiales de la FCEIA, da pistas antes que la solución, toma simulacros cronometrados y registra el progreso en el árbol.

## Decision

Los modelos van por **OpenRouter en formato OpenAI Chat Completions**, con un modelo principal y fallbacks de otros proveedores en el campo `models`. Las tools de la FCEIA se llaman **en proceso** desde el módulo compartido `fceia/tools`, no por MCP.

Rechazado:
- **API de un solo proveedor**: si ese proveedor se cae en la demo, no hay tutor. OpenRouter cambia de modelo solo.
- **Llamar al servidor MCP por red**: un salto más que puede fallar, sin ganancia; el MCP queda para clientes externos ([mcp-server](../../../fceia/docs/features/mcp-server.md)).
- **Pasar `student_id` a las tools locales**: el modelo nunca elige alumno. `record_progress`, `view_my_tree` y `start_mock_exam` toman el alumno del request autenticado.
- **Streaming token a token (etapa 2 del contrato)**: no hecho. Se manda un solo `text` al final; la app simula el tipeo. El contrato SSE ya lo admite sin cambios.

## Contract

**In:** `POST /api/chat` (SSE) y `GET /api/students/{id}/conversations/{conversation_id}`. Eventos, errores previos al stream y tools locales en [contratos §2.4, §2.5 y §3](../../../docs/contratos.md).

**Código que la app matchea:** `tutor_unavailable`, con texto propio en `web/src/pages/Tutor.tsx`, tanto en el `503` previo al stream como en el evento `error`. El resto (incluido `429 rate_limited`) se muestra con su `message`, que ya viene en español para el alumno.

**Depende de:** OpenRouter (el backend no le pone timeout propio: dura lo que dure la request del alumno) y la API de la FCEIA a través de las tools. Si una tool falla, el modelo recibe `ERROR: …` y sigue con lo que tiene.

## Flow

backend es dueño del turno: historial, tools, límites y persistencia. Diagrama en [tutor-chat](../../../web/docs/flows/tutor-chat.md).

Lo que es solo de backend:

- Un turno a la vez por alumno, y cuotas de 8 por minuto, 60 por hora y 200 por día (`chatLimiter`, en memoria: se reinician con el proceso y no se comparten entre réplicas).
- Un turno guarda todo o nada: los mensajes nuevos y la actividad `chat` van en una transacción **después** de que el modelo terminó. Si el modelo falla, no queda nada del turno salvo la conversación vacía si era nueva.
- Al modelo van los últimos 40 mensajes, cortando en un mensaje del alumno para no dejar un resultado de tool sin su llamada.
- Límites por turno: 12 rondas, 24 llamadas a tools, 30 000 bytes por resultado, 4096 tokens por respuesta, `record_progress` 3 veces.
- Contexto del servidor en `<context>`, texto del alumno en `<student_message>`; `neutralize` rompe esas etiquetas si vienen del alumno. Los errores de base se loguean y nunca llegan al modelo ni al cliente.
- La imagen se valida (PNG, JPEG, GIF o WebP, hasta 5 MB) y va al modelo, pero no se guarda en el historial.
- Un simulacro solo se corrige si hay uno en curso de esa materia en esa conversación.

## When it fails

| Estado | Se cura solo | Quién lo recupera |
|---|---|---|
| Sin `OPENROUTER_API_KEY` | no, `503` en cada mensaje | quien despliega |
| Modelo principal caído | sí, OpenRouter pasa a los fallbacks | nadie |
| Todos los modelos fallan o se pasan las 12 rondas | sí, el alumno reintenta; no quedó nada guardado | nadie |
| Proceso reiniciado | sí, pero las cuotas en memoria vuelven a cero | nadie |

## Operating

- Modelos: `TUTOR_MODEL` y `TUTOR_FALLBACK_MODELS` (separados por coma). Cambiarlos no requiere imagen nueva, solo reiniciar.
- Prompt en `internal/tutor/prompt.go`; textos de estado de cada tool en `internal/tutor/fceia.go` (una tool nueva en `fceia/tools` aparece sola, pero sin texto de estado propio).
- No hay métricas: buscar `chat:` en los logs.
- Rollback: imagen anterior. Las conversaciones guardadas son JSON de Chat Completions y siguen siendo legibles.
