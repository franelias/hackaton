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
| Modelos del tutor | OpenRouter (formato OpenAI Chat Completions): modelo principal `anthropic/claude-sonnet-5.5` y fallbacks de otros proveedores (`openai/gpt-6-astra`, `google/gemini-3.1-pro-preview`), configurables en el backend |
| Streaming del chat | Contrato SSE desde el día 1; implementación en dos etapas (ver 2.5) |
| Formato de errores | `{ "error": { "code": "string", "message": "string" } }` en backend y MCP. Códigos del MCP: `not_found`, `api_unavailable`, `invalid_argument` |
| Idioma | **Todo lo que viaja por el cable va en inglés**: rutas, campos, valores de enums propios, eventos SSE y nombres de tools del MCP. La documentación queda en español. Los textos que lee el alumno (`message` de una alerta, respuestas del tutor) van en español |

## 1. Convenciones

- **IDs de la API**: enteros, los mismos de la API (`subject_id`, `career_id`, `exam_id`, `session_id`). Ojo: **una materia tiene un `id` distinto en cada carrera**; lo que se comparte entre carreras es el `code` (ej. `FB11`).
- **IDs propios**: strings con prefijo + serial: alumno `s-001`, conversación `c-12`, alerta `al-17`, docente `t-3`.
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

El backend verifica el token con el Admin SDK y obtiene el `uid`. Cada alumno queda vinculado a un `uid`, y el `uid` tiene que ser dueño del `student_id` de la URL (o del body en `/api/chat` y `/api/schedule`). Token ausente o inválido → `401`; alumno de otro usuario → `403`. `GET /api/faculties` y `GET /api/careers/{career_id}/plan` son públicos.

Flujo de la app: login con Firebase → `GET /api/me` → si `teacher_id` no es `null`, la app ofrece la vista docente (2.6); si `student_id` es `null`, onboarding: elige facultad y carrera (`GET /api/faculties`), `POST /api/students` y carga de lo ya cursado con `PUT /api/students/{id}/subjects`.

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

Igual para todos los alumnos de la carrera. Fran lo calcula desde la API con la revisión manual aplicada (`arbol plan` en `backend/` → `backend/data/plan_career_<id>.json`, ver `camino-critico.md`), el backend lo importa a Postgres y lo sirve desde la base.

```json
{
  "career_id": 1,
  "name": "Licenciatura en Ciencias de la Computación",
  "min_terms": 7,
  "critical_path": [1, 4, 7, 10, 15, 21, 24],
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
  ],
  "final_goal": {
    "subject_id": 31,
    "code": "r523",
    "name": "Tesina",
    "year": 5,
    "term": 2,
    "requires_all": true
  }
}
```

| Campo | Notas |
|---|---|
| `requires[].condition` | `approved` · `regular`. Sale de `requirement` en `/relations` (`null` → `approved`, confirmado para LCC con los programas 2024) |
| `unlocks` | Materias que la requieren directamente (de `required_by`) |
| `unlocks_total` | Directas + indirectas; la app lo usa para el grosor del tronco |
| `bottleneck` | Cuello de botella: `unlocks_total >= 8` (ver `camino-critico.md`) |
| `optional` | `true` en las electivas: no entran en el plan base; se suman al camino crítico cuando el alumno las elige |
| `slack` | Holgura: cuatrimestres que se puede demorar sin atrasar la carrera (0 = camino crítico) |
| `postpone_year_delay` | Cuatrimestres que se atrasa la carrera si se pospone un año |
| `term` | Cuatrimestre dentro del año (`1` o `2`) |
| `min_terms`, `critical_path` | A nivel del plan: largo y cadena de `subject_id` de la ruta más larga |
| `final_goal` | La Tesina, objetivo final: fuera de `subjects` y de las correlativas; `requires_all: true` = hay que tener aprobadas todas las demás para presentarla. No cuenta en `min_terms` ni en `unlocks_total` |

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
| `health.state` | `lush` (frondoso) · `wilted` (mustio) · `withered` (marchito) | Lo decide el backend según los días sin actividad, sin contar los días de receso: menos de 5 → `lush`, desde 5 → `wilted`, desde 10 → `withered`. En **época de parciales** (semana de mesas del calendario, o el alumno tiene un `exam` cargado en los próximos 7 días) los umbrales bajan a 3 / 6. Nunca "muerto". La app solo lo dibuja |
| `health.last_activity` | fecha | Para mostrar "hace 11 días" si hace falta |
| `streak.weeks` | entero ≥ 0 | Semanas ISO seguidas (hora de Argentina) con al menos 1 sesión de estudio (ejercicio, simulacro o chat; el checkin no cuenta). Una semana vacía gasta un comodín o corta la racha; las semanas de receso la congelan; la semana en curso suma recién cuando tiene una sesión |
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
| `type` | `inactivity` · `first_exam_missed` | Las señales del MVP (ver abajo) |
| `message` | texto | En español, lo lee el alumno |
| `action.type` | `open_tutor` · `build_schedule` · `view_dates` · `contact_tutor` | Lo que hace el botón de la alerta |

