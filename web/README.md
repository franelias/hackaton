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
con el plan real copiado en `src/mock/plan.json`, la alumna Ana y un tutor de ejemplo. La salud se
calcula como en el backend, con los días desde la última actividad: Ana arranca con 11 días (árbol
seco) y "Estudié hoy" o un mensaje al tutor la reviven. El árbol toma la salud continua de
`saludVisual()` (en `TreeView.tsx`): el estado del backend más los días dentro de ese estado.

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
El tutor necesita `OPENROUTER_API_KEY` en `backend/.env`; sin eso responde 503 y la app lo muestra.

## Estructura

- `src/lib/`: `config.ts` (env), `firebase.ts`, `api.ts` (cliente con token y SSE del chat),
  `types.ts` (contrato), `session.tsx` (usuario, alumno, plan, árbol y alertas; un `401` lleva al login).
- `src/components/TreeView.tsx`: el árbol. Es genérico, sirve para cualquier plan.
  - Forma: cada materia nace de su correlativa del año o cuatrimestre más cercano; el abanico es
    proporcional a lo que sostiene cada rama y el radio sale de año + cuatrimestre.
  - Hojas: dependen de `leaves` y `health`, y caen con animación. `flower` y `dry` se dibujan como
    marcas, y la Tesina (`final_goal`) va arriba.
  - Nombres: los de las materias bloqueadas se ven al pasar el mouse.
  - Al tocar una materia se marca su camino de correlativas.
- `src/pages/`:
  - `Login`: Google, mail y "Me olvidé la contraseña".
  - `Onboarding`: crear el alumno y marcar las materias.
  - `MiArbol`: árbol, alertas, "Estudié hoy" y la ficha de la materia (estado, fecha de parcial,
    practicar).
  - `Tutor`: chat SSE, lista de conversaciones y simulacro con cronómetro.
  - `Horarios`: `POST /api/schedule` con una grilla semanal.
  - `Cuenta`: nombre, mail, verificación, contraseña y cerrar sesión.

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
2. Tutor: subir foto (`image_base64`, máx. 5 MB). Markdown básico y LaTeX con KaTeX ya están (`src/components/Texto.tsx`); como el backend manda la respuesta entera en un solo evento `text`, `TextoQueAparece` la muestra de a poco con un fundido por palabra.
3. Pantalla Fechas: el backend no la expone; hace falta un endpoint, o mostrar los `exam` cargados.
4. Optativas: dejar elegirlas (`optional: true`) para que entren al árbol.
5. Celular: barra inferior y zoom o lista para el árbol; lista accesible del árbol.
6. Backend, pedir a Eugenio:
   - editar o borrar el alumno (nombre, carrera);
   - listar conversaciones;
   - endpoint de fechas.
7. Tests (Vitest), code splitting de Firebase y deploy.

## Árbol en 3D (`src/components/TreeView3D.tsx`, three.js 0.180)

En "Mi árbol" hay un selector 2D / 3D (se recuerda en `localStorage`). El 3D se carga con `lazy()`
para no sumarle three.js a la carga inicial, y sin WebGL arranca en 2D.

- **Forma de árbol real:**
  - tronco que se afina y raíces que entran al pasto;
  - un eje central del que salen las ramas, y la copa es un elipsoide;
  - cada materia es una rama que nace de su correlativa, o del eje si no tiene;
  - la rama termina en un punto cerca de la superficie de la copa: la altura sale del año y
    cuatrimestre, y el ángulo alrededor del tronco, del orden de las correlativas (`armar()`), así
    cada rama queda cerca de la que la habilita;
  - las ramas se afinan (`tuboAfinado`), tienen grosor por lo que sostienen y ramitas decorativas.
- **Follaje:** unas 4.000 hojas en un `InstancedMesh`, en las materias, en las ramitas y de relleno
  en la copa. Se mueven con el viento. Al bajar la salud cambian de color, caen balanceándose (solo
  las que estaban visibles) y quedan en el pasto; al revivir rebrotan.
- **Escena:** el cielo, el pasto y la niebla se apagan con la salud. Lo aprobado es una flor blanca,
  y la Tesina, una estrella arriba.
- **Interacción:** girar arrastrando (gira solo hasta que lo tocás) y zoom. Al tocar una materia o
  su rama se ilumina el camino y se abre la ficha.
- **Nombres:** etiquetas HTML (`CSS2DRenderer`); las de las materias bloqueadas aparecen al pasar
  el mouse.
- **Probado:** con Chrome por software (SwiftShader) en frondoso, mustio y seco, sin errores en
  consola.

Pendiente del 3D:
- etiquetas: no se pisan (cada 6 cuadros se proyectan a pantalla y se ocultan las de menos prioridad que choquen; prioridad: elegida > camino > cursando > regular > aprobada > podés cursar > bloqueada; aparecen al pasar el mouse);
- probar el rendimiento en celulares (sombras de 2048 px, 4.000 hojas);
- falta una prueba de clic automatizada.
- Árbol más grande (copa 5,4 × 3,7 m, tronco 3,2 m) con 34 ramas internas sin datos y ramitas en cada rama.
- Las materias aprobadas florecen: una flor grande en la punta y 3 por ramita; no se caen al secarse.
- **Siguiente:** más estados intermedios de salud (hoy son 3: `lush`, `wilted`, `withered`).
- "Mi árbol" va a lo ancho: margen izquierdo chico, panel de la materia pegado al borde derecho y el
  3D con el alto de la pantalla. Abajo, `Resumen`: avance por año, cuatrimestres mínimos que faltan
  (la cadena más larga de correlativas pendientes), materias que se cursan (ejercicios, lista para
  rendir, se está secando) y lo que más destraba. Todo se calcula con el plan y el árbol, sin
  endpoints nuevos.
- Nombres en el 3D: por defecto solo los de lo que se cursa y sus relacionadas (lo que necesitan y
  lo que destraban). El resto aparece al tocar, al pasar el mouse o al buscar. Hay un buscador de
  materias arriba del árbol: al elegir una se selecciona, se marca su camino y la cámara gira hacia
  ella. El interruptor "Todos los nombres" muestra todos, sin pisarse (los que chocan se ocultan).
