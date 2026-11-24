/// <reference types="vite/client" />
import { useEffect, useMemo, useState } from 'react'
import { MapPin, Search } from 'lucide-react'
import iconUrl from '@iconify-json/lucide/icons.json?url'
import emojiUrl from 'emojibase-data/de/compact.json?url'

export const placeCategories = [
  'Ort',
  'Sehenswürdigkeit',
  'Aussichtspunkt',
  'Berg',
  'Park',
  'Campingplatz',
  'Schlafplatz',
  'Parkplatz',
  'Sonstiges',
]
export type SymbolType = 'emoji' | 'lucide'
type Icons = { icons: Record<string, { body: string }>; aliases?: Record<string, { parent: string }> }
type Emoji = { unicode: string; label: string; tags?: string[]; order?: number; skins?: Emoji[] }
type Choice = { value: string; label: string; search: string }

const preferred: Record<string, string> = {
  Ort: 'map-pin',
  Berg: 'mountain',
  Park: 'trees',
  Schlafplatz: 'bed-double',
  Aussichtspunkt: 'binoculars',
  Sehenswürdigkeit: 'landmark',
  Campingplatz: 'tent',
  Parkplatz: 'square-parking',
}
export const categoryIcon = (name: string) => preferred[name] || 'map-pin'
const localizedNames: Record<string, string> = Object.fromEntries(
  Object.entries(preferred).map(([name, icon]) => [icon, name]),
)

async function localData<T>(url: string): Promise<T> {
  const response = await fetch(url)
  if (!response.ok) throw new Error('Die Symbolsammlung konnte nicht geladen werden.')
  return response.json()
}
let iconRequest: Promise<Icons> | undefined
function loadIcons() {
  iconRequest ??= localData<Icons>(iconUrl).catch((e) => {
    iconRequest = undefined
    throw e
  })
  return iconRequest
}
let emojiRequest: Promise<Choice[]> | undefined
function loadEmojis() {
  emojiRequest ??= localData<Emoji[]>(emojiUrl)
    .then((records) =>
      records
        .sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity))
        .flatMap((base) =>
          [base, ...(base.skins ?? [])].map((e) => ({
            label: e.label,
            value: e.unicode,
            search: [e.label, e.unicode, ...(base.tags ?? [])].join(' ').toLocaleLowerCase('de'),
          })),
        ),
    )
    .catch((e) => {
      emojiRequest = undefined
      throw e
    })
  return emojiRequest
}

export function usePlaceIcons() {
  const [icons, setIcons] = useState<Icons | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let current = true
    loadIcons()
      .then((value) => {
        if (current) setIcons(value)
      })
      .catch((e) => {
        if (current) setError(e.message)
      })
    return () => {
      current = false
    }
  }, [])
  return { icons, error }
}
export type PlaceIcons = Icons | null
export function iconBody(icons: PlaceIcons, name: string) {
  if (!icons) return ''
  const key = Object.hasOwn(icons.icons, name)
    ? name
    : icons.aliases && Object.hasOwn(icons.aliases, name)
      ? icons.aliases[name].parent
      : 'map-pin'
  return icons.icons[key]?.body ?? ''
}

export function PlaceGlyph({
  type,
  value,
  icons,
  size = 21,
}: {
  type: SymbolType
  value: string
  icons: PlaceIcons
  size?: number
}) {
  if (type === 'emoji')
    return (
      <span className="pl-emoji" style={{ fontSize: size }} aria-hidden="true">
        {value}
      </span>
    )
  const body = iconBody(icons, value)
  // SVG markup comes exclusively from the bundled Lucide catalog. Stored values only select a catalog key.
  return body ? (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      dangerouslySetInnerHTML={{ __html: body }}
    />
  ) : (
    <MapPin size={size} aria-hidden="true" />
  )
}

export function SymbolPicker({
  type,
  value,
  change,
}: {
  type: SymbolType
  value: string
  change: (type: SymbolType, value: string) => void
}) {
  const { icons, error: iconError } = usePlaceIcons()
  const [expanded, setExpanded] = useState(false)
  const [tab, setTab] = useState<SymbolType>(type)
  const [query, setQuery] = useState('')
  const [emojis, setEmojis] = useState<Choice[]>([])
  const [error, setError] = useState('')
  const [limit, setLimit] = useState(72)
  useEffect(() => {
    if (!expanded || tab !== 'emoji') return
    let current = true
    loadEmojis()
      .then((items) => {
        if (current) setEmojis(items)
      })
      .catch((cause) => {
        if (current) setError(cause.message)
      })
    return () => {
      current = false
    }
  }, [expanded, tab])
  const candidates = useMemo(() => {
    if (tab === 'emoji') return emojis
    if (!icons) return []
    const names = new Set([
      ...Object.values(preferred),
      ...Object.keys(icons.icons),
      ...Object.keys(icons.aliases ?? {}),
    ])
    return Array.from(names, (key) => ({
      value: key,
      label: localizedNames[key] || key,
      search: [key, localizedNames[key]].join(' ').toLocaleLowerCase('de'),
    }))
  }, [tab, icons, emojis])
  const matches = useMemo(
    () => candidates.filter((c) => c.search.includes(query.trim().toLocaleLowerCase('de'))),
    [candidates, query],
  )
  function switchTab(tab: SymbolType) {
    setTab(tab)
    setLimit(72)
    setQuery('')
  }
  return (
    <div className="pl-symbol-field">
      <button
        type="button"
        className="btn btn-secondary"
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
      >
        <PlaceGlyph type={type} value={value} icons={icons} /> Markersymbol wählen
      </button>
      {expanded && (
        <div className="pl-symbol-picker">
          <div className="pl-switch">
            <button type="button" aria-pressed={tab === 'emoji'} onClick={() => switchTab('emoji')}>
              Emojis
            </button>
            <button type="button" aria-pressed={tab === 'lucide'} onClick={() => switchTab('lucide')}>
              Icons
            </button>
          </div>
          <label className="pl-search">
            <Search size={16} />
            <input
              aria-label="Symbol suchen"
              type="search"
              placeholder={tab === 'emoji' ? 'Emoji suchen …' : 'Icon suchen, z. B. mountain …'}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setLimit(72)
              }}
            />
          </label>
          {error || iconError ? (
            <p role="alert">{error || iconError}</p>
          ) : candidates.length === 0 ? (
            <p role="status">Symbole werden geladen …</p>
          ) : matches.length === 0 ? (
            <p>Kein passendes Symbol gefunden.</p>
          ) : null}
          <div className="pl-symbol-results" aria-label="Symbolauswahl">
            {matches.slice(0, limit).map((c) => (
              <button
                key={c.value}
                type="button"
                title={c.label}
                aria-label={c.label}
                aria-pressed={type === tab && value === c.value}
                onClick={() => {
                  change(tab, c.value)
                  setExpanded(false)
                }}
              >
                <PlaceGlyph type={tab} value={c.value} icons={icons} />
              </button>
            ))}
            {matches.length > limit && (
              <button type="button" className="pl-more" onClick={() => setLimit(limit + 144)}>
                Weitere Symbole anzeigen
              </button>
            )}
          </div>
          <a className="pl-coords" href="/markersymbol-lizenzen.txt" target="_blank" rel="noreferrer">Lucide und Emojibase · Lizenzen</a>
        </div>
      )}
    </div>
  )
}
