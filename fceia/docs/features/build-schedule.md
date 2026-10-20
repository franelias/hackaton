---
service: fceia
status: active
owner: "@franelias"
flows: []
consumes: []
publishes: []
config: [FCEIA_API_BASE]
reviewed: 2026-10-20
---

# Armado de horarios (`build_schedule`)

Dadas hasta 12 materias, arma hasta 3 combinaciones de comisiones sin choques, ordenadas por preferencia; si no hay ninguna, dice qué choca y qué conviene postergar.

## Decision

**Búsqueda exhaustiva con poda**, no heurística: con hasta 12 materias y pocas comisiones por materia, recorrer todas las combinaciones es barato y garantiza que si existe un horario sin choques, aparece. Tope de 2 000 000 nodos (`maxSearchNodes`) para que un caso raro no cuelgue el request.

**Las comisiones se parsean del texto libre `notes`** (`Com.: 630`, `Com: 630 y Com: 660`), porque la API no tiene un campo comisión. Sin etiqueta, la materia tiene una sola.

**Qué postergar** cuando no hay combinación: el conjunto que menos cuellos de botella toca, después el más chico, después el que menos destraba. Los cuellos de botella se calculan con las correlativas ya corregidas por [`corrections`](../../../corrections/docs/features/manual-review.md), igual que el plan del backend.

Rechazado:
- **Elegir el horario con menos huecos primero**: el alumno se queja más de clases fuera de su turno que de un hueco; el orden es turno, días en la facultad, horas de hueco, comisión.
- **`free_days` como preferencia blanda**: es restricción dura; solo se relaja si ninguna combinación la cumple, y se avisa.

## Contract

**In/Out:** parámetros, respuesta y reglas de orden en [contratos §3 `build_schedule`](../../../docs/contratos.md). Lo llaman el MCP, el tutor y `POST /api/schedule` del backend ([schedule-endpoint](../../../backend/docs/features/schedule-endpoint.md)).

**Contrato con quien llama:** si no llega ni `approved_subject_ids` ni `regular_subject_ids`, las correlativas **no se chequean** y la respuesta trae un `warning`. El backend siempre manda ambas.

**Errores:** `invalid_argument` (más de 12 materias, materias de carreras distintas), `not_found`, `api_unavailable`.

## Flow

Lo que garantiza esta tool:

- El solver (`schedule/`) es puro: no habla con la API, recibe las ofertas ya cargadas.
- Semestre por materia: el más reciente; si solo hay "última publicación", sale con `stale: true` y aviso.
- Clase sin hora de fin: se asumen 180 minutos y sale con `end_estimated: true`.
- Si una materia tiene comisiones etiquetadas, las clases sin etiqueta se ignoran (son duplicados parciales de la API) y se avisa.
- El aviso de traslado entre sedes (menos de 60 min) no cambia el orden.

## When it fails

| Estado | Se cura solo | Quién lo recupera |
|---|---|---|
| Se pasa el tope de búsqueda | n/a: devuelve las mejores encontradas hasta ahí | nadie |
| Notas de comisión con un formato nuevo | no: las clases se agrupan mal y pueden aparecer choques falsos | quien mantiene `fceia`, ampliando el parser |
| Materia sin clases en la API | n/a: va a `without_schedule` | nadie |

## Operating

- Probar contra la API real: `make test-live`.
- Rollback: imagen anterior; no hay estado.
