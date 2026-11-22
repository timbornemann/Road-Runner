import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import {
  ArrowDownLeft,
  Check,
  ChevronDown,
  CircleHelp,
  LoaderCircle,
  Plus,
  X,
  type LucideIcon,
} from 'lucide-react'
import { dateLabel } from '../shared'
export { localDate as dayNow, money as moneyLabel } from '../shared'

export const todayLabel = (date?: string | null) => date ? dateLabel(date) : 'Ohne Datum'
export const qty = (value: number) => new Intl.NumberFormat('de-DE', { maximumFractionDigits: 4 }).format(value)
export const categories: Record<string, string> = {
  food: 'Lebensmittel',
  purchase: 'Anschaffungen',
  mobility: 'Mobilität',
  lodging: 'Übernachtung',
  other: 'Sonstiges',
}
export const kindNames: Record<string, string> = {
  fuel: 'Tanken',
  ferry: 'Fähre',
  train: 'Bahnfahrt',
  other: 'Sonstiges',
}

export function Header({
  title,
  description,
  action,
  onAction,
}: {
  title: string
  description: string
  action: string
  onAction: () => void
}) {
  return (
    <div className="rr-m-header">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <button className="rr-m-button primary" onClick={onAction}>
        <Plus size={17} />
        {action}
      </button>
    </div>
  )
}
export function Metric({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: LucideIcon
  label: string
  value: string
  sub?: string
}) {
  return (
    <div className="rr-m-metric">
      <span className="rr-m-metric-icon">
        <Icon size={20} />
      </span>
      <div>
        <span className="rr-m-small">{label}</span>
        <strong>{value}</strong>
        {sub && <small>{sub}</small>}
      </div>
    </div>
  )
}
export function Card({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rr-m-card">
      <div className="rr-m-card-head">
        <h2>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}
export function Empty({ icon: Icon = CircleHelp, text }: { icon?: LucideIcon; text: string }) {
  return (
    <div className="rr-m-empty">
      <Icon size={26} />
      <p>{text}</p>
    </div>
  )
}
export function Row({
  icon: Icon,
  title,
  sub,
  amount,
  detail,
  actions,
  children,
}: {
  icon?: LucideIcon
  title: string
  sub?: string
  amount?: string
  detail?: string
  actions?: ReactNode
  children?: ReactNode
}) {
  return (
    <div className="rr-m-row">
      {Icon && (
        <span className="rr-m-row-icon">
          <Icon size={19} />
        </span>
      )}
      <div className="rr-m-row-info">
        <strong>{title}</strong>
        {sub && <small>{sub}</small>}
        {children}
      </div>
      {(amount || detail) && (
        <div className="rr-m-row-total">
          <strong>{amount}</strong>
          {detail && <small>{detail}</small>}
        </div>
      )}
      {actions && <div className="rr-m-actions">{actions}</div>}
    </div>
  )
}
export function IconButton({
  icon: Icon,
  label,
  onClick,
  danger = false,
}: {
  icon: LucideIcon
  label: string
  onClick: () => void
  danger?: boolean
}) {
  return (
    <button
      type="button"
      className={`rr-m-icon-btn${danger ? ' danger' : ''}`}
      title={label}
      aria-label={label}
      onClick={onClick}
    >
      <Icon size={17} />
    </button>
  )
}
export function Status({ done, label }: { done: boolean; label?: string }) {
  return (
    <span className={`rr-m-pill ${done ? 'done' : 'open'}`}>
      {done ? <Check size={12} /> : <ArrowDownLeft size={12} />} {label ?? (done ? 'Bezahlt' : 'Geplant')}
    </span>
  )
}
export function Tabs<T extends string>({
  value,
  tabs,
  onChange,
}: {
  value: T
  tabs: readonly { value: T; label: string }[]
  onChange: (value: T) => void
}) {
  return (
    <div className="rr-m-tabs">
      {tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          aria-pressed={value === t.value}
          className={value === t.value ? 'active' : ''}
          onClick={() => onChange(t.value)}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}
export function Field({
  label,
  children,
  full = false,
  hint,
}: {
  label: string
  children: ReactNode
  full?: boolean
  hint?: string
}) {
  return (
    <label className={`rr-m-field${full ? ' wide' : ''}`}>
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  )
}
export function Select({
  value,
  onChange,
  children,
}: {
  value: string
  onChange: (s: string) => void
  children: ReactNode
}) {
  return (
    <span className="rr-m-select">
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {children}
      </select>
      <ChevronDown size={15} />
    </span>
  )
}
export function Modal({
  title,
  children,
  onClose,
  onSubmit,
  save = 'Speichern',
  danger = false,
}: {
  title: string
  children: ReactNode
  onClose: () => void
  onSubmit: () => Promise<void>
  save?: string
  danger?: boolean
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const active = useRef(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    const el = ref.current
    el?.showModal()
    return () => el?.close()
  }, [])
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (active.current) return
    active.current = true
    setBusy(true)
    setError('')
    try {
      await onSubmit()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Speichern fehlgeschlagen.')
    } finally {
      active.current = false
      setBusy(false)
    }
  }
  return (
    <dialog
      ref={ref}
      className="rr-m-dialog"
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault()
        if (!busy) onClose()
      }}
    >
      <form onSubmit={submit}>
        <header>
          <h2>{title}</h2>
          <button
            type="button"
            className="rr-m-icon-btn"
            aria-label="Schließen"
            disabled={busy}
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </header>
        <div className="rr-m-formbody">
          {children}
          {error && (
            <p className="rr-m-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <footer>
          <button type="button" className="rr-m-button secondary" onClick={onClose} disabled={busy}>
            Abbrechen
          </button>
          <button
            type="submit"
            disabled={busy}
            className={'rr-m-button ' + (danger ? 'destructive' : 'primary')}
          >
            {busy && <LoaderCircle size={15} className="rr-m-spin" />}
            {save}
          </button>
        </footer>
      </form>
    </dialog>
  )
}
