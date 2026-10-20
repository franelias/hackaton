---
service: backend
status: active
owner: "@felisaga"
flows: [onboarding]
consumes: []
publishes: []
config: [DATABASE_URL]
reviewed: 2026-10-20
---

# Vista docente

Un docente ve, por cada materia que dicta, a los alumnos que la están cursando ordenados por riesgo, su actividad semanal y los temas más practicados, para intervenir a tiempo.

## Decision

**Los alumnos de un docente son los que tienen su materia en estado `enrolled`.** El alumno no se inscribe en ningún curso ni acepta nada para aparecer.

**Docente no se autodeclara:** se carga con `arbol teacher add` (o el seed) y se reconoce por el **mail verificado** del token, no por el `uid`.

Rechazado:
- **Comisiones o invitaciones**: requiere que el alumno haga algo, y el objetivo es detectar justamente a los que no hacen nada.
- **Rol elegido en el onboarding**: cualquiera podría verse los datos de una materia entera.
- **Mostrarle las conversaciones con el tutor**: el docente nunca las ve. Solo ve conteos, temas y alertas.

El costo: un alumno que marca una materia como `enrolled` por error aparece con nombre en la vista del docente.

## Contract

**Out:** `GET /api/teacher`, `GET /api/teacher/subjects/{subject_id}` y `teacher_id` en `GET /api/me`. Forma, orden por riesgo y definiciones en [contratos §2.6](../../../docs/contratos.md).

**Códigos que la app usa:** `403` sin docente para ese mail, `404` materia que no dicta.

**Depende de:** las mismas reglas que [student-tree](student-tree.md) y [alerts](alerts.md): la salud y las alertas de cada alumno se calculan con `tree.Build`. Cambiar un umbral cambia lo que ve el docente.

## Flow

Lo que garantiza este servicio:

- **Solo lee.** Las alertas se calculan en el momento sin tocar la tabla `alerts`, e incluyen las que el alumno descartó: el docente las tiene que ver igual.
- Carga los alumnos de todas las materias del docente en pocas consultas, no una por alumno (`Server.classes`).
- `arbol teacher add` reemplaza todas las materias del docente: no suma.
- Un mismo usuario puede ser alumno y docente; la app muestra las dos vistas.

## When it fails

| Estado | Se cura solo | Quién lo recupera |
|---|---|---|
| Docente entra con mail + contraseña sin verificar | no: `403`, la app lo trata como alumno | el docente, verificando el mail |
| Docente cargado con otro mail que el de su cuenta | no: `403` | operador, con `arbol teacher add --email` |
| Materia sin alumnos `enrolled` | n/a: aparece con `students: 0` | nadie |

## Operating

- Alta o cambio: `arbol teacher add --email … --name … --subject 2 --subject 12`.
- Demo: `arbol seed` crea a Laura Méndez (`docente@arbol.demo`, mail verificado, Análisis I y Lógica) y 8 compañeros sin cuenta de Firebase (`uid` `seed:<nombre>`) para que haya alumnos en todos los estados.
- Rollback: imagen anterior. La migración `00004_teachers` solo agrega tablas.
