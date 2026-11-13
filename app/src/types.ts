import type { Card as FsrsCard, Rating, State } from 'ts-fsrs'

export type Kind = 'vocab' | 'error'

export type VocabType = 'word' | 'phrasal_verb' | 'idiom' | 'slang' | 'collocation' | 'chunk'
export type Area = 'tech_ai' | 'finance' | 'business' | 'daily' | 'nyc'
export type Register = 'formal' | 'neutral' | 'informal' | 'slang'

export interface VocabRow {
  id: string
  english: string
  spanish: string
  example_en: string
  example_es: string
  type: VocabType
  area: Area
  register: Register
  source: string
  date_added: string
  notes: string
}

export interface ErrorRow {
  id: string
  wrong: string
  right: string
  rule: string
  category: string
  date_added: string
}

export interface CardsFile {
  generated_at: string
  vocab: VocabRow[]
  errors: ErrorRow[]
}

/** Tarjeta lista para repasar: une el contenido del CSV con su clave de estado. */
export type DeckItem =
  | { key: string; kind: 'vocab'; order: number; data: VocabRow }
  | { key: string; kind: 'error'; order: number; data: ErrorRow }

/** Estado FSRS guardado en IndexedDB (store "states"). */
export interface CardStateRecord {
  key: string // `${kind}:${id}`
  kind: Kind
  id: string
  card: FsrsCard
  updated_at: string
  /** 1 = cambiado en este dispositivo y aún no subido a Supabase */
  dirty?: 0 | 1
}

/** Un repaso (store "logs"). */
export interface ReviewLogRecord {
  logId?: number
  /** uuid generado en el dispositivo; es el id en Supabase */
  uid: string
  /** 1 = ya está en Supabase */
  synced: 0 | 1
  key: string
  kind: Kind
  id: string
  rating: Rating
  /** Estado de la tarjeta ANTES de valorar */
  state: State
  review: string // ISO
  due: string // nuevo vencimiento ISO
  stability: number
  difficulty: number
  scheduled_days: number
  mode: ReviewMode
}

export type ReviewMode = 'normal' | 'inverse'
export type Theme = 'system' | 'light' | 'dark'

export interface Settings {
  theme: Theme
  newPerDay: number
  voiceURI: string
  speechRate: number
  mode: ReviewMode
  includeErrors: boolean
  retention: number
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  newPerDay: 20,
  voiceURI: '',
  speechRate: 0.95,
  mode: 'normal',
  includeErrors: true,
  retention: 0.9,
}

export interface Backup {
  app: 'english-deck'
  version: 1
  exported_at: string
  settings: Settings
  states: CardStateRecord[]
  logs: ReviewLogRecord[]
}
