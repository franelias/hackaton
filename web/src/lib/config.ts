// Configuration from environment variables (see web/.env.example).
const env = import.meta.env

export const API_URL: string = (env.VITE_API_URL ?? '').replace(/\/+$/, '')

export const FIREBASE = {
  apiKey: env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  appId: env.VITE_FIREBASE_APP_ID as string | undefined,
  // "localhost:9099" to use the backend's Firebase Auth Emulator
  emulatorHost: env.VITE_FIREBASE_AUTH_EMULATOR_HOST as string | undefined,
}

const firebaseReady = Boolean(FIREBASE.apiKey && FIREBASE.projectId)

// Demo mode: without a backend or Firebase config, the app uses sample data with the real LCC plan.
export const MOCK = env.VITE_MOCK === '1' || !API_URL || !firebaseReady
