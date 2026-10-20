---
service: backend
status: active
owner: "@eugeniobergia"
flows: []
consumes: []
publishes: []
config: [FCEIA_API_BASE]
reviewed: 2026-10-20
---

# Armador de horarios para el alumno

`POST /api/schedule`: el alumno elige materias y preferencias de turno y días libres, y recibe hasta 3 combinaciones de comisiones sin choques, con las correlativas chequeadas contra su propio estado.

## Decision

El endpoint es una capa fina sobre la tool `build_schedule` de `fceia/tools`, llamada en proceso. Lo único que agrega backend es **completar `approved_subject_ids` y `regular_subject_ids` desde el estado guardado del alumno**.

Rechazado:
- **Que la app mande las materias aprobadas**: la app podría mandar cualquier cosa; el estado que vale es el de la base.
- **Un solver propio en backend**: el tutor y el MCP ya usan `build_schedule`; un segundo solver daría horarios distintos según desde dónde se pida.

## Contract

**In/Out:** cuerpo y respuesta en [contratos §2.4 y §3 (`build_schedule`)](../../../docs/contratos.md). Las reglas del armado son de [build-schedule](../../../fceia/docs/features/build-schedule.md).

**Errores de la tool → HTTP:** `invalid_argument` → `400`, `not_found` → `404`, cualquier otro (incluido `api_unavailable`) → `502`.

**Depende de:** la API de la FCEIA en vivo (horarios, comisiones, correlativas), con la caché de 1 h del cliente de `fceia`.

## Flow

Lo que es solo de backend:

- Siempre manda las dos listas (aunque estén vacías), así la tool siempre chequea correlativas y nunca devuelve el aviso de "no se chequearon".
- Usa el estado del momento del request: si el alumno acaba de aprobar una materia, la ve.
- No guarda nada: armar un horario no cuenta como actividad.

## When it fails

| Estado | Se cura solo | Quién lo recupera |
|---|---|---|
| API de la FCEIA caída | sí, al volver la API | nadie; mientras tanto `502 api_unavailable` |
| Horarios de la API desactualizados (`stale`) | no | nadie del lado de Árbol; la respuesta lo avisa en `warnings` |

## Operating

- `FCEIA_API_BASE` cambia la API (por defecto la pública). Requiere reiniciar.
- Rollback: imagen anterior; no hay estado.
