/** Cálculos de la pestaña Progreso (puros, testeables). */
import type { CardStateRecord, DeckItem, ReviewLogRecord } from '../types'
import { addDays, dayKey, dueOnDay, Rating, startOfDay, State } from './scheduler'

export interface Retention {
  /** % de aciertos en tarjetas que ya estaban en repaso (retención real) */
  retention: number | null
  reviewCount: number
  /** % de aciertos en todos los repasos */
  accuracy: number | null
  total: number
}

export function retention(logs: ReviewLogRecord[], now: Date, days = 30): Retention {
  const since = addDays(startOfDay(now), -days + 1).getTime()
  const recent = logs.filter((l) => new Date(l.review).getTime() >= since)
  const mature = recent.filter((l) => l.state === State.Review)
  const pct = (xs: ReviewLogRecord[]) => (xs.length ? Math.round((xs.filter((l) => l.rating !== Rating.Again).length / xs.length) * 100) : null)
  return { retention: pct(mature), reviewCount: mature.length, accuracy: pct(recent), total: recent.length }
}

/** Repasos por día de los últimos `days` días (incluido hoy), del más antiguo al más reciente. */
export function activity(logs: ReviewLogRecord[], now: Date, days: number): { day: Date; key: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const l of logs) {
    const k = dayKey(new Date(l.review))
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  const start = addDays(startOfDay(now), -days + 1)
  return Array.from({ length: days }, (_, i) => {
    const day = addDays(start, i)
    const key = dayKey(day)
    return { day, key, count: counts.get(key) ?? 0 }
  })
}

export function forecast(items: DeckItem[], states: Map<string, CardStateRecord>, now: Date, days: number): { day: Date; count: number }[] {
  return Array.from({ length: days }, (_, i) => ({ day: addDays(startOfDay(now), i), count: dueOnDay(items, states, now, i) }))
}

export interface Neglected {
  item: DeckItem
  days: number
}

/** Tarjetas ya vistas cuyo último repaso fue hace más de `minDays` días. */
export function neglected(items: DeckItem[], states: Map<string, CardStateRecord>, now: Date, minDays: number): Neglected[] {
  const out: Neglected[] = []
  for (const item of items) {
    const rec = states.get(item.key)
    if (!rec || rec.card.state === State.New || !rec.card.last_review) continue
    const days = Math.floor((now.getTime() - new Date(rec.card.last_review).getTime()) / 86_400_000)
    if (days >= minDays) out.push({ item, days })
  }
  return out.sort((a, b) => b.days - a.days)
}

export interface Struggle {
  item: DeckItem
  again: number
  lapses: number
}

/** Lo que más fallo: veces que pulsé Again + olvidos (lapses). */
export function struggles(items: DeckItem[], states: Map<string, CardStateRecord>, logs: ReviewLogRecord[], top = 10): Struggle[] {
  const again = new Map<string, number>()
  for (const l of logs) if (l.rating === Rating.Again) again.set(l.key, (again.get(l.key) ?? 0) + 1)
  return items
    .map((item) => ({ item, again: again.get(item.key) ?? 0, lapses: states.get(item.key)?.card.lapses ?? 0 }))
    .filter((s) => s.again + s.lapses > 0)
    .sort((a, b) => b.again + b.lapses - (a.again + a.lapses) || b.lapses - a.lapses)
    .slice(0, top)
}

/** Nivel 0-4 para el calendario de actividad. */
export function heatLevel(count: number): 0 | 1 | 2 | 3 | 4 {
  if (count === 0) return 0
  if (count <= 5) return 1
  if (count <= 15) return 2
  if (count <= 30) return 3
  return 4
}
