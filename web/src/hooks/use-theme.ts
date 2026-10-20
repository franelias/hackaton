// Light, dark or the device's mode. index.html applies the saved choice before React loads, so there is no flash.
import { useCallback, useEffect, useSyncExternalStore } from 'react'

export type Theme = 'system' | 'light' | 'dark'
const KEY = 'arbol.theme'
const media = () => matchMedia('(prefers-color-scheme: dark)')
const listeners = new Set<() => void>()

const read = (): Theme => { try { const v = localStorage.getItem(KEY); return v === 'light' || v === 'dark' ? v : 'system' } catch { return 'system' } }
const apply = (t: Theme) => document.documentElement.classList.toggle('dark', t === 'dark' || (t === 'system' && media().matches))

export function useTheme() {
  const theme = useSyncExternalStore(cb => { listeners.add(cb); return () => listeners.delete(cb) }, read)
  // following the device: react when it changes
  useEffect(() => { if (theme !== 'system') return; const m = media(), on = () => apply('system'); m.addEventListener('change', on); return () => m.removeEventListener('change', on) }, [theme])
  const setTheme = useCallback((t: Theme) => { try { if (t === 'system') localStorage.removeItem(KEY); else localStorage.setItem(KEY, t) } catch { /* no storage */ }
    apply(t); listeners.forEach(l => l()) }, [])
  const resolved: 'light' | 'dark' = theme === 'system' ? (media().matches ? 'dark' : 'light') : theme
  return { theme, resolved, setTheme }
}
