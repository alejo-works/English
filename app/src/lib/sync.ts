/**
 * Sincronización local-first con Supabase.
 *
 * - Se repasa siempre contra IndexedDB; la red nunca bloquea.
 * - Estados: gana el más reciente por `updated_at` (momento del repaso en el dispositivo).
 * - Logs: solo se añaden; el `uid` generado en el dispositivo evita duplicados.
 * - Bajada incremental con `synced_at` (hora del servidor) y 5 min de solape por seguridad.
 */
import type { CardStateRecord, Kind, ReviewLogRecord, ReviewMode } from '../types'
import { db, getKv, setKv } from './db'
import { reviveCard, type Card } from './scheduler'

export interface RemoteState {
  key: string
  kind: Kind
  card_id: string
  state: number
  due: string
  last_review: string | null
  stability: number
  difficulty: number
  reps: number
  lapses: number
  card: Card | Record<string, unknown>
  updated_at: string
  synced_at?: string
}

export interface RemoteLog {
  id: string
  key: string
  kind: Kind
  card_id: string
  rating: number
  state: number
  review: string
  due: string
  stability: number
  difficulty: number
  scheduled_days: number
  mode: string
  synced_at?: string
}

/** Lo que la sincronización necesita del servidor (Supabase en la app, memoria en los tests). */
export interface Remote {
  pullStates(since: string): Promise<RemoteState[]>
  pullLogs(since: string): Promise<RemoteLog[]>
  upsertStates(rows: RemoteState[]): Promise<void>
  insertLogs(rows: RemoteLog[]): Promise<void>
  deleteLogs(ids: string[]): Promise<void>
}

export interface SyncResult {
  pulledStates: number
  pulledLogs: number
  pushedStates: number
  pushedLogs: number
  deletedLogs: number
  /** true si cambió algo en local y hay que recargar la vista */
  changedLocal: boolean
}

const OVERLAP_MS = 5 * 60_000
const EPOCH = '1970-01-01T00:00:00.000Z'

export function toRemoteState(s: CardStateRecord): RemoteState {
  return {
    key: s.key,
    kind: s.kind,
    card_id: s.id,
    state: s.card.state,
    due: s.card.due.toISOString(),
    last_review: s.card.last_review ? new Date(s.card.last_review).toISOString() : null,
    stability: s.card.stability,
    difficulty: s.card.difficulty,
    reps: s.card.reps,
    lapses: s.card.lapses,
    card: s.card,
    updated_at: s.updated_at,
  }
}

export function fromRemoteState(r: RemoteState): CardStateRecord {
  return { key: r.key, kind: r.kind, id: r.card_id, card: reviveCard(r.card), updated_at: r.updated_at, dirty: 0 }
}

export function toRemoteLog(l: ReviewLogRecord): RemoteLog {
  return {
    id: l.uid,
    key: l.key,
    kind: l.kind,
    card_id: l.id,
    rating: l.rating,
    state: l.state,
    review: l.review,
    due: l.due,
    stability: l.stability,
    difficulty: l.difficulty,
    scheduled_days: l.scheduled_days,
    mode: l.mode,
  }
}

export function fromRemoteLog(r: RemoteLog): ReviewLogRecord {
  return {
    uid: r.id,
    synced: 1,
    key: r.key,
    kind: r.kind,
    id: r.card_id,
    rating: r.rating as ReviewLogRecord['rating'],
    state: r.state as ReviewLogRecord['state'],
    review: new Date(r.review).toISOString(),
    due: new Date(r.due).toISOString(),
    stability: r.stability,
    difficulty: r.difficulty,
    scheduled_days: r.scheduled_days,
    mode: r.mode as ReviewMode,
  }
}

/** ¿Debe el estado remoto sustituir al local? Gana el más reciente; en empate, el local deja de estar pendiente. */
export function remoteWins(local: CardStateRecord | undefined, remote: RemoteState): 'replace' | 'clean' | 'keep' {
  if (!local) return 'replace'
  const l = new Date(local.updated_at).getTime()
  const r = new Date(remote.updated_at).getTime()
  if (r > l) return 'replace'
  if (r === l) return 'clean'
  return 'keep'
}

let running: Promise<SyncResult> | null = null

