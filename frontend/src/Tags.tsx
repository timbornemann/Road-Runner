import { useId, useState } from 'react'
import { ChevronDown, Layers3, ListFilter, Plus, Tag } from 'lucide-react'
import type { TripData } from './shared'
import './tags.css'

type Tagged = { tags: string[] }
type TagGroup<T> = { key: string; label: string; items: T[] }
const all = 'all'
const untagged = 'untagged'

function tagKey(label: string) {
  return label.trim().normalize('NFC').toLocaleLowerCase('de').replaceAll('ß', 'ss').replaceAll('ς', 'σ')
}

function uniqueTags(labels: string[]) {
  const result = new Map<string, string>()
  for (const label of labels) {
    const key = tagKey(label)
    if (key && !result.has(key)) result.set(key, label.trim())
  }
  return [...result.values()]
}

function sortedTags(items: Tagged[]) {
  return uniqueTags(items.flatMap((item) => item.tags ?? [])).sort((a, b) => a.localeCompare(b, 'de'))
}

export function tripTags(data: TripData) {
  return sortedTags([
    ...data.stops,
    ...data.purchases,
    ...data.pantry,
    ...data.shopping,
    ...data.mobility,
    ...data.expenses,
  ])
}

export function TagChips({ tags }: Tagged) {
  if (!tags?.length) return null
  return (
    <span className="tag-chips" aria-label="Tags">
      {tags.map((label) => (
        <span className="tag-chip" key={tagKey(label)}>
          <Tag size={11} aria-hidden="true" />
          {label}
        </span>
      ))}
    </span>
  )
}

export function TagEditor({
  value,
  onChange,
  suggestions = [],
}: {
  value: string[]
  onChange: (tags: string[]) => void
  suggestions?: string[]
}) {
  const [draft, setDraft] = useState(() => value.join(', '))
  const [typing, setTyping] = useState(false)
  const id = useId()
  function edit(text: string) {
    setDraft(text)
    onChange(uniqueTags(text.split(',')))
  }
  const tokens = draft.split(',')
  const tail = tagKey(tokens[tokens.length - 1])
  const selected = new Set(value.map(tagKey))
  const completing = typing && tail !== '' && !suggestions.some((label) => tagKey(label) === tail)
  const matches = suggestions
    .filter((label) => !selected.has(tagKey(label)) && (!completing || tagKey(label).startsWith(tail)))
    .slice(0, 6)
  function add(label: string) {
    const previous = completing ? tokens.slice(0, -1) : value
    edit([...uniqueTags([...previous, label]), ''].join(', '))
    setTyping(false)
  }
  return (
    <div className="tag-editor wide">
      <label htmlFor={id}>Tags</label>
      <input
        id={id}
        value={draft}
        onChange={(e) => {
          setTyping(true)
          edit(e.target.value)
        }}
        autoComplete="off"
        aria-describedby={id + '-help'}
        placeholder="z. B. Schlafen, Elektronik"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            e.preventDefault()
            if (tail) edit([...value, ''].join(', '))
          }
        }}
      />
      <small id={id + '-help'}>Mehrere Tags mit Komma trennen.</small>
      {matches.length > 0 && (
        <div className="tag-suggestions" aria-label="Vorhandene Tags">
          {matches.map((label) => (
            <button key={tagKey(label)} type="button" onClick={() => add(label)}>
              <Plus size={11} aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function useTagView<T extends Tagged>(items: T[]) {
  const [selection, setSelection] = useState(all)
  const [grouped, setGrouped] = useState(false)
  const labels = sortedTags(items)
  const optionKey = (label: string) => 'tag:' + tagKey(label)
  const filter =
    selection === untagged || labels.some((label) => optionKey(label) === selection) ? selection : all
  const filtered = items.filter((item) => {
    if (filter === all) return true
    if (filter === untagged) return !item.tags?.length
    return item.tags.some((label) => optionKey(label) === filter)
  })

  let groups: TagGroup<T>[]
  if (grouped) {
    const buckets = new Map<string, T[]>()
    for (const item of filtered) {
      const keys = item.tags?.length ? item.tags.map(optionKey) : [untagged]
      for (const key of keys) {
        if (filter !== all && filter !== key) continue
        const bucket = buckets.get(key)
        if (bucket) bucket.push(item)
        else buckets.set(key, [item])
      }
    }
    const headings = [
      ...labels.map((label) => ({ key: optionKey(label), label })),
      { key: untagged, label: 'Ohne Tag' },
    ]
    groups = headings
      .filter((group) => buckets.has(group.key))
      .map((group) => ({ ...group, items: buckets.get(group.key)! }))
  } else {
    groups = filtered.length ? [{ key: all, label: '', items: filtered }] : []
  }

  const controls = (
    <div className="tag-controls">
      <label className={'tag-filter' + (filter !== all ? ' selected' : '')}>
        <ListFilter size={15} aria-hidden="true" />
        <select aria-label="Nach Tag filtern" value={filter} onChange={(e) => setSelection(e.target.value)}>
          <option value={all}>Alle Tags</option>
          <option value={untagged}>Ohne Tag</option>
          {labels.map((label) => (
            <option value={optionKey(label)} key={optionKey(label)}>
              {label}
            </option>
          ))}
        </select>
        <ChevronDown size={13} aria-hidden="true" />
      </label>
      <button
        type="button"
        className="tag-group-toggle"
        aria-pressed={grouped}
        onClick={() => setGrouped(!grouped)}
      >
        <Layers3 size={15} aria-hidden="true" />
        Nach Tags gruppieren
      </button>
    </div>
  )
  return { filtered, groups, grouped, active: filter !== all, controls }
}
