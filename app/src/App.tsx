import { useCallback, useEffect, useState } from 'react'
import type { CardsFile, CardStateRecord, DeckItem, ReviewLogRecord, Settings } from './types'
import { DEFAULT_SETTINGS } from './types'
import { loadLogs, loadSettings, loadStates, saveSettings } from './lib/db'
import { stateKey } from './lib/scheduler'
import Today from './views/Today'
import Review from './views/Review'
import Library from './views/Library'
import SettingsView from './views/Settings'

export type Tab = 'today' | 'review' | 'library' | 'settings'

export interface DeckData {
  items: DeckItem[]
  generatedAt: string
  states: Map<string, CardStateRecord>
  logs: ReviewLogRecord[]
  settings: Settings
}

function toItems(file: CardsFile): DeckItem[] {
  return [
    ...file.vocab.map((data, order) => ({ key: stateKey('vocab', data.id), kind: 'vocab' as const, order, data })),
    ...file.errors.map((data, order) => ({ key: stateKey('error', data.id), kind: 'error' as const, order, data })),
  ]
}

function applyTheme(theme: Settings['theme']) {
  const root = document.documentElement
  if (theme === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', theme)
}

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'today', label: 'Hoy', icon: 'M3 12l9-8 9 8M5 10v10h14V10' },
  { id: 'review', label: 'Repasar', icon: 'M4 6h12v14H4zM8 2h12v14' },
  { id: 'library', label: 'Biblioteca', icon: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-5-5' },
  { id: 'settings', label: 'Ajustes', icon: 'M4 7h10M18 7h2M4 17h4M12 17h8M14 4v6M8 14v6' },
]

export default function App() {
  const [tab, setTab] = useState<Tab>('today')
  const [data, setData] = useState<DeckData | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    try {
      const res = await fetch('/cards.json', { cache: 'no-cache' })
      if (!res.ok) throw new Error(`No se pudo cargar cards.json (${res.status})`)
      const file = (await res.json()) as CardsFile
      const [states, logs, settings] = await Promise.all([loadStates(), loadLogs(), loadSettings()])
      applyTheme(settings.theme)
      setData({ items: toItems(file), generatedAt: file.generated_at, states, logs, settings })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const updateSettings = useCallback(async (patch: Partial<Settings>) => {
    setData((d) => {
      if (!d) return d
      const settings = { ...d.settings, ...patch }
      void saveSettings(settings)
      applyTheme(settings.theme)
      return { ...d, settings }
    })
  }, [])

  const onReviewed = useCallback(
    (state: CardStateRecord, log: ReviewLogRecord) =>
      setData((d) => {
        if (!d) return d
        const states = new Map(d.states)
        states.set(state.key, state)
        return { ...d, states, logs: [...d.logs, log] }
      }),
    [],
  )

  const onUndone = useCallback(
    (key: string, previous: CardStateRecord | undefined, logId: number) =>
      setData((d) => {
        if (!d) return d
        const states = new Map(d.states)
        if (previous) states.set(key, previous)
        else states.delete(key)
        return { ...d, states, logs: d.logs.filter((l) => l.logId !== logId) }
      }),
    [],
  )

  if (error) {
    return (
      <div className="boot">
        <p>{error}</p>
        <button className="btn" onClick={() => location.reload()}>
          Reintentar
        </button>
      </div>
    )
  }
  if (!data) return <div className="boot">Cargando…</div>

  return (
    <div className="shell">
      <main className="content">
        {tab === 'today' && <Today data={data} onStart={() => setTab('review')} />}
        {tab === 'review' && (
          <Review
            data={data}
            settings={data.settings ?? DEFAULT_SETTINGS}
            onReviewed={onReviewed}
            onUndone={onUndone}
            onModeChange={(mode) => updateSettings({ mode })}
            onExit={() => setTab('today')}
          />
        )}
        {tab === 'library' && <Library data={data} />}
        {tab === 'settings' && <SettingsView data={data} onChange={updateSettings} onDataReplaced={reload} />}
      </main>
      <nav className="tabbar" aria-label="Secciones">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`tab ${tab === t.id ? 'active' : ''}`}
            onClick={() => setTab(t.id)}
            aria-current={tab === t.id ? 'page' : undefined}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d={t.icon} />
            </svg>
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}
