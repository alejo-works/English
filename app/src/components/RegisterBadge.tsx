import type { Register } from '../types'

/** Aviso visible para slang / informal: no usar con clientes ni en entrevistas. */
export default function RegisterBadge({ register, compact = false }: { register: Register; compact?: boolean }) {
  if (register === 'slang') {
    return <span className="reg reg-slang">⚠ slang{compact ? '' : ' · no usar con clientes'}</span>
  }
  if (register === 'informal') {
    return <span className="reg reg-informal">informal{compact ? '' : ' · evita con clientes'}</span>
  }
  if (register === 'formal') return <span className="reg reg-formal">formal</span>
  return compact ? null : null
}
