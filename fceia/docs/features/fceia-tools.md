---
service: fceia
status: active
owner: "@franelias"
flows: [tutor-chat]
consumes: []
publishes: []
config: [FCEIA_API_BASE]
reviewed: 2026-10-20
---

# Tools de la FCEIA

Nueve operaciones de solo lectura sobre la API pública de la FCEIA: buscar materias, temas frecuentes de parciales, ejercicios, resoluciones, materiales, bibliografía, correlativas, fechas y armado de horarios. Las usa el tutor y las sirve el MCP.

## Decision

**Un solo módulo para todos los consumidores.** `fceia/tools` define cada tool una vez (nombre, descripción, JSON Schema de entrada y salida); el backend las llama en proceso y `mcpserver` las publica por MCP. Una tool nueva aparece en los dos sin tocar nada más.

**Búsqueda por texto, no RAG.** La API solo busca materiales por subcadena y distingue tildes y mayúsculas; la tool prueba variantes (`topic` tal cual, en minúscula, capitalizado) y filtra en local con `fold`.

**`frequent_topics` devuelve `keywords`** además de los temas: con pocos exámenes (Lógica tiene 10), casi todos los temas aparecen una sola vez y la lista de temas no dice nada; las palabras y pares que se repiten en al menos 2 exámenes sí.

Rechazado:
- **Embeddings sobre los materiales**: no hay texto completo indexable en la API, y la hackatón no daba para mantener un índice propio.
- **Traducir los valores de la API** (`parcial`, `apuntes`, `basica`): pasan tal cual; el contrato es en inglés solo para lo que definimos nosotros.

## Contract

**Out:** las nueve tools con sus parámetros y respuestas en [contratos §3](../../../docs/contratos.md). Nombres, parámetros y campos son contrato: el tutor tiene sus textos de estado en `backend/internal/tutor/fceia.go` por nombre de tool, y clientes MCP externos pueden depender de ellos.

**Errores que son contrato:** `{"error":{"code","message"}}` con `code` ∈ `not_found`, `api_unavailable`, `invalid_argument`. Un resultado vacío es una lista vacía, nunca un error.

**URLs:** `file_url`, `url` y `pdf_url` son siempre absolutas (`Client.AbsURL`).

**Depende de:** `https://fceia-api.ariloc.ar/api/v1`, de un tercero, sin auth y sin SLA. `prerequisites` y `build_schedule` aplican [`corrections`](../../../corrections/docs/features/manual-review.md).

## Flow

Este módulo es la última parada del chat con el tutor. Diagrama en [tutor-chat](../../../web/docs/flows/tutor-chat.md).

Lo que es solo de este módulo:

- El cliente cachea cada `GET` exitoso por URL durante 1 hora, en memoria y por proceso. Los errores no se cachean.
- Timeout de 20 s por request a la API.
- Un 404 de la API es `not_found`; cualquier otro fallo (red, 5xx, timeout) es `api_unavailable`.
- `solution` casi siempre devuelve `available: false`: solo 25 de las 73 resoluciones de la API están vinculadas a un examen.

## When it fails

| Estado | Se cura solo | Quién lo recupera |
|---|---|---|
| API de la FCEIA caída | sí, al volver; lo cacheado sigue sirviendo hasta 1 h | nadie. El tutor sigue sin esas tools; el árbol no depende de la API |
| La API cambia un campo | no: la tool devuelve vacío o falla al parsear | quien mantiene `fceia`; `make test-live` lo detecta |

## Operating

- `FCEIA_API_BASE` apunta a otra instancia de la API.
- `make test` usa respuestas grabadas en `mcpserver/testdata/`; `make test-live` pega contra la API real.
- Rollback: imagen anterior; la caché se vacía con el proceso.