`POST /api/students/{student_id}/alerts/{id}/dismiss` → `204` (`404` si no existe o es de otro alumno).

Reglas del MVP (umbrales iniciales, a calibrar):

| `type` | Cuándo | `level` | `action` |
|---|---|---|---|
| `inactivity` | 5 días sin actividad (3 en época de parciales) | `low` | `open_tutor` |
| `inactivity` | 10 días (6) | `medium` | `open_tutor` con la materia cursando que tiene el parcial más cercano o, si no hay, la que más destraba. Esa materia queda seca (`dry`) |
| `inactivity` | 15 días (10) | `high` | `contact_tutor` |
| `first_exam_missed` | Pasó la fecha de un `exam` cargado y no hay un `exam` con `result` para esa materia y fecha (y la materia no está regular ni aprobada) | `high` si es cuello de botella, si no `medium` | `open_tutor` con la materia |

Las alertas se recalculan en cada lectura o escritura del alumno. Una alerta descartada no vuelve mientras la condición sea la misma; reaparece si cambia (otro nivel de inactividad u otra fecha de parcial). Cuando la condición deja de cumplirse (por ejemplo, el alumno vuelve a tener actividad), la alerta desaparece sola.

### 2.4 Escritura y chat

| Endpoint | Body | Respuesta |
|---|---|---|
| `GET /api/me` | — | `{ "student_id": "s-001" \| null, "teacher_id": "t-3" \| null }`. `teacher_id` solo si el mail verificado del token es el de un docente (2.6) |
| `GET /api/faculties` | — | `[ { "faculty_id": "fceia", "name", "careers": [ { "career_id", "name" } ] } ]`. Solo las carreras con plan cargado |
| `POST /api/students` | `{ "name", "faculty_id"?, "career_id" }` | `{ "student_id" }`. Crea el alumno del `uid` del token; `409` si ese `uid` ya tiene uno. `faculty_id` por defecto `fceia` |
| `PUT /api/students/{id}/subjects` | `{ "subjects": [ { "subject_id", "state": "approved" \| "regular" \| "enrolled" } ] }` | árbol (2.2). Varias materias en un pedido (onboarding); las que no vienen quedan igual. Todo o nada: una materia ajena a la carrera → `404` |
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
| `exam` | Fecha de un parcial del alumno (la API solo tiene parciales viejos) | `subject_id`, `date`. Para registrar que lo rindió, se manda otro `exam` con la misma fecha y `result` (ej. `{ "score": 70 }`). Si pasa la fecha sin un `result`, se dispara `first_exam_missed` |

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
| `status` | Cada vez que el modelo llama a una tool | Muestra el mensaje como indicador ("Buscando…") hasta el próximo `text` |
| `text` | Uno o más por respuesta | Agrega `delta` al final del mensaje del tutor |
| `done` | Siempre, una vez, al final | Cierra el mensaje; guarda `conversation_id` para el próximo mensaje; si `tree_changed` es `true`, vuelve a pedir el árbol (2.2) y las alertas (2.3) |
| `error` | Si algo falla | Muestra `{ "error": { "code", "message" } }` y cierra |

Antes de abrir el stream, `POST /api/chat` puede responder JSON normal: `400` (mensaje vacío o imagen inválida, máx. 5 MB), `403`/`404` (alumno o conversación) o `503` con `code: "tutor_unavailable"` si el backend no tiene configurada la key de OpenRouter.

**Conversaciones:** `conversation_id` es opcional. Si no viene, el backend crea una conversación nueva y devuelve su id en `done`. Para seguir la misma, la app lo manda en los mensajes siguientes.

**Implementación en dos etapas (sin cambiar el contrato):**

