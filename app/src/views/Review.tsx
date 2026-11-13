import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DeckData } from '../App'
import type { CardStateRecord, DeckItem, ReviewLogRecord, ReviewMode, Settings } from '../types'
import {
  buildQueue,
  cardFor,
  formatInterval,
  GRADES,
  makeScheduler,
  pickNext,
  previewIntervals,
  State,
  type Grade,
} from '../lib/scheduler'
import { newUid, saveReview, undoReview } from '../lib/db'
import { speak, speechSupported } from '../lib/speech'
import { AREA_LABEL, TYPE_LABEL } from '../lib/labels'
import RegisterBadge from '../components/RegisterBadge'

interface Props {
  data: DeckData
  settings: Settings
  onReviewed: (state: CardStateRecord, log: ReviewLogRecord) => void
  onUndone: (restored: CardStateRecord, logId: number) => void
  onModeChange: (mode: ReviewMode) => void
  onExit: () => void
}

interface UndoEntry {
  key: string
  previous: CardStateRecord | undefined
  logId: number
  item: DeckItem
}

const SWIPE_PX = 80

export default function Review({ data, settings, onReviewed, onUndone, onModeChange, onExit }: Props) {
  const { items, states, logs } = data
  const scheduler = useMemo(() => makeScheduler(settings.retention), [settings.retention])
  const [locked, setCurrent] = useState<DeckItem | null>(null)
  const [flipped, setFlipped] = useState(false)
  const [busy, setBusy] = useState(false)
  const [doneInSession, setDoneInSession] = useState(0)
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([])
  const [tick, setTick] = useState(0) // fuerza recalcular la cola (aprendizaje en minutos)
  const [drag, setDrag] = useState(0)
  const pointer = useRef<{ x: number; y: number; moved: boolean } | null>(null)

  const queue = useMemo(
    () => buildQueue(items, states, logs, settings, new Date()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, states, logs, settings, tick],
  )

  // La tarjeta en pantalla se fija al mostrarla; si no hay ninguna, se calcula en el mismo render
  // (así no parpadea la pantalla de "hecho" entre una tarjeta y la siguiente).
  const candidate = useMemo(
    () => (locked ? null : pickNext(queue, states, doneInSession)),
    [locked, queue, states, doneInSession],
  )
  useEffect(() => {
    if (!locked && candidate) {
      setCurrent(candidate)
      setFlipped(false)
    }
  }, [locked, candidate])
  const current = locked ?? candidate

  // Si la cola está vacía pero hay aprendizaje pendiente más tarde, revisar cada 30 s
  useEffect(() => {
    if (current) return
    const t = window.setInterval(() => setTick((n) => n + 1), 30_000)
    return () => window.clearInterval(t)
  }, [current])

  const now = new Date()
  const card = current ? cardFor(current, states, now) : null
  const intervals = useMemo(
    () => (card ? previewIntervals(scheduler, card, new Date()) : {}),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [current, states, scheduler],
  )

  const speakText = useCallback(
    (text: string) => speak(text, settings.voiceURI, settings.speechRate),
    [settings.voiceURI, settings.speechRate],
  )

  const flip = useCallback(() => {
    if (!current) return
    setFlipped((f) => {
      const next = !f
      // En modo inverso, al girar suena la respuesta en inglés
      if (next && current.kind === 'vocab' && settings.mode === 'inverse') speakText(current.data.english)
      return next
    })
  }, [current, settings.mode, speakText])

  const rate = useCallback(
    async (grade: Grade) => {
      if (!current || !flipped || busy) return
      setBusy(true)
      const at = new Date()
      const prevCard = cardFor(current, states, at)
      const { card: nextCard, log } = scheduler.next(prevCard, at, grade)
      const record: CardStateRecord = {
        key: current.key,
        kind: current.kind,
        id: current.data.id,
        card: nextCard,
        updated_at: at.toISOString(),
      }
      const logRec: ReviewLogRecord = {
        uid: newUid(),
        synced: 0,
        key: current.key,
        kind: current.kind,
        id: current.data.id,
        rating: grade,
        state: prevCard.state,
        review: at.toISOString(),
        due: nextCard.due.toISOString(),
        stability: nextCard.stability,
        difficulty: nextCard.difficulty,
        scheduled_days: log.scheduled_days,
        mode: current.kind === 'vocab' ? settings.mode : 'normal',
      }
      const previous = states.get(current.key)
      const logId = await saveReview(record, logRec)
      onReviewed(record, { ...logRec, logId })
      setUndoStack((s) => [...s.slice(-19), { key: current.key, previous, logId, item: current }])
      setDoneInSession((n) => n + 1)
      setDrag(0)
      setCurrent(null)
      setFlipped(false)
      setBusy(false)
    },
    [current, flipped, busy, states, scheduler, settings.mode, onReviewed],
  )

  const undo = useCallback(async () => {
    const last = undoStack[undoStack.length - 1]
    if (!last || busy) return
    setBusy(true)
    const restored = await undoReview(last.key, last.previous, last.logId, { kind: last.item.kind, id: last.item.data.id })
    onUndone(restored, last.logId)
    setUndoStack((s) => s.slice(0, -1))
    setDoneInSession((n) => Math.max(0, n - 1))
    setCurrent(last.item)
    setFlipped(true)
    setBusy(false)
  }, [undoStack, busy, onUndone])

  // Teclado: espacio/enter gira, 1-4 valora, z deshace, s habla
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault()
        if (!flipped) flip()
        else if (e.key === 'Enter') void rate(3 as Grade)
        return
      }
      if (['1', '2', '3', '4'].includes(e.key) && flipped) {
        e.preventDefault()
        void rate(Number(e.key) as Grade)
        return
      }
      if (e.key === 'z' || e.key === 'Z') void undo()
      if ((e.key === 's' || e.key === 'S') && current) {
        speakText(current.kind === 'vocab' ? current.data.english : current.data.right)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [flip, rate, undo, flipped, current, speakText])

  // Gestos: tocar gira; con la tarjeta girada, deslizar → Good, ← Again
  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return
    pointer.current = { x: e.clientX, y: e.clientY, moved: false }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const p = pointer.current
    if (!p) return
    const dx = e.clientX - p.x
    if (Math.abs(dx) > 8 || Math.abs(e.clientY - p.y) > 8) p.moved = true
    if (flipped) setDrag(dx)
  }
  const onPointerUp = () => {
    const p = pointer.current
    pointer.current = null
    if (!p) return
    if (!p.moved) {
      flip()
      return
    }
    if (flipped && drag > SWIPE_PX) void rate(3 as Grade)
    else if (flipped && drag < -SWIPE_PX) void rate(1 as Grade)
    else setDrag(0)
  }

  const counts = {
    new: queue.newAvailable.length,
    learning: queue.dueNow.filter((i) => states.get(i.key)?.card.state !== State.Review).length,
    review: queue.dueNow.filter((i) => states.get(i.key)?.card.state === State.Review).length,
  }

  if (!current) {
    const nextLearning = [...states.values()]
      .filter((s) => s.card.state === State.Learning || s.card.state === State.Relearning)
      .map((s) => s.card.due.getTime())
      .sort((a, b) => a - b)[0]
    return (
      <section className="view review-done">
        <div className="done-badge">✓</div>
        <h1>¡Hecho por ahora!</h1>
        <p className="muted">
          {doneInSession ? `Has repasado ${doneInSession} ${doneInSession === 1 ? 'tarjeta' : 'tarjetas'} en esta sesión.` : 'No hay tarjetas pendientes.'}
        </p>
        {nextLearning && (
          <p className="muted">Próxima tarjeta en aprendizaje en {formatInterval(nextLearning - Date.now())}.</p>
        )}
        <div className="row-gap">
          {undoStack.length > 0 && (
            <button className="btn" onClick={() => void undo()}>
              Deshacer última
            </button>
          )}
          <button className="btn btn-primary" onClick={onExit}>
            Volver a Hoy
          </button>
        </div>
      </section>
    )
  }

  const isNewCard = card?.state === State.New
  const tilt = Math.max(-12, Math.min(12, drag / 12))
  const swipeHint = drag > SWIPE_PX ? 'good' : drag < -SWIPE_PX ? 'again' : ''

  return (
    <section className="view review">
      <div className="review-top">
        <div className="counters" aria-label="Pendientes">
          <span className="c-new" title="Nuevas">{counts.new}</span>
          <span className="c-learning" title="Aprendiendo">{counts.learning}</span>
          <span className="c-review" title="Repasos">{counts.review}</span>
        </div>
        <div className="segmented" role="group" aria-label="Modo">
          <button className={settings.mode === 'normal' ? 'on' : ''} onClick={() => onModeChange('normal')}>
            EN → ES
          </button>
          <button className={settings.mode === 'inverse' ? 'on' : ''} onClick={() => onModeChange('inverse')}>
            ES → EN
          </button>
        </div>
        <button className="icon-btn" onClick={() => void undo()} disabled={!undoStack.length} title="Deshacer (Z)" aria-label="Deshacer">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3" />
          </svg>
        </button>
      </div>

      <div
        className={`flashcard ${flipped ? 'is-flipped' : ''} ${swipeHint ? `hint-${swipeHint}` : ''}`}
        style={{ transform: drag ? `translateX(${drag}px) rotate(${tilt}deg)` : undefined }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          pointer.current = null
          setDrag(0)
        }}
        data-testid="flashcard"
        key={current.key}
      >
        <div className="flashcard-inner">
          <div className="face front">
            {isNewCard && <span className="pill pill-new">nueva</span>}
            <CardFront item={current} mode={settings.mode} onSpeak={speakText} />
            <p className="tap-hint">Toca o pulsa espacio para girar</p>
          </div>
          <div className="face back">
            <CardBack item={current} mode={settings.mode} onSpeak={speakText} />
          </div>
        </div>
      </div>

      <div className="grades">
        {flipped ? (
          GRADES.map((g) => (
            <button key={g.grade} className={`grade grade-${g.label.toLowerCase()}`} onClick={() => void rate(g.grade)} disabled={busy}>
              <span className="grade-label">{g.label}</span>
              <span className="grade-ivl">{intervals[g.grade]}</span>
              <kbd>{g.key}</kbd>
            </button>
          ))
        ) : (
          <button className="btn btn-primary btn-big show-answer" onClick={flip}>
            Mostrar respuesta
          </button>
        )}
      </div>
    </section>
  )
}

