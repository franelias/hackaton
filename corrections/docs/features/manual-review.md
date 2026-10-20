---
service: corrections
status: active
owner: "@franelias"
flows: []
consumes: []
publishes: []
config: []
reviewed: 2026-10-20
---

# Revisión manual del plan sobre la API

Corrige lo que la API de la FCEIA tiene mal (años y cuatrimestres, correlativas, materias electivas, la Tesina como objetivo final) sin tocar la API, para que el árbol, el tutor y el armador de horarios muestren el plan oficial.

## Decision

**Una capa de overrides versionada, aplicada por todos los consumidores.** Un JSON embebido por carrera (`data/career_<id>.json`) que leen el backend al generar el plan y `fceia` en `prerequisites` y `build_schedule`.

**Cada entrada cita su fuente oficial** en `note` (resolución del plan o programa 2024 de la materia). Sin fuente, no entra.

Rechazado:
- **Corregir en cada consumidor por separado**: el árbol diría que una materia está disponible y el tutor diría que no. Con una sola capa, nunca se contradicen frente al alumno.
- **Pedirle al dueño de la API que la corrija**: está fuera del alcance del proyecto y de los plazos.
- **Corregir en silencio lo que no se encuentra**: un override de una materia o correlativa que la API no tiene es un error, así un typo no deja una corrección sin aplicar.

## Contract

**In:** JSON con `subjects` (`year`, `term`, `elective`, `note`), `add_prerequisites` y `remove_prerequisites` (`subject_id`, `requires`, `condition`, `note`). Campos desconocidos son error.

**Quién depende:** `backend` (`plan.Generate`, vía `arbol plan`) y `fceia` (`tools/relations.go`). Los dos lo importan con `replace … => ../corrections`, así que cualquier build necesita la raíz del repo como contexto.

**Desfase posible:** `fceia` lo aplica en vivo en cada llamada; el backend solo cuando se regenera e importa el plan. Un cambio acá que no pase por `arbol plan` + `arbol import plan` deja al árbol y al tutor en desacuerdo.

## Flow

Lo que garantiza este módulo:

- Aplicar los overrides es idempotente (`Prerequisites`, `Unlocks`): quitar una correlativa que no está o agregar una que ya está no cambia nada. Por eso `fceia` los aplica sin validar.
- `Validate` corre en `arbol plan` y falla si una materia del override no está en la carrera, si se borra una correlativa que la API no tiene, o si `condition` no es `approved` ni `regular`.
- `condition` vacía es `approved`.
- `Graph` aplica los overrides a toda la carrera y deja solo las correlativas directas (`Reduce`): si C pide A y B, y B pide A, C se queda con B. Solo cuenta como implícita una correlativa garantizada por otra que se pide aprobada. El plan y las tools del MCP usan la misma reducción.
- La Tesina es una materia más del grafo: depende de todas las obligatorias y las optativas.

Evidencia y cómo repetir la revisión: [revision-plan-lcc](../../../docs/revision-plan-lcc.md).

## When it fails

| Estado | Se cura solo | Quién lo recupera |
|---|---|---|
| La API corrige algo que acá ya estaba corregido | `fceia` sí: aplicar un override que ya no hace falta no cambia nada. `arbol plan` no: `Validate` falla a propósito para que la entrada sobrante se borre | quien mantiene el módulo, borrando la entrada |
| Override cambiado y plan no regenerado | no | quien despliega: `arbol plan` y `arbol import plan` |

## Operating

- Probar una revisión sin tocar el JSON embebido: `arbol plan --overrides <archivo>`.
- Cambiar este módulo requiere imagen nueva (está embebido en el binario) **y** regenerar e importar el plan.
- Rollback: revertir el JSON, imagen nueva y re-importar el plan anterior.
