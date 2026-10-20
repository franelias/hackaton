# Árbol · frontend (web)

React 19 + Vite + TypeScript + Firebase Auth. Implementa el contrato de `../docs/contratos.md`.
El diseño y sus decisiones están en `../DISENO.md`.

## Correr

```sh
cd web
cp .env.example .env    # y completar (ver abajo)
nix shell nixpkgs#nodejs_22 nixpkgs#pnpm -c pnpm install
nix shell nixpkgs#nodejs_22 nixpkgs#pnpm -c pnpm dev   # http://localhost:5173
```

Chequeo de tipos: `pnpm exec tsc -b`. Build: `pnpm build`.

## Configuración (`web/.env`, no se sube al repo)

| Variable | Qué es |
|---|---|
| `VITE_API_URL` | URL del backend, sin barra final. **Vacía = modo demo** |
| `VITE_FIREBASE_API_KEY`, `_AUTH_DOMAIN`, `_PROJECT_ID`, `_APP_ID` | Config web del proyecto de Firebase (ya cargada) |
| `VITE_FIREBASE_AUTH_EMULATOR_HOST` | `localhost:9099` para usar el emulador del backend (docker compose) |
| `VITE_MOCK=1` | Fuerza el modo demo |

**Modo demo:** si falta `VITE_API_URL` o Firebase, la app no llama a nada. Usa `src/mock/mockApi.ts`,
con el plan real copiado en `src/mock/plan.json`, la alumna Ana (que en el demo también es docente) y un tutor de ejemplo.
La salud del árbol se calcula como en el backend, con los días desde la última actividad (5 mustio,
10 seco); para ver un árbol seco hay que entrar como Beto contra el backend.

Para el login real, en la consola de Firebase:
- habilitar Google y Correo/contraseña en *Sign-in method*;
- agregar el dominio en *Dominios autorizados*.

El backend tiene que usar el mismo proyecto de Firebase.

**Contra el backend local** (`make up-seed` en la raíz: Postgres, emulador de Auth y la API en `:8000`):

```sh
VITE_API_URL=http://localhost:8000
VITE_FIREBASE_API_KEY=demo-key            # el emulador acepta cualquiera
VITE_FIREBASE_AUTH_DOMAIN=demo-arbol.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=demo-arbol       # igual a FIREBASE_PROJECT_ID del backend
VITE_FIREBASE_APP_ID=demo-app
VITE_FIREBASE_AUTH_EMULATOR_HOST=localhost:9099
```

Entrar con `ana@arbol.demo` o `beto@arbol.demo` (contraseña `DEMO_PASSWORD`, por defecto `arbol-demo`).
Para la vista docente, con `docente@arbol.demo` (Laura Méndez, dicta Análisis I y Lógica; mail ya verificado).
El tutor necesita `OPENROUTER_API_KEY` en `backend/.env`; sin eso responde 503 y la app lo muestra.

## Estructura

- `src/lib/`: `config.ts` (env), `firebase.ts`, `api.ts` (cliente con token y SSE del chat),
  `types.ts` (contrato), `queries.ts` (caché de TanStack Query: claves, cliente y las queries de cada dato; lo ya
  visto se muestra al instante y se refresca por detrás), `mutations.ts` (los cambios: el árbol, descartar alertas
  con actualización optimista, recordatorios; cada uno deja la caché como la tiene el server; las devtools
  aparecen solo en desarrollo), `session.tsx` (usuario, alumno, plan, árbol y alertas, sobre
  TanStack Query; un `401` lleva al login).
- UI: Tailwind v4 + shadcn/ui (`components.json`, estilo radix-nova). Los componentes de shadcn están en
  `src/components/ui/` y son nuestros: ya están ajustados (botones y toggles en píldora, inputs de 40 px).
  Se agregan con `pnpm dlx shadcn@latest add <componente>`. Los tokens (verde de la marca, estados de las
  materias, salud, modo oscuro) están en `src/index.css`; el tema claro, oscuro o automático en
  `src/hooks/use-theme.ts`. Íconos: `lucide-react`. Fuente: Nunito, auto-hospedada con `@fontsource-variable`.
  `src/components/Page.tsx` tiene el encabezado y los estados de carga y error que usan todas las pantallas.