1. **Etapa 1 (la implementada):** el backend emite un `status` por cada tool que llama y, cuando el modelo termina, manda **un solo** `text` con la respuesta entera y después `done`. La app ya muestra "Buscando parciales…" y el código del cliente es el definitivo.
2. **Etapa 2, si sobra tiempo:** el backend usa el streaming de OpenRouter y reenvía cada fragmento como un `text`. La app no cambia nada.

Para el cliente: `EventSource` no soporta `POST` ni headers propios, así que la app lee el stream con `fetch` + `response.body.getReader()` (o una librería como `@microsoft/fetch-event-source`).

### 2.6 Vista docente

Un docente dicta materias; **sus alumnos son los que tienen esa materia en estado `enrolled`** (cursando). El alumno no tiene que hacer nada para aparecer. El docente ve a cada alumno con su nombre, para poder intervenir a tiempo; nunca ve las conversaciones con el tutor.

**Quién es docente.** Lo carga el backend, no se autodeclara: tabla `teachers` (mail, nombre) y `teacher_subjects` (las materias que dicta), con `arbol teacher add` o el seed. El docente entra con Firebase como cualquiera; el backend lo reconoce si el **mail del token está verificado** (`email_verified`) y coincide con el de un docente. Con Google el mail viene verificado; con mail + contraseña hay que verificarlo primero. Un mismo usuario puede ser alumno y docente.

Todos los endpoints de esta sección piden el token (1.1). Sin docente para ese mail → `403`; materia que no dicta → `404`.

| Endpoint | Qué trae |
|---|---|
| `GET /api/teacher` | El docente y sus materias con un resumen de cada una |
| `GET /api/teacher/subjects/{subject_id}` | El detalle de una materia: resumen, alumnos, actividad por semana y temas practicados |
| `POST /api/teacher/chat`, `GET /api/teacher/conversations/{id}` | El asistente del docente (abajo) |

#### `GET /api/teacher`

```json
{
  "teacher_id": "t-3",
  "name": "Laura Méndez",
  "subjects": [
    {
      "subject_id": 2,
      "career_id": 1,
      "name": "Análisis Matemático I",
      "year": 1,
      "term": 1,
      "students": 9,
      "health": { "lush": 5, "wilted": 2, "withered": 2 },
      "open_alerts": 4
    }
  ]
}
```

#### `GET /api/teacher/subjects/{subject_id}`

```json
{
  "subject_id": 2,
  "career_id": 1,
  "name": "Análisis Matemático I",
  "year": 1,
  "term": 1,
  "summary": {
    "students": 9,
    "health": { "lush": 5, "wilted": 2, "withered": 2 },
    "active_this_week": 6,
    "exercises_this_week": 31,
    "open_alerts": 4
  },
  "students": [
    {
      "student_id": "s-002",
      "name": "Beto",
      "health": { "state": "withered", "last_activity": "2026-10-08T21:10:00-03:00" },
      "exercises": 8,
      "correct_rate": 0.62,
      "mastered_topics": 1,
      "best_mock_exam": null,
      "flower": false,
      "dry": true,
      "next_exam": null,
      "alerts": [ { "type": "first_exam_missed", "level": "high", "message": "…" } ]
    }
  ],
  "weeks": [ { "week": "2026-10-12", "exercises": 31, "active_students": 6 } ],
  "topics": [ { "topic": "límites", "attempts": 24, "correct": 15, "students": 7 } ]
}
```

| Campo | Notas |
|---|---|
| `summary.health` | Cuántos alumnos hay en cada estado de salud (2.2) |
| `summary.active_this_week` | Alumnos con al menos un ejercicio, simulacro o chat de **esta materia** en la semana en curso (lunes a domingo, hora de Argentina) |
| `students` | Ordenados por riesgo: primero los que tienen alertas `high`, después `withered`, `wilted` y `lush`; dentro de cada grupo, por última actividad (la más vieja primero) |
| `students[].exercises`, `correct_rate`, `mastered_topics` | Solo de esta materia. `correct_rate` es `null` sin ejercicios. Tema dominado: 3 correctos (como en el tutor) |
| `students[].best_mock_exam` | Mejor nota de simulacro en esta materia (0–100) o `null` |
| `students[].flower`, `dry` | Los de la rama de esta materia en el árbol del alumno (2.2) |
| `students[].next_exam` | Próxima fecha de parcial que el alumno cargó para esta materia (`exam` sin `result`, de hoy en adelante) o `null` |
| `students[].alerts` | Alertas vigentes del alumno que son de esta materia o generales (inactividad). Se calculan en el momento, sin escribir nada; incluyen las que el alumno descartó, porque el docente igual tiene que verlas. `open_alerts` las cuenta |
| `weeks` | Las últimas 8 semanas (incluida la actual), de la más vieja a la más nueva; `week` es el lunes |
| `topics` | Temas de los ejercicios de esta materia de todos sus alumnos, los más practicados primero (como `view_my_tree`, ignorando tildes y mayúsculas); `students` es cuántos alumnos distintos lo practicaron |

