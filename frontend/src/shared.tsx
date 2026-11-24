import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import type { JournalEntry } from './journal-types'
import type { NotebookData } from './NotebookTypes'

export interface Trip {
  id: number
  name: string
  region: string
  description: string
  start_date: string | null
  end_date: string | null
  budget: number
  currency: string
  is_demo: boolean
}
interface Item {
  id: number
  trip_id: number
  tags: string[]
}
export interface Stop extends Item {
  title: string
  kind: 'stop' | 'sleep' | 'sight'
  date: string | null
  time: string | null
  end_date: string | null
  address: string
  lat: number | null
  lon: number | null
  notes: string
  position: number
  saved: boolean
  done: boolean
  stage_id: number | null
  variant_id: number | null
}
export interface RouteVariant {
  id: number
  stage_id: number
  name: string
  notes: string
}
export interface RouteStage {
  id: number
  trip_id: number
  name: string
  notes: string
  position: number
  active_variant_id: number | null
  variants: RouteVariant[]
}
export interface Expense extends Item {
  title: string
  amount: number
  currency: string
  exchange_rate: number
  base_amount: number
  date: string
  category: string
  status: 'planned' | 'paid'
  notes: string
  source_type: 'shopping' | 'purchases' | 'mobility' | null
  source_id: number | null
  items: { id: number; name: string; quantity: number; unit: string }[]
}
export interface Purchase extends Item {
  title: string
  quantity: number
  unit: string
  estimated_cost: number
  currency: string
  exchange_rate: number
  paid: boolean
  notes: string
  done: boolean
  expense_id: number | null
  date: string | null
}
export interface Mobility extends Item {
  title: string
  kind: 'fuel' | 'ferry' | 'train' | 'parking' | 'toll' | 'other'
  date: string | null
  stop_id: number | null
  quantity: number | null
  odometer: number | null
  origin: string
  destination: string
  departure: string | null
  arrival: string | null
  estimated_cost: number
  currency: string
  exchange_rate: number
  paid: boolean
  notes: string
  done: boolean
  expense_id: number | null
}
export interface PantryItem extends Item {
  name: string
  quantity: number
  unit: string
}
export interface ShoppingItem extends PantryItem {
  done: boolean
  manual: boolean
  expense_id: number | null
}
export interface TripData {
  notebook: NotebookData
  trip: Trip
  stops: Stop[]
  stages: RouteStage[]
  journal_entries: JournalEntry[]
  favorite_stop_ids: number[]
  purchases: Purchase[]
  shopping: ShoppingItem[]
  mobility: Mobility[]
  expenses: Expense[]
  pantry: PantryItem[]
}

export function activeRoute({ stages, stops }: TripData): Stop[] {
  const byId = new Map<number | null, RouteStage>(stages.map((stage) => [stage.id, stage]))
  const position = (stop: Stop) => byId.get(stop.stage_id)?.position ?? Number.MAX_SAFE_INTEGER
  return stops
    .filter((stop) =>
      !stop.saved && (stop.variant_id === null || stop.variant_id === byId.get(stop.stage_id)?.active_variant_id),
    )
    .sort((a, b) => position(a) - position(b) || a.position - b.position || a.id - b.id)
}

export async function api<T = unknown>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    const detail = payload?.detail
    throw new Error(
      typeof detail === 'string'
        ? detail
        : Array.isArray(detail)
          ? detail.map((entry: { msg: string }) => entry.msg).join(' · ')
          : 'Die Anfrage konnte nicht abgeschlossen werden (' + response.status + ').',
    )
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}
export function money(value: number, currency = 'EUR') {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency }).format(value)
}
export function localDate(date = new Date()) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}
export function dateLabel(date: string) {
  return new Date(date.slice(0, 10) + 'T12:00:00').toLocaleDateString('de-DE', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}
export function navUrl(stop: Stop) {
  const target =
    stop.lat != null && stop.lon != null ? [stop.lat, stop.lon].join(',') : stop.address || stop.title
  return 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(target)
}
export function Modal({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  close.current = onClose
  const titleId = useId()
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const focusable = () =>
      Array.from(
        ref.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]',
        ) ?? [],
      ).filter((el) => el.getClientRects().length > 0)
    ;(ref.current?.querySelector<HTMLElement>('input,select,textarea') ?? ref.current)?.focus()
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        close.current()
      }
      if (e.key !== 'Tab') return
      const nodes = focusable()
      if (!nodes.length) {
        e.preventDefault()
        return
      }
      if (e.shiftKey && (document.activeElement === nodes[0] || document.activeElement === ref.current)) {
        e.preventDefault()
        nodes.at(-1)?.focus()
      } else if (!e.shiftKey && document.activeElement === nodes.at(-1)) {
        e.preventDefault()
        nodes[0].focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previousOverflow
      before?.focus()
    }
  }, [])
  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        ref={ref}
      >
        <div className="modal-header">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="btn-icon" aria-label="Schließen" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  )
}
