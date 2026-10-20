---
service: web
status: active
owner: "@felisaga"
flows: [tutor-chat]
consumes: []
publishes: []
config: [VITE_API_URL]
reviewed: 2026-10-20
---

# Pantalla del tutor

`/tutor`: chat con el tutor, lista de conversaciones, foto de un ejercicio y simulacro con cronómetro.

## Decision

La lista de conversaciones vive en `localStorage` (`arbol.conversations.<uid>`), porque backend no tiene un endpoint para listarlas. Los mensajes sí salen de backend (`GET /conversations/{id}`).

Como backend manda la respuesta entera en un solo evento `text`, la app la revela palabra por palabra (`TypedText`) para que no aparezca de golpe. Cuando backend haga streaming real no hay que cambiar nada: cada `text` se agrega al final.

Rechazado:
- **`EventSource`**: no admite `POST` ni el header `Authorization`. El stream se lee con `fetch` + `getReader()` (`web/src/lib/api.ts`).

## Contract

**Out:** `POST /api/chat` y `GET /api/students/{id}/conversations/{conversation_id}` de backend ([contratos §2.4 y §2.5](../../../docs/contratos.md)).

**Depende de:** los nombres de evento `status`, `text`, `done`, `error` y del código `tutor_unavailable`, que la app matchea literalmente.

**Entrada por URL:** `/tutor?subject=<id>` abre el tutor con esa materia. La usan las alertas, la ficha de la materia y los links de los recordatorios de backend ([reminders](../../../backend/docs/flows/reminders.md)): renombrar el parámetro rompe los tres.

## Flow

La app es dueña de la experiencia del chat, no del turno. Diagrama en [tutor-chat](../flows/tutor-chat.md).

Lo que es solo de la app:

- La foto se achica a 1600 px en JPEG antes de mandarla (`src/lib/photo.ts`): cámara en el celular, pegar o arrastrar.
- El simulacro lo arranca el tutor con su tool; la app solo lleva el reloj (`arbol.mockExam.<uid>` en `localStorage`) y pide la corrección al entregar.
- Markdown y LaTeX con KaTeX (`src/components/RichText.tsx`).
- Después de cada `done`, invalida árbol y alertas en el caché de TanStack Query.

## When it fails

| Estado | Se cura solo | Quién lo recupera |
|---|---|---|
| `localStorage` bloqueado o borrado | no: las conversaciones viejas no se listan, siguen en backend | nadie hasta que exista el endpoint de listado |
| Backend sin key de OpenRouter | no: la app muestra "El tutor no está disponible ahora" | quien despliega backend |

## Operating

- Sin `VITE_API_URL` la app usa un tutor de ejemplo ([demo-mode](demo-mode.md)).
- Rollback: build anterior de la app. Lo guardado en `localStorage` es compatible hacia atrás.
