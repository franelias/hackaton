# Contratos entre frentes — Árbol

> Contratos acordados en el kickoff (issue #1).
> Base de la API: `https://fceia-api.ariloc.ar/api/v1` (pública, solo lectura, sin auth).

## 0. Decisiones del kickoff

| Tema | Decisión |
|---|---|
| Carrera de la demo | Licenciatura en Ciencias de la Computación (`career_id = 1`) |
| App | React (web) |
| Persistencia | Postgres |
| Streaming del chat | Contrato SSE desde el día 1; implementación en dos etapas (ver 2.5) |
| Formato de errores | `{ "error": { "code": "string", "message": "string" } }` en backend y MCP. Códigos del MCP: `not_found`, `api_unavailable`, `invalid_argument` |

## 1. Convenciones

- **IDs**: enteros, los mismos de la API (`subject_id`, `career_id`, `exam_id`, `session_id`). Ojo: **una materia tiene un `id` distinto en cada carrera**; lo que se comparte entre carreras es el `code` (ej. `FB11`).
- **Fechas**: ISO 8601 (`2026-11-15`, `2026-10-19T15:00:00-03:00`).
- **Días de la semana**: ISO, `1` = lunes … `7` = domingo (igual que la API).
- **Horas**: `"HH:MM"` (igual que la API).
- **Idioma de los campos**: español en nuestros contratos; inglés en lo que viene crudo de la API.

---

## 2. Contratos backend → app

La app hace tres pedidos y los cruza por `subject_id`:

| Endpoint | Qué trae | Cambia | Dueño |
|---|---|---|---|
| `GET /api/carreras/{career_id}/plan` | Estructura del árbol: materias y correlativas | Nunca (cacheable) | Frente 1 (Fran) |
| `GET /api/alumnos/{alumno_id}/arbol` | Estado del alumno sobre esa estructura | Con cada actividad | Frente 2 (Eugenio) |
| `GET /api/alumnos/{alumno_id}/alertas` | Alertas abiertas | Aparecen y se descartan | Frente 2 (Eugenio) |

### 2.1 `GET /api/carreras/{career_id}/plan`

Igual para todos los alumnos de la carrera. Se calcula una vez desde la API (con la revisión manual del plan aplicada).

```json
{
  "career_id": 1,
  "nombre": "Licenciatura en Ciencias de la Computación",
  "materias": [
    {
      "subject_id": 6,
      "code": "r123",
      "nombre": "Programación II",
      "anio": 1,
      "cuatrimestre": 2,
      "requiere": [ { "subject_id": 3, "condicion": "aprobada" } ],
      "destraba": [12, 15],
      "destraba_total": 9,
      "cuello_de_botella": true
    }
  ]
}
```

| Campo | Notas |
|---|---|
| `requiere[].condicion` | `aprobada` · `regular`. Sale de `requirement` en `/relations` (`null` → `aprobada`, **a confirmar**) |
| `destraba` | Directas (de `required_by`) |
| `destraba_total` | Directas + indirectas; la app lo usa para el grosor del tronco |
| `cuello_de_botella` | Según el umbral que defina el frente 1 |

La app calcula el layout (posición de cada rama) a partir de `requiere` y `destraba`. El backend no manda coordenadas.

### 2.2 `GET /api/alumnos/{alumno_id}/arbol`

Solo el estado del alumno; nada que ya esté en el plan.

```json
{
  "alumno_id": "a-001",
  "career_id": 1,
  "salud": { "estado": "mustio", "ultima_actividad": "2026-10-08T21:10:00-03:00" },
  "racha": { "semanas": 0, "mejor": 8, "comodines": 1 },
  "materias": [
    { "subject_id": 6,  "estado": "aprobada", "hojas": 14, "flor": false, "seca": false },
    { "subject_id": 21, "estado": "cursando", "hojas": 2,  "flor": false, "seca": true }
  ]
}
```

| Campo | Valores | Notas |
|---|---|---|
| `salud.estado` | `frondoso` · `mustio` · `marchito` | Lo decide el backend (umbrales iniciales 5 / 10 / 15 días, pausados en receso). Nunca `muerto`. La app solo lo dibuja |
| `salud.ultima_actividad` | fecha | Para mostrar "hace 11 días" si hace falta |
| `racha.semanas` | entero ≥ 0 | Semanas seguidas con al menos 1 sesión de estudio |
| `racha.mejor` | entero | La app muestra esta cuando `semanas` = 0 |
| `materias[].estado` | `aprobada` · `regular` · `cursando` · `disponible` · `bloqueada` | Solo vienen las materias con estado distinto de `bloqueada`; la app asume `bloqueada` para el resto |
| `hojas` | entero | Ejercicios y sesiones registradas en esa materia |
| `flor` | bool | Simulacro aprobado: lista para rendir |
| `seca` | bool | Hay una alerta abierta sobre esa materia. **Una materia aprobada nunca se seca** |

### 2.3 `GET /api/alumnos/{alumno_id}/alertas`

```json
[
  {
    "id": "al-17",
    "nivel": "alto",
    "tipo": "primer_parcial_no_rendido",
    "subject_id": 21,
    "mensaje": "Se viene el parcial de Lógica, ¿practicamos 1 ejercicio?",
    "accion": { "tipo": "abrir_tutor", "subject_id": 21 }
  }
]
```

| Campo | Valores | Notas |
|---|---|---|
| `nivel` | `bajo` · `medio` · `alto` | **No hay puntaje de abandono en el contrato, a propósito** |
| `accion.tipo` | `abrir_tutor` · `armar_horario` · `ver_fechas` · `contactar_tutor` | Lo que hace el botón de la alerta |

`POST /api/alumnos/{alumno_id}/alertas/{id}/descartar` → `204`.

### 2.4 Escritura y chat

| Endpoint | Body | Respuesta |
|---|---|---|
| `POST /api/alumnos` | `{ "nombre", "career_id" }` | `{ "alumno_id" }` |
| `PUT /api/alumnos/{id}/materias/{subject_id}` | `{ "estado": "aprobada" \| "regular" \| "cursando" }` | árbol (2.2) |
| `POST /api/alumnos/{id}/actividad` | `{ "tipo": "checkin" \| "ejercicio" \| "simulacro", "subject_id"?, "tema"?, "resultado"? }` | árbol (2.2) |
| `POST /api/chat` | `{ "alumno_id", "mensaje", "imagen_base64"? }` | Stream SSE (ver 2.5) |
| `POST /api/horario` | `{ "alumno_id", "subject_ids": [..] }` | mismo formato que `armar_horario` |

### 2.5 Chat: formato SSE

`POST /api/chat` responde con `Content-Type: text/event-stream`. Hay cuatro tipos de evento (`error` solo si algo falla):

```
event: estado
data: {"tool": "exercises", "mensaje": "Buscando parciales de Lógica…"}

event: texto
data: {"delta": "Arranquemos por inducción, que apareció en 7 de los 10 parciales. "}

event: fin
data: {"arbol_cambio": true}
```

| Evento | Cuándo | Qué hace la app |
|---|---|---|
| `estado` | Cada vez que Claude llama a una tool | Muestra el mensaje como indicador ("Buscando…") hasta el próximo `texto` |
| `texto` | Uno o más por respuesta | Agrega `delta` al final del mensaje del tutor |
| `fin` | Siempre, una vez, al final | Cierra el mensaje; si `arbol_cambio` es `true`, vuelve a pedir el árbol (2.2) y las alertas (2.3) |
| `error` | Si algo falla | Muestra `{ "error": { "code", "message" } }` y cierra |

**Implementación en dos etapas (sin cambiar el contrato):**

1. **Etapa 1, para integrar rápido:** el backend emite un `estado` por cada tool que llama y, cuando Claude termina, manda **un solo** `texto` con la respuesta entera y después `fin`. La app ya muestra "Buscando parciales…" y el código del cliente es el definitivo.
2. **Etapa 2, si sobra tiempo:** el backend usa el streaming de la API de Claude y reenvía cada fragmento como un `texto`. La app no cambia nada.

Para el cliente: `EventSource` no soporta `POST`, así que la app lee el stream con `fetch` + `response.body.getReader()` (o una librería como `@microsoft/fetch-event-source`).

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

### `armar_horario(...)`, `registrar_progreso(...)` y `ver_mi_arbol(...)`
No están en `mcp/` todavía: `armar_horario` es el issue #4 y las otras dos van contra nuestro backend (no la API). Se definirán en inglés con el mismo criterio. `ver_mi_arbol` devuelve el árbol (2.2) con el `nombre` de cada materia y las alertas abiertas.

---

## 4. Lo que encontramos en la API y cambia cosas

| Hallazgo | Impacto | Responsable |
|---|---|---|
| **Los horarios no tienen un campo "comisión"**: viene en el texto libre de `notes` (ej. `"Com: 610 ciclo básico"`) | El armador tiene que parsear `notes` para agrupar clases por comisión; si no hay número, se asume una sola comisión | Fran |
| `semester` en horarios mezcla `"2026-2S"` con `"última publicación"` | Filtrar por el cuatrimestre vigente y avisar si los horarios son viejos | Fran |
| Solo el 83 % de las clases tiene sede | El aviso de traslados entre sedes es parcial | Fran |
| **Las mesas de examen no traen fechas**, solo etiqueta y PDF | La alerta "cierra la inscripción a mesas" sale de `/calendar` (`kind = inscripcion`) o se carga a mano | Fran / Eugenio |
| Solo 25 de las 73 resoluciones están vinculadas a un examen | `solution` va a devolver `available: false` casi siempre; el tutor resuelve solo | Eugenio |
| El texto de los materiales se busca por subcadena, no hay búsqueda semántica | `search_materials` es búsqueda por texto, no RAG con embeddings (ajustar la propuesta) | Fran |
| `requirement` en correlativas puede ser `"regular"` o `null` | Confirmar que `null` significa "aprobada" | Fran |
| Materias compartidas entre carreras se reconocen por `code` | Resuelve la "reorientación": `GET /subjects?code=` | Fran |
| `GET /subjects/{id}/overview` trae horarios, correlativas y conteos de exámenes en una llamada | Útil para armar el plan sin N llamadas | Fran |
