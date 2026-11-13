import type { Area, Register, VocabType } from '../types'

export const TYPE_LABEL: Record<VocabType, string> = {
  word: 'palabra',
  phrasal_verb: 'phrasal verb',
  idiom: 'idiom',
  slang: 'slang',
  collocation: 'collocation',
  chunk: 'chunk',
}

export const AREA_LABEL: Record<Area, string> = {
  tech_ai: 'Tech / IA',
  finance: 'Finanzas',
  business: 'Negocio',
  daily: 'Día a día',
  nyc: 'NYC',
}

export const REGISTER_LABEL: Record<Register, string> = {
  formal: 'formal',
  neutral: 'neutral',
  informal: 'informal',
  slang: 'slang',
}
