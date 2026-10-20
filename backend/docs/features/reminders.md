---
service: backend
status: active
owner: "@franelias"
flows: [reminders]
consumes: []
publishes: []
config: [NOTIFY_INTERVAL, APP_URL, PUSH_PROVIDER, SMTP_ADDR, SMTP_USER, SMTP_PASSWORD, MAIL_FROM, GOOGLE_APPLICATION_CREDENTIALS]
reviewed: 2026-10-20
---

# Recordatorios por push y mail

Avisos fuera de la app, al estilo Duolingo, antes de que el alumno pierda algo: la racha, la salud del árbol, una materia que no toca hace semanas o un final pendiente con mesas cerca.

## Decision

Los recordatorios (`tree.Nudges`) son distintos de las [alertas](alerts.md): miran hacia adelante y salen de la app. El scheduler corre **dentro de `arbol serve`** (`NOTIFY_INTERVAL`) y cada envío se **reclama en la tabla `notifications` antes de mandarlo**.

Rechazado:
- **Cron externo o cola**: no hay infraestructura de colas en el proyecto. `arbol notify` existe para correrlo una vez a mano o desde un cron si hiciera falta.
- **Mandar y después registrar**: con dos instancias de `serve` o una corrida manual en paralelo, el mismo aviso saldría dos veces. Reclamar primero (índice único + `ON CONFLICT DO NOTHING`) lo impide.
- **Push con `notification` de FCM**: los mensajes son solo de datos (`{title, body, url}`) para que la app decida cómo mostrarlos y a dónde lleva el click.

El costo: el scheduler vive en el proceso de la API; si se escala a varias réplicas todas corren el loop (sin duplicar envíos, pero con trabajo repetido).

## Contract

**In:** `GET|PUT /api/students/{id}/notifications`, `POST /api/students/{id}/push-tokens`, `DELETE …/push-tokens/{token}`. Tipos de recordatorio, ventanas y endpoints en [contratos §2.3.1](../../../docs/contratos.md).

**Out:** mensajes FCM de datos con `title`, `body` y `url`; los muestra `web/public/firebase-messaging-sw.js`. Cambiar esas tres claves rompe la app.

**Out:** mails por SMTP con un link a "Mi cuenta" para desactivarlos.

**Depende de:** Firebase Admin (`GetUser` para el mail del alumno; Messaging para push). Push necesita el proyecto real: el emulador no tiene FCM.

## Flow

backend es dueño de qué se manda, a quién y cuándo. Diagrama en [reminders](../flows/reminders.md).

Lo que es solo de backend:

- Ventana de envío 10 a 21 h de Argentina y como mucho uno por alumno por día (`FromHour`, `ToHour`, `PerDay`). Se manda el primero de la lista que no se haya mandado.
- Cada condición `(student, kind, subject, cond_key)` sale una sola vez; si ningún canal la entrega, la fila se borra y se reintenta en la próxima vuelta.
- Si el alumno no tiene canal activo, no se reclama nada: el aviso puede salir cuando active uno.
- Un fallo con un alumno se loguea y no frena a los demás.
- `push_tokens.token` es la clave: el mismo navegador con otra cuenta mueve el token al último alumno que lo registró.

## When it fails

| Estado | Se cura solo | Quién lo recupera |
|---|---|---|
| SMTP caído y sin push | sí, el reclamo se libera y la próxima vuelta reintenta | nadie |
| `SMTP_ADDR` vacío | no: los mails solo se loguean (`LogMailer`) y no cuentan como entregados; sin push, el aviso se libera y se reintenta en cada vuelta | quien despliega |
| FCM rechaza un token (proyecto distinto, credenciales) | no: se loguea `push: token <prefijo>…: <error>` y el token queda | quien despliega; si el token es de otro proyecto, el alumno vuelve a activar push |
| `PUSH_PROVIDER` vacío | no: no hay push, el mail sigue | quien despliega |
| `PUSH_PROVIDER` con un valor desconocido | no: `arbol serve` no arranca | quien despliega |

Los estados en los que backend y el navegador no coinciden están en [reminders](../flows/reminders.md).

## Operating

- `NOTIFY_INTERVAL=off` apaga el loop sin tocar nada más. `arbol notify --any-hour --student s-002` manda uno ya, para probar.
- Desarrollo: Mailpit de `docker-compose.yml` (`SMTP_ADDR=localhost:1025`, bandeja en http://localhost:8025).
- No hay dashboard: buscar `notify` en los logs (`N students nudged`, errores por alumno con el canal y el token que falló). `N students nudged` cuenta solo push aceptados por FCM o mails enviados por SMTP; FCM aceptando no garantiza que el navegador lo muestre.
- Los links (`Notifier.link` y el de "Mi cuenta" en el mail) usan las rutas de `web/src/App.tsx`: `/tutor?subject=<id>`, `/schedule`, `/account`. Si la app renombra una ruta, el link cae en `/` sin error; `TestLink` fija las actuales.
- Rollback: `NOTIFY_INTERVAL=off` alcanza. La migración `00005_notifications` tiene `Down`, pero no hace falta rollback de imagen.
