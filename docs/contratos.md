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
| Formato de errores | `{ "error": { "code": "string", "message": "string" } }` en backend y MCP |

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
data: {"tool": "ejercicios", "mensaje": "Buscando parciales de Lógica…"}

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

Todas devuelven JSON. Entre paréntesis, el endpoint de la API.

### `buscar_materia(nombre: str, career_id?: int)`
(`GET /subjects?q=&career_id=`)
```json
[ { "subject_id": 6, "code": "r123", "nombre": "Programación II", "career_id": 1, "anio": 1, "cuatrimestre": 2 } ]
```

### `temas_frecuentes(subject_id: int, desde?: int)`
(`GET /exams?subject_id=&since=`; parsea `description` → "Temas: a; b; c")
```json
{ "subject_id": 21, "examenes_analizados": 10, "sin_fecha": 4,
  "temas": [ { "tema": "inducción", "apariciones": 7, "ultimo_anio": 2025 } ] }
```

### `ejercicios(subject_id: int, tema?: str, categoria?: "parcial"|"final"|"recuperatorio"|"coloquio"|"quiz", limite?: int = 3)`
(`GET /exams?subject_id=&text=&category=` + `GET /exams/{id}/text`)
```json
[ { "exam_id": 929, "titulo": "…", "categoria": "parcial", "fecha": "2026-05-14",
    "texto": "…", "file_url": "/media/…", "tiene_resolucion": false, "solution_id": null } ]
```

### `resolucion(exam_id: int)`
(usa `solution_id` del examen; **solo 25 de las 73 resoluciones tienen `exam_id`**)
```json
{ "exam_id": 929, "disponible": false, "texto": null }
```

### `buscar_apunte(subject_id: int, tema: str, limite?: int = 3)`
(`GET /materials?subject_id=&text=` + `GET /materials/{id}/text`)
```json
[ { "material_id": 3157, "titulo": "…", "tipo": "apuntes", "fragmento": "…", "url": "/media/…" } ]
```

### `bibliografia(subject_id: int)`
(`GET /subjects/{id}/bibliography`)
```json
[ { "titulo": "…", "autor": "…", "anio": 2005, "isbn": "…", "tipo": "basica" } ]
```

### `correlativas(subject_id: int)`
(`GET /subjects/{id}/relations`)
```json
{ "subject_id": 55,
  "requiere": [ { "subject_id": 52, "code": "FB3", "condicion": "regular" } ],
  "destraba": [ { "subject_id": 59, "nombre": "Cálculo III" } ] }
```

### `fechas(career_id: int, anio?: int)`
(`GET /calendar?year=` + `GET /exam-boards?career_id=`)
```json
{ "eventos": [ { "tipo": "inscripcion", "titulo": "…", "desde": "2026-08-05", "hasta": "2026-12-18" } ],
  "mesas": [ { "titulo": "Mesas flotantes 2do cuatrimestre 2026", "pdf_url": "…" } ] }
```

### `armar_horario(subject_ids: int[], preferencias?: { "turno"?: "mañana"|"tarde"|"noche", "dias_libres"?: int[] })`
(`GET /sessions?subject_id=`)
```json
{ "opciones": [
    { "comisiones": [ { "subject_id": 6, "comision": "610", "clases": [ { "dia": 2, "desde": "07:30", "hasta": "10:30", "sede": "Sede Pellegrini", "aula": "Lab. DCC" } ] } ],
      "dias_en_facultad": 3, "horas_hueco": 1.5 } ],
  "conflictos": [ { "materias": [6, 21], "dia": 4, "desde": "10:30", "hasta": "12:30" } ],
  "sugerencia_postergar": 21 }
```

### `registrar_progreso(alumno_id: str, tipo: str, subject_id?: int, tema?: str, resultado?: object)` y `ver_mi_arbol(alumno_id: str)`
Las dos van contra nuestro backend (no la API). `ver_mi_arbol` devuelve el árbol (2.2) con el `nombre` de cada materia agregado y las alertas abiertas, para que Claude tenga todo en una llamada.

---

## 4. Lo que encontramos en la API y cambia cosas

| Hallazgo | Impacto | Responsable |
|---|---|---|
| **Los horarios no tienen un campo "comisión"**: viene en el texto libre de `notes` (ej. `"Com: 610 ciclo básico"`) | El armador tiene que parsear `notes` para agrupar clases por comisión; si no hay número, se asume una sola comisión | Fran |
| `semester` en horarios mezcla `"2026-2S"` con `"última publicación"` | Filtrar por el cuatrimestre vigente y avisar si los horarios son viejos | Fran |
| Solo el 83 % de las clases tiene sede | El aviso de traslados entre sedes es parcial | Fran |
| **Las mesas de examen no traen fechas**, solo etiqueta y PDF | La alerta "cierra la inscripción a mesas" sale de `/calendar` (`kind = inscripcion`) o se carga a mano | Fran / Eugenio |
| Solo 25 de las 73 resoluciones están vinculadas a un examen | `resolucion()` va a devolver `disponible: false` casi siempre; el tutor resuelve solo | Eugenio |
| El texto de los materiales se busca por subcadena, no hay búsqueda semántica | `buscar_apunte` es búsqueda por texto, no RAG con embeddings (ajustar la propuesta) | Fran |
| `requirement` en correlativas puede ser `"regular"` o `null` | Confirmar que `null` significa "aprobada" | Fran |
| Materias compartidas entre carreras se reconocen por `code` | Resuelve la "reorientación": `GET /subjects?code=` | Fran |
| `GET /subjects/{id}/overview` trae horarios, correlativas y conteos de exámenes en una llamada | Útil para armar el plan sin N llamadas | Fran |
