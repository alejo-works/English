import { useMemo, useState } from 'react'
import type { DeckData } from '../App'
import type { DeckItem } from '../types'
import { formatInterval, State, STATE_LABEL } from '../lib/scheduler'
import { AREA_LABEL, REGISTER_LABEL, TYPE_LABEL } from '../lib/labels'
import RegisterBadge from '../components/RegisterBadge'

type Section = 'vocab' | 'error'

function normalize(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

export default function Library({ data, onPracticeErrors }: { data: DeckData; onPracticeErrors: () => void }) {
  const { items, states } = data
  const [section, setSection] = useState<Section>('vocab')
  const [query, setQuery] = useState('')
  const [type, setType] = useState('')
  const [area, setArea] = useState('')
  const [register, setRegister] = useState('')
  const [source, setSource] = useState('')
  const [stateFilter, setStateFilter] = useState('')
  const [open, setOpen] = useState<string | null>(null)

  const sources = useMemo(
    () => [...new Set(items.flatMap((i) => (i.kind === 'vocab' && i.data.source ? [i.data.source] : [])))].sort(),
    [items],
  )

  const now = Date.now()
  const filtered = useMemo(() => {
    const q = normalize(query.trim())
    return items.filter((item) => {
      if (item.kind !== section) return false
      const st = states.get(item.key)?.card.state ?? State.New
      if (stateFilter !== '' && String(st) !== stateFilter) return false
      if (item.kind === 'vocab') {
        const v = item.data
        if (type && v.type !== type) return false
        if (area && v.area !== area) return false
        if (register && v.register !== register) return false
        if (source && v.source !== source) return false
        if (q && !normalize(`${v.english} ${v.spanish} ${v.example_en} ${v.example_es} ${v.notes}`).includes(q)) return false
      } else {
        const e = item.data
        if (q && !normalize(`${e.wrong} ${e.right} ${e.rule} ${e.category}`).includes(q)) return false
      }
      return true
    })
  }, [items, states, section, query, type, area, register, source, stateFilter])

  const anyFilter = type || area || register || source || stateFilter || query

  return (
    <section className="view library">
      <header className="view-head">
        <h1>Biblioteca</h1>
        <div className="segmented" role="group" aria-label="Sección">
          <button className={section === 'vocab' ? 'on' : ''} onClick={() => setSection('vocab')}>
            Vocabulario
          </button>
          <button className={section === 'error' ? 'on' : ''} onClick={() => setSection('error')}>
            Errores
          </button>
        </div>
      </header>

      <input
        className="search"
        type="search"
        placeholder="Buscar en inglés o español…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Buscar"
      />

      <div className="filters">
        {section === 'vocab' && (
          <>
            <Select label="Tipo" value={type} onChange={setType} options={TYPE_LABEL} />
            <Select label="Área" value={area} onChange={setArea} options={AREA_LABEL} />
            <Select label="Registro" value={register} onChange={setRegister} options={REGISTER_LABEL} />
            <Select label="Fuente" value={source} onChange={setSource} options={Object.fromEntries(sources.map((s) => [s, s]))} />
          </>
        )}
        <Select
          label="Estado"
          value={stateFilter}
          onChange={setStateFilter}
          options={Object.fromEntries(Object.entries(STATE_LABEL).map(([k, v]) => [k, v]))}
        />
        {anyFilter && (
          <button
            className="link-btn"
            onClick={() => {
              setQuery('')
              setType('')
              setArea('')
              setRegister('')
              setSource('')
              setStateFilter('')
            }}
          >
            Limpiar
          </button>
        )}
      </div>

      <div className="lib-count">
        <p className="muted small">
          {filtered.length} {filtered.length === 1 ? 'tarjeta' : 'tarjetas'}
        </p>
        {section === 'error' && (
          <button className="link-btn" onClick={onPracticeErrors}>
            Practicar errores →
          </button>
        )}
      </div>

      <ul className="lib-list">
        {filtered.map((item) => (
          <LibRow key={item.key} item={item} data={data} now={now} open={open === item.key} onToggle={() => setOpen(open === item.key ? null : item.key)} />
        ))}
      </ul>
    </section>
  )
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: Record<string, string>
}) {
  return (
    <label className={`select ${value ? 'has-value' : ''}`}>
      <span className="sr-only">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
        <option value="">{label}</option>
        {Object.entries(options).map(([k, v]) => (
          <option key={k} value={k}>
            {v}
          </option>
        ))}
      </select>
    </label>
  )
}

function LibRow({ item, data, now, open, onToggle }: { item: DeckItem; data: DeckData; now: number; open: boolean; onToggle: () => void }) {
  const rec = data.states.get(item.key)
  const st = rec?.card.state ?? State.New
  const due = rec && st !== State.New ? rec.card.due.getTime() - now : null
  const dueLabel = due === null ? '' : due <= 0 ? 'toca ya' : `en ${formatInterval(due)}`
  const reviews = open ? data.logs.filter((l) => l.key === item.key) : []
  const lapses = rec?.card.lapses ?? 0

  return (
    <li className={`lib-row ${open ? 'open' : ''}`}>
      <button className="lib-head" onClick={onToggle} aria-expanded={open}>
        <div className="lib-main">
          {item.kind === 'vocab' ? (
            <>
              <span className="lib-term">{item.data.english}</span>
              <span className="lib-sub">{item.data.spanish}</span>
            </>
          ) : (
            <>
              <span className="lib-term">{item.data.right}</span>
              <span className="lib-sub strike">{item.data.wrong}</span>
            </>
          )}
        </div>
        <div className="lib-side">
          <span className={`state state-${st}`}>{STATE_LABEL[st]}</span>
          {dueLabel && <span className="lib-due">{dueLabel}</span>}
        </div>
      </button>
      {open && (
        <div className="lib-detail">
          {item.kind === 'vocab' ? (
            <>
              <p className="example-en">{item.data.example_en}</p>
              {item.data.example_es && <p className="example-es">{item.data.example_es}</p>}
              {item.data.notes && <p className="notes">{item.data.notes}</p>}
              <div className="tags">
                <span className="tag">{TYPE_LABEL[item.data.type]}</span>
                <span className="tag">{AREA_LABEL[item.data.area]}</span>
                <RegisterBadge register={item.data.register} compact />
                {item.data.source && <span className="tag">{item.data.source}</span>}
                <span className="tag">añadida {item.data.date_added}</span>
              </div>
            </>
          ) : (
            <>
              <p className="rule">{item.data.rule}</p>
              <div className="tags">
                <span className="tag">{item.data.category}</span>
                <span className="tag">añadida {item.data.date_added}</span>
              </div>
            </>
          )}
          <p className="muted small">
            {reviews.length} {reviews.length === 1 ? 'repaso' : 'repasos'} · {lapses} {lapses === 1 ? 'fallo' : 'fallos'}
            {rec && st !== State.New ? ` · estabilidad ${rec.card.stability.toFixed(1)} d · dificultad ${rec.card.difficulty.toFixed(1)}` : ''}
          </p>
        </div>
      )}
    </li>
  )
}