- `src/components/TreeView.tsx`: el árbol. Es genérico, sirve para cualquier plan.
  - Forma: cada materia nace de su correlativa del año o cuatrimestre más cercano; el abanico es
    proporcional a lo que sostiene cada rama y el radio sale de año + cuatrimestre.
  - Hojas: dependen de `leaves` y `health`, y caen con animación. `flower` y `dry` se dibujan como
    marcas, y la Tesina (`final_goal`) va arriba.
  - Nombres: los de las materias bloqueadas se ven al pasar el mouse.
  - Al tocar una materia se marca su camino de correlativas.
- `src/pages/`:
  - `Login` (`/login`): Google, mail y "Me olvidé la contraseña".
  - `Onboarding` (`/start`): crear el alumno y marcar las materias.
  - `MyTree` (`/`): árbol, alertas, "Estudié hoy" y la ficha de la materia (estado, fecha de parcial,
    practicar).
  - `Tutor` (`/tutor`): chat SSE, lista de conversaciones y simulacro con cronómetro.
  - `Schedule` (`/schedule`): `POST /api/schedule` con una grilla semanal.
  - `Account` (`/account`): nombre, mail, verificación, contraseña y cerrar sesión.
  - `TeacherHome` (`/teacher`) y `TeacherSubject` (`/teacher/subjects/:subjectId`): vista docente (contrato 2.6).
    Se ve si `/api/me` trae `teacher_id`; un docente que no es alumno no ve Mi árbol, Tutor ni Horarios.
    En modo demo Ana también es docente (`src/mock/classes.ts`).

## Estado (2026-10-19)

**Probado:**
- compila sin errores de tipos;
- modo demo con capturas;
- el flujo del tutor de punta a punta (chat, simulacro, entrega, lista) con Chrome por CDP.

**Probado contra el backend local** (emulador de Auth, alumna Ana sembrada): login con mail, `/me`,
árbol, alertas, "Estudié hoy" y `POST /api/schedule` con horarios reales de la FCEIA.

**No probado:** el tutor con un modelo real (faltaba `OPENROUTER_API_KEY`) y el login con el proyecto
real de Firebase.

Notas:
- La lista de conversaciones se guarda en el `localStorage` porque no hay un endpoint para
  listarlas; los mensajes sí salen del backend (`GET /conversations/{id}`). Lo ideal sería que el
  backend agregue `GET /api/students/{id}/conversations`.
- El simulacro lo arranca el tutor con su tool `start_mock_exam`; el frontend solo lleva el reloj y
  pide la corrección al entregar.

## Pendientes

1. Probar el tutor con `OPENROUTER_API_KEY` y el login con el proyecto real de Firebase.
2. Tutor: la foto ya está (`src/lib/photo.ts`: botón con cámara en el celular, pegar con Ctrl+V o arrastrar; se achica a 1600 px en JPEG antes de mandarla; el historial del backend no la guarda, así que al reabrir la conversación se ve "Foto de un ejercicio"). Markdown básico y LaTeX con KaTeX ya están (`src/components/RichText.tsx`); como el backend manda la respuesta entera en un solo evento `text`, `TypedText` la muestra de a poco con un fundido por palabra.
3. Pantalla Fechas: el backend no la expone; hace falta un endpoint, o mostrar los `exam` cargados.
4. Optativas: dejar elegirlas (`optional: true`) para que entren al árbol.
5. Celular: barra inferior y zoom o lista para el árbol; lista accesible del árbol.
6. Backend, pedir a Eugenio:
   - editar o borrar el alumno (nombre, carrera);
   - listar conversaciones;
   - endpoint de fechas.
7. Tests (Vitest), code splitting de Firebase y deploy.
8. Idea para la ficha de la materia (MyTree): al tocar una materia del árbol se abre la ventanita de la
   derecha con sus datos; abajo de esos datos, dibujar su "rama": el camino de correlativas que lleva a
   ella (lo que hay que aprobar antes, de la raíz a la materia), con el estado de cada una. Hoy ese camino
   solo se resalta en el árbol.

## Convenciones

- El código va en inglés: archivos, componentes, funciones, variables, tipos, clases CSS, rutas y
  comentarios. En español van los textos que ve el alumno y la prosa de los docs, igual que en
  `backend/` (ver `backend/AGENTS.md`).
- Rutas: `/` (MyTree), `/tutor` (`?subject=<id>` para arrancar con una materia), `/schedule`,
  `/account`, `/login`, `/start` (onboarding).