#### Asistente del docente

Un chat con el mismo modelo y las mismas tools de la FCEIA que el tutor (parciales reales, temas frecuentes, apuntes, bibliografía, correlativas y fechas), con otro prompt: ayuda a preparar exámenes y simulacros, guías de ejercicios, resoluciones y criterios de corrección. Ejemplo: "armame un parcial de Análisis Matemático I con límites, continuidad, derivadas y función inversa". **No ve datos de alumnos**; en el contexto solo van la fecha, el nombre del docente, su facultad y las materias que dicta.

| Endpoint | Body | Respuesta |
|---|---|---|
| `POST /api/teacher/chat` | `{ "message", "conversation_id"?, "image_base64"? }` | SSE igual que `/api/chat` (2.5): `status`, `text`, `done` con `{ "conversation_id" }` (sin `tree_changed`) y `error`. Sin `conversation_id` crea una conversación nueva. Mismos límites y errores previos al stream (`400`, `429`, `503`) |
| `GET /api/teacher/conversations/{conversation_id}` | — | `{ "conversation_id", "messages": [ { "role", "text", "created_at" } ] }`. Solo las conversaciones del docente (`404` si no es suya) |

Las conversaciones se guardan en las mismas tablas que las del tutor (`conversations` con `teacher_id`). La lista de conversaciones la guarda la app, como en el tutor.

---

## 3. Tools del MCP

La lógica de las tools vive en el módulo compartido `fceia/` (Go): el backend las publica como servidor MCP (`arbol mcp`) y las usa directo en el tutor y en `POST /api/schedule`, sin pasar por MCP. Nombres de tools, parámetros y campos **en inglés**; los valores que vienen de la API (`parcial`, `final`…) se dejan tal cual. Todas devuelven JSON (`structuredContent`) y las listas van dentro de un objeto. Las URLs de archivos (`file_url`, `url`, `pdf_url`) son siempre absolutas.

**Errores**: tool error (`isError: true`) con `{ "error": { "code", "message" } }`; `code` ∈ `not_found` · `api_unavailable` · `invalid_argument`. Un resultado vacío no es error.

### `search_subject(name: str, career_id?: int)`
(`GET /subjects?q=&career_id=`; `q` ignora tildes)
```json
{ "subjects": [ { "subject_id": 12, "code": "r223", "name": "Lógica", "career_id": 1, "year": 2, "term": 4 } ] }
```

