import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronRight,
  Compass,
  Crosshair,
  Expand,
  List,
  Map as MapIcon,
  MapPin,
  MapPinPlus,
  Minimize,
  Plus,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react'
import { api, Modal, type Place, type TripData } from './shared'
import PlaceMapDetails from './PlaceMapDetails'
import useMapFullscreen from './useMapFullscreen'
import PlaceEditor from './PlaceEditor'
import PlacesMap, { geoKey, type Focus, type GeoResult, type Viewport } from './PlacesMap'
import PlacesDiscovery from './PlacesDiscovery'
import { categoryIcon, PlaceGlyph, usePlaceIcons } from './PlaceSymbols'
import VisitEditor from './VisitEditor'
import './places.css'

interface Props {
  data: TripData
  reload: () => Promise<void>
  notify: (message: string) => void
  initialPlaceId?: number
  onOpenVisit: (id: number) => void
}
type Editor = { existing?: Place; initial?: Partial<Place> }
export default function Places({ data, reload, notify, initialPlaceId, onOpenVisit }: Props) {
  const { icons } = usePlaceIcons()
  const [source, setSource] = useState<'own' | 'discover'>('own')
  const [selected, setSelected] = useState<number | undefined>(initialPlaceId)
  const [candidate, setCandidate] = useState<GeoResult | null>(null)
  const [results, setResults] = useState<GeoResult[]>([])
  const [provider, setProvider] = useState('')
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')
  const [tag, setTag] = useState('')
  const [planned, setPlanned] = useState('')
  const [filters, setFilters] = useState(false)
  const [mobileList, setMobileList] = useState(false)
  const [view, setView] = useState<Viewport | null>(null)
  const selectedPlace = data.places.find((p) => p.id === selected)
  const unplaced = selectedPlace && (selectedPlace.lat === null || selectedPlace.lon === null)
    ? selectedPlace : undefined
  const card = useRef<HTMLElement>(null)
  const mapWrap = useRef<HTMLDivElement>(null)
  const [focus, setFocus] = useState<Focus | null>(() =>
    selectedPlace?.lat != null && selectedPlace.lon !== null
      ? { coords: [selectedPlace.lat, selectedPlace.lon] }
      : null,
  )
  const [placing, setPlacing] = useState<{ placeId?: number } | null>(null)
  const [editor, setEditor] = useState<Editor | null>(null)
  const [visitPlace, setVisitPlace] = useState<number | null>(null)
  const [remove, setRemove] = useState<Place | null>(null)
  const [deleteError, setDeleteError] = useState('')
  const [deleting, setDeleting] = useState(false)
  const { fullscreen, toggleFullscreen, fullscreenButtonRef } = useMapFullscreen(!!(editor || visitPlace || remove))
  const used = useMemo(() => new Set(data.visits.map((v) => v.place_id)), [data.visits])
  const osmPlaces = useMemo(
    () =>
      new Map(data.places.filter((p) => p.osm_type && p.osm_id).map((p) => [p.osm_type + '/' + p.osm_id, p])),
    [data.places],
  )
  const categories = useMemo(
    () => Array.from(new Set(data.places.map((p) => p.category))).sort((a, b) => a.localeCompare(b, 'de')),
    [data.places],
  )
  const tags = useMemo(
    () => Array.from(new Set(data.places.flatMap((p) => p.tags))).sort((a, b) => a.localeCompare(b, 'de')),
    [data.places],
  )
  const filtered = useMemo(() => {
    const text = query.trim().toLocaleLowerCase('de')
    return data.places
      .filter(
        (p) =>
          (!category || p.category === category) &&
          (!tag || p.tags.includes(tag)) &&
          (!planned || used.has(p.id) === (planned === 'yes')) &&
          (!text ||
            [p.title, p.category, p.address, p.description, ...p.tags]
              .join(' ')
              .toLocaleLowerCase('de')
              .includes(text)),
      )
      .sort((a, b) => a.title.localeCompare(b.title, 'de'))
  }, [data.places, category, tag, planned, query, used])
  const mapResults = useMemo(
    () => (source === 'discover' ? results.filter((r) => !osmPlaces.has(geoKey(r))) : []),
    [source, results, osmPlaces],
  )
  const visiblePlaces = useMemo(() => {
    if (source === 'discover') return data.places
    if (selectedPlace && !filtered.some((p) => p.id === selectedPlace.id)) return [...filtered, selectedPlace]
    return filtered
  }, [source, filtered, data.places, selectedPlace])
  const hasDetail = !!(selectedPlace || candidate)
  const linkedPlace = data.places.find((p) => p.id === initialPlaceId)
  useEffect(() => {
    if (linkedPlace) showPlace(linkedPlace)
    else {
      setSelected(undefined)
      setCandidate(null)
    }
  }, [initialPlaceId])
  useEffect(() => {
    if (unplaced) card.current?.focus({ preventScroll: true })
  }, [unplaced?.id])
  function showPlace(p: Place, center = true) {
    setSelected(p.id)
    setCandidate(null)
    setPlacing(null)
    setMobileList(false)
    if (center && p.lat !== null && p.lon !== null) setFocus({ coords: [p.lat, p.lon] })
  }
  function showResult(r: GeoResult, center = true) {
    const stored = osmPlaces.get(geoKey(r))
    if (stored) {
      showPlace(stored, center)
      return
    }
    setSelected(undefined)
    setCandidate(r)
    setPlacing(null)
    setMobileList(false)
    if (center) setFocus({ coords: [r.lat, r.lon] })
  }
  function dismiss() {
    setSelected(undefined)
    setCandidate(null)
  }
  function closeUnplaced() {
    dismiss()
    mapWrap.current?.querySelector<HTMLElement>('.pl-map-surface')?.focus({ preventScroll: true })
  }
  function switchSource(next: typeof source) {
    if (next === source) return
    dismiss()
    setPlacing(null)
    setSource(next)
  }
  function pick(coords: [number, number]) {
    const existing = placing?.placeId ? data.places.find((p) => p.id === placing.placeId) : undefined
    setPlacing(null)
    if (existing) setEditor({ existing, initial: { ...existing, lat: coords[0], lon: coords[1] } })
    else setEditor({ initial: { lat: coords[0], lon: coords[1] } })
  }
  async function saved(place: Place) {
    setEditor(null)
    try {
      await reload()
      showPlace(place)
      notify('Ort in der Sammlung gespeichert.')
    } catch {
      notify('Ort gespeichert. Die Ansicht konnte noch nicht aktualisiert werden.')
    }
  }
  async function confirmDelete() {
    if (!remove || deleting) return
    setDeleting(true)
    setDeleteError('')
    try {
      await api('/api/trips/' + data.trip.id + '/places/' + remove.id, 'DELETE')
    } catch (cause) {
      setDeleteError((cause as Error).message)
      setDeleting(false)
      return
    }
    setDeleting(false)
    setRemove(null)
    dismiss()
    try {
      await reload()
      notify('Ort gelöscht.')
    } catch {
      notify('Ort gelöscht. Die Ansicht konnte noch nicht aktualisiert werden.')
    }
  }
  const point = selectedPlace ?? candidate
  const detail = point && (
    <PlaceMapDetails
      data={data}
      place={selectedPlace}
      candidate={candidate}
      icons={icons}
      onVisit={setVisitPlace}
      onOpenVisit={onOpenVisit}
      onEdit={(place) => setEditor({ existing: place })}
      onDelete={(place) => {
        setDeleteError('')
        setRemove(place)
      }}
      onLocate={(place) => {
        setPlacing({ placeId: place.id })
        dismiss()
        setMobileList(false)
      }}
      onSaveResult={(result) => setEditor({ initial: { ...result, icon: categoryIcon(result.category) } })}
    />
  )
  return (
    <section className="places-page" aria-label="Ortekarte">
      <div className={'pl-atlas' + (fullscreen ? ' pl-full' : '') + (mobileList ? ' pl-list-visible' : '')}>
        <aside className="pl-panel" aria-label="Ortssammlung und Suche">
          <header className="pl-head">
            <div>
              <h1>Ortekarte</h1>
              <p className="pl-subtitle">
                {data.places.length} {data.places.length === 1 ? 'gespeicherter Ort' : 'gespeicherte Orte'}
              </p>
            </div>
            <button className="btn btn-primary" onClick={() => setEditor({})}>
              <Plus size={16} /> Ort anlegen
            </button>
          </header>
          <div className="pl-tabs pl-switch">
            <button aria-pressed={source === 'own'} onClick={() => switchSource('own')}>
              <List size={15} /> Sammlung
            </button>
            <button aria-pressed={source === 'discover'} onClick={() => switchSource('discover')}>
              <Compass size={15} /> Entdecken
            </button>
          </div>
          {source === 'own' ? (
            <>
              <div className="pl-tools">
                <label className="pl-search">
                  <Search size={16} />
                  <input
                    type="search"
                    aria-label="Gespeicherte Orte suchen"
                    placeholder="Gespeicherte Orte suchen"
                    value={query}
                    onChange={(e) => {
                      dismiss()
                      setQuery(e.target.value)
                    }}
                  />
                </label>
                <button
                  className={
                    'btn-icon pl-filter-button' + (filters || category || tag || planned ? ' active' : '')
                  }
                  aria-label="Orte filtern"
                  aria-expanded={filters}
                  onClick={() => setFilters(!filters)}
                >
                  <SlidersHorizontal size={17} />
                </button>
              </div>
              {filters && (
                <div className="pl-filters">
                  <label>
                    Kategorie
                    <select
                      aria-label="Kategorie"
                      value={category}
                      onChange={(e) => {
                        dismiss()
                        setCategory(e.target.value)
                      }}
                    >
                      <option value="">Alle Kategorien</option>
                      {categories.map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Tag
                    <select
                      aria-label="Tag"
                      value={tag}
                      onChange={(e) => {
                        dismiss()
                        setTag(e.target.value)
                      }}
                    >
                      <option value="">Alle Tags</option>
                      {tags.map((t) => (
                        <option key={t}>{t}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Planung
                    <select
                      aria-label="Planung"
                      value={planned}
                      onChange={(e) => {
                        dismiss()
                        setPlanned(e.target.value)
                      }}
                    >
                      <option value="">Alle Orte</option>
                      <option value="yes">Bereits eingeplant</option>
                      <option value="no">Noch offen</option>
                    </select>
                  </label>
                </div>
              )}
              <div className="pl-items" aria-label="Gespeicherte Orte">
                {filtered.map((p) => (
                  <button
                    className="pl-item"
                    key={p.id}
                    aria-pressed={selected === p.id}
                    onClick={() => showPlace(p)}
                  >
                    <span className="pl-item-symbol">
                      <PlaceGlyph value={p.icon} type={p.icon_type} icons={icons} />
                    </span>
                    <span>
                      <strong>{p.title}</strong>
                      <small>
                        {p.category}
                        {p.lat === null ? ' · Ohne Position' : used.has(p.id) ? ' · Eingeplant' : ''}
                      </small>
                    </span>
                    <ChevronRight size={14} />
                  </button>
                ))}
                {!filtered.length && (
                  <div className="pl-empty">
                    <MapPin size={23} />
                    <p>
                      {data.places.length
                        ? 'Keine Orte für diese Auswahl.'
                        : 'Deine Sammlung ist noch leer.'}
                    </p>
                    <button
                      className="text-link"
                      onClick={() => {
                        if (!data.places.length) {
                          switchSource('discover')
                          return
                        }
                        setQuery('')
                        setCategory('')
                        setPlanned('')
                        setTag('')
                      }}
                    >
                      {data.places.length ? 'Filter zurücksetzen' : 'Orte entdecken'}
                    </button>
                  </div>
                )}
              </div>
            </>
          ) : (
            <PlacesDiscovery
              viewport={view}
              results={results}
              setResults={(items) => {
                setResults(items)
                if (!items.length) dismiss()
              }}
              provider={provider}
              setProvider={setProvider}
              open={showResult}
              savedKeys={new Set(osmPlaces.keys())}
            />
          )}
        </aside>
        <div className="pl-map-wrap" ref={mapWrap}>
          <PlacesMap
            places={visiblePlaces}
            results={mapResults}
            contextKey={JSON.stringify([source, mobileList, query, category, tag, planned])}
            icons={icons}
            selectedId={selected}
            focus={focus}
            onMove={setView}
            onPlace={(p) => (placing ? pick([p.lat!, p.lon!]) : showPlace(p, false))}
            onResult={(result) => placing ? pick([result.lat, result.lon]) : showResult(result, false)}
            onClick={(coords) => hasDetail && !placing ? dismiss() : pick(coords)}
            popup={point?.lat != null && point.lon != null ? {
              key: selectedPlace ? 'place/' + selectedPlace.id : 'geo/' + geoKey(candidate!),
              coords: [point.lat, point.lon],
              content: detail,
            } : null}
            onDismissPopup={dismiss}
            placing={!!placing}
          />
          {unplaced && (
            <section
              ref={card}
              tabIndex={-1}
              className="pl-unplaced-card"
              role="dialog"
              aria-label={unplaced.title}
              onKeyDown={(event) => {
                if (event.key === 'Escape' && !event.defaultPrevented) {
                  event.preventDefault()
                  closeUnplaced()
                }
              }}
            >
              <button className="btn-icon pl-card-close" aria-label="Ortsdetails schließen" onClick={closeUnplaced}>
                <X size={16} />
              </button>
              {detail}
            </section>
          )}
          <div className="pl-map-tools">
            <button
              className="pl-map-command"
              title="Alle sichtbaren Orte anzeigen"
              aria-label="Alle sichtbaren Orte anzeigen"
              onClick={() => {
                dismiss()
                setFocus({ overview: true })
              }}
            >
              <Crosshair size={17} />
            </button>
            <button
              className="pl-map-command"
              aria-label={fullscreen ? 'Vollbild beenden' : 'Karte im Vollbild öffnen'}
              title={fullscreen ? 'Vollbild beenden' : 'Karte im Vollbild öffnen'}
              ref={fullscreenButtonRef}
              aria-pressed={fullscreen}
              onClick={toggleFullscreen}
            >
              {fullscreen ? <Minimize size={17} /> : <Expand size={17} />}
            </button>
            <button
              className="pl-map-command"
              aria-label="Punkt auf Karte setzen"
              title="Punkt auf Karte setzen"
              aria-pressed={!!placing}
              onClick={() => {
                dismiss()
                setPlacing(placing ? null : {})
                setMobileList(false)
              }}
            >
              <MapPinPlus size={17} />
            </button>
          </div>
          {placing && (
            <div className="pl-pick-notice" role="status">
              Position auf der Karte wählen
              <button aria-label="Platzieren abbrechen" onClick={() => setPlacing(null)}>
                <X size={14} />
              </button>
            </div>
          )}
        </div>
        {!fullscreen && (
          <button
            className="pl-mobile-switch"
            onClick={() => {
              dismiss()
              setPlacing(null)
              setMobileList(!mobileList)
            }}
          >
            {mobileList ? <MapIcon size={16} /> : <List size={16} />}{' '}
            {mobileList ? 'Karte anzeigen' : 'Orte und Suche'}
          </button>
        )}
      </div>
      {editor && (
        <PlaceEditor
          data={data}
          existing={editor.existing}
          initial={editor.initial}
          onClose={() => setEditor(null)}
          onSaved={saved}
        />
      )}
      {visitPlace !== null && (
        <VisitEditor
          data={data}
          placeId={visitPlace}
          reload={reload}
          notify={notify}
          onClose={() => setVisitPlace(null)}
        />
      )}
      {remove && (
        <Modal
          title="Ort löschen?"
          onClose={() => {
            if (!deleting) setRemove(null)
          }}
        >
          {data.visits.some((v) => v.place_id === remove.id) ? (
            <>
              <p>
                „{remove.title}“ ist in der Route eingeplant. Entferne zuerst die Besuche dieses Ortes aus der
                Routenplanung.
              </p>
              <div className="actions">
                <button className="btn btn-secondary" onClick={() => setRemove(null)}>
                  Schließen
                </button>
              </div>
            </>
          ) : (
            <>
              <p>
                „{remove.title}“ mit Titelbild und zugehörigen Ortsverknüpfungen aus dieser Reise löschen?
              </p>
              {deleteError && (
                <p role="alert" className="rr-error">
                  {deleteError}
                </p>
              )}
              <div className="actions">
                <button className="btn btn-secondary" disabled={deleting} onClick={() => setRemove(null)}>
                  Abbrechen
                </button>
                <button className="btn btn-danger" disabled={deleting} onClick={() => void confirmDelete()}>
                  Ort löschen
                </button>
              </div>
            </>
          )}
        </Modal>
      )}
    </section>
  )
}