/** Sincroniza una vez. Si ya hay una en marcha, devuelve esa. */
export function sync(remote: Remote): Promise<SyncResult> {
  if (!running) running = doSync(remote).finally(() => (running = null))
  return running
}

async function doSync(remote: Remote): Promise<SyncResult> {
  const res: SyncResult = { pulledStates: 0, pulledLogs: 0, pushedStates: 0, pushedLogs: 0, deletedLogs: 0, changedLocal: false }
  const cursor = (await getKv<string>('syncCursor')) ?? null
  const since = cursor ? new Date(new Date(cursor).getTime() - OVERLAP_MS).toISOString() : EPOCH
  let maxSynced = cursor ?? EPOCH
  const bump = (t?: string) => {
    if (t && new Date(t).getTime() > new Date(maxSynced).getTime()) maxSynced = new Date(t).toISOString()
  }

  // 1. Bajar estados
  const remoteStates = await remote.pullStates(since)
  if (remoteStates.length) {
    const d = await db()
    const tx = d.transaction('states', 'readwrite')
    for (const r of remoteStates) {
      bump(r.synced_at)
      const local = await tx.store.get(r.key)
      const decision = remoteWins(local, r)
      if (decision === 'replace') {
        await tx.store.put(fromRemoteState(r))
        res.pulledStates++
        res.changedLocal = true
      } else if (decision === 'clean' && local?.dirty) {
        await tx.store.put({ ...local, dirty: 0 })
      }
    }
    await tx.done
  }

  // 2. Bajar logs (solo los que no tengo)
  const remoteLogs = await remote.pullLogs(since)
  if (remoteLogs.length) {
    const d = await db()
    const pendingDeletes = new Set((await getKv<string[]>('pendingLogDeletes')) ?? [])
    const tx = d.transaction('logs', 'readwrite')
    const idx = tx.store.index('by_uid')
    for (const r of remoteLogs) {
      bump(r.synced_at)
      if (pendingDeletes.has(r.id)) continue
      const existing = await idx.getKey(r.id)
      if (existing === undefined) {
        await tx.store.add(fromRemoteLog(r))
        res.pulledLogs++
        res.changedLocal = true
      }
    }
    await tx.done
  }

  // 3. Borrar logs deshechos
  const pendingDeletes = (await getKv<string[]>('pendingLogDeletes')) ?? []
  if (pendingDeletes.length) {
    await remote.deleteLogs(pendingDeletes)
    const after = ((await getKv<string[]>('pendingLogDeletes')) ?? []).filter((id) => !pendingDeletes.includes(id))
    await setKv('pendingLogDeletes', after)
    res.deletedLogs = pendingDeletes.length
  }

  // 4. Subir estados pendientes
  const d = await db()
  const dirty = await d.getAllFromIndex('states', 'by_dirty', 1)
  if (dirty.length) {
    await remote.upsertStates(dirty.map((s) => toRemoteState({ ...s, card: reviveCard(s.card) })))
    const tx = d.transaction('states', 'readwrite')
    for (const s of dirty) {
      const now = await tx.store.get(s.key)
      // Solo se limpia si no se ha vuelto a repasar mientras subía
      if (now && now.updated_at === s.updated_at) await tx.store.put({ ...now, dirty: 0 })
    }
    await tx.done
    res.pushedStates = dirty.length
  }

  // 5. Subir logs pendientes
  const unsynced = await d.getAllFromIndex('logs', 'by_synced', 0)
  if (unsynced.length) {
    await remote.insertLogs(unsynced.map(toRemoteLog))
    const tx = d.transaction('logs', 'readwrite')
    for (const l of unsynced) {
      const cur = await tx.store.get(l.logId!)
      if (cur) await tx.store.put({ ...cur, synced: 1 })
    }
    await tx.done
    res.pushedLogs = unsynced.length
  }

  await setKv('syncCursor', maxSynced)
  await setKv('lastSync', new Date().toISOString())
  return res
}

/** Cuántos cambios locales faltan por subir. */
export async function pendingCount(): Promise<number> {
  const d = await db()
  const [s, l] = await Promise.all([d.countFromIndex('states', 'by_dirty', 1), d.countFromIndex('logs', 'by_synced', 0)])
  const del = ((await getKv<string[]>('pendingLogDeletes')) ?? []).length
  return s + l + del
}
