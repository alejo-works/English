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
  Rating,
  State,
  type Grade,
} from '../lib/scheduler'
import { newUid, saveReview, undoReview } from '../lib/db'
import { speak, speechSupported } from '../lib/speech'
import { AREA_LABEL, TYPE_LABEL } from '../lib/labels'
import { diffWords, findCloze, type DiffResult } from '../lib/text'
import RegisterBadge from '../components/RegisterBadge'

export type ReviewFilter = 'all' | 'errors'

interface Props {
  data: DeckData
  settings: Settings
  filter: ReviewFilter
  onReviewed: (state: CardStateRecord, log: ReviewLogRecord) => void
  onUndone: (restored: CardStateRecord, logId: number) => void
  onModeChange: (mode: ReviewMode) => void
  onClearFilter: () => void
  onExit: () => void
}

interface UndoEntry {
  key: string
  previous: CardStateRecord | undefined
  logId: number
  item: DeckItem
}

const SWIPE_PX = 80

export const MODES: { id: ReviewMode; label: string; hint: string }[] = [
  { id: 'normal', label: 'EN → ES', hint: 'Ves la palabra en inglés' },
  { id: 'inverse', label: 'ES → EN', hint: 'Ves el español y dices el inglés' },
  { id: 'audio', label: 'Oído', hint: 'La oyes y dices qué significa' },
  { id: 'dictation', label: 'Dictado', hint: 'Oyes el ejemplo y lo escribes' },
  { id: 'cloze', label: 'Cloze', hint: 'Completa el hueco del ejemplo' },
]

/** Valoración sugerida tras escribir: perfecto → Good, casi → Hard, si no → Again. */
function suggestedGrade(diff: DiffResult | null): Grade | null {
  if (!diff) return null
  if (diff.perfect) return Rating.Good as Grade
  if (diff.score >= 0.8) return Rating.Hard as Grade
  return Rating.Again as Grade
}

/** ¿Esta tarjeta se responde escribiendo? */
function needsTyping(item: DeckItem, mode: ReviewMode): boolean {
  return item.kind === 'error' || mode === 'dictation'
}

