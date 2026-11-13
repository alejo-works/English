/**
 * Lógica pura de repaso (sin IndexedDB ni React) para poder testearla.
 */
import { createEmptyCard, fsrs, Rating, State, type Card, type FSRS, type Grade } from 'ts-fsrs'
import type { CardStateRecord, DeckItem, ReviewLogRecord, Settings } from '../types'

export { Rating, State }
export type { Card, Grade }

/** Si no queda nada vencido, se adelantan tarjetas en aprendizaje que venzan en estos minutos (como Anki). */
export const LEARN_AHEAD_MIN = 20

export function makeScheduler(retention: number): FSRS {
  return fsrs({ request_retention: retention, enable_fuzz: true, enable_short_term: true })
}

export function stateKey(kind: 'vocab' | 'error', id: string): string {
  return `${kind}:${id}`
}

export function startOfDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}

export function dayKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Convierte una tarjeta que viene de JSON (fechas como string) a Card con Date. */
export function reviveCard(c: Card | Record<string, unknown>): Card {
  const card = c as Card & { due: Date | string; last_review?: Date | string | null }
  return {
    ...card,
    due: new Date(card.due),
    last_review: card.last_review ? new Date(card.last_review) : undefined,
  } as Card
}

export function cardFor(item: DeckItem, states: Map<string, CardStateRecord>, now: Date): Card {
  return states.get(item.key)?.card ?? createEmptyCard(now)
}

export function isNew(item: DeckItem, states: Map<string, CardStateRecord>): boolean {
  const rec = states.get(item.key)
  return !rec || rec.card.state === State.New
}

export interface QueueInfo {
  /** Tarjetas ya vistas que vencen ahora o antes */
  dueNow: DeckItem[]
  /** Tarjetas nuevas que aún caben en el cupo de hoy */
  newAvailable: DeckItem[]
  /** En aprendizaje, vencen en los próximos LEARN_AHEAD_MIN minutos */
  learnAhead: DeckItem[]
  newDoneToday: number
}

export function activeItems(items: DeckItem[], settings: Settings): DeckItem[] {
  return settings.includeErrors ? items : items.filter((i) => i.kind === 'vocab')
}

export function countNewToday(logs: ReviewLogRecord[], now: Date): number {
  const today = dayKey(now)
  const keys = new Set<string>()
  for (const l of logs) {
    if (l.state === State.New && dayKey(new Date(l.review)) === today) keys.add(l.key)
  }
  return keys.size
}

export function buildQueue(
  items: DeckItem[],
  states: Map<string, CardStateRecord>,
  logs: ReviewLogRecord[],
  settings: Settings,
  now: Date,
): QueueInfo {
  const active = activeItems(items, settings)
  const nowMs = now.getTime()
  const aheadMs = nowMs + LEARN_AHEAD_MIN * 60_000

  const dueNow: DeckItem[] = []
  const learnAhead: DeckItem[] = []
  const fresh: DeckItem[] = []

  for (const item of active) {
    const rec = states.get(item.key)
    if (!rec || rec.card.state === State.New) {
      fresh.push(item)
      continue
    }
    const due = rec.card.due.getTime()
    if (due <= nowMs) dueNow.push(item)
    else if (rec.card.state !== State.Review && due <= aheadMs) learnAhead.push(item)
  }

  const byDue = (a: DeckItem, b: DeckItem) =>
    states.get(a.key)!.card.due.getTime() - states.get(b.key)!.card.due.getTime()
  dueNow.sort(byDue)
  learnAhead.sort(byDue)
  // Nuevas: vocabulario antes que errores, en el orden del CSV
  fresh.sort((a, b) => (a.kind === b.kind ? a.order - b.order : a.kind === 'vocab' ? -1 : 1))

  const newDoneToday = countNewToday(logs, now)
  const quota = Math.max(0, settings.newPerDay - newDoneToday)
  return { dueNow, newAvailable: fresh.slice(0, quota), learnAhead, newDoneToday }
}

/**
 * Siguiente tarjeta: primero las vencidas en aprendizaje, luego mezcla repasos y nuevas
 * (una nueva cada 3 repasos para no dejarlas siempre al final), y por último el aprendizaje adelantado.
 */
export function pickNext(q: QueueInfo, states: Map<string, CardStateRecord>, reviewedInSession: number): DeckItem | null {
  const learning = q.dueNow.filter((i) => {
    const s = states.get(i.key)!.card.state
    return s === State.Learning || s === State.Relearning
  })
  if (learning.length) return learning[0]
  const reviews = q.dueNow
  if (reviews.length && q.newAvailable.length) {
    return reviewedInSession % 4 === 3 ? q.newAvailable[0] : reviews[0]
  }
  if (reviews.length) return reviews[0]
  if (q.newAvailable.length) return q.newAvailable[0]
  if (q.learnAhead.length) return q.learnAhead[0]
  return null
}

export function formatInterval(ms: number): string {
  const min = Math.max(1, Math.round(ms / 60_000))
  if (min < 60) return `${min} min`
  const h = Math.round(min / 60)
  if (h < 24) return `${h} h`
  const d = Math.round(ms / 86_400_000)
  if (d < 30) return `${d} d`
  const mo = d / 30.4
  if (mo < 12) return `${mo.toFixed(mo < 10 ? 1 : 0).replace('.0', '')} mes`
  const y = d / 365
  return `${y.toFixed(1).replace('.0', '')} a`
}

export const GRADES: { grade: Grade; label: string; key: string }[] = [
  { grade: Rating.Again, label: 'Again', key: '1' },
  { grade: Rating.Hard, label: 'Hard', key: '2' },
  { grade: Rating.Good, label: 'Good', key: '3' },
  { grade: Rating.Easy, label: 'Easy', key: '4' },
]

export function previewIntervals(f: FSRS, card: Card, now: Date): Record<number, string> {
  const preview = f.repeat(card, now)
  const out: Record<number, string> = {}
  for (const { grade } of GRADES) {
    out[grade] = formatInterval(preview[grade].card.due.getTime() - now.getTime())
  }
  return out
}

/** Días seguidos con al menos un repaso, terminando hoy (o ayer si hoy aún no has repasado). */
export function streak(logs: ReviewLogRecord[], now: Date): number {
  const days = new Set(logs.map((l) => dayKey(new Date(l.review))))
  let cursor = startOfDay(now)
  if (!days.has(dayKey(cursor))) cursor = addDays(cursor, -1)
  let n = 0
  while (days.has(dayKey(cursor))) {
    n++
    cursor = addDays(cursor, -1)
  }
  return n
}

/** Cuántas tarjetas ya vistas vencen en el día `offset` (0 = hoy, incluye atrasadas; 1 = mañana). */
export function dueOnDay(items: DeckItem[], states: Map<string, CardStateRecord>, now: Date, offset: number): number {
  const start = addDays(startOfDay(now), offset).getTime()
  const end = addDays(startOfDay(now), offset + 1).getTime()
  let n = 0
  for (const item of items) {
    const rec = states.get(item.key)
    if (!rec || rec.card.state === State.New) continue
    const due = rec.card.due.getTime()
    if (due < end && (offset === 0 || due >= start)) n++
  }
  return n
}

export const STATE_LABEL: Record<State, string> = {
  [State.New]: 'nueva',
  [State.Learning]: 'aprendiendo',
  [State.Review]: 'repaso',
  [State.Relearning]: 'reaprendiendo',
}
