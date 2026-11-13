/**
 * Progreso local en IndexedDB (fuente de verdad en el dispositivo; Supabase se sincroniza aparte).
 *  - states: estado FSRS por tarjeta (clave `${kind}:${id}`), con `dirty` si falta subirlo
 *  - logs:   historial de repasos, con `uid` (id en Supabase) y `synced`
 *  - kv:     ajustes, cursor de sincronización y borrados pendientes
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import { createEmptyCard } from 'ts-fsrs'
import type { Backup, CardStateRecord, ReviewLogRecord, Settings } from '../types'
import { DEFAULT_SETTINGS } from '../types'
import { reviveCard } from './scheduler'

interface DeckDB extends DBSchema {
  states: { key: string; value: CardStateRecord; indexes: { by_dirty: number } }
  logs: {
    key: number
    value: ReviewLogRecord
    indexes: { by_key: string; by_review: string; by_uid: string; by_synced: number }
  }
  kv: { key: string; value: unknown }
}

let dbName = 'english-deck'
let dbPromise: Promise<IDBPDatabase<DeckDB>> | null = null

/** Solo para tests: usar otra base de datos (simula otro dispositivo). */
export function useDatabase(name: string): void {
  dbName = name
  dbPromise = null
}

export function newUid(): string {
  return crypto.randomUUID()
}

export function db(): Promise<IDBPDatabase<DeckDB>> {
  if (!dbPromise) {
    dbPromise = openDB<DeckDB>(dbName, 2, {
      async upgrade(database, oldVersion, _newVersion, tx) {
        if (oldVersion < 1) {
          database.createObjectStore('states', { keyPath: 'key' })
          const logs = database.createObjectStore('logs', { keyPath: 'logId', autoIncrement: true })
          logs.createIndex('by_key', 'key')
          logs.createIndex('by_review', 'review')
          database.createObjectStore('kv')
        }
        if (oldVersion < 2) {
          // Fase 2: marcar todo lo de la fase 1 como pendiente de subir
          const states = tx.objectStore('states')
          states.createIndex('by_dirty', 'dirty')
          const logs = tx.objectStore('logs')
          logs.createIndex('by_uid', 'uid', { unique: true })
          logs.createIndex('by_synced', 'synced')
          let sc = await states.openCursor()
          while (sc) {
            await sc.update({ ...sc.value, dirty: 1 })
            sc = await sc.continue()
          }
          let lc = await logs.openCursor()
          while (lc) {
            await lc.update({ ...lc.value, uid: lc.value.uid ?? newUid(), synced: 0 })
            lc = await lc.continue()
          }
        }
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

export async function getKv<T>(key: string): Promise<T | undefined> {
  return (await (await db()).get('kv', key)) as T | undefined
}

export async function setKv(key: string, value: unknown): Promise<void> {
  await (await db()).put('kv', value, key)
}

/** Guarda el nuevo estado y el log en una sola transacción. Devuelve el id local del log. */
export async function saveReview(state: CardStateRecord, log: ReviewLogRecord): Promise<number> {
  const d = await db()
  const tx = d.transaction(['states', 'logs'], 'readwrite')
  await tx.objectStore('states').put({ ...state, dirty: 1 })
  const logId = await tx.objectStore('logs').add({ ...log, synced: 0 })
  await tx.done
  return logId
}

/**
 * Deshace un repaso: restaura el estado anterior (o deja la tarjeta como nueva) con fecha de ahora,
 * para que gane al sincronizar, y elimina el log. Si el log ya estaba en Supabase, se apunta su borrado.
 * Devuelve el estado restaurado.
 */
export async function undoReview(
  key: string,
  previous: CardStateRecord | undefined,
  logId: number,
  fallback: { kind: CardStateRecord['kind']; id: string },
): Promise<CardStateRecord> {
  const d = await db()
  const now = new Date()
  const restored: CardStateRecord = previous
    ? { ...previous, updated_at: now.toISOString(), dirty: 1 }
    : { key, kind: fallback.kind, id: fallback.id, card: createEmptyCard(now), updated_at: now.toISOString(), dirty: 1 }
  const tx = d.transaction(['states', 'logs', 'kv'], 'readwrite')
  const log = await tx.objectStore('logs').get(logId)
  await tx.objectStore('states').put(restored)
  await tx.objectStore('logs').delete(logId)
  if (log?.synced) {
    const pending = ((await tx.objectStore('kv').get('pendingLogDeletes')) as string[] | undefined) ?? []
    await tx.objectStore('kv').put([...pending, log.uid], 'pendingLogDeletes')
  }
  await tx.done
  return restored
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
    logs: b.logs.map((l) => ({ ...l, uid: l.uid ?? newUid() })),
  }
}

/** Sustituye todo el progreso local por el de la copia (y lo deja pendiente de subir). */
export async function importBackup(backup: Backup): Promise<void> {
  const d = await db()
  const tx = d.transaction(['states', 'logs', 'kv'], 'readwrite')
  await tx.objectStore('states').clear()
  await tx.objectStore('logs').clear()
  for (const s of backup.states) await tx.objectStore('states').put({ ...s, dirty: 1 })
  for (const l of backup.logs) await tx.objectStore('logs').put({ ...l, synced: 0 })
  await tx.objectStore('kv').put(backup.settings, 'settings')
  await tx.done
}

/** Borra el progreso local. Si hay sesión, la siguiente sincronización lo vuelve a bajar de Supabase. */
export async function resetProgress(): Promise<void> {
  const d = await db()
  const tx = d.transaction(['states', 'logs', 'kv'], 'readwrite')
  await tx.objectStore('states').clear()
  await tx.objectStore('logs').clear()
  await tx.objectStore('kv').delete('syncCursor')
  await tx.objectStore('kv').delete('pendingLogDeletes')
  await tx.done
}