### `frequent_topics(subject_id: int, since?: int)`
(`GET /exams?subject_id=`; parsea `description` → "Temas: a; b; c"; agrupa ignorando tildes, mayúsculas y el paréntesis final; muestra la variante más frecuente. Los exámenes sin fecha cuentan, pero no aportan `last_year`; `since` no los descarta. `keywords`: palabras (4 letras o más, sin tildes ni palabras vacías) y pares de palabras vecinas que aparecen en al menos 2 exámenes, con la cantidad de exámenes que los mencionan; una palabra suelta se omite si solo aparece dentro de un par igual de frecuente; hasta 15, y es lo que conviene usar cuando la materia tiene pocos exámenes)
```json
{ "subject_id": 12, "exams_analyzed": 10, "undated": 0,
  "topics": [ { "topic": "consecuencia semántica y contraejemplos", "count": 2, "last_year": 2017 } ],
  "keywords": [ { "keyword": "deducción natural", "exams": 7, "last_year": 2022 } ] }
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
(`GET /subjects/{id}/relations` con la revisión manual aplicada (`corrections/`, ver `revision-plan-lcc.md`): hay 3 correlativas de LCC que la API tiene mal y se corrigen; `requirement: null` → `approved`, confirmado)
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
- **Sin combinación**: `conflicts` lista los pares que chocan en todas sus comisiones; `suggest_postpone` es el conjunto a postergar que menos cuellos de botella (`unlocks_total >= 8`) toca, después el más chico, después el que menos destraba; `options` arma el resto. Los cuellos de botella se calculan en el MCP desde `/relations`, con la revisión manual aplicada.
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

No están en el MCP: el backend las agrega al loop de tool use junto con las de `fceia/`. **No reciben `student_id`**: el backend lo inyecta desde el request autenticado, así el modelo nunca puede tocar a otro alumno.

- `record_progress(type: str, subject_id?: int, topic?: str, result?: object, date?: str)`: mismo body que `POST /activity` (2.4).
- `view_my_tree()`: devuelve el árbol (2.2) con el `name` de cada materia, los temas practicados por materia (`topic`, `correct`, `attempts`, `mastered` a partir de 3 correctos) y las alertas abiertas, para que el modelo tenga todo en una llamada. Los temas solo los ve el tutor; no están en `GET /tree`.
- `start_mock_exam(subject_id: int, minutes: int)`: guarda el inicio del simulacro en la conversación (10 a 300 minutos). Mientras dura, cada mensaje del alumno le pasa al modelo los minutos transcurridos.

---

## 4. Lo que encontramos en la API y cambia cosas

| Hallazgo | Impacto | Responsable |
|---|---|---|
| **Los horarios no tienen un campo "comisión"**: viene en el texto libre de `notes` (ej. `"Com: 610 ciclo básico"`) | El armador tiene que parsear `notes` para agrupar clases por comisión; si no hay número, se asume una sola comisión | Fran |
| `semester` en horarios mezcla `"2026-2S"` con `"última publicación"` | Filtrar por el cuatrimestre vigente y avisar si los horarios son viejos | Fran |
| Solo el 83 % de las clases tiene sede (en LCC, el 100 % de `2026-2S`) | El aviso de traslados entre sedes es parcial y casi no aplica en LCC (ver `verificacion-datos.md`) | Fran |
| **Las mesas de examen no traen fechas**, solo etiqueta y PDF (una por carrera, solo el 2.º llamado flotante 2026, que ya pasó; el PDF sí trae fecha por materia pero la API no la expone). Las 5 entradas de `inscripcion` de `/calendar` son del ingreso 2027, no de mesas | La alerta de inscripción a mesas queda fuera del MVP | Fran / Eugenio |
| **`/calendar` no trae receso ni períodos de parciales** (solo ingreso 2027 y dos eventos sin fecha) | Receso y mesas 2026-27 cargados a mano desde el PDF del Calendario Académico (Res. DEC 1723/2025, Escuela de Ciencias Exactas y Naturales) en `backend/data/periods_fceia_2026.json`. Los parciales no están en el calendario: los carga el alumno | Eugenio |
| **El 52 % de los exámenes no tiene fecha** (en LCC, el 23 %: 77 son los de Suficiencia de Inglés; sin ellos, el 6 %) | `frequent_topics` los cuenta pero no les pone `last_year`; no se infiere el año | Fran |
| Los temas de las descripciones son texto libre: con pocos exámenes (Lógica: 10) casi todos aparecen una sola vez | `frequent_topics` devuelve además `keywords` (palabras y pares con la cantidad de exámenes que los mencionan) | Fran |
| Solo 25 de las 73 resoluciones están vinculadas a un examen | `solution()` va a devolver `available: false` casi siempre; el tutor resuelve solo | Eugenio |
| El texto de los materiales se busca por subcadena, no hay búsqueda semántica | `search_materials` es búsqueda por texto, no RAG con embeddings (ajustar la propuesta) | Fran |
| `requirement` en correlativas puede ser `"regular"` o `null` | Confirmado para LCC: los programas 2024 solo tienen "Previos Aprobados", así que `null` = aprobada | Fran |
| Materias compartidas entre carreras se reconocen por `code` | Resuelve la "reorientación": `GET /subjects?code=` | Fran |
| `GET /subjects/{id}/overview` trae horarios, correlativas y conteos de exámenes en una llamada | Útil para armar el plan sin N llamadas | Fran |

---

## 5. Cambios respecto al kickoff

Resumen para quien integró contra la versión del kickoff (issue #1). El detalle de cada punto está en su sección.

**Para la app (Feli):**

| Antes | Ahora | Sección |
|---|---|---|
| Rutas y campos en español (`/api/alumnos/{alumno_id}/arbol`, `salud`, `racha`, `hojas`…) | Todo en inglés: `/api/students/{student_id}/tree`, `/alerts`, `/careers/{id}/plan`, `/schedule`; `health`, `streak`, `leaves`, `flower`, `dry`… | 0, 2 |
| Enums en español (`frondoso`, `cursando`, `alto`, `abrir_tutor`…) | `lush` · `wilted` · `withered`; `approved` · `regular` · `enrolled` · `available` · `locked`; `low` · `medium` · `high`; `open_tutor` · `build_schedule` · `view_dates` · `contact_tutor` | 2.2, 2.3 |
| Plan: `nombre`, `materias`, `requiere`, `destraba`, `cuello_de_botella`… | `name`, `subjects`, `requires`, `unlocks`, `unlocks_total`, `bottleneck`, más `min_terms`, `critical_path`, `optional`, `slack`, `postpone_year_delay` y `final_goal` (la Tesina, fuera de `subjects`) | 2.1 |
| Sin autenticación; `POST /api/alumnos` devolvía solo el id | **Firebase Auth** (Google o email + contraseña). Todos los endpoints salvo `/plan` piden `Authorization: Bearer <ID token de Firebase>` (`401` / `403`). Nuevo `GET /api/me` para saber si el usuario ya tiene alumno; `POST /api/students` crea el del usuario logueado (`409` si ya existe) | 1.1, 2.4 |
| IDs de alumno `a-001` | `s-001` (conversaciones `c-N`, alertas `al-N`) | 1 |
| `POST .../descartar` | `POST /api/students/{id}/alerts/{id}/dismiss` → `204` | 2.3 |
| Actividad `checkin` · `ejercicio` · `simulacro` | `checkin` · `exercise` · `mock_exam` · `exam`. `exam` es nuevo: la fecha de un parcial del alumno (y, con `result`, que lo rindió) | 2.4 |
| Chat sin conversaciones | `conversation_id` opcional en `POST /api/chat`; si no viene se crea una y vuelve en `done`. Nuevo `GET /api/students/{id}/conversations/{conversation_id}` para recargar los mensajes | 2.4, 2.5 |
| Eventos SSE `estado` · `texto` · `fin` | `status` · `text` · `done` (`done` trae `tree_changed` y `conversation_id`); `error` igual | 2.5 |
| — | Antes de abrir el stream, `/api/chat` puede responder JSON con `400`, `403`, `404` o `503 tutor_unavailable` | 2.5 |
| `POST /api/horario` | `POST /api/schedule` (acepta `preferences`); el backend completa las materias aprobadas y regulares del alumno para chequear correlativas | 2.4, 3 |
| Reglas de salud, racha y alertas sin definir | Definidas: umbrales, receso, época de parciales, comodines, cuándo aparece y se va cada alerta | 2.2, 2.3 |
| — | **Vista docente**: `GET /api/me` suma `teacher_id`; nuevos `GET /api/teacher` y `GET /api/teacher/subjects/{subject_id}`. El docente lo carga el backend y se reconoce por el mail verificado del token | 2.6 |
| — | **Asistente del docente**: nuevos `POST /api/teacher/chat` (SSE) y `GET /api/teacher/conversations/{id}`, con las tools de la FCEIA y sin datos de alumnos | 2.6 |

**Para el MCP y el backend:**

- Tools del MCP en inglés (`search_subject`, `frequent_topics`, `exercises`, `solution`, `search_materials`, `bibliography`, `prerequisites`, `dates`, `build_schedule`), con listas envueltas en objetos y URLs absolutas. Los valores crudos de la API (`parcial`, `apuntes`…) pasan en español.
- `registrar_progreso` y `ver_mi_arbol` pasaron a ser tools locales del backend (`record_progress`, `view_my_tree`) y se sumó `start_mock_exam`; no reciben `student_id`.
- El backend no llama al servidor MCP: usa las mismas tools desde el módulo compartido `fceia/` (ya no hay `MCP_URL`). El servidor MCP queda para clientes externos, como el Claude de un alumno.
- El tutor no llama a Claude directo: usa OpenRouter con un modelo principal y fallbacks de otros proveedores.
- Persistencia en Postgres (no SQLite); el backend es Go + Chi.