export default function Review({ data, settings, filter, onReviewed, onUndone, onModeChange, onClearFilter, onExit }: Props) {
  const { states, logs } = data
  const items = useMemo(() => (filter === 'errors' ? data.items.filter((i) => i.kind === 'error') : data.items), [data.items, filter])
  const effectiveSettings = useMemo(() => (filter === 'errors' ? { ...settings, includeErrors: true } : settings), [settings, filter])
  const mode = settings.mode
  const scheduler = useMemo(() => makeScheduler(settings.retention), [settings.retention])
  const [locked, setCurrent] = useState<DeckItem | null>(null)
  const [flipped, setFlipped] = useState(false)
  const [busy, setBusy] = useState(false)
  const [doneInSession, setDoneInSession] = useState(0)
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([])
  const [tick, setTick] = useState(0) // fuerza recalcular la cola (aprendizaje en minutos)
  const [drag, setDrag] = useState(0)
  const [typed, setTyped] = useState('')
  const [diff, setDiff] = useState<DiffResult | null>(null)
  const pointer = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const flippedRef = useRef(false)
  flippedRef.current = flipped

  const queue = useMemo(
    () => buildQueue(items, states, logs, effectiveSettings, new Date()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, states, logs, effectiveSettings, tick],
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

  // Al cambiar el filtro, empezar de nuevo
  useEffect(() => {
    setCurrent(null)
    setFlipped(false)
  }, [filter])

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

  /** Lo que suena con el botón grande / la tecla S en cada modo. */
  const promptAudio = useCallback(
    (item: DeckItem): string => {
      if (item.kind === 'error') return item.data.right
      if (mode === 'dictation') return item.data.example_en
      return item.data.english
    },
    [mode],
  )

  // Nueva tarjeta: limpiar respuesta, sonar en modos de oído y enfocar el campo de texto
  useEffect(() => {
    setTyped('')
    setDiff(null)
    if (!current) return
    if (current.kind === 'vocab' && (mode === 'audio' || mode === 'dictation')) {
      speakText(promptAudio(current))
    }
    if (needsTyping(current, mode) && window.matchMedia('(hover: hover)').matches) {
      const t = window.setTimeout(() => {
        if (!flippedRef.current) inputRef.current?.focus()
      }, 350)
      return () => window.clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.key, mode])

  const flip = useCallback(() => {
    if (!current) return
    setFlipped((f) => {
      const next = !f
      if (next) {
        ;(document.activeElement as HTMLElement | null)?.blur?.()
        // En modo inverso y cloze, al girar suena la respuesta en inglés
        if (current.kind === 'vocab' && (mode === 'inverse' || mode === 'cloze')) speakText(current.data.english)
      }
      return next
    })
  }, [current, mode, speakText])

  /** Comprueba lo escrito y gira la tarjeta. */
  const check = useCallback(() => {
    if (!current || flipped) return
    if (typed.trim()) {
      const target = current.kind === 'error' ? current.data.right : current.data.example_en
      setDiff(diffWords(typed, target))
    }
    inputRef.current?.blur()
    flip()
  }, [current, flipped, typed, flip])

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
        mode: current.kind === 'vocab' ? mode : 'normal',
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
    [current, flipped, busy, states, scheduler, mode, onReviewed],
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

  // Teclado: espacio/enter gira, 1-4 valora, z deshace, s habla (fuera de los campos de texto)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault()
        if (!flipped) check()
        else if (e.key === 'Enter') void rate(suggestedGrade(diff) ?? (Rating.Good as Grade))
        return
      }
      if (['1', '2', '3', '4'].includes(e.key) && flipped) {
        e.preventDefault()
        void rate(Number(e.key) as Grade)
        return
      }
      if (e.key === 'z' || e.key === 'Z') void undo()
      if ((e.key === 's' || e.key === 'S') && current) speakText(promptAudio(current))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [check, rate, undo, flipped, current, speakText, promptAudio, diff])

  // Gestos: tocar gira; con la tarjeta girada, deslizar → Good, ← Again
  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button, input, textarea, a, form')) return
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
      if (flipped) flip()
      else check()
      return
    }
    if (flipped && drag > SWIPE_PX) void rate(Rating.Good as Grade)
    else if (flipped && drag < -SWIPE_PX) void rate(Rating.Again as Grade)
    else setDrag(0)
  }

  const counts = {
    new: queue.newAvailable.length,
    learning: queue.dueNow.filter((i) => states.get(i.key)?.card.state !== State.Review).length,
    review: queue.dueNow.filter((i) => states.get(i.key)?.card.state === State.Review).length,
  }

  const modePicker = (
    <div className="mode-chips" role="group" aria-label="Modo">
      {MODES.map((m) => (
        <button key={m.id} className={mode === m.id ? 'on' : ''} onClick={() => onModeChange(m.id)} title={m.hint}>
          {m.label}
        </button>
      ))}
    </div>
  )

  const filterChip =
    filter === 'errors' ? (
      <button className="filter-chip" onClick={onClearFilter}>
        Solo errores <span aria-hidden="true">✕</span>
      </button>
    ) : null

  if (!current) {
    const nextLearning = [...states.values()]
      .filter((s) => items.some((i) => i.key === s.key))
      .filter((s) => s.card.state === State.Learning || s.card.state === State.Relearning)
      .map((s) => s.card.due.getTime())
      .sort((a, b) => a - b)[0]
    return (
      <section className="view review-done">
        {filterChip}
        <div className="done-badge">✓</div>
        <h1>¡Hecho por ahora!</h1>
        <p className="muted">
          {doneInSession
            ? `Has repasado ${doneInSession} ${doneInSession === 1 ? 'tarjeta' : 'tarjetas'} en esta sesión.`
            : filter === 'errors'
              ? 'No hay errores pendientes hoy.'
              : 'No hay tarjetas pendientes.'}
        </p>
        {nextLearning && <p className="muted">Próxima tarjeta en aprendizaje en {formatInterval(nextLearning - Date.now())}.</p>}
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
  const typing = needsTyping(current, mode)
  const suggested = suggestedGrade(diff)

  return (
    <section className="view review">
      <div className="review-top">
        <div className="counters" aria-label="Pendientes">
          <span className="c-new" title="Nuevas">
            {counts.new}
          </span>
          <span className="c-learning" title="Aprendiendo">
            {counts.learning}
          </span>
          <span className="c-review" title="Repasos">
            {counts.review}
          </span>
        </div>
        {filterChip}
        <button className="icon-btn" onClick={() => void undo()} disabled={!undoStack.length} title="Deshacer (Z)" aria-label="Deshacer">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3" />
          </svg>
        </button>
      </div>
      {filter === 'all' && modePicker}

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
            <CardFront item={current} mode={mode} onSpeak={speakText} />
            {typing ? (
              <form
                className="answer-form"
                onSubmit={(e) => {
                  e.preventDefault()
                  check()
                }}
              >
                <input
                  ref={inputRef}
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  placeholder={current.kind === 'error' ? 'Escribe la frase corregida…' : 'Escribe lo que oyes…'}
                  aria-label="Tu respuesta"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  lang="en"
                  tabIndex={flipped ? -1 : 0}
                />
              </form>
            ) : (
              <p className="tap-hint">Toca o pulsa espacio para girar</p>
            )}
          </div>
          <div className="face back">
            {diff && <DiffView diff={diff} />}
            <CardBack item={current} mode={mode} onSpeak={speakText} />
          </div>
        </div>
      </div>

      <div className="grades">
        {flipped ? (
          GRADES.map((g) => (
            <button
              key={g.grade}
              className={`grade grade-${g.label.toLowerCase()} ${suggested === g.grade ? 'suggested' : ''}`}
              onClick={() => void rate(g.grade)}
              disabled={busy}
            >
              <span className="grade-label">{g.label}</span>
              <span className="grade-ivl">{intervals[g.grade]}</span>
              <kbd>{g.key}</kbd>
            </button>
          ))
        ) : (
          <button className="btn btn-primary btn-big show-answer" onClick={check}>
            {typing && typed.trim() ? 'Comprobar' : 'Mostrar respuesta'}
          </button>
        )}
      </div>
    </section>
  )
}

function SpeakButton({
  text,
  onSpeak,
  label = 'Escuchar',
  big = false,
}: {
  text: string
  onSpeak: (t: string) => void
  label?: string
  big?: boolean
}) {
  if (!speechSupported()) return null
  return (
    <button
      type="button"
      className={big ? 'speak speak-big' : 'speak'}
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

function DiffView({ diff }: { diff: DiffResult }) {
  return (
    <div className={`diff ${diff.perfect ? 'diff-perfect' : ''}`} data-testid="diff">
      <p className="eyebrow">{diff.perfect ? '¡Perfecto!' : `Tu respuesta · ${Math.round(diff.score * 100)} %`}</p>
      {!diff.perfect && (
        <p className="diff-text">
          {diff.parts.map((p, i) => (
            <span key={i} className={`d-${p.kind}`}>
              {p.text}{' '}
            </span>
          ))}
        </p>
      )}
    </div>
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
  switch (mode) {
    case 'inverse':
      return (
        <div className="card-body">
          <p className="eyebrow">{TYPE_LABEL[v.type]} · ¿cómo se dice en inglés?</p>
          <p className="term">{v.spanish}</p>
        </div>
      )
    case 'audio':
      return (
        <div className="card-body center-body">
          <p className="eyebrow">Escucha · ¿qué significa?</p>
          <SpeakButton text={v.english} onSpeak={onSpeak} label="Escuchar palabra" big />
          <button type="button" className="link-btn" onClick={() => onSpeak(v.example_en)}>
            Oír en una frase
          </button>
        </div>
      )
    case 'dictation':
      return (
        <div className="card-body center-body">
          <p className="eyebrow">Dictado · escribe la frase</p>
          <SpeakButton text={v.example_en} onSpeak={onSpeak} label="Escuchar frase" big />
          <p className="muted small">Pista: {v.spanish}</p>
        </div>
      )
    case 'cloze': {
      const c = findCloze(v.english, v.example_en)
      return (
        <div className="card-body">
          <p className="eyebrow">{TYPE_LABEL[v.type]} · completa el hueco</p>
          {c ? (
            <p className="term term-sentence">
              {c.before}
              <span className="cloze-gap">{'_'.repeat(Math.max(4, Math.min(14, c.hidden.length)))}</span>
              {c.after}
            </p>
          ) : (
            <p className="term term-sentence">{v.spanish}</p>
          )}
          <p className="muted">({v.spanish})</p>
        </div>
      )
    }
    default:
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
  const cloze = mode === 'cloze' ? findCloze(v.english, v.example_en) : null
  const englishFirst = mode === 'inverse' || mode === 'cloze'
  return (
    <div className="card-body">
      {englishFirst ? (
        <>
          <p className="muted small">{v.spanish}</p>
          <div className="term-row">
            <p className="term">{v.english}</p>
            <SpeakButton text={v.english} onSpeak={onSpeak} />
          </div>
        </>
      ) : (
        <>
          <div className="term-row">
            <p className="muted small">{v.english}</p>
            {mode === 'audio' && <SpeakButton text={v.english} onSpeak={onSpeak} />}
          </div>
          <p className="term">{v.spanish}</p>
        </>
      )}
      <RegisterBadge register={v.register} />
      <div className="example">
        <div className="term-row">
          <p className="example-en">
            {cloze ? (
              <>
                {cloze.before}
                <mark>{cloze.hidden}</mark>
                {cloze.after}
              </>
            ) : (
              v.example_en
            )}
          </p>
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
