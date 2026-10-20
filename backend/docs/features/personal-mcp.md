---
service: backend
status: active
owner: "@franelias"
flows: []
consumes: []
publishes: []
config: [PORT]
reviewed: 2026-10-20
---

# MCP personal del alumno

El alumno conecta su propio Claude (Desktop, Code) a Árbol y le hace las mismas preguntas que al chatbot, pero Claude ve **su** árbol. Vive en `arbol serve`, en `/mcp`, junto a la API; no es el `arbol mcp` público de la [FCEIA](../../../fceia/docs/features/mcp-server.md), que sigue sin auth.

## Decision

**Token personal, no OAuth.** El alumno genera un token desde la app y lo pega en su cliente. OAuth completo (lo que pide claude.ai web para conectores) es bastante más trabajo y no hace falta para Claude Desktop/Code.

**Solo lectura.** Expone las nueve tools de la FCEIA, `view_my_tree` y el prompt `tutor` (el system prompt del chatbot más una nota de cliente externo). `record_progress` y `start_mock_exam` **no** están: con el modelo en manos del alumno, el progreso que reporta no es confiable. Para que cuente en el árbol lo registra en la app.

Rechazado:
- **Sesiones MCP con estado**: una sesión podría seguir viva con el token revocado. El servidor es *stateless* y valida el token en cada request.
- **Reusar el token de Firebase**: vence en una hora, inservible para un cliente de larga vida.

## Contract

**In:** `POST /api/students/{student_id}/mcp-token` (Firebase, como el resto) → `201 {"token": "arb_…"}`. Se muestra una sola vez; uno nuevo reemplaza al anterior. `DELETE` del mismo path lo revoca (`204`).

**Out:** `/mcp` (Streamable HTTP) con `Authorization: Bearer arb_…`; sin token o con uno inválido o revocado, `401`. De cada token se guarda solo el SHA-256 (`mcp_tokens`), con `last_used_at`.

## When it fails

| Estado | Se cura solo | Quién lo recupera |
|---|---|---|
| Token perdido | no | el alumno genera otro (invalida el viejo) |
| API de la FCEIA caída | sí | el cliente ve `api_unavailable` en las tools de la FCEIA; `view_my_tree` sigue andando |

## Operating

Claude Code:

```
claude mcp add --transport http arbol https://<host>/mcp --header "Authorization: Bearer arb_…"
```

En el cliente, el prompt `tutor` activa la forma de enseñar del chatbot. Rollback: quitar la ruta `/mcp`; la tabla `mcp_tokens` puede quedar.
