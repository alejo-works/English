import { describe, expect, it } from 'vitest'
import { createEmptyCard } from 'ts-fsrs'
import type { CardStateRecord, DeckItem, ReviewLogRecord, VocabRow } from '../types'
import { DEFAULT_SETTINGS } from '../types'
import {
  buildQueue,
  dueOnDay,
  formatInterval,
  makeScheduler,
  pickNext,
  previewIntervals,
  Rating,
  reviveCard,
  State,
  stateKey,
  streak,
} from './scheduler'

const NOW = new Date('2026-11-13T18:00:00')

function vocab(id: string, order: number): DeckItem {
  const data: VocabRow = {
    id,
    english: id,
    spanish: id,
    example_en: id,
    example_es: '',
    type: 'word',
    area: 'daily',
    register: 'neutral',
    source: '',
    date_added: '2026-11-13',
    notes: '',
  }
  return { key: stateKey('vocab', id), kind: 'vocab', order, data }
}

function stateAt(item: DeckItem, due: Date, state: State): CardStateRecord {
  return {
    key: item.key,
    kind: item.kind,
    id: item.data.id,
    card: { ...createEmptyCard(NOW), due, state, stability: 3, difficulty: 5, reps: 1 },
    updated_at: NOW.toISOString(),
  }
}

function newLog(item: DeckItem, when: Date): ReviewLogRecord {
  return {
    uid: `${item.key}-${when.getTime()}`,
    synced: 0,
    key: item.key,
    kind: 'vocab',
    id: item.data.id,
    rating: Rating.Good,
    state: State.New,
    review: when.toISOString(),
    due: when.toISOString(),
    stability: 1,
    difficulty: 5,
    scheduled_days: 0,
    mode: 'normal',
  }
}

describe('buildQueue', () => {
  const items = Array.from({ length: 30 }, (_, i) => vocab(`w${i}`, i))

  it('limita las nuevas al cupo diario', () => {
    const q = buildQueue(items, new Map(), [], { ...DEFAULT_SETTINGS, newPerDay: 20 }, NOW)
    expect(q.newAvailable).toHaveLength(20)
    expect(q.newAvailable[0].data.id).toBe('w0')
  })

  it('descuenta las nuevas ya vistas hoy', () => {
    const logs = [newLog(items[0], NOW), newLog(items[1], NOW), newLog(items[1], NOW)]
    const states = new Map([items[0], items[1]].map((i) => [i.key, stateAt(i, new Date(NOW.getTime() + 864e5), State.Review)]))
    const q = buildQueue(items, states, logs, { ...DEFAULT_SETTINGS, newPerDay: 20 }, NOW)
    expect(q.newDoneToday).toBe(2)
    expect(q.newAvailable).toHaveLength(18)
  })

  it('separa vencidas, adelantables y futuras', () => {
    const states = new Map<string, CardStateRecord>([
      [items[0].key, stateAt(items[0], new Date(NOW.getTime() - 60_000), State.Review)],
      [items[1].key, stateAt(items[1], new Date(NOW.getTime() + 5 * 60_000), State.Learning)],
      [items[2].key, stateAt(items[2], new Date(NOW.getTime() + 5 * 60_000), State.Review)],
    ])
    const q = buildQueue(items, states, [], DEFAULT_SETTINGS, NOW)
    expect(q.dueNow.map((i) => i.data.id)).toEqual(['w0'])
    expect(q.learnAhead.map((i) => i.data.id)).toEqual(['w1'])
  })

  it('pickNext prioriza aprendizaje y luego mezcla repasos y nuevas', () => {
    const states = new Map<string, CardStateRecord>([
      [items[0].key, stateAt(items[0], new Date(NOW.getTime() - 1000), State.Review)],
      [items[1].key, stateAt(items[1], new Date(NOW.getTime() - 1000), State.Learning)],
    ])
    const q = buildQueue(items, states, [], DEFAULT_SETTINGS, NOW)
    expect(pickNext(q, states, 0)?.data.id).toBe('w1')
    const q2 = buildQueue(items, new Map([[items[0].key, states.get(items[0].key)!]]), [], DEFAULT_SETTINGS, NOW)
    expect(pickNext(q2, states, 0)?.data.id).toBe('w0')
    expect(pickNext(q2, states, 3)?.data.id).toBe('w1') // 1 de cada 4: nueva
  })

  it('excluye errores si includeErrors es false', () => {
    const err: DeckItem = {
      key: 'error:x',
      kind: 'error',
      order: 0,
      data: { id: 'x', wrong: 'a', right: 'b', rule: 'c', category: 'tense', date_added: '2026-11-13' },
    }
    const q = buildQueue([err], new Map(), [], { ...DEFAULT_SETTINGS, includeErrors: false }, NOW)
    expect(q.newAvailable).toHaveLength(0)
  })
})

describe('FSRS', () => {
  it('una tarjeta nueva da intervalos crecientes Again < Hard ≤ Good < Easy', () => {
    const f = makeScheduler(0.9)
    const card = createEmptyCard(NOW)
    const preview = f.repeat(card, NOW)
    const ms = [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy].map((g) => preview[g as 1].card.due.getTime())
    expect(ms[0]).toBeLessThan(ms[1])
    expect(ms[1]).toBeLessThanOrEqual(ms[2])
    expect(ms[2]).toBeLessThan(ms[3])
    const labels = previewIntervals(f, card, NOW)
    expect(labels[Rating.Again]).toMatch(/min/)
  })

  it('reviveCard convierte fechas de JSON a Date', () => {
    const c = JSON.parse(JSON.stringify(createEmptyCard(NOW)))
    const r = reviveCard(c)
    expect(r.due).toBeInstanceOf(Date)
    expect(r.due.getTime()).toBe(NOW.getTime())
  })
})

describe('utilidades', () => {
  it('formatInterval', () => {
    expect(formatInterval(60_000)).toBe('1 min')
    expect(formatInterval(10 * 60_000)).toBe('10 min')
    expect(formatInterval(3 * 3600_000)).toBe('3 h')
    expect(formatInterval(3 * 864e5)).toBe('3 d')
    expect(formatInterval(45 * 864e5)).toBe('1.5 mes')
    expect(formatInterval(400 * 864e5)).toBe('1.1 a')
  })

  it('streak cuenta días seguidos aunque hoy no haya repasos', () => {
    const it0 = vocab('a', 0)
    const day = (n: number) => new Date(NOW.getTime() - n * 864e5)
    expect(streak([newLog(it0, day(1)), newLog(it0, day(2)), newLog(it0, day(4))], NOW)).toBe(2)
    expect(streak([newLog(it0, day(0)), newLog(it0, day(1))], NOW)).toBe(2)
    expect(streak([], NOW)).toBe(0)
  })

  it('dueOnDay: hoy incluye atrasadas, mañana solo mañana', () => {
    const its = [vocab('a', 0), vocab('b', 1), vocab('c', 2)]
    const states = new Map<string, CardStateRecord>([
      [its[0].key, stateAt(its[0], new Date(NOW.getTime() - 3 * 864e5), State.Review)],
      [its[1].key, stateAt(its[1], new Date(NOW.getTime() + 864e5), State.Review)],
    ])
    expect(dueOnDay(its, states, NOW, 0)).toBe(1)
    expect(dueOnDay(its, states, NOW, 1)).toBe(1)
  })
})
