import { useState } from 'react'
import { sendLoginCode, signInWithPassword, signOut, syncNow, useCloud, verifyLoginCode } from '../lib/cloud'
import { formatInterval } from '../lib/scheduler'

export function ago(iso: string | null): string {
  if (!iso) return 'nunca'
  const ms = Date.now() - new Date(iso).getTime()
  return ms < 60_000 ? 'ahora mismo' : `hace ${formatInterval(ms)}`
}

/** Bloque de Ajustes: login con código de email y estado de la sincronización. */
export default function CloudSync() {
  const cloud = useCloud()
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [step, setStep] = useState<'password' | 'email' | 'code'>('password')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setMsg(null)
    try {
      await fn()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (!cloud.configured) {
    return (
      <div className="card-surface group">
        <h2>Sincronización</h2>
        <p className="muted small">
          Sin configurar: faltan <code>VITE_SUPABASE_URL</code> y <code>VITE_SUPABASE_ANON_KEY</code> en el build. El progreso se guarda solo en este
          dispositivo.
        </p>
      </div>
    )
  }

  if (!cloud.session) {
    return (
      <div className="card-surface group" data-testid="cloud-login">
        <h2>Sincronización</h2>
        <p className="muted small">Entra para sincronizar el progreso entre el móvil y el PC.</p>
        {step === 'password' ? (
          <form
            className="stack-form"
            onSubmit={(e) => {
              e.preventDefault()
              void run(() => signInWithPassword(email.trim(), password))
            }}
          >
            <input type="email" required autoComplete="username" placeholder="tu@email.com" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email" />
            <input
              type="password"
              required
              autoComplete="current-password"
              placeholder="Contraseña"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-label="Contraseña"
            />
            <button className="btn btn-primary" disabled={busy || !email || !password}>
              Entrar
            </button>
          </form>
        ) : step === 'email' ? (
          <form
            className="row-form"
            onSubmit={(e) => {
              e.preventDefault()
              void run(async () => {
                await sendLoginCode(email.trim())
                setStep('code')
                setMsg('Código enviado. Mira tu correo (y la carpeta de spam).')
              })
            }}
          >
            <input type="email" required autoComplete="email" placeholder="tu@email.com" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email" />
            <button className="btn btn-primary" disabled={busy || !email}>
              Enviar código
            </button>
          </form>
        ) : (
          <form
            className="row-form"
            onSubmit={(e) => {
              e.preventDefault()
              void run(() => verifyLoginCode(email.trim(), code))
            }}
          >
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="Código"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              aria-label="Código"
              maxLength={10}
            />
            <button className="btn btn-primary" disabled={busy || code.length < 6}>
              Entrar
            </button>
          </form>
        )}
        {step === 'code' && (
          <button className="link-btn" onClick={() => setStep('email')}>
            Cambiar email o reenviar
          </button>
        )}
        <button className="link-btn" onClick={() => setStep(step === 'password' ? 'email' : 'password')}>
          {step === 'password' ? 'Entrar con código por email' : 'Entrar con contraseña'}
        </button>
        {msg && <p className="muted small">{msg}</p>}
      </div>
    )
  }

  const label =
    cloud.status === 'syncing'
      ? 'Sincronizando…'
      : cloud.status === 'offline'
        ? 'Sin conexión: se subirá al volver'
        : cloud.status === 'error'
          ? `Error: ${cloud.error}`
          : cloud.pending
            ? `${cloud.pending} cambios pendientes`
            : 'Todo sincronizado'

  return (
    <div className="card-surface group" data-testid="cloud-on">
      <h2>Sincronización</h2>
      <div className={`sync-status sync-${cloud.status}`}>
        <span className="sync-dot" />
        <div>
          <b>{label}</b>
          <div className="muted small">
            {cloud.session.user.email} · última {ago(cloud.lastSync)}
          </div>
        </div>
      </div>
      <div className="row-gap">
        <button className="btn" disabled={cloud.status === 'syncing'} onClick={() => void syncNow()}>
          Sincronizar ahora
        </button>
        <button className="btn" onClick={() => void run(signOut)}>
          Cerrar sesión
        </button>
      </div>
      {msg && <p className="muted small">{msg}</p>}
    </div>
  )
}
