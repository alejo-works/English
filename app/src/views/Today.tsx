import { useMemo } from 'react'
import type { DeckData } from '../App'
import { activeItems, buildQueue, dayKey, dueOnDay, State, streak } from '../lib/scheduler'

export default function Today({ data, onStart }: { data: DeckData; onStart: () => void }) {
  const now = new Date()
  const { items, states, logs, settings } = data

  const info = useMemo(() => {
    const q = buildQueue(items, states, logs, settings, now)
    const active = activeItems(items, settings)
    const today = dayKey(now)
    const todayLogs = logs.filter((l) => dayKey(new Date(l.review)) === today)
    const counts = { new: 0, learning: 0, review: 0 }
    for (const it of active) {
      const s = states.get(it.key)?.card.state ?? State.New
      if (s === State.New) counts.new++
      else if (s === State.Review) counts.review++
      else counts.learning++
    }
    const dueToday = dueOnDay(active, states, now, 0)
    const tomorrow = dueOnDay(active, states, now, 1)
    const correct = todayLogs.filter((l) => l.rating > 1).length
    return {
      pending: dueToday + q.newAvailable.length,
      dueToday,
      newToday: q.newAvailable.length,
      dueNow: q.dueNow.length + q.newAvailable.length + q.learnAhead.length,
      reviewedToday: todayLogs.length,
      accuracy: todayLogs.length ? Math.round((correct / todayLogs.length) * 100) : null,
      streak: streak(logs, now),
      tomorrow,
      counts,
      total: active.length,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, states, logs, settings])

  const greeting = now.getHours() < 13 ? 'Good morning' : now.getHours() < 20 ? 'Good afternoon' : 'Good evening'

  return (
    <section className="view today">
      <header className="view-head">
        <p className="eyebrow">{now.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
        <h1>{greeting}, Alejo</h1>
      </header>

      <div className="hero card-surface">
        <div className="hero-num" data-testid="pending">
          {info.pending}
        </div>
        <div className="hero-label">{info.pending === 1 ? 'tarjeta pendiente hoy' : 'tarjetas pendientes hoy'}</div>
        <div className="hero-split">
          <span>
            <i className="dot dot-new" /> {info.newToday} nuevas
          </span>
          <span>
            <i className="dot dot-review" /> {info.dueToday} repasos
          </span>
        </div>
        <button className="btn btn-primary btn-big" onClick={onStart} disabled={info.dueNow === 0}>
          {info.dueNow === 0 ? 'Todo al día' : info.reviewedToday ? 'Seguir repasando' : 'Empezar repaso'}
        </button>
      </div>

      <div className="stats-grid">
        <div className="stat card-surface">
          <div className="stat-num">{info.streak}</div>
          <div className="stat-label">{info.streak === 1 ? 'día de racha' : 'días de racha'}</div>
        </div>
        <div className="stat card-surface">
          <div className="stat-num">{info.reviewedToday}</div>
          <div className="stat-label">
            repasadas hoy{info.accuracy !== null ? ` · ${info.accuracy} % bien` : ''}
          </div>
        </div>
        <div className="stat card-surface">
          <div className="stat-num">{info.tomorrow}</div>
          <div className="stat-label">vencen mañana</div>
        </div>
        <div className="stat card-surface">
          <div className="stat-num">{info.total}</div>
          <div className="stat-label">tarjetas en el mazo</div>
        </div>
      </div>

      <div className="card-surface progress-box">
        <div className="progress-bar" aria-hidden="true">
          <span className="seg seg-review" style={{ flexGrow: info.counts.review }} />
          <span className="seg seg-learning" style={{ flexGrow: info.counts.learning }} />
          <span className="seg seg-new" style={{ flexGrow: info.counts.new }} />
        </div>
        <div className="progress-legend">
          <span>
            <i className="dot dot-review" /> {info.counts.review} en repaso
          </span>
          <span>
            <i className="dot dot-learning" /> {info.counts.learning} aprendiendo
          </span>
          <span>
            <i className="dot dot-new" /> {info.counts.new} sin ver
          </span>
        </div>
      </div>
    </section>
  )
}