function SpeakButton({ text, onSpeak, label = 'Escuchar' }: { text: string; onSpeak: (t: string) => void; label?: string }) {
  if (!speechSupported()) return null
  return (
    <button
      className="speak"
      onClick={(e) => {
        e.stopPropagation()
        onSpeak(text)
      }}
      aria-label={label}
      title={label}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 9v6h4l5 4V5L8 9H4zM16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" />
      </svg>
    </button>
  )
}

function CardFront({ item, mode, onSpeak }: { item: DeckItem; mode: ReviewMode; onSpeak: (t: string) => void }) {
  if (item.kind === 'error') {
    return (
      <div className="card-body">
        <p className="eyebrow">Corrige la frase</p>
        <p className="term term-sentence wrong">{item.data.wrong}</p>
      </div>
    )
  }
  const v = item.data
  if (mode === 'inverse') {
    return (
      <div className="card-body">
        <p className="eyebrow">{TYPE_LABEL[v.type]} · ¿cómo se dice en inglés?</p>
        <p className="term">{v.spanish}</p>
      </div>
    )
  }
  return (
    <div className="card-body">
      <p className="eyebrow">{TYPE_LABEL[v.type]}</p>
      <div className="term-row">
        <p className="term">{v.english}</p>
        <SpeakButton text={v.english} onSpeak={onSpeak} />
      </div>
      <RegisterBadge register={v.register} />
    </div>
  )
}

