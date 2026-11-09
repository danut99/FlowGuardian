import { useSyncExternalStore } from 'react'

const KEY = 'fg-dev-mode'
const EVENT = 'fg-dev-mode'

const subscribe = (cb: () => void) => {
  window.addEventListener(EVENT, cb)
  window.addEventListener('storage', cb)
  return () => {
    window.removeEventListener(EVENT, cb)
    window.removeEventListener('storage', cb)
  }
}

export function useDevMode(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(subscribe, () => localStorage.getItem(KEY) === '1')
  const set = (v: boolean) => {
    localStorage.setItem(KEY, v ? '1' : '0')
    window.dispatchEvent(new Event(EVENT))
  }
  return [on, set]
}
