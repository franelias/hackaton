---
service: web
status: active
owner: "@felisaga"
flows: []
consumes: []
publishes: []
config: [VITE_API_URL, VITE_MOCK, VITE_FIREBASE_API_KEY, VITE_FIREBASE_PROJECT_ID]
reviewed: 2026-10-20
---

# Modo demo

Sin backend o sin config de Firebase, la app no llama a nada: implementa el contrato en memoria con el plan real de LCC, la alumna Ana (que también es docente) y un tutor de ejemplo.

## Decision

El modo demo implementa **la misma interfaz `Api`** que el cliente real (`src/mock/mockApi.ts`), y `src/lib/api.ts` elige uno u otro al cargar. Ninguna pantalla sabe en qué modo está.

Rechazado:
- **Fixtures dentro de cada pantalla**: el código de las pantallas divergiría entre modos y lo que se prueba en demo no sería lo que corre contra backend.

El costo: el mock copia a mano reglas de backend (umbrales de salud 5/10, forma de las alertas). Si backend las cambia, el demo se desactualiza sin que nada avise.

## Contract

**Entra solo si** falta `VITE_API_URL`, falta `VITE_FIREBASE_API_KEY` o `VITE_FIREBASE_PROJECT_ID`, o `VITE_MOCK=1` (`src/lib/config.ts`). Un build de producción sin esas variables se publica en modo demo sin error.

**Copia del plan:** `src/mock/plan.json` es una copia de `backend/data/plan_career_1.json`. Regenerar el plan no la actualiza.

## Flow

Lo que es solo del modo demo:

- No hay login: el usuario es Ana (`uid` `demo`) desde el arranque.
- Push está desactivado (`syncPush` no corre con `MOCK`).
- La salud sale de los días desde la última actividad simulada, solo con los umbrales normales: no hay época de parciales ni receso. Para ver un árbol marchito real hay que entrar como Beto contra backend.
- El estado vive en memoria: recargar la página vuelve al inicio.

## When it fails

| Estado | Se cura solo | Quién lo recupera |
|---|---|---|
| Build de producción sin `VITE_API_URL` | no: la app anda pero con datos falsos | quien despliega |
| El mock quedó atrás de backend | no | quien cambia el contrato, actualizando `src/mock/` en el mismo PR |

## Operating

- Forzarlo con backend configurado: `VITE_MOCK=1`.
- Las variables `VITE_*` se resuelven en el build: cambiar de modo requiere un build nuevo.
