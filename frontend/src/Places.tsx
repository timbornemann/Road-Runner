import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Compass,
  Crosshair,
  Expand,
  ExternalLink,
  List,
  Map as MapIcon,
  MapPin,
  MapPinPlus,
  Minimize,
  Navigation,
  Pencil,
  Plus,
  Route as RouteIcon,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react'
import { api, dateLabel, Modal, navUrl, type Place, type TripData } from './shared'
import { NotebookBacklinks, useNotebookNavigation } from './NotebookNavigation'
import { TagChips } from './Tags'
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
function OSMSource({ item }: { item: Pick<Place, 'osm_type' | 'osm_id'> }) {
  if (!item.osm_type || !item.osm_id) return null
  return (
    <a
      className="pl-coords"
      href={'https://www.openstreetmap.org/' + item.osm_type + '/' + item.osm_id}
      target="_blank"
      rel="noreferrer"
    >
      © OpenStreetMap-Mitwirkende ↗
    </a>
  )
}
export default function Places({ data, reload, notify, initialPlaceId, onOpenVisit }: Props) {
  const { open } = useNotebookNavigation()
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
  const [fullscreen, setFullscreen] = useState(false)
  const [mobileList, setMobileList] = useState(false)
  const [sheetExpanded, setSheetExpanded] = useState(false)
  const touchStart = useRef<number | null>(null)
  const [view, setView] = useState<Viewport | null>(null)
  const selectedPlace = data.places.find((p) => p.id === selected)
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
  const currentVisits = selectedPlace ? data.visits.filter((v) => v.place_id === selectedPlace.id) : []
  const areas = selectedPlace ? data.notebook.areas.filter((a) => a.stop_ids.includes(selectedPlace.id)) : []
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
    if (!fullscreen) return
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !editor && !visitPlace && !remove) setFullscreen(false)
    }
    document.addEventListener('keydown', escape)
    return () => document.removeEventListener('keydown', escape)
  }, [fullscreen, editor, visitPlace, remove])

  function showPlace(p: Place, center = true) {
    setSelected(p.id)
    setCandidate(null)
    setPlacing(null)
    setMobileList(false)
    setSheetExpanded(false)
    if (center && p.lat !== null && p.lon !== null) setFocus({ coords: [p.lat, p.lon] })
  }
  function showResult(r: GeoResult) {
    const stored = osmPlaces.get(geoKey(r))
    if (stored) {
      showPlace(stored)
      return
    }
    setSelected(undefined)
    setCandidate(r)
    setMobileList(false)
    setSheetExpanded(false)
    setFocus({ coords: [r.lat, r.lon] })
  }
  function back() {
    setSelected(undefined)
    setCandidate(null)
    setMobileList(true)
    setSheetExpanded(false)
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
    back()
    try {
      await reload()
      notify('Ort gelöscht.')
    } catch {
      notify('Ort gelöscht. Die Ansicht konnte noch nicht aktualisiert werden.')
    }
  }
  return (
    <section className="places-page">
      <header className="pl-head">
        <div>
          <h1 className="page-title">Ortekarte</h1>
          <p className="pl-subtitle">
            {data.trip.name} <span>·</span> {data.places.length}{' '}
            {data.places.length === 1 ? 'gespeicherter Ort' : 'gespeicherte Orte'}
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setEditor({})}>
          <Plus size={17} /> Ort anlegen
        </button>
      </header>
      <div
        className={
          'pl-atlas' +
          (fullscreen ? ' pl-full' : '') +
          (mobileList ? ' pl-list-visible' : '') +
          (hasDetail ? ' pl-has-detail' : '') +
          (sheetExpanded ? ' pl-expanded' : '')
        }
      >
        <aside className="pl-panel" aria-label={hasDetail ? 'Ortsdetails' : 'Ortssammlung und Suche'}>
          {hasDetail ? (
            <>
              <button
                type="button"
                className="pl-sheet-handle"
                onClick={() => setSheetExpanded(!sheetExpanded)}
                onTouchStart={(e) => {
                  touchStart.current = e.touches[0].clientY
                }}
                onTouchEnd={(e) => {
                  if (touchStart.current !== null) {
                    const delta = e.changedTouches[0].clientY - touchStart.current
                    if (Math.abs(delta) > 18) {
                      e.preventDefault()
                      setSheetExpanded(delta < 0)
                    }
                    touchStart.current = null
                  }
                }}
                aria-label={sheetExpanded ? 'Ortsdetails verkleinern' : 'Ortsdetails vergrößern'}
                aria-expanded={sheetExpanded}
              >
                {sheetExpanded ? <ChevronDown size={17} /> : <ChevronUp size={17} />}
              </button>
              <div className="pl-detail-scroll">
                <div className="pl-panel-bar">
                  <button className="text-link" onClick={back}>
                    <ArrowLeft size={16} />
                    {source === 'own' ? 'Zur Sammlung' : 'Zu den Treffern'}
                  </button>
                  <button
                    className="btn-icon"
                    aria-label="Ortsdetails schließen"
                    onClick={() => {
                      back()
                      setMobileList(false)
                    }}
                  >
                    <X size={16} />
                  </button>
                </div>
                {selectedPlace ? (
                  <div className="pl-detail">
                    {selectedPlace.image && (
                      <img
                        className="pl-cover"
                        alt={'Titelbild von ' + selectedPlace.title}
                        src={selectedPlace.image.url}
                      />
                    )}
                    <div className="pl-place-title">
                      <span className="pl-detail-symbol">
                        <PlaceGlyph
                          value={selectedPlace.icon}
                          type={selectedPlace.icon_type}
                          icons={icons}
                          size={26}
                        />
                      </span>
                      <div>
                        <small>{selectedPlace.category}</small>
                        <h2>{selectedPlace.title}</h2>
                      </div>
                    </div>
                    <TagChips tags={selectedPlace.tags} />
                    {selectedPlace.address && (
                      <p className="pl-address">
                        <MapPin size={14} />
                        {selectedPlace.address}
                      </p>
                    )}
                    {selectedPlace.lat !== null && selectedPlace.lon !== null ? (
                      <p className="pl-coords">
                        {selectedPlace.lat.toFixed(5)}, {selectedPlace.lon.toFixed(5)}
                      </p>
                    ) : (
                      <button
                        className="text-link"
                        onClick={() => {
                          setPlacing({ placeId: selectedPlace.id })
                          setSelected(undefined)
                          setMobileList(false)
                        }}
                      >
                        <MapPinPlus size={16} /> Auf Karte platzieren
                      </button>
                    )}
                    {selectedPlace.description && (
                      <p className="pl-description">{selectedPlace.description}</p>
                    )}
                    {!!selectedPlace.links.length && (
                      <ul className="pl-links">
                        {selectedPlace.links.map((link, i) => (
                          <li key={i}>
                            <a href={link.url} target="_blank" rel="noreferrer">
                              <ExternalLink size={14} />
                              {link.label || link.url}
                            </a>
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="pl-detail-actions">
                      <button className="btn btn-primary" onClick={() => setVisitPlace(selectedPlace.id)}>
                        <RouteIcon size={16} /> Zur Route hinzufügen
                      </button>
                      <a
                        className="btn btn-secondary"
                        href={navUrl(selectedPlace)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <Navigation size={15} /> Navigation öffnen
                      </a>
                    </div>
                    <OSMSource item={selectedPlace} />
                    {currentVisits.length > 0 && (
                      <section className="pl-visits">
                        <h3>In der Routenplanung</h3>
                        {currentVisits.map((v) => {
                          const stage = data.stages.find((s) => s.id === v.stage_id),
                            variant = stage?.variants.find((s) => s.id === v.variant_id)
                          return (
                            <button key={v.id} onClick={() => onOpenVisit(v.id)}>
                              {v.done ? <Check size={15} /> : <RouteIcon size={15} />}
                              <span>
                                <strong>
                                  {stage?.name || 'Ohne Etappe'}
                                  {variant ? ' · ' + variant.name : ''}
                                </strong>
                                <small>
                                  {v.date ? dateLabel(v.date) : 'Flexibler Stopp'}
                                  {v.time ? ' · ' + v.time.slice(0, 5) + ' Uhr' : ''}
                                </small>
                              </span>
                              <ChevronRight size={14} />
                            </button>
                          )
                        })}
                      </section>
                    )}
                    {!!areas.length && (
                      <div className="pl-areas">
                        <span>Gebiete</span>
                        {areas.map((a) => (
                          <button
                            className="text-link"
                            key={a.id}
                            onClick={() => open({ kind: 'area', id: a.id })}
                          >
                            {a.name}
                          </button>
                        ))}
                      </div>
                    )}
                    <NotebookBacklinks target={{ kind: 'stop', id: selectedPlace.id }} />
                    <div className="pl-admin">
                      <button className="text-link" onClick={() => setEditor({ existing: selectedPlace })}>
                        <Pencil size={14} /> Bearbeiten
                      </button>
                      <button
                        className="btn-icon"
                        title="Ort löschen"
                        aria-label="Ort löschen"
                        onClick={() => {
                          setDeleteError('')
                          setRemove(selectedPlace)
                        }}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                ) : (
                  candidate && (
                    <div className="pl-detail">
                      <div className="pl-place-title">
                        <span className="pl-detail-symbol external">
                          <MapPin size={25} />
                        </span>
                        <div>
                          <small>{candidate.category}</small>
                          <h2>{candidate.title}</h2>
                        </div>
                      </div>
                      {candidate.address && (
                        <p className="pl-address">
                          <MapPin size={15} />
                          {candidate.address}
                        </p>
                      )}
                      <OSMSource item={candidate} />
                      <p className="pl-coords">
                        {candidate.lat.toFixed(5)}, {candidate.lon.toFixed(5)}
                      </p>
                      <button
                        className="btn btn-primary"
                        onClick={() =>
                          setEditor({ initial: { ...candidate, icon: categoryIcon(candidate.category) } })
                        }
                      >
                        <Plus size={16} /> Ort übernehmen
                      </button>
                    </div>
                  )
                )}
              </div>
            </>
          ) : (
            <>
              <div className="pl-tabs pl-switch">
                <button aria-pressed={source === 'own'} onClick={() => setSource('own')}>
                  <List size={15} /> Sammlung
                </button>
                <button aria-pressed={source === 'discover'} onClick={() => setSource('discover')}>
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
                        onChange={(e) => setQuery(e.target.value)}
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
                          onChange={(e) => setCategory(e.target.value)}
                        >
                          <option value="">Alle Kategorien</option>
                          {categories.map((c) => (
                            <option key={c}>{c}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Tag
                        <select aria-label="Tag" value={tag} onChange={(e) => setTag(e.target.value)}>
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
                          onChange={(e) => setPlanned(e.target.value)}
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
                      <button className="pl-item" key={p.id} onClick={() => showPlace(p)}>
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
                              setSource('discover')
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
                  setResults={setResults}
                  provider={provider}
                  setProvider={setProvider}
                  open={showResult}
                  savedKeys={new Set(osmPlaces.keys())}
                />
              )}
            </>
          )}
        </aside>
        <div className="pl-map-wrap">
          <PlacesMap
            places={visiblePlaces}
            results={mapResults}
            icons={icons}
            selectedId={selected}
            focus={focus}
            onMove={setView}
            onPlace={(p) => (placing ? pick([p.lat!, p.lon!]) : showPlace(p, false))}
            onResult={showResult}
            onClick={pick}
            placing={!!placing}
          />
          <div className="pl-map-tools">
            <button
              className="pl-map-command"
              title="Alle sichtbaren Orte anzeigen"
              aria-label="Alle sichtbaren Orte anzeigen"
              onClick={() => setFocus({ overview: true })}
            >
              <Crosshair size={17} />
            </button>
            <button
              className="pl-map-command"
              aria-label={fullscreen ? 'Vergrößerte Karte schließen' : 'Karte vergrößern'}
              title={fullscreen ? 'Vergrößerte Karte schließen' : 'Karte vergrößern'}
              onClick={() => setFullscreen(!fullscreen)}
            >
              {fullscreen ? <Minimize size={17} /> : <Expand size={17} />}
            </button>
            <button
              className="pl-map-command"
              aria-label="Punkt auf Karte setzen"
              title="Punkt auf Karte setzen"
              aria-pressed={!!placing}
              onClick={() => {
                setSelected(undefined)
                setCandidate(null)
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
        {!hasDetail && (
          <button className="pl-mobile-switch" onClick={() => setMobileList(!mobileList)}>
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
