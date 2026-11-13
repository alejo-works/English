import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { createEmptyCard, fsrs, Rating, type Card } from 'ts-fsrs'
import type { CardStateRecord, ReviewLogRecord } from '../types'
import { db, loadLogs, loadStates, newUid, resetProgress, saveReview, undoReview, useDatabase } from './db'
import { remoteWins, sync, type Remote, type RemoteLog, type RemoteState } from './sync'

/** Servidor falso con la misma semántica que el SQL: synced_at lo pone el servidor, upsert por clave. */
class MemoryRemote implements Remote {
  states = new Map<string, RemoteState>()
  logs = new Map<string, RemoteLog>()
  private clock = Date.parse('2026-11-13T10:00:00Z')
  private stamp() {
    this.clock += 1000
    return new Date(this.clock).toISOString()
  }
  async pullStates(since: string) {
    return [...this.states.values()].filter((s) => s.synced_at! > since)
  }
  async pullLogs(since: string) {
    return [...this.logs.values()].filter((l) => l.synced_at! > since)
  }
  async upsertStates(rows: RemoteState[]) {
    for (const r of rows) this.states.set(r.key, JSON.parse(JSON.stringify({ ...r, synced_at: this.stamp() })))
  }
  async insertLogs(rows: RemoteLog[]) {
    for (const r of rows) if (!this.logs.has(r.id)) this.logs.set(r.id, { ...r, synced_at: this.stamp() })
  }
  async deleteLogs(ids: string[]) {
    ids.forEach((id) => this.logs.delete(id))
  }
}

const f = fsrs()
let n = 0

async function review(key: string, at: Date, rating: Rating.Again | Rating.Good = Rating.Good) {
  const states = await loadStates()
  const prev: Card = states.get(key)?.card ?? createEmptyCard<Card>(at)
  const { card, log } = f.next(prev, at, rating)
  const id = key.split(':')[1]
  const rec: CardStateRecord = { key, kind: 'vocab', id, card, updated_at: at.toISOString() }
  const l: ReviewLogRecord = {
    uid: newUid(),
    synced: 0,
    key,
    kind: 'vocab',
    id,
    rating,
    state: prev.state,
    review: at.toISOString(),
    due: card.due.toISOString(),
    stability: card.stability,
    difficulty: card.difficulty,
    scheduled_days: log.scheduled_days,
    mode: 'normal',
  }
  const logId = await saveReview(rec, l)
  return { prev: states.get(key), logId, rec }
}

const T = (h: number) => new Date(Date.UTC(2026, 10, 13, h))

describe('sincronización', () => {
  let remote: MemoryRemote
  beforeEach(() => {
    remote = new MemoryRemote()
    useDatabase(`movil-${++n}`)
  })
  const device = (name: string) => useDatabase(`${name}-${n}`)

  it('sube repasos y estados, y otro dispositivo los baja', async () => {
    device('movil')
    await review('vocab:a', T(9))
    await review('vocab:b', T(9))
    const r1 = await sync(remote)
    expect(r1).toMatchObject({ pushedStates: 2, pushedLogs: 2 })
    expect(remote.states.size).toBe(2)
    // segunda sync no sube nada
    expect(await sync(remote)).toMatchObject({ pushedStates: 0, pushedLogs: 0, changedLocal: false })

    device('pc')
    const r2 = await sync(remote)
    expect(r2).toMatchObject({ pulledStates: 2, pulledLogs: 2, changedLocal: true })
    const states = await loadStates()
    expect(states.get('vocab:a')?.card.due).toBeInstanceOf(Date)
    expect(states.get('vocab:a')?.dirty).toBe(0)
    expect(await loadLogs()).toHaveLength(2)
  })

  it('gana el repaso más reciente aunque se suba antes el otro', async () => {
    device('movil')
    await review('vocab:a', T(12), Rating.Again)
    device('pc')
    await review('vocab:a', T(10), Rating.Good)
    await sync(remote) // pc sube el suyo (más antiguo)
    device('movil')
    await sync(remote) // móvil baja el del pc pero conserva el suyo (más nuevo) y lo sube
    expect(remote.states.get('vocab:a')!.updated_at).toBe(T(12).toISOString())
    device('pc')
    await sync(remote)
    const s = (await loadStates()).get('vocab:a')!
    expect(s.updated_at).toBe(T(12).toISOString())
    expect(await loadLogs()).toHaveLength(2) // ambos repasos quedan en el historial
  })

  it('deshacer un repaso ya subido lo borra en Supabase', async () => {
    device('movil')
    const { prev, logId } = await review('vocab:a', T(9))
    await sync(remote)
    expect(remote.logs.size).toBe(1)
    const restored = await undoReview('vocab:a', prev, logId, { kind: 'vocab', id: 'a' })
    expect(restored.card.state).toBe(0) // vuelve a nueva
    const r = await sync(remote)
    expect(r.deletedLogs).toBe(1)
    expect(remote.logs.size).toBe(0)
    expect(remote.states.get('vocab:a')!.state).toBe(0)
  })

  it('migra datos de la fase 1 (sin uid ni dirty) y los sube', async () => {
    const name = `fase1-${n}`
    // crea una BD v1 a mano
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(name, 1)
      req.onupgradeneeded = () => {
        const d = req.result
        d.createObjectStore('states', { keyPath: 'key' }).put({
          key: 'vocab:a', kind: 'vocab', id: 'a', card: createEmptyCard(T(8)), updated_at: T(8).toISOString(),
        })
        const logs = d.createObjectStore('logs', { keyPath: 'logId', autoIncrement: true })
        logs.createIndex('by_key', 'key')
        logs.createIndex('by_review', 'review')
        logs.put({ key: 'vocab:a', kind: 'vocab', id: 'a', rating: 3, state: 0, review: T(8).toISOString(), due: T(9).toISOString(), stability: 1, difficulty: 5, scheduled_days: 0, mode: 'normal' })
        d.createObjectStore('kv')
      }
      req.onsuccess = () => { req.result.close(); resolve() }
      req.onerror = () => reject(req.error)
    })
    useDatabase(name)
    const logs = await loadLogs()
    expect(logs[0].uid).toMatch(/^[0-9a-f-]{36}$/)
    expect(await sync(remote)).toMatchObject({ pushedStates: 1, pushedLogs: 1 })
  })

  it('borrar progreso con sesión vuelve a bajarlo todo', async () => {
    device('movil')
    await review('vocab:a', T(9))
    await sync(remote)
    await resetProgress()
    expect((await loadStates()).size).toBe(0)
    await sync(remote)
    expect((await loadStates()).size).toBe(1)
    expect(await loadLogs()).toHaveLength(1)
    await (await db()).close()
  })

  it('remoteWins', () => {
    const local = { updated_at: T(10).toISOString() } as CardStateRecord
    expect(remoteWins(undefined, { updated_at: T(1).toISOString() } as RemoteState)).toBe('replace')
    expect(remoteWins(local, { updated_at: T(11).toISOString() } as RemoteState)).toBe('replace')
    expect(remoteWins(local, { updated_at: T(10).toISOString() } as RemoteState)).toBe('clean')
    expect(remoteWins(local, { updated_at: T(9).toISOString() } as RemoteState)).toBe('keep')
  })
})
