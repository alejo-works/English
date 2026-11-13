/**
 * Progreso local en IndexedDB.
 *  - states: estado FSRS por tarjeta (clave `${kind}:${id}`)
 *  - logs:   historial de repasos
 *  - kv:     ajustes
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { Backup, CardStateRecord, ReviewLogRecord, Settings } from '../types'
import { DEFAULT_SETTINGS } from '../types'
import { reviveCard } from './scheduler'

interface DeckDB extends DBSchema {
  states: { key: string; value: CardStateRecord }
  logs: { key: number; value: ReviewLogRecord; indexes: { by_key: string; by_review: string } }
  kv: { key: string; value: unknown }
}

let dbPromise: Promise<IDBPDatabase<DeckDB>> | null = null

export function db(): Promise<IDBPDatabase<DeckDB>> {
  if (!dbPromise) {
    dbPromise = openDB<DeckDB>('english-deck', 1, {
      upgrade(database) {
        database.createObjectStore('states', { keyPath: 'key' })
        const logs = database.createObjectStore('logs', { keyPath: 'logId', autoIncrement: true })
        logs.createIndex('by_key', 'key')
        logs.createIndex('by_review', 'review')
        database.createObjectStore('kv')
      },
    })
  }
  return dbPromise
}

export async function loadStates(): Promise<Map<string, CardStateRecord>> {
  const all = await (await db()).getAll('states')
  return new Map(all.map((r) => [r.key, { ...r, card: reviveCard(r.card) }]))
}

export async function loadLogs(): Promise<ReviewLogRecord[]> {
  return (await db()).getAll('logs')
}

export async function loadSettings(): Promise<Settings> {
  const saved = (await (await db()).get('kv', 'settings')) as Partial<Settings> | undefined
  return { ...DEFAULT_SETTINGS, ...saved }
}

export async function saveSettings(s: Settings): Promise<void> {
  await (await db()).put('kv', s, 'settings')
}

/** Guarda el nuevo estado y el log en una sola transacción. Devuelve el id del log. */
export async function saveReview(state: CardStateRecord, log: ReviewLogRecord): Promise<number> {
  const d = await db()
  const tx = d.transaction(['states', 'logs'], 'readwrite')
  await tx.objectStore('states').put(state)
  const logId = await tx.objectStore('logs').add(log)
  await tx.done
  return logId
}

/** Deshace un repaso: restaura el estado anterior (o lo borra si era nueva) y elimina el log. */
export async function undoReview(key: string, previous: CardStateRecord | undefined, logId: number): Promise<void> {
  const d = await db()
  const tx = d.transaction(['states', 'logs'], 'readwrite')
  if (previous) await tx.objectStore('states').put(previous)
  else await tx.objectStore('states').delete(key)
  await tx.objectStore('logs').delete(logId)
  await tx.done
}

export async function exportBackup(): Promise<Backup> {
  const d = await db()
  return {
    app: 'english-deck',
    version: 1,
    exported_at: new Date().toISOString(),
    settings: await loadSettings(),
    states: await d.getAll('states'),
    logs: await d.getAll('logs'),
  }
}

export function parseBackup(raw: unknown): Backup {
  const b = raw as Partial<Backup>
  if (!b || b.app !== 'english-deck' || b.version !== 1 || !Array.isArray(b.states) || !Array.isArray(b.logs)) {
    throw new Error('El archivo no es una copia de English Deck válida.')
  }
  return {
    app: 'english-deck',
    version: 1,
    exported_at: String(b.exported_at ?? ''),
    settings: { ...DEFAULT_SETTINGS, ...(b.settings ?? {}) },
    states: b.states.map((s) => ({ ...s, card: reviveCard(s.card) })),
    logs: b.logs,
  }
}

/** Sustituye todo el progreso local por el de la copia. */
export async function importBackup(backup: Backup): Promise<void> {
  const d = await db()
  const tx = d.transaction(['states', 'logs', 'kv'], 'readwrite')
  await tx.objectStore('states').clear()
  await tx.objectStore('logs').clear()
  for (const s of backup.states) await tx.objectStore('states').put(s)
  for (const l of backup.logs) await tx.objectStore('logs').put(l)
  await tx.objectStore('kv').put(backup.settings, 'settings')
  await tx.done
}

export async function resetProgress(): Promise<void> {
  const d = await db()
  const tx = d.transaction(['states', 'logs'], 'readwrite')
  await tx.objectStore('states').clear()
  await tx.objectStore('logs').clear()
  await tx.done
}
