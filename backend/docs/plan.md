# Plan backend Árbol (frente 2: Eugenio): issues #7–#11

## Context
Árbol (hackatón EdTech FCEIA-UNR) convierte el plan de estudios en un árbol vivo que se marchita cuando el alumno deja de entrar y dispara intervenciones del tutor IA. Mi frente es el backend: estado del alumno, salud, rachas, alertas y el chat con Claude conectado al MCP de Fran. Los contratos están en `docs/contratos.md`. Todo lo de abajo se decidió en el grilling y no queda nada asumido.

## Decisiones
| Tema | Decisión |
|---|---|
| Idioma | **Código en inglés** (identificadores, paquetes, tablas, columnas, comentarios). **Contrato en inglés**: rutas (`/api/students/{student_id}/tree`, `/alerts`, `/careers/{id}/plan`), campos, valores de enums (`lush`·`wilted`·`withered`; `approved`·`regular`·`enrolled`·`available`·`locked`), eventos SSE (`status`·`text`·`done`·`error`) y nombres de tools del MCP (`search_subject`, `frequent_topics`…). **La documentación queda en español** (la prosa de `contratos.md`, los README). Los textos que lee el alumno siguen en español. Los nombres en español que aparecen abajo se traducen al implementar |
| Stack | Go + Chi, en `backend/` (un módulo Go) |
| DB | Postgres (el #9 dice SQLite: se corrige). GORM para queries, **goose + SQL** para migraciones, docker-compose local |
| Binario | Un solo binario con los subcomandos `serve`, `migrate`, `import-plan`, `seed` |
| Modelos | **OpenRouter** con formato OpenAI Chat Completions (`openai-go`). Principal `TUTOR_MODEL` (default `anthropic/claude-sonnet-5.5`) y fallbacks `TUTOR_FALLBACK_MODELS` (default `openai/gpt-6-astra,google/gemini-3.1-pro-preview`) en el campo `models` del body. Key en `OPENROUTER_API_KEY` |
| Tools FCEIA | Módulo compartido `../fceia/tools` llamado en proceso (las mismas tools que sirve el MCP), con loop de tool use propio |
| Tools locales | `record_progress`, `view_my_tree`, `start_mock_exam`. El `alumno_id` lo inyecta el backend, nunca Claude |
| SSE | Etapa 1: un `estado` por tool, un solo `texto` al final y después `fin` |
| Conversación | `conversacion_id` opcional en `POST /api/chat`; si no viene, se crea y se devuelve en `fin`. Agrega `GET /api/alumnos/{id}/conversaciones/{cid}`. Mensajes en DB |
| Auth | **Firebase Auth** (Google y email + contraseña). La app manda el ID token en `Authorization: Bearer`; el backend lo verifica con `firebase.google.com/go/v4` y obtiene el `uid`. Tabla `students` con `firebase_uid` unique; `student_id` sigue siendo `s-<n>`. `GET /api/me` → `{student_id \| null}`. El middleware chequea que el `uid` sea dueño del `student_id` de la URL o del body (401/403). En dev y tests: Firebase Auth Emulator en compose (`FIREBASE_AUTH_EMULATOR_HOST`); para la demo, el proyecto real (falta que alguien lo cree y comparta el project id y la service account) |
| IDs | `s-001`, `c-<n>`, `al-<n>` (prefijo + serial). Materias y carreras con los ids de la API |
| Multi-facultad | Columna `facultad` (`'fceia'`) con clave `(facultad, id_externo)` en carreras, materias y correlativas. Rutas iguales y sin interfaz de proveedor |
| Plan | Tablas `carreras`/`materias`/`correlativas`. `import-plan --facultad fceia <json>` lee el formato 2.1. `/api/carreras/{id}/plan` se sirve desde la base. JSON provisorio mío (`/subjects` + `/relations`, cuello = destraba ≥ 3) hasta que Fran entregue el suyo |
| Períodos | Tabla `periodos` (receso, parciales, mesas) desde `periodos_fceia_2026.json`, que armo a mano desde el PDF Res. DEC 1723/2025 (`/calendar` no los trae) |
| Actividad | Todo `POST /actividad` y todo mensaje de chat riegan el árbol. Los GET no. Sesión de estudio para la racha = ejercicio, simulacro o chat (el checkin no cuenta) |
| Salud | Menos de 5 días → frondoso; 5–9 → mustio + alerta bajo; 10–14 → marchito + alerta medio (`abrir_tutor`); 15 o más → alerta alto (`contactar_tutor`). En parciales o mesas: 3/6/10. Los días de receso no cuentan. Umbrales en config |
| Racha | Semanas ISO, hora de Argentina. Una semana vacía consume un comodín o corta la racha; se guarda la mejor. El receso congela. +1 comodín cada 4 semanas, máximo 2. Sin frutos. Se calcula desde las actividades |
| Alertas | Motor de reglas que corre al leer y al escribir (sin cron) y hace upsert en `alertas` con unique (alumno, tipo, subject_id). Una alerta descartada no reaparece hasta que cambie el escalón. Señales del MVP: **inactividad** y **primer parcial no rendido** (sube de nivel si la materia es cuello de botella) |
| Parciales | Los carga el alumno: `/actividad` con `tipo:"parcial", subject_id, fecha`, o por chat con `registrar_progreso` |
| Materias | `disponible` si cumple las correlativas (`regular` alcanza con regular o aprobada); si no, `bloqueada`. El PUT permite corregir, incluso bajar de aprobada. `seca` = alerta abierta y la materia no está aprobada |
| Tutor | `hojas` = cantidad de actividades en la materia. Tema dominado = 3 ejercicios correctos (solo visible para el tutor, en `view_my_tree`). Hasta 2 pistas antes de la solución. Simulacro: 3-4 ejercicios de parciales reales, 120 min por defecto. Ante alertas abiertas, el tutor arranca por esa materia sin reproches. Simulacro aprobado ≥ 60 → `flor` si la materia no está aprobada. El simulacro se cronometra en el backend (tiempo transcurrido que se le pasa a Claude) |
| Horario | `POST /api/horario` pasa directo a la tool `armar_horario` del MCP |
| Deploy | Sin decidir; local con compose por ahora |

## Estructura (`backend/`)
Fran ya creó el módulo `github.com/franelias/hackaton/backend` con `cmd/plan`, `internal/plan` (puro), `internal/fceia` y `data/plan_career_1.json`. Sigo sus convenciones (`backend/AGENTS.md`): `cmd/<binario>` + `internal/<paquete>`, paquetes puros sin HTTP y tests sin red.
- `cmd/server`: API HTTP (Chi). `cmd/migrate`, `cmd/import-plan`, `cmd/seed`: subcomandos como binarios aparte, igual que `cmd/plan`.
- `internal/db`: migraciones goose (SQL embebido) y modelos GORM.
- `internal/api`: router, middleware de auth, handlers del contrato y errores `{error:{code,message}}`.
- `internal/tree`: funciones puras para el estado de materias, la salud, la racha y las reglas de alertas.
- `internal/tutor`: loop de Claude, cliente MCP, tools locales, system prompt y escritor SSE.
- `data/`: `plan_career_1.json` (de Fran), `periods_fceia_2026.json`, seed.
- `docker-compose.yml`, `.env.example`.

**Claves del plan en inglés:** hecho en esta rama (tags json de `internal/plan`, constante `Approved`, JSON regenerado; datos idénticos salvo las claves).

## Orden: rama + PR por issue
0. ✅ **Directo a main** (3fed708, 8560b50: auth con Firebase): actualizar `docs/contratos.md`: pasar a inglés todo lo que viaja por el cable (rutas, campos, enums, SSE, tools MCP) dejando la prosa en español, más (conversacion_id en chat y `fin` + GET conversación; token en `POST /api/alumnos` + header; tipo `parcial` en `/actividad`; Postgres; ids reales: Lógica = 12, AM I = 2).
1. ✅ `backend/9-estado-alumno` (PR #19, mergeado): esqueleto, compose, migraciones, import-plan (JSON de Fran), middleware Firebase, `GET /api/me`, `POST /api/students`, PUT materias, POST actividad, GET árbol y plan.
2. ✅ `backend/10-salud-alertas` (PR #20, mergeado): periodos, salud, racha, motor de alertas, GET alertas y descartar.
3. ✅ `backend/7-chat-mcp` (PR #23, mergeado): cliente MCP, loop de tool use, tools locales, SSE etapa 1, conversaciones, horario.
4. ✅ `backend/8-tutor` (PR #24, mergeado): system prompt (pistas antes que la solución, decir cuando no está seguro, foto vía `imagen_base64`, simulacro).
5. ✅ `backend/11-seed-demo`: A (AM I id 2, frondoso, racha 6, parcial en 10 días) y B (Lógica id 12, 12 días inactivo → marchito + inactividad medio; parcial hace 3 días → `primer_parcial_no_rendido` alto, rama seca; racha 0, mejor 8). Fechas relativas a now(). Crea los usuarios de A y B en Firebase (email + contraseña, vía Admin SDK) y los vincula.

## Verificación
- Tests table-driven de `arbol/` (salud con receso y clima, racha con comodines, disponible/bloqueada, reglas de alertas).
- `docker compose up -d && go run . migrate && go run . import-plan … && go run . seed && go run . serve`, después curl de cada endpoint con un ID token de A y de B (login contra el emulador), comparando contra los JSON de `contratos.md`.
- Chat: `curl -N` a `/api/chat` con el MCP de Fran levantado (o un MCP stub) y ver `estado`/`texto`/`fin`.
