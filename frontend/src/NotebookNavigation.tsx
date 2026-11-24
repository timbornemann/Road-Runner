import { createContext, useContext, useEffect, useRef } from 'react'
import { BookOpen } from 'lucide-react'
import { topicPath, type NotebookKind, type NotebookLink, type NotebookTarget } from './NotebookTypes'
import type { TripData } from './shared'

export const kindLabels: Record<NotebookKind, string> = {
  topic: 'Thema',
  note: 'Notiz',
  area: 'Gebiet',
  stop: 'Ort',
  stage: 'Etappe',
  variant: 'Variante',
  purchase: 'Anschaffung',
  pantry: 'Vorrat',
  shopping: 'Einkaufsartikel',
  mobility: 'Verkehr',
  expense: 'Ausgabe',
  journal: 'Tagebucheintrag',
}

export const targetPages = {
  topic: 'notebook',
  note: 'notebook',
  area: 'notebook',
  stop: 'route',
  stage: 'route',
  variant: 'route',
  purchase: 'purchases',
  pantry: 'pantry',
  shopping: 'pantry',
  mobility: 'mobility',
  expense: 'finance',
  journal: 'journal',
} as const

export function hashDestination() {
  const [page, kind, rawId, rawTrip] = location.hash.slice(1).split('/')
  const id = Number(rawId)
  if (
    !Object.hasOwn(targetPages, kind) ||
    targetPages[kind as NotebookKind] !== page ||
    !Number.isSafeInteger(id) ||
    id <= 0
  )
    return null
  return { target: { kind: kind as NotebookKind, id }, tripId: Number(rawTrip) || undefined }
}

export interface NamedTarget extends NotebookTarget {
  title: string
  detail: string
  backlinks: NotebookLink[]
}
export function targetIndex(data: TripData | null) {
  const index = new Map<string, NamedTarget>()
  if (!data) return index
  const add = (kind: NotebookKind, id: number, title: string, detail = '') =>
    index.set(kind + '/' + id, { kind, id, title, detail, backlinks: [] })
  const { topics, notes, areas } = data.notebook
  const trail = (id: number | null) =>
    topicPath(topics, id)
      .map((t) => t.title)
      .join(' › ')
  topics.forEach((t) => add('topic', t.id, t.title, trail(t.parent_id)))
  notes.forEach((n) => add('note', n.id, n.title, trail(n.topic_id)))
  areas.forEach((a) => add('area', a.id, a.name))
  data.stops.forEach((s) => add('stop', s.id, s.title, s.address))
  data.stages.forEach((s) => {
    add('stage', s.id, s.name)
    s.variants.forEach((v) => add('variant', v.id, v.name, s.name))
  })
  data.purchases.forEach((p) => add('purchase', p.id, p.title))
  data.pantry.forEach((p) => add('pantry', p.id, p.name))
  data.shopping.forEach((p) => add('shopping', p.id, p.name, p.done ? 'Eingekauft' : ''))
  data.mobility.forEach((m) => add('mobility', m.id, m.title))
  data.expenses.forEach((e) => add('expense', e.id, e.title, e.date))
  data.journal_entries.forEach((j) => add('journal', j.id, j.title || 'Tagebucheintrag', j.date))
  for (const link of data.notebook.links) {
    index.get(link.target_type + '/' + link.target_id)?.backlinks.push(link)
  }
  return index
}

export const NotebookNavigation = createContext<{
  data: TripData | null
  index: Map<string, NamedTarget>
  target: NotebookTarget | null
  open: (target: NotebookTarget) => void
}>({ data: null, index: new Map(), target: null, open: () => {} })

export const useNotebookNavigation = () => useContext(NotebookNavigation)

export function NotebookBacklinks({ target }: { target: NotebookTarget }) {
  const nav = useNotebookNavigation()
  const active = nav.target?.kind === target.kind && nav.target.id === target.id
  const anchor = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!active) return
    const row = anchor.current?.closest<HTMLElement>(
      '.rr-m-row, .rr-m-shopping-row, .journal-note, .rr-stage-admin-row',
    )
    if (!row) return
    row.classList.add('notebook-focused')
    row.tabIndex = -1
    const frame = requestAnimationFrame(() => {
      row.focus({ preventScroll: true })
      row.scrollIntoView({ block: 'nearest' })
    })
    return () => {
      cancelAnimationFrame(frame)
      row.classList.remove('notebook-focused')
      row.removeAttribute('tabindex')
    }
  }, [active])
  const incoming = nav.index.get(target.kind + '/' + target.id)?.backlinks ?? []
  if (!incoming.length && !active) return null
  return (
    <div className="notebook-backlinks" ref={anchor}>
      {incoming.length > 0 && (
        <span>
          <BookOpen size={13} /> Im Planungsheft
        </span>
      )}
      {incoming.map((l) => {
        const source = nav.index.get(l.source_type + '/' + l.source_id)
        return (
          source && (
            <button
              type="button"
              key={l.id}
              onClick={() => nav.open(source)}
              title={[source.detail, source.title].filter(Boolean).join(' › ')}
            >
              {source.title}
            </button>
          )
        )
      })}
    </div>
  )
}
