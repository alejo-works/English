/**
 * Prebuild: lee ../data/vocab.csv y ../data/errors.csv y genera public/cards.json.
 * Falla (exit 1) si falta una columna obligatoria o hay ids duplicados,
 * para que Cloudflare no publique una app con datos rotos.
 */
import { parse } from 'csv-parse/sync'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const dataDir = resolve(here, '../../data')
const outFile = resolve(here, '../public/cards.json')

const VOCAB_REQUIRED = ['id', 'english', 'spanish', 'example_en', 'type', 'area', 'register', 'date_added']
const ERRORS_REQUIRED = ['id', 'wrong', 'right', 'rule', 'category', 'date_added']

function read(name: string, required: string[]): Record<string, string>[] {
  const text = readFileSync(resolve(dataDir, name), 'utf8').replace(/^﻿/, '')
  const rows = parse(text, { columns: true, skip_empty_lines: true, trim: true }) as Record<string, string>[]
  const problems: string[] = []
  const seen = new Set<string>()
  rows.forEach((row, i) => {
    const line = i + 2
    for (const col of required) {
      if (!row[col]) problems.push(`${name}:${line}: falta '${col}'`)
    }
    if (seen.has(row.id)) problems.push(`${name}:${line}: id duplicado '${row.id}'`)
    seen.add(row.id)
  })
  if (problems.length) {
    console.error(problems.join('\n'))
    process.exit(1)
  }
  return rows
}

const vocab = read('vocab.csv', VOCAB_REQUIRED).map((r) => ({
  id: r.id,
  english: r.english,
  spanish: r.spanish,
  example_en: r.example_en,
  example_es: r.example_es ?? '',
  type: r.type,
  area: r.area,
  register: r.register,
  source: r.source ?? '',
  date_added: r.date_added,
  notes: r.notes ?? '',
}))

const errors = read('errors.csv', ERRORS_REQUIRED).map((r) => ({
  id: r.id,
  wrong: r.wrong,
  right: r.right,
  rule: r.rule,
  category: r.category,
  date_added: r.date_added,
}))

mkdirSync(dirname(outFile), { recursive: true })
writeFileSync(outFile, JSON.stringify({ generated_at: new Date().toISOString(), vocab, errors }))
console.log(`cards.json: ${vocab.length} vocab, ${errors.length} errores`)
