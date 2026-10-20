// Push notifications with Firebase Cloud Messaging, as in the FCM web guide:
// public/firebase-messaging-sw.js shows them in the background and onMessage with the app open.
import { deleteToken, getMessaging, getToken, isSupported, onMessage } from 'firebase/messaging'
import { api } from './api'
import { FIREBASE } from './config'
import { firebaseApp } from './firebase'

const KEY = 'arbol.push.token'
const load = () => { try { return localStorage.getItem(KEY) } catch { return null } }
const save = (t: string | null) => { try { if (t) localStorage.setItem(KEY, t); else localStorage.removeItem(KEY) } catch { /* no storage */ } }

export type PushState = 'unsupported' | 'blocked' | 'on' | 'off'

export async function pushState(): Promise<PushState> {
  if (!firebaseApp() || !FIREBASE.vapidKey || !FIREBASE.messagingSenderId || !('Notification' in window) || !('serviceWorker' in navigator) || !(await isSupported())) return 'unsupported'
  if (Notification.permission === 'denied') return 'blocked'
  return Notification.permission === 'granted' && load() ? 'on' : 'off'
}

// The service worker gets the Firebase web config in the query string (it is public).
function registerSW() {
  const config = { apiKey: FIREBASE.apiKey, authDomain: FIREBASE.authDomain, projectId: FIREBASE.projectId, appId: FIREBASE.appId, messagingSenderId: FIREBASE.messagingSenderId }
  const q = new URLSearchParams(Object.entries(config).filter((e): e is [string, string] => Boolean(e[1])))
  return navigator.serviceWorker.register(`/firebase-messaging-sw.js?${q}`)
}

let listening = false

// With the app in the foreground FCM shows nothing: we show it anyway, with the same service worker.
function listen(reg: ServiceWorkerRegistration) {
  if (listening) return
  listening = true
  onMessage(getMessaging(firebaseApp()!), ({ data = {} }) => {
    reg.showNotification(data.title || 'Árbol', { body: data.body || '', icon: '/arbol.svg', badge: '/arbol.svg', tag: 'arbol-recordatorio', data: { url: data.url || '/' } })
  })
}

async function token(): Promise<string> {
  const reg = await registerSW()
  const t = await getToken(getMessaging(firebaseApp()!), { vapidKey: FIREBASE.vapidKey, serviceWorkerRegistration: reg })
  listen(reg)
  return t
}

// Asks for permission and registers this browser's token for the student.
export async function enablePush(studentId: string): Promise<PushState> {
  if (await Notification.requestPermission() !== 'granted') return pushState()
  const t = await token()
  await api.addPushToken(studentId, t)
  await api.setNotifications(studentId, { push: true })
  save(t)
  return 'on'
}

export async function disablePush(studentId: string) {
  const t = load()
  if (!t) return
  await api.removePushToken(studentId, t).catch(() => { /* the backend forgets it when FCM rejects it */ })
  await deleteToken(getMessaging(firebaseApp()!)).catch(() => { /* already gone */ })
  save(null)
}

// getToken returns the current token (FCM rotates them): on opening the app it is registered again if it changed.
export async function syncPush(studentId: string) {
  if (await pushState() !== 'on') return
  const t = await token()
  if (t !== load()) { await api.addPushToken(studentId, t); save(t) }
}
