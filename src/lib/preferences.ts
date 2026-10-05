export type Preferences = {
  sound: boolean; music: boolean; volume: number; musicVolume: number
  effects: boolean; reducedMotion: boolean; simpleOrders: boolean
}
const defaults: Preferences = { sound: true, music: true, volume: 55, musicVolume: 22, effects: true, reducedMotion: false, simpleOrders: true }
let value: Preferences = { ...defaults }
try {
  const stored = JSON.parse(localStorage.getItem('peris-settings') || '{}')
  for (const key of ['sound', 'music', 'effects', 'reducedMotion', 'simpleOrders'] as const)
    if (typeof stored[key] === 'boolean') value[key] = stored[key]
  for (const key of ['volume', 'musicVolume'] as const)
    if (Number.isFinite(stored[key])) value[key] = Math.max(0, Math.min(100, stored[key]))
  if (localStorage.getItem('peris-sound') === 'off') value.sound = false
} catch { /* Defaults keep the game available in private browsers. */ }
const listeners = new Set<() => void>()
export const preferences = () => value
export const subscribePreferences = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } }
export function setPreferences(patch: Partial<Preferences>) {
  value = { ...value, ...patch }
  try { localStorage.setItem('peris-settings', JSON.stringify(value)); localStorage.removeItem('peris-sound') } catch { /* Optional persistence. */ }
  listeners.forEach(fn => fn())
}
