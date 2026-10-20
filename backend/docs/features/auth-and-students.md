---
service: backend
status: active
owner: "@eugeniobergia"
flows: [onboarding]
consumes: []
publishes: []
config: [FIREBASE_PROJECT_ID, FIREBASE_AUTH_EMULATOR_HOST]
reviewed: 2026-10-20
---

# Autenticación y alta de alumno

Cada usuario de Firebase tiene como mucho un alumno (`s-NNN`) y solo puede leer y escribir el suyo.

## Decision

El login lo hace la app con Firebase Auth (Google o mail + contraseña); el backend solo verifica el ID token con el Admin SDK. No hay sesiones ni contraseñas en Postgres.

Rechazado:
- **Auth propia (usuarios en Postgres)**: más superficie para una hackatón, y Google login gratis con Firebase.
- **`student_id` como identidad**: el alumno se resuelve siempre desde el `uid` del token, así un id adivinado no da acceso.

## Contract

**In:** `Authorization: Bearer <Firebase ID token>` en todo salvo `GET /api/faculties` y `GET /api/careers/{career_id}/plan`. Detalle en [contratos §1.1 y §2.4](../../../docs/contratos.md).

**Códigos de los que depende la app:** `401` lleva al login (`web/src/lib/session.tsx`); `409 conflict` en `POST /api/students` significa que ese `uid` ya tiene alumno.

**Depende de:** Firebase Auth, el mismo proyecto que la app (`FIREBASE_PROJECT_ID` = `VITE_FIREBASE_PROJECT_ID`). Si no coinciden, todos los tokens dan `401`.

## Flow

El backend es dueño del vínculo `uid` → alumno. El recorrido completo de la app está en [onboarding](../../../web/docs/flows/onboarding.md).

Lo que el backend garantiza solo:

- `students.firebase_uid` es único y el alta usa `INSERT … ON CONFLICT DO NOTHING`: dos `POST /api/students` simultáneos del mismo usuario crean uno y el otro recibe `409`.
- Todo `/api/students/{student_id}/…` pasa por `ownStudent`: alumno inexistente → `404`, de otro `uid` → `403`. `POST /api/chat` y `POST /api/schedule` hacen el mismo chequeo sobre el `student_id` del body.
- El nombre es una línea de hasta 80 caracteres sin caracteres de control (llega al prompt del tutor).
- No hay endpoint para editar ni borrar el alumno: cambiar de carrera hoy requiere tocar la base.

## When it fails

| Estado | Se cura solo | Quién lo recupera |
|---|---|---|
| Token vencido | sí, el SDK de Firebase lo renueva en la app | nadie |
| Proyecto de Firebase distinto entre app y backend | no, `401` en todo | quien despliega, alineando las variables |
| Usuario con alumno en la carrera equivocada | no | operador, en la base (no hay endpoint) |

## Operating

- Desarrollo: `FIREBASE_AUTH_EMULATOR_HOST=localhost:9099` (emulador de `docker-compose.yml`, proyecto `demo-arbol`). Producción: borrar esa variable y dar `GOOGLE_APPLICATION_CREDENTIALS`.
- Token de prueba para curl: ver `backend/AGENTS.md`.
- Rollback: imagen anterior; no hay datos que migrar.
