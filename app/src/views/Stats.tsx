import { useMemo, useState } from 'react'
import type { DeckData } from '../App'
import type { DeckItem } from '../types'
import { activeItems, State } from '../lib/scheduler'
import { activity, forecast, heatLevel, neglected, retention, struggles } from '../lib/stats'

const WEEKS = 18
const WEEKDAYS = ['L', '', 'X', '', 'V', '', 'D']

function term(item: DeckItem): { main: string; sub: string } {
  return item.kind === 'vocab' ? { main: item.data.english, sub: item.data.spanish } : { main: item.data.right, sub: 'error' }
}

const fmtDay = (d: Date) => d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })

export default function Stats({ data }: { data: DeckData }) {
  const { states, logs, settings } = data
  const items = useMemo(() => activeItems(data.items, settings), [data.items, settings])
  const [minDays, setMinDays] = useState(7)
  const now = new Date()

  const ret = useMemo(() => retention(logs, now, 30), [logs]) // eslint-disable-line react-hooks/exhaustive-deps
  const fc = useMemo(() => forecast(items, states, now, 14), [items, states]) // eslint-disable-line react-hooks/exhaustive-deps
  const old = useMemo(() => neglected(items, states, now, minDays), [items, states, minDays]) // eslint-disable-line react-hooks/exhaustive-deps
  const hard = useMemo(() => struggles(items, states, logs), [items, states, logs])

  // Calendario: semanas completas de lunes a domingo, terminando en la semana actual
  const heat = useMemo(() => {
    const todayIdx = (now.getDay() + 6) % 7 // lunes = 0
    const days = WEEKS * 7 - (6 - todayIdx)
    return activity(logs, now, days)
  }, [logs]) // eslint-disable-line react-hooks/exhaustive-deps
  const studiedDays = heat.slice(-30).filter((d) => d.count > 0).length

  const counts = { new: 0, learning: 0, review: 0 }
  for (const it of items) {
    const s = states.get(it.key)?.card.state ?? State.New
    if (s === State.New) counts.new++
    else if (s === State.Review) counts.review++
    else counts.learning++
  }
  const maxFc = Math.max(1, ...fc.map((d) => d.count))

  return (
    <section className="view stats">
      <header className="view-head">
        <h1>Progreso</h1>
      </header>

      <div className="stats-grid">
        <div className="stat card-surface">
          <div className="stat-num">{ret.retention === null ? '—' : `${ret.retention} %`}</div>
          <div className="stat-label">retención (30 d){ret.reviewCount ? ` · ${ret.reviewCount} repasos` : ''}</div>
        </div>
        <div className="stat card-surface">
          <div className="stat-num">{ret.accuracy === null ? '—' : `${ret.accuracy} %`}</div>
          <div className="stat-label">aciertos (30 d) · {ret.total} en total</div>
        </div>
        <div className="stat card-surface">
          <div className="stat-num">{studiedDays}</div>
          <div className="stat-label">días con repaso (30 d)</div>
        </div>
        <div className="stat card-surface">
          <div className="stat-num">{counts.review}</div>
          <div className="stat-label">tarjetas en repaso</div>
        </div>
      </div>
      {ret.retention === null && (
        <p className="muted small">La retención cuenta solo tarjetas que ya pasaron el aprendizaje; aparecerá cuando vuelvan las primeras.</p>
      )}

      <div className="card-surface panel">
        <h2>Actividad</h2>
        <div className="heatmap" role="img" aria-label={`Repasos por día en las últimas ${WEEKS} semanas`}>
          <div className="heat-days">
            {WEEKDAYS.map((d, i) => (
              <span key={i}>{d}</span>
            ))}
          </div>
          <div className="heat-grid">
            {heat.map((d) => (
              <span
                key={d.key}
                className={`heat heat-${heatLevel(d.count)}`}
                title={`${fmtDay(d.day)}: ${d.count} ${d.count === 1 ? 'repaso' : 'repasos'}`}
              />
            ))}
          </div>
        </div>
        <div className="heat-legend">
          <span>menos</span>
          {[0, 1, 2, 3, 4].map((l) => (
            <span key={l} className={`heat heat-${l}`} />
          ))}
          <span>más</span>
        </div>
      </div>

      <div className="card-surface panel">
        <h2>Próximos 14 días</h2>
        <div className="bars" role="img" aria-label="Tarjetas que vencen cada día">
          {fc.map((d, i) => (
            <div key={i} className="bar-col" title={`${i === 0 ? 'Hoy (con atrasadas)' : fmtDay(d.day)}: ${d.count}`}>
              <span className="bar-val">{d.count > 0 && (i === 0 || d.count === maxFc) ? d.count : ''}</span>
              <span className="bar" style={{ height: `${(d.count / maxFc) * 100}%` }} />
              <span className="bar-x">{i === 0 ? 'hoy' : d.day.getDate()}</span>
            </div>
          ))}
        </div>
        <table className="sr-only">
          <tbody>
            {fc.map((d, i) => (
              <tr key={i}>
                <td>{fmtDay(d.day)}</td>
                <td>{d.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card-surface panel">
        <h2>Estado del mazo</h2>
        <div className="progress-bar" aria-hidden="true">
          <span className="seg seg-review" style={{ flexGrow: counts.review }} />
          <span className="seg seg-learning" style={{ flexGrow: counts.learning }} />
          <span className="seg seg-new" style={{ flexGrow: counts.new }} />
        </div>
        <div className="progress-legend">
          <span>
            <i className="dot dot-review" /> {counts.review} en repaso
          </span>
          <span>
            <i className="dot dot-learning" /> {counts.learning} aprendiendo
          </span>
          <span>
            <i className="dot dot-new" /> {counts.new} sin ver
          </span>
        </div>
      </div>

      <div className="card-surface panel">
        <div className="panel-head">
          <h2>Sin ver desde hace</h2>
          <select value={minDays} onChange={(e) => setMinDays(Number(e.target.value))} aria-label="Días sin ver">
            {[3, 7, 14, 30].map((d) => (
              <option key={d} value={d}>
                {d}+ días
              </option>
            ))}
          </select>
        </div>
        {old.length ? (
          <ul className="mini-list">
            {old.slice(0, 15).map(({ item, days }) => (
              <li key={item.key}>
                <span>
                  <b>{term(item).main}</b> <span className="muted">{term(item).sub}</span>
                </span>
                <span className="muted">{days} d</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted small">Nada lleva más de {minDays} días sin verse.</p>
        )}
      </div>

      <div className="card-surface panel">
        <h2>Lo que más fallas</h2>
        {hard.length ? (
          <ul className="mini-list">
            {hard.map(({ item, again, lapses }) => (
              <li key={item.key}>
                <span>
                  <b>{term(item).main}</b> <span className="muted">{term(item).sub}</span>
                </span>
                <span className="muted">
                  {again}× Again{lapses ? ` · ${lapses} olvidos` : ''}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted small">Todavía no has fallado ninguna tarjeta.</p>
        )}
      </div>
    </section>
  )
}
