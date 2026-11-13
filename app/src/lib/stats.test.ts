import { describe, expect, it } from 'vitest'
import { createEmptyCard } from 'ts-fsrs'
import type { CardStateRecord, DeckItem, ReviewLogRecord } from '../types'
import { activity, heatLevel, neglected, retention, struggles } from './stats'
import { Rating, State } from './scheduler'

const NOW = new Date('2026-11-13T18:00:00')
const d = (n: number) => new Date(NOW.getTime() - n * 864e5)
const item = (id: string): DeckItem => ({
  key: `vocab:${id}`,
  kind: 'vocab',
  order: 0,
  data: { id, english: id, spanish: id, example_en: '', example_es: '', type: 'word', area: 'daily', register: 'neutral', source: '', date_added: '', notes: '' },
})
const log = (id: string, rating: Rating, state: State, when: Date): ReviewLogRecord => ({
  uid: `${id}${when.getTime()}${rating}`, synced: 0, key: `vocab:${id}`, kind: 'vocab', id, rating, state,
  review: when.toISOString(), due: when.toISOString(), stability: 1, difficulty: 5, scheduled_days: 1, mode: 'normal',
})
const st = (id: string, lastDaysAgo: number, lapses = 0): CardStateRecord => ({
  key: `vocab:${id}`, kind: 'vocab', id, updated_at: '',
  card: { ...createEmptyCard(NOW), state: State.Review, last_review: d(lastDaysAgo), lapses },
})

describe('stats', () => {
  const logs = [
    log('a', Rating.Good, State.Review, d(1)),
    log('a', Rating.Again, State.Review, d(2)),
    log('b', Rating.Good, State.New, d(0)),
    log('b', Rating.Again, State.Learning, d(0)),
    log('c', Rating.Good, State.Review, d(40)), // fuera de los 30 días
  ]
  it('retención solo con tarjetas en repaso, últimos 30 días', () => {
    expect(retention(logs, NOW)).toEqual({ retention: 50, reviewCount: 2, accuracy: 50, total: 4 })
    expect(retention([], NOW).retention).toBeNull()
  })
  it('actividad por día', () => {
    const a = activity(logs, NOW, 3)
    expect(a.map((x) => x.count)).toEqual([1, 1, 2])
  })
  it('sin ver y lo que más fallo', () => {
    const items = [item('a'), item('b'), item('c')]
    const states = new Map([st('a', 10, 2), st('b', 2), st('c', 40)].map((s) => [s.key, s]))
    expect(neglected(items, states, NOW, 7).map((n) => [n.item.data.id, n.days])).toEqual([['c', 40], ['a', 10]])
    expect(struggles(items, states, logs).map((s) => [s.item.data.id, s.again, s.lapses])).toEqual([['a', 1, 2], ['b', 1, 0]])
  })
  it('heatLevel', () => {
    expect([0, 1, 6, 20, 50].map(heatLevel)).toEqual([0, 1, 2, 3, 4])
  })
})
