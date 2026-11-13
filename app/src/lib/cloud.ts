/**
 * Supabase: cliente, login por código de email y estado de la sincronización para la UI.
 * Si faltan VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY, la app funciona como en la fase 1.
 */
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js'
import { useSyncExternalStore } from 'react'
import { getKv, setKv } from './db'
import { pendingCount, sync, type Remote, type RemoteLog, type RemoteState, type SyncResult } from './sync'

const URL = import.meta.env.VITE_SUPABASE_URL as string | undefined
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const supabase: SupabaseClient | null =
  URL && KEY
    ? createClient(URL, KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' } })
    : null

export const cloudConfigured = supabase !== null

const PAGE = 1000

class SupabaseRemote implements Remote {
  constructor(
    private client: SupabaseClient,
    private userId: string,
  ) {}

  private async pullAll<T>(table: string, since: string): Promise<T[]> {
    const out: T[] = []
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await this.client
        .from(table)
        .select('*')
        .gt('synced_at', since)
        .order('synced_at', { ascending: true })
        .range(from, from + PAGE - 1)
      if (error) throw new Error(error.message)
      out.push(...(data as T[]))
      if (!data || data.length < PAGE) return out
    }
  }

  pullStates(since: string) {
    return this.pullAll<RemoteState>('card_state', since)
  }

  pullLogs(since: string) {
    return this.pullAll<RemoteLog>('review_log', since)
  }

  async upsertStates(rows: RemoteState[]) {
    for (let i = 0; i < rows.length; i += PAGE) {
      const chunk = rows.slice(i, i + PAGE).map((r) => ({ ...r, user_id: this.userId }))
      const { error } = await this.client.from('card_state').upsert(chunk, { onConflict: 'user_id,key' })
      if (error) throw new Error(error.message)
    }
  }

  async insertLogs(rows: RemoteLog[]) {
    for (let i = 0; i < rows.length; i += PAGE) {
      const chunk = rows.slice(i, i + PAGE).map((r) => ({ ...r, user_id: this.userId }))
      const { error } = await this.client.from('review_log').upsert(chunk, { onConflict: 'id', ignoreDuplicates: true })
      if (error) throw new Error(error.message)
    }
  }

  async deleteLogs(ids: string[]) {
    const { error } = await this.client.from('review_log').delete().in('id', ids)
    if (error) throw new Error(error.message)
  }
}

// ---------- estado observable para React ----------

export interface CloudState {
  configured: boolean
  session: Session | null
  status: 'idle' | 'syncing' | 'error' | 'offline'
  error: string | null
  lastSync: string | null
  pending: number
}

let state: CloudState = {
  configured: cloudConfigured,
  session: null,
  status: 'idle',
  error: null,
  lastSync: null,
  pending: 0,
}
const listeners = new Set<() => void>()

function set(patch: Partial<CloudState>) {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}

export function useCloud(): CloudState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state,
  )
}

async function refreshPending() {
  set({ pending: await pendingCount() })
}

// ---------- sincronización ----------

let onChanged: (() => void) | null = null
let timer: number | undefined

/** Sincroniza ya. `onChanged` recarga los datos de la app si ha bajado algo. */
export async function syncNow(): Promise<SyncResult | null> {
  window.clearTimeout(timer)
  if (!supabase || !state.session) {
    await refreshPending()
    return null
  }
  if (!navigator.onLine) {
    set({ status: 'offline' })
    await refreshPending()
    return null
  }
  set({ status: 'syncing', error: null })
  try {
    const res = await sync(new SupabaseRemote(supabase, state.session.user.id))
    set({ status: 'idle', lastSync: new Date().toISOString() })
    if (res.changedLocal) onChanged?.()
    return res
  } catch (e) {
    set({ status: 'error', error: e instanceof Error ? e.message : String(e) })
    return null
  } finally {
    await refreshPending()
  }
}

/** Programa una sincronización en unos segundos (agrupa varios repasos seguidos). */
export function scheduleSync(delayMs = 4000) {
  void refreshPending()
  if (!supabase || !state.session) return
  window.clearTimeout(timer)
  timer = window.setTimeout(() => void syncNow(), delayMs)
}

/** Arranque: sesión guardada, eventos de red/visibilidad y sincronización periódica. */
export async function initCloud(reload: () => void) {
  onChanged = reload
  set({ lastSync: (await getKv<string>('lastSync')) ?? null })
  await refreshPending()
  if (!supabase) return

  const { data } = await supabase.auth.getSession()
  set({ session: data.session })
  supabase.auth.onAuthStateChange((event, session) => {
    const wasSignedIn = !!state.session
    set({ session })
    if (session && !wasSignedIn && event === 'SIGNED_IN') {
      // Login nuevo: bajar todo desde el principio (fuera del callback, como pide supabase-js)
      window.setTimeout(() => void setKv('syncCursor', null).then(() => syncNow()), 0)
    }
  })

  window.addEventListener('online', () => void syncNow())
  window.addEventListener('offline', () => set({ status: 'offline' }))
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void syncNow()
  })
  window.setInterval(() => void syncNow(), 5 * 60_000)
  if (data.session) void syncNow()
}

// ---------- login ----------

export async function sendLoginCode(email: string): Promise<void> {
  if (!supabase) throw new Error('Supabase no está configurado.')
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin, shouldCreateUser: true },
  })
  if (error) throw new Error(error.message)
}

export async function verifyLoginCode(email: string, code: string): Promise<void> {
  if (!supabase) throw new Error('Supabase no está configurado.')
  const { error } = await supabase.auth.verifyOtp({ email, token: code.trim(), type: 'email' })
  if (error) throw new Error(error.message)
}

export async function signOut(): Promise<void> {
  if (!supabase) return
  await supabase.auth.signOut()
  await setKv('syncCursor', null)
  set({ session: null, status: 'idle' })
}