function CardBack({ item, mode, onSpeak }: { item: DeckItem; mode: ReviewMode; onSpeak: (t: string) => void }) {
  if (item.kind === 'error') {
    const e = item.data
    return (
      <div className="card-body">
        <p className="strike">{e.wrong}</p>
        <div className="term-row">
          <p className="term term-sentence right">{e.right}</p>
          <SpeakButton text={e.right} onSpeak={onSpeak} />
        </div>
        <p className="rule">{e.rule}</p>
        <p className="meta">{e.category}</p>
      </div>
    )
  }
  const v = item.data
  return (
    <div className="card-body">
      {mode === 'inverse' ? (
        <>
          <p className="muted small">{v.spanish}</p>
          <div className="term-row">
            <p className="term">{v.english}</p>
            <SpeakButton text={v.english} onSpeak={onSpeak} />
          </div>
        </>
      ) : (
        <>
          <p className="muted small">{v.english}</p>
          <p className="term">{v.spanish}</p>
        </>
      )}
      <RegisterBadge register={v.register} />
      <div className="example">
        <div className="term-row">
          <p className="example-en">{v.example_en}</p>
          <SpeakButton text={v.example_en} onSpeak={onSpeak} label="Escuchar ejemplo" />
        </div>
        {v.example_es && <p className="example-es">{v.example_es}</p>}
      </div>
      {v.notes && <p className="notes">{v.notes}</p>}
      <p className="meta">
        {AREA_LABEL[v.area]}
        {v.source ? ` · ${v.source}` : ''}
      </p>
    </div>
  )
}
