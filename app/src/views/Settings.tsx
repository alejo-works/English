import { useEffect, useRef, useState } from 'react'
import type { DeckData } from '../App'
import type { Settings, Theme } from '../types'
import { exportBackup, importBackup, parseBackup, resetProgress } from '../lib/db'
import { englishVoices, onVoicesChanged, speak, speechSupported } from '../lib/speech'

interface Props {
  data: DeckData
  onChange: (patch: Partial<Settings>) => void
  onDataReplaced: () => Promise<void>
}

export default function SettingsView({ data, onChange, onDataReplaced }: Props) {
  const s = data.settings
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(() => englishVoices())
  const [message, setMessage] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => onVoicesChanged(() => setVoices(englishVoices())), [])

  const flash = (msg: string) => {
    setMessage(msg)
    window.setTimeout(() => setMessage(null), 3500)
  }

  const doExport = async () => {
    const backup = await exportBackup()
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `english-deck-backup-${new Date().toISOString().slice(0, 10)}.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    flash(`Copia exportada: ${backup.states.length} tarjetas, ${backup.logs.length} repasos.`)
  }

  const doImport = async (file: File) => {
    try {
      const backup = parseBackup(JSON.parse(await file.text()))
      const ok = window.confirm(
        `Esto sustituye tu progreso actual por la copia del ${backup.exported_at.slice(0, 10)} (${backup.states.length} tarjetas, ${backup.logs.length} repasos). ¿Seguir?`,
      )
      if (!ok) return
      await importBackup(backup)
      await onDataReplaced()
      flash('Copia importada.')
    } catch (e) {
      flash(e instanceof Error ? e.message : 'No se pudo importar la copia.')
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const doReset = async () => {
    if (!window.confirm('¿Borrar todo tu progreso en este dispositivo? Exporta una copia antes si la quieres guardar.')) return
    await resetProgress()
    await onDataReplaced()
    flash('Progreso borrado.')
  }

  return (
    <section className="view settings">
      <header className="view-head">
        <h1>Ajustes</h1>
      </header>

      <div className="card-surface group">
        <h2>Apariencia</h2>
        <div className="segmented full" role="group" aria-label="Tema">
          {(['system', 'light', 'dark'] as Theme[]).map((t) => (
            <button key={t} className={s.theme === t ? 'on' : ''} onClick={() => onChange({ theme: t })}>
              {t === 'system' ? 'Sistema' : t === 'light' ? 'Claro' : 'Oscuro'}
            </button>
          ))}
        </div>
      </div>

      <div className="card-surface group">
        <h2>Repaso</h2>
        <label className="field">
          <span>Tarjetas nuevas al día</span>
          <input
            type="number"
            min={0}
            max={200}
            inputMode="numeric"
            value={s.newPerDay}
            onChange={(e) => onChange({ newPerDay: Math.max(0, Math.min(200, Number(e.target.value) || 0)) })}
          />
        </label>
        <label className="field">
          <span>
            Retención objetivo <b>{Math.round(s.retention * 100)} %</b>
            <small>Más alta = repasos más frecuentes. 90 % es lo recomendado.</small>
          </span>
          <input
            type="range"
            min={0.8}
            max={0.97}
            step={0.01}
            value={s.retention}
            onChange={(e) => onChange({ retention: Number(e.target.value) })}
          />
        </label>
        <label className="field switch">
          <span>
            Incluir errores en el repaso
            <small>Tarjetas de «corrige la frase» de errors.csv.</small>
          </span>
          <input type="checkbox" checked={s.includeErrors} onChange={(e) => onChange({ includeErrors: e.target.checked })} />
        </label>
      </div>

      <div className="card-surface group">
        <h2>Voz</h2>
        {speechSupported() ? (
          <>
            <label className="field">
              <span>Voz en inglés (US)</span>
              <select value={s.voiceURI} onChange={(e) => onChange({ voiceURI: e.target.value })}>
                <option value="">Automática</option>
                {voices.map((v) => (
                  <option key={v.voiceURI} value={v.voiceURI}>
                    {v.name} ({v.lang})
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>
                Velocidad <b>{s.speechRate.toFixed(2)}×</b>
              </span>
              <input
                type="range"
                min={0.6}
                max={1.2}
                step={0.05}
                value={s.speechRate}
                onChange={(e) => onChange({ speechRate: Number(e.target.value) })}
              />
            </label>
            <button className="btn" onClick={() => speak('I wanted to follow up on what we discussed.', s.voiceURI, s.speechRate)}>
              Probar voz
            </button>
          </>
        ) : (
          <p className="muted">Este navegador no tiene síntesis de voz.</p>
        )}
      </div>

      <div className="card-surface group">
        <h2>Copia de seguridad</h2>
        <p className="muted small">El progreso se guarda solo en este dispositivo. Exporta una copia de vez en cuando o para pasarla a otro dispositivo.</p>
        <div className="row-gap">
          <button className="btn" onClick={() => void doExport()}>
            Exportar copia
          </button>
          <button className="btn" onClick={() => fileRef.current?.click()}>
            Importar copia
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void doImport(f)
            }}
          />
        </div>
        <button className="link-btn danger" onClick={() => void doReset()}>
          Borrar progreso
        </button>
      </div>

      <p className="muted small center">
        English Deck · FSRS · mazo generado {new Date(data.generatedAt).toLocaleString('es-ES')}
      </p>

      {message && (
        <div className="toast" role="status">
          {message}
        </div>
      )}
    </section>
  )
}
