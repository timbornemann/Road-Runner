import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Check, Compass, MapPin, Search } from 'lucide-react'
import { geoKey, type GeoResult, type Viewport } from './PlacesMap'

const categories = ['Alle', 'Aussichtspunkt', 'Sehenswürdigkeit', 'Park', 'Berg', 'Campingplatz']
interface Props {
  viewport: Viewport | null
  results: GeoResult[]
  setResults: (items: GeoResult[]) => void
  provider: string
  setProvider: (name: string) => void
  open: (item: GeoResult) => void
  savedKeys: Set<string>
}
export default function PlacesDiscovery({
  viewport,
  results,
  setResults,
  provider,
  setProvider,
  open,
  savedKeys,
}: Props) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('Alle')
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const controller = useRef<AbortController | null>(null)
  useEffect(() => () => controller.current?.abort(), [])
  async function lookup(mode: 'name' | 'nearby', event?: FormEvent) {
    event?.preventDefault()
    const params = new URLSearchParams()
    if (mode === 'name') {
      if (!query.trim()) return
      params.set('q', query.trim())
      if (viewport) {
        params.set('lat', String(viewport.lat))
        params.set('lon', String(viewport.lon))
      }
    } else {
      if (!viewport) return
      const { north, south, east, west } = viewport
      if (north - south > 0.5 || east - west > 1) {
        setStatus('Zoome näher heran, um diese Umgebung zu erkunden.')
        return
      }
      const wrap = (longitude: number) => ((((longitude + 180) % 360) + 360) % 360) - 180
      if (wrap(east) < wrap(west)) {
        setStatus('Wähle einen Ausschnitt auf einer Seite der Datumsgrenze.')
        return
      }
      Object.entries({ north, south, east: wrap(east), west: wrap(west), category }).forEach(([key, value]) =>
        params.set(key, String(value)),
      )
    }
    controller.current?.abort()
    const request = new AbortController()
    controller.current = request
    setBusy(true)
    setStatus('Suche läuft …')
    setResults([])
    try {
      const response = await fetch('/api/geo/' + (mode === 'name' ? 'search' : 'nearby') + '?' + params, {
        signal: request.signal,
      })
      const payload = await response.json()
      if (!response.ok)
        throw new Error(
          typeof payload.detail === 'string'
            ? payload.detail
            : 'Der Kartendienst ist gerade nicht erreichbar.',
        )
      if (controller.current !== request) return
      const items = Array.from(
        new Map((payload.items as GeoResult[]).map((item) => [geoKey(item), item])).values(),
      )
      setResults(items)
      setProvider(
        mode === 'name' ? 'Photon' : payload.source === 'photon' ? 'Photon (Umgebungssuche)' : 'Overpass',
      )
      setStatus(
        items.length
          ? payload.truncated
            ? 'Weitere Treffer verfügbar. Zoome näher heran oder wähle eine Kategorie.'
            : ''
          : 'Keine passenden Orte gefunden.',
      )
    } catch (cause) {
      if (!request.signal.aborted) setStatus((cause as Error).message)
    } finally {
      if (controller.current === request && !request.signal.aborted) setBusy(false)
    }
  }
  return (
    <div className="pl-discovery">
      <form onSubmit={(e) => void lookup('name', e)} className="pl-external-search">
        <label className="pl-search">
          <Search size={16} />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ortsname oder Adresse"
            aria-label="Online nach Ortsname oder Adresse suchen"
          />
        </label>
        <button className="btn btn-primary" aria-label="Online suchen" disabled={!query.trim() || busy}>
          <Search size={16} />
        </button>
      </form>
      <div className="pl-nearby">
        <label className="field">
          Umgebung erkunden
          <select
            aria-label="Kategorie für die Umgebungssuche"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            {categories.map((c) => (
              <option key={c} value={c}>
                {c === 'Alle' ? 'Alle Kategorien' : c}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={busy || !viewport}
          onClick={() => void lookup('nearby')}
        >
          <Compass size={16} /> Diese Umgebung erkunden
        </button>
      </div>
      {status && (
        <p className="pl-muted" role="status">
          {status}
        </p>
      )}
      {results.length > 0 && (
        <p className="pl-result-source">
          {provider} ·{' '}
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
            © OpenStreetMap-Mitwirkende
          </a>
        </p>
      )}
      {results.length > 0 && (
        <div className="pl-items" aria-label="Öffentliche Suchtreffer">
          {results.map((item) => (
            <button key={geoKey(item)} className="pl-item" onClick={() => open(item)}>
              <span className="pl-item-symbol external">
                <MapPin size={18} />
              </span>
              <span>
                <strong>{item.title}</strong>
                <small>{[item.category, item.address].filter(Boolean).join(' · ')}</small>
              </span>
              {savedKeys.has(geoKey(item)) && <Check size={15} aria-label="Gespeichert" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
