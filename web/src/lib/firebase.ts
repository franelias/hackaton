import { initializeApp, type FirebaseApp } from 'firebase/app'
import { connectAuthEmulator, getAuth, GoogleAuthProvider, type Auth } from 'firebase/auth'
import { FIREBASE, MOCK } from './config'

let app: FirebaseApp | null = null
let auth: Auth | null = null

// Firebase is only initialized outside demo mode.
export function firebaseApp(): FirebaseApp | null {
  if (MOCK) return null
  app ??= initializeApp({ apiKey: FIREBASE.apiKey, authDomain: FIREBASE.authDomain, projectId: FIREBASE.projectId, appId: FIREBASE.appId, messagingSenderId: FIREBASE.messagingSenderId })
  return app
}

export function firebaseAuth(): Auth | null {
  const app = firebaseApp()
  if (!app) return null
  if (!auth) {
    auth = getAuth(app)
    auth.languageCode = 'es'
    if (FIREBASE.emulatorHost) connectAuthEmulator(auth, `http://${FIREBASE.emulatorHost}`, { disableWarnings: true })
  }
  return auth
}

export const googleProvider = new GoogleAuthProvider()
