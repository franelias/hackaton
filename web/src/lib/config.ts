// Configuración por variables de entorno (ver web/.env.example).
const env = import.meta.env

export const API_URL: string = (env.VITE_API_URL ?? '').replace(/\/+$/, '')
export const CAREER_ID = Number(env.VITE_CAREER_ID ?? 1)

export const FIREBASE = {
  apiKey: env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  appId: env.VITE_FIREBASE_APP_ID as string | undefined,
  // "localhost:9099" para usar el Firebase Auth Emulator del backend
  emulatorHost: env.VITE_FIREBASE_AUTH_EMULATOR_HOST as string | undefined,
}

const firebaseListo = Boolean(FIREBASE.apiKey && FIREBASE.projectId)

// Modo demo: sin backend o sin Firebase configurado, la app usa datos de prueba con el plan real de LCC.
export const MOCK = env.VITE_MOCK === '1' || !API_URL || !firebaseListo
