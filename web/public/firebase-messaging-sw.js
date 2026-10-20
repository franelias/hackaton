// FCM service worker (https://firebase.google.com/docs/cloud-messaging/web/get-started).
// The backend sends data-only messages ({ title, body, url }); they are shown here when the app
// is not in the foreground, and tapping one opens Árbol on that screen. The Firebase config comes in
// the registration query string (src/lib/push.ts), because public/ does not go through Vite.

// Before the SDK, so it also handles clicks on the notifications we show ourselves.
self.addEventListener('notificationclick', e => {
  const url = e.notification.data?.url
  if (!url) return
  e.notification.close()
  const target = new URL(url, self.location.origin)
  e.waitUntil((async () => {
    if (target.origin === self.location.origin) {
      for (const w of await self.clients.matchAll({ type: 'window', includeUncontrolled: true })) {
        await w.navigate(target.href)
        return w.focus()
      }
    }
    return self.clients.openWindow(target.href)
  })())
})

// Same version as the firebase package in package.json.
importScripts('https://www.gstatic.com/firebasejs/13.0.0/firebase-app-compat.js')
importScripts('https://www.gstatic.com/firebasejs/13.0.0/firebase-messaging-compat.js')

const config = Object.fromEntries(new URL(self.location.href).searchParams)
firebase.initializeApp(config)
const messaging = firebase.messaging()

messaging.onBackgroundMessage(({ data = {} }) => {
  self.registration.showNotification(data.title || 'Árbol', {
    body: data.body || '', icon: '/arbol.svg', badge: '/arbol.svg', tag: 'arbol-recordatorio', data: { url: data.url || '/' },
  })
})
