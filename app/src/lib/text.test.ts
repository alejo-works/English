import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse } from 'csv-parse/sync'
import { describe, expect, it } from 'vitest'
import { diffWords, findCloze } from './text'

describe('diffWords', () => {
  it('perfecta aunque cambien mayúsculas, puntuación y apóstrofo', () => {
    const r = diffWords('i wanted to follow up on what we discussed', 'I wanted to follow up on what we discussed.')
    expect(r.perfect).toBe(true)
    expect(r.score).toBe(1)
    expect(diffWords("Ive lived here", "I've lived here").perfect).toBe(false)
    expect(diffWords('I’ve lived here', "I've lived here").perfect).toBe(true)
  })

  it('marca faltas y sobras', () => {
    const r = diffWords('I have sent it yesterday', 'I sent it yesterday.')
    expect(r.parts).toEqual([
      { kind: 'ok', text: 'I' },
      { kind: 'extra', text: 'have' },
      { kind: 'ok', text: 'sent' },
      { kind: 'ok', text: 'it' },
      { kind: 'ok', text: 'yesterday.' },
    ])
    expect(r.score).toBe(1)
    expect(r.perfect).toBe(false)
    const missing = diffWords('I want check the code', 'I want you to check the code.')
    expect(missing.parts.filter((p) => p.kind === 'missing').map((p) => p.text)).toEqual(['you', 'to'])
    expect(missing.score).toBeCloseTo(5 / 7)
  })

  it('respuesta vacía', () => {
    expect(diffWords('', 'Hello there').score).toBe(0)
  })
})

describe('findCloze', () => {
  it('casos concretos', () => {
    expect(findCloze('follow up on', 'I wanted to follow up on what we discussed.')).toEqual({
      before: 'I wanted to ',
      hidden: 'follow up on',
      after: ' what we discussed.',
    })
    expect(findCloze('reach out (to)', 'If you have any questions, feel free to reach out.')?.hidden).toBe('reach out')
    expect(findCloze('fine-tune', 'We fine-tuned the model on our support tickets.')?.hidden).toBe('fine-tuned')
    expect(findCloze('roll out', "We're going to roll this out next week.")?.hidden).toBe('roll this out')
    expect(findCloze('be on the same page', "I just want to make sure we're on the same page.")?.hidden).toBe('on the same page')
    expect(findCloze('deadass', 'Deadass, that was the best pizza.')).toEqual({ before: '', hidden: 'Deadass', after: ', that was the best pizza.' })
    expect(findCloze('xyz', 'Nothing here.')).toBeNull()
  })

  it('encuentra el hueco en todas las tarjetas de vocab.csv', () => {
    const csv = readFileSync(resolve(__dirname, '../../../data/vocab.csv'), 'utf8')
    const rows = parse(csv, { columns: true }) as { id: string; english: string; example_en: string }[]
    const misses = rows.filter((r) => !findCloze(r.english, r.example_en)).map((r) => r.id)
    expect(misses).toEqual([])
  })
})
