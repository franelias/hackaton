# Contratos entre frentes — Árbol

> Contratos acordados en el kickoff (issue #1), actualizados durante la planificación del backend.
> Base de la API: `https://fceia-api.ariloc.ar/api/v1` (pública, solo lectura, sin auth).

## 0. Decisiones del kickoff

| Tema | Decisión |
|---|---|
| Carrera de la demo | Licenciatura en Ciencias de la Computación (`career_id = 1`) |
| App | React (web) |
| Backend | Go + Chi |
| Persistencia | Postgres (reemplaza la mención a SQLite del issue #9) |
| Autenticación | Firebase Auth (Google y email + contraseña); el backend verifica el ID token |
| Streaming del chat | Contrato SSE desde el día 1; implementación en dos etapas (ver 2.5) |
| Formato de errores | `{ "error": { "code": "string", "message": "string" } }` en backend y MCP. Códigos del MCP: `not_found`, `api_unavailable`, `invalid_argument` |
| Idioma | **Todo lo que viaja por el cable va en inglés**: rutas, campos, valores de enums propios, eventos SSE y nombres de tools del MCP. La documentación queda en español. Los textos que lee el alumno (`message` de una alerta, respuestas del tutor) van en español |

## 1. Convenciones

- **IDs de la API**: enteros, los mismos de la API (`subject_id`, `career_id`, `exam_id`, `session_id`). Ojo: **una materia tiene un `id` distinto en cada carrera**; lo que se comparte entre carreras es el `code` (ej. `FB11`).
- **IDs propios**: strings con prefijo + serial: alumno `s-001`, conversación `c-12`, alerta `al-17`.
- **IDs reales de la demo (LCC)**: Análisis Matemático I = `2`, Lógica = `12`, EDyA II = `15`, Arquitectura del Computador = `11`.
- **Fechas**: ISO 8601 (`2026-11-15`, `2026-10-19T15:00:00-03:00`).
- **Días de la semana**: ISO, `1` = lunes … `7` = domingo (igual que la API).
- **Horas**: `"HH:MM"` (igual que la API).
- **Valores que vienen crudos de la API** (`parcial`, `basica`, `apuntes`…) pasan tal cual, en español (así lo implementa el MCP). Los enums propios de nuestros contratos van en inglés.

## 1.1 Autenticación

Login con **Firebase Auth** (Google o email + contraseña), hecho por la app con el SDK de Firebase. Todos los endpoints `/api/me`, `/api/students...`, `/api/chat` y `/api/schedule` exigen el ID token de Firebase en el header:

```
Authorization: Bearer <Firebase ID token>
```

El backend verifica el token con el Admin SDK y obtiene el `uid`. Cada alumno queda vinculado a un `uid`, y el `uid` tiene que ser dueño del `student_id` de la URL (o del body en `/api/chat` y `/api/schedule`). Token ausente o inválido → `401`; alumno de otro usuario → `403`. `GET /api/careers/{career_id}/plan` es público.

Flujo de la app: login con Firebase → `GET /api/me` → si `student_id` es `null`, onboarding y `POST /api/students`.

En desarrollo se usa el Firebase Auth Emulator; para la demo, el proyecto real.

---

## 2. Contratos backend → app

La app hace tres pedidos y los cruza por `subject_id`:

| Endpoint | Qué trae | Cambia | Dueño |
|---|---|---|---|
| `GET /api/careers/{career_id}/plan` | Estructura del árbol: materias y correlativas | Nunca (cacheable) | Datos: Frente 1 (Fran) · Endpoint: Frente 2 (Eugenio) |
| `GET /api/students/{student_id}/tree` | Estado del alumno sobre esa estructura | Con cada actividad | Frente 2 (Eugenio) |
| `GET /api/students/{student_id}/alerts` | Alertas abiertas | Aparecen y se descartan | Frente 2 (Eugenio) |

### 2.1 `GET /api/careers/{career_id}/plan`

Igual para todos los alumnos de la carrera. Fran lo calcula desde la API con la revisión manual aplicada (`backend/cmd/plan` → `backend/data/plan_career_<id>.json`, ver `camino-critico.md`), el backend lo importa a Postgres y lo sirve desde la base.

```json
{
  "career_id": 1,
  "name": "Licenciatura en Ciencias de la Computación",
  "min_terms": 9,
  "critical_path": [1, 4, 7, 10, 15, 17, 23, 22, 25],
  "subjects": [
    {
      "subject_id": 6,
      "code": "r123",
      "name": "Programación II",
      "year": 1,
      "term": 2,
      "requires": [ { "subject_id": 3, "condition": "approved" } ],
      "unlocks": [12, 15],
      "unlocks_total": 17,
      "bottleneck": true,
      "optional": false,
      "slack": 0,
      "postpone_year_delay": 2
    }
  ]
}
```

| Campo | Notas |
|---|---|
| `requires[].condition` | `approved` · `regular`. Sale de `requirement` en `/relations` (`null` → `approved`, **a confirmar**) |
| `unlocks` | Materias que la requieren directamente (de `required_by`) |
| `unlocks_total` | Directas + indirectas; la app lo usa para el grosor del tronco |
| `bottleneck` | Cuello de botella: `unlocks_total >= 8` (ver `camino-critico.md`) |
| `optional` | `true` en las electivas: no entran en el plan base; se suman al camino crítico cuando el alumno las elige |
| `slack` | Holgura: cuatrimestres que se puede demorar sin atrasar la carrera (0 = camino crítico) |
| `postpone_year_delay` | Cuatrimestres que se atrasa la carrera si se pospone un año |
| `term` | Cuatrimestre dentro del año (`1` o `2`) |
| `min_terms`, `critical_path` | A nivel del plan: largo y cadena de `subject_id` de la ruta más larga |

La app calcula el layout (posición de cada rama) a partir de `requires` y `unlocks`. El backend no manda coordenadas.

### 2.2 `GET /api/students/{student_id}/tree`

Solo el estado del alumno; nada que ya esté en el plan.

```json
{
  "student_id": "s-001",
  "career_id": 1,
  "health": { "state": "wilted", "last_activity": "2026-10-08T21:10:00-03:00" },
  "streak": { "weeks": 0, "best": 8, "wildcards": 1 },
  "subjects": [
    { "subject_id": 6,  "state": "approved", "leaves": 14, "flower": false, "dry": false },
    { "subject_id": 12, "state": "enrolled", "leaves": 2,  "flower": false, "dry": true }
  ]
}
```

| Campo | Valores | Notas |
|---|---|---|
| `health.state` | `lush` (frondoso) · `wilted` (mustio) · `withered` (marchito) | Lo decide el backend (umbrales iniciales 5 / 10 días; 3 / 6 en época de parciales o mesas; pausados en receso). Nunca "muerto". La app solo lo dibuja |
| `health.last_activity` | fecha | Para mostrar "hace 11 días" si hace falta |
| `streak.weeks` | entero ≥ 0 | Semanas ISO seguidas con al menos 1 sesión de estudio (ejercicio, simulacro o chat) |
| `streak.best` | entero | La app muestra esta cuando `weeks` = 0 |
| `streak.wildcards` | entero 0–2 | Comodines: se gana 1 cada 4 semanas seguidas |
| `subjects[].state` | `approved` · `regular` · `enrolled` (cursando) · `available` · `locked` | Solo vienen las materias con estado distinto de `locked`; la app asume `locked` para el resto |
| `leaves` | entero | Hojas: ejercicios y sesiones registradas en esa materia |
| `flower` | bool | Flor: simulacro aprobado (≥ 60/100) y la materia no está aprobada; lista para rendir |
| `dry` | bool | Rama seca: hay una alerta abierta sobre esa materia. **Una materia aprobada nunca se seca** |

### 2.3 `GET /api/students/{student_id}/alerts`

```json
[
  {
    "id": "al-17",
    "level": "high",
    "type": "first_exam_missed",
    "subject_id": 12,
    "message": "Se viene el parcial de Lógica, ¿practicamos 1 ejercicio?",
    "action": { "type": "open_tutor", "subject_id": 12 }
  }
]
```

| Campo | Valores | Notas |
|---|---|---|
| `level` | `low` · `medium` · `high` | **No hay puntaje de abandono en el contrato, a propósito** |
| `type` | `inactivity` · `first_exam_missed` | Las señales del MVP. Inactividad: 5 días → `low`, 10 → `medium` (`open_tutor`), 15 → `high` (`contact_tutor`) |
| `message` | texto | En español, lo lee el alumno |
| `action.type` | `open_tutor` · `build_schedule` · `view_dates` · `contact_tutor` | Lo que hace el botón de la alerta |

`POST /api/students/{student_id}/alerts/{id}/dismiss` → `204`.

### 2.4 Escritura y chat

| Endpoint | Body | Respuesta |
|---|---|---|
| `GET /api/me` | — | `{ "student_id": "s-001" \| null }` |
| `POST /api/students` | `{ "name", "career_id" }` | `{ "student_id" }`. Crea el alumno del `uid` del token; `409` si ese `uid` ya tiene uno |
| `PUT /api/students/{id}/subjects/{subject_id}` | `{ "state": "approved" \| "regular" \| "enrolled" }` | árbol (2.2) |
| `POST /api/students/{id}/activity` | `{ "type": "checkin" \| "exercise" \| "mock_exam" \| "exam", "subject_id"?, "topic"?, "result"?, "date"? }` | árbol (2.2) |
| `POST /api/chat` | `{ "student_id", "message", "conversation_id"?, "image_base64"? }` | Stream SSE (ver 2.5) |
| `GET /api/students/{id}/conversations/{conversation_id}` | — | `{ "conversation_id", "messages": [ { "role": "user" \| "assistant", "text", "created_at" } ] }` |
| `POST /api/schedule` | `{ "student_id", "subject_ids": [..], "preferences"? }` | mismo formato que `build_schedule` (el backend completa `approved_subject_ids` y `regular_subject_ids` desde el estado del alumno) |

Notas de `activity`:

| `type` | Qué es | Campos |
|---|---|---|
| `checkin` | Acción chica que revive el árbol. No suma a la racha | — |
| `exercise` | Ejercicio practicado | `subject_id`, `topic`, `result: { "correct": bool }`. 3 correctos del mismo tema = tema dominado |
| `mock_exam` | Simulacro | `subject_id`, `result: { "score": 0-100 }`. Aprobado con ≥ 60 |
| `exam` | Fecha de un parcial del alumno (la API solo tiene parciales viejos) | `subject_id`, `date`. Si pasa la fecha sin `result`, se dispara `first_exam_missed` |

Cualquier `activity` o mensaje de chat cuenta como actividad (resetea `last_activity`). Abrir la app (un GET) no.

`PUT /subjects` permite corregir errores de carga, incluso bajar de `approved`.

### 2.5 Chat: formato SSE

`POST /api/chat` responde con `Content-Type: text/event-stream`. Hay cuatro tipos de evento (`error` solo si algo falla):

```
event: status
data: {"tool": "exercises", "message": "Buscando parciales de Lógica…"}

event: text
data: {"delta": "Arranquemos por inducción, que apareció en 7 de los 10 parciales. "}

event: done
data: {"tree_changed": true, "conversation_id": "c-12"}
```

| Evento | Cuándo | Qué hace la app |
|---|---|---|
| `status` | Cada vez que Claude llama a una tool | Muestra el mensaje como indicador ("Buscando…") hasta el próximo `text` |
| `text` | Uno o más por respuesta | Agrega `delta` al final del mensaje del tutor |
| `done` | Siempre, una vez, al final | Cierra el mensaje; guarda `conversation_id` para el próximo mensaje; si `tree_changed` es `true`, vuelve a pedir el árbol (2.2) y las alertas (2.3) |
| `error` | Si algo falla | Muestra `{ "error": { "code", "message" } }` y cierra |

**Conversaciones:** `conversation_id` es opcional. Si no viene, el backend crea una conversación nueva y devuelve su id en `done`. Para seguir la misma, la app lo manda en los mensajes siguientes.

**Implementación en dos etapas (sin cambiar el contrato):**

1. **Etapa 1, para integrar rápido:** el backend emite un `status` por cada tool que llama y, cuando Claude termina, manda **un solo** `text` con la respuesta entera y después `done`. La app ya muestra "Buscando parciales…" y el código del cliente es el definitivo.
2. **Etapa 2, si sobra tiempo:** el backend usa el streaming de la API de Claude y reenvía cada fragmento como un `text`. La app no cambia nada.

Para el cliente: `EventSource` no soporta `POST` ni headers propios, así que la app lee el stream con `fetch` + `response.body.getReader()` (o una librería como `@microsoft/fetch-event-source`).

---

## 3. Tools del MCP

Servidor en `mcp/` (Go). Nombres de tools, parámetros y campos **en inglés**; los valores que vienen de la API (`parcial`, `final`…) se dejan tal cual. Todas devuelven JSON (`structuredContent`) y las listas van dentro de un objeto. Las URLs de archivos (`file_url`, `url`, `pdf_url`) son siempre absolutas.

**Errores**: tool error (`isError: true`) con `{ "error": { "code", "message" } }`; `code` ∈ `not_found` · `api_unavailable` · `invalid_argument`. Un resultado vacío no es error.

### `search_subject(name: str, career_id?: int)`
(`GET /subjects?q=&career_id=`; `q` ignora tildes)
```json
{ "subjects": [ { "subject_id": 12, "code": "r223", "name": "Lógica", "career_id": 1, "year": 2, "term": 4 } ] }
```

### `frequent_topics(subject_id: int, since?: int)`
(`GET /exams?subject_id=`; parsea `description` → "Temas: a; b; c"; agrupa ignorando tildes, mayúsculas y el paréntesis final; muestra la variante más frecuente. Los exámenes sin fecha cuentan, pero no aportan `last_year`; `since` no los descarta)
```json
{ "subject_id": 21, "exams_analyzed": 10, "undated": 4,
  "topics": [ { "topic": "inducción", "count": 7, "last_year": 2025 } ] }
```

### `exercises(subject_id: int, topic?: str, category?: "parcial"|"final"|"recuperatorio"|"coloquio"|"quiz", limit?: int = 3)`
(`GET /exams?subject_id=&category=` + `GET /exams/{id}/text`; `limit` máximo 10. El filtro por tema se hace en el MCP, sin tildes ni mayúsculas, sobre título + descripción, porque `text=` de la API distingue ambas. Más nuevos primero)
```json
{ "exercises": [ { "exam_id": 929, "title": "…", "category": "parcial", "date": "2026-05-14",
    "text": "…", "file_url": "https://fceia-api.ariloc.ar/media/…", "scanned": true,
    "has_solution": false, "solution_id": null } ] }
```
`scanned` sale de la descripción ("Escaneo…"): mostrar también el PDF de `file_url`.

### `solution(exam_id: int)`
(`GET /exams/{id}` → `solution_id` → `GET /solutions/{id}/text`; **solo 25 de las 73 resoluciones tienen `exam_id`**)
```json
{ "exam_id": 929, "available": false, "text": "" }
```

### `search_materials(subject_id: int, topic: str, limit?: int = 3)`
(`GET /materials?subject_id=&text=` probando `topic` tal cual, en minúscula y capitalizado, + `GET /materials/{id}/text`; `limit` máximo 10)
```json
{ "materials": [ { "material_id": 3016, "title": "…", "kind": "apuntes", "snippet": "…", "url": "https://fceia-api.ariloc.ar/media/…" } ] }
```
`snippet` son ~1500 caracteres alrededor de la primera coincidencia.

### `bibliography(subject_id: int)`
(`GET /subjects/{id}/bibliography`)
```json
{ "books": [ { "title": "…", "author": "…", "year": 2005, "isbn": "…", "kind": "basica" } ] }
```

### `prerequisites(subject_id: int)`
(`GET /subjects/{id}/relations`; `requirement: null` → `approved`, **a confirmar en #6**)
```json
{ "subject_id": 55,
  "requires": [ { "subject_id": 52, "code": "FB3", "condition": "regular" } ],
  "unlocks": [ { "subject_id": 59, "name": "Cálculo III" } ] }
```

### `dates(career_id: int, year?: int)`
(`GET /calendar?year=` + `GET /exam-boards?career_id=`; `year` por defecto el año actual. Casi todos los eventos vienen con `from`/`to` en `null`: usar `notes` y `source_url`)
```json
{ "events": [ { "kind": "resolucion", "title": "…", "from": null, "to": null, "notes": "…", "source_url": "…" } ],
  "exam_boards": [ { "title": "Mesas flotantes 2do cuatrimestre 2026", "session_kind": "flotante", "pdf_url": "…", "notes": "…" } ] }
```

### `build_schedule(subject_ids: int[], approved_subject_ids?: int[], regular_subject_ids?: int[], semester?: str, preferences?: { shift?: "morning"|"afternoon"|"evening", free_days?: int[] })`
(`GET /subjects/{id}`, `/subjects/{id}/sessions`, `/subjects/{id}/relations`; hasta 12 materias de una misma carrera)

- **Correlativas**: si llega `approved_subject_ids` o `regular_subject_ids`, las materias con correlativas sin cumplir salen en `not_enabled` y no se arman. Una correlativa `regular` se cumple con regular o aprobada; el resto exige aprobada. Si no llega ninguno, no se chequea y hay un `warning`. `POST /api/schedule` los arma desde el estado del alumno.
- **Comisiones**: salen de `notes` (`Com.: 630`, `Com: 630 y Com: 660`). Sin etiquetas, la materia tiene una sola. Si la materia tiene comisiones etiquetadas, las clases sin etiqueta se ignoran (duplicados parciales de la API) y se avisa. LCC no tiene comisiones alternativas.
- **Semestre**: por materia, el más reciente (`2026-2S`); si solo tiene "última publicación" va con `stale: true` y un aviso. `semester` fuerza uno.
- **Fin de clase vacío**: se asumen 180 min y la clase sale con `end_estimated: true`.
- **Orden** (hasta 3 opciones): menos clases fuera del turno pedido (por hora de inicio: `morning` < 13:00, `afternoon` 13:00–18:59, `evening` desde 19:00), menos días en la facultad, menos horas de hueco, menor comisión. `free_days` es restricción dura; si ninguna combinación la cumple se ignora con un aviso.
- **Sin combinación**: `conflicts` lista los pares que chocan en todas sus comisiones; `suggest_postpone` es el conjunto a postergar que menos cuellos de botella (`destraba_total >= 8`) toca, después el más chico, después el que menos destraba; `options` arma el resto. Los cuellos de botella se calculan en el MCP desde `/relations`.
- **Traslados**: `warnings` avisa dos clases seguidas en sedes distintas con menos de 60 min entre ellas (solo si ambas sedes están informadas). No influye en el orden.

```json
{ "options": [
    { "commissions": [ { "subject_id": 12, "name": "Lógica", "commission": "", "stale": false,
        "classes": [ { "day": 1, "from": "07:30", "to": "11:00", "campus": "Sede Pellegrini", "room": "14 Pell.", "end_estimated": false } ] } ],
      "days_on_campus": 3, "gap_hours": 1.5 } ],
  "scheduled_subject_ids": [12],
  "conflicts": [ { "subject_ids": [7, 12], "day": 1, "from": "07:30", "to": "11:00" } ],
  "suggest_postpone": [12],
  "not_enabled": [ { "subject_id": 21, "name": "Teoría de Base de Datos", "missing": [ { "subject_id": 15, "code": "r312", "condition": "approved" } ] } ],
  "without_schedule": [16],
  "warnings": [ "…" ] }
```
`without_schedule`: materias que la API no tiene con clases (por ejemplo Suficiencia de Inglés): no entran al armado.

### Tools locales del backend: `record_progress`, `view_my_tree`, `start_mock_exam`

No están en el MCP: el backend las agrega al loop de tool use junto con las del MCP. **No reciben `student_id`**: el backend lo inyecta desde el request autenticado, así Claude nunca puede tocar a otro alumno.

- `record_progress(type: str, subject_id?: int, topic?: str, result?: object, date?: str)`: mismo body que `POST /activity` (2.4).
- `view_my_tree()`: devuelve el árbol (2.2) con el `name` de cada materia y las alertas abiertas, para que Claude tenga todo en una llamada.
- `start_mock_exam(subject_id: int, minutes: int)`: guarda el inicio del simulacro en la conversación. Cuando el alumno entrega, el backend le pasa a Claude el tiempo transcurrido.

---

## 4. Lo que encontramos en la API y cambia cosas

| Hallazgo | Impacto | Responsable |
|---|---|---|
| **Los horarios no tienen un campo "comisión"**: viene en el texto libre de `notes` (ej. `"Com: 610 ciclo básico"`) | El armador tiene que parsear `notes` para agrupar clases por comisión; si no hay número, se asume una sola comisión | Fran |
| `semester` en horarios mezcla `"2026-2S"` con `"última publicación"` | Filtrar por el cuatrimestre vigente y avisar si los horarios son viejos | Fran |
| Solo el 83 % de las clases tiene sede | El aviso de traslados entre sedes es parcial | Fran |
| **Las mesas de examen no traen fechas**, solo etiqueta y PDF | La alerta de inscripción a mesas queda fuera del MVP | Fran / Eugenio |
| **`/calendar` no trae receso ni períodos de parciales** (solo ingreso 2027 y dos eventos sin fecha) | Los períodos 2026 se cargan a mano desde el PDF del Calendario Académico (Res. DEC 1723/2025) | Eugenio |
| Solo 25 de las 73 resoluciones están vinculadas a un examen | `solution()` va a devolver `available: false` casi siempre; el tutor resuelve solo | Eugenio |
| El texto de los materiales se busca por subcadena, no hay búsqueda semántica | `search_materials` es búsqueda por texto, no RAG con embeddings (ajustar la propuesta) | Fran |
| `requirement` en correlativas puede ser `"regular"` o `null` | Confirmar que `null` significa "aprobada" | Fran |
| Materias compartidas entre carreras se reconocen por `code` | Resuelve la "reorientación": `GET /subjects?code=` | Fran |
| `GET /subjects/{id}/overview` trae horarios, correlativas y conteos de exámenes en una llamada | Útil para armar el plan sin N llamadas | Fran |
