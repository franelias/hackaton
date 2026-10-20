// For demos: ?health=lush|wilted|withered shows the tree in that state (2D, 3D and the greeting),
// against the backend or in demo mode. It only changes what is drawn, never the data. It stays for
// the whole tab (sessionStorage) so navigating keeps it; ?health=off goes back to the real state.
import type { HealthState, Tree } from './types'

const KEY = 'arbol.health'
// days without activity of each state, in the middle of its band (see visualHealth)
const DAYS: Record<HealthState, number> = { lush: 1, wilted: 7, withered: 13 }

function read(): HealthState | null {
  try {
    const p = new URLSearchParams(location.search).get('health')
    if (p === 'off') sessionStorage.removeItem(KEY)
    else if (p && p in DAYS) sessionStorage.setItem(KEY, p)
    const v = sessionStorage.getItem(KEY)
    return v && v in DAYS ? v as HealthState : null
  } catch { return null }
}
const forced = read()

export function withHealthOverride(tree: Tree): Tree {
  if (!forced) return tree
  return { ...tree, health: { state: forced, last_activity: new Date(Date.now() - DAYS[forced] * 864e5).toISOString() } }
}
