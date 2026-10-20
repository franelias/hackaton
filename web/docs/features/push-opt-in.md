---
service: web
status: behind-flag
owner: "@franelias"
flows: [reminders]
consumes: []
publishes: []
config: [VITE_FIREBASE_MESSAGING_SENDER_ID, VITE_FIREBASE_VAPID_KEY]
reviewed: 2026-10-20
---

# Activar notificaciones push

En "Mi cuenta" el alumno activa el push en este navegador y elige si quiere recordatorios por push, por mail o ninguno.

## Decision

El service worker (`public/firebase-messaging-sw.js`) recibe la config web de Firebase **en el query string del registro**, porque `public/` no pasa por Vite y no puede leer las variables `VITE_*`. Esa config es pública.

Con la app en primer plano FCM no muestra nada; la app la muestra igual con el mismo service worker (`onMessage` → `showNotification`), para que el alumno vea el aviso esté donde esté.

## Contract

**Out:** `POST /push-tokens`, `DELETE /push-tokens/{token}` (token con `encodeURIComponent`), `GET|PUT /notifications` de backend ([contratos §2.3.1](../../../docs/contratos.md)).

**In:** mensajes FCM de datos con `title`, `body` y `url`. Si backend cambia esas claves, el service worker muestra "Árbol" sin texto.

**Versión fijada:** el service worker importa `firebase-*-compat.js` 13.0.0 desde gstatic; tiene que ser la misma versión que `firebase` en `package.json`.

## Flow

La app es dueña del permiso del navegador y del token. Diagrama en [reminders](../../../backend/docs/flows/reminders.md).

Lo que es solo de la app:

- Estados: `unsupported` (falta config, navegador sin service worker o sin soporte de FCM), `blocked` (permiso denegado), `on`, `off`.
- Al abrir la app con push activo, `syncPush` pide el token otra vez y lo registra si FCM lo rotó.
- Al cerrar sesión, `disablePush` borra el token en backend y en FCM: el navegador deja de recibir los recordatorios de esa cuenta.
- El click en la notificación reusa una ventana abierta de la app si la hay; si no, abre una.

## When it fails

| Estado | Se cura solo | Quién lo recupera |
|---|---|---|
| Falta `VITE_FIREBASE_MESSAGING_SENDER_ID` o `VITE_FIREBASE_VAPID_KEY` | no: la app no ofrece push; el mail sigue | quien despliega |
| Permiso denegado | no | el alumno, desde la configuración del navegador |
| Backend con `PUSH_PROVIDER` vacío | no: el alumno activa push pero nunca le llega nada | quien despliega backend |

## Operating

- La VAPID key se genera en la consola de Firebase → Cloud Messaging → Certificados push web.
- Push no funciona con el emulador de Auth: hace falta el proyecto real en la app y en backend.
- Rollback: build anterior. Los tokens ya registrados quedan en backend y se borran solos cuando FCM los rechaza.
