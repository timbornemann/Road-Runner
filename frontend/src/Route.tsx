import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import * as L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import {
  ArrowDown,
  ArrowUp,
  BedDouble,
  BookOpen,
  Bookmark,
  CalendarDays,
  Camera,
  Check,
  ChevronRight,
  Compass,
  ExternalLink,
  Flag,
  GripVertical,
  Layers3,
  List,
  LocateFixed,
  Map as MapIcon,
  MapPin,
  MapPinPlus,
  Navigation,
  Pencil,
  Plus,
  Route as RouteIcon,
  Trash2,
} from 'lucide-react'
import { activeRoute, api, dateLabel, Modal, navUrl, type RouteStage, type Stop, type TripData } from './shared'
import { TagChips, TagEditor, tripTags, useTagView } from './Tags'
import StageManager from './StageManager'
import RouteStageCard from './RouteStageCard'
import './route.css'

const kinds = {
  stop: { title: 'Zwischenstopp', Icon: MapPin },
  sight: { title: 'Sehenswürdigkeit', Icon: Camera },
  sleep: { title: 'Schlafplatz', Icon: BedDouble },
}
type StopKind = keyof typeof kinds
type Coordinates = [number, number]

function ordered(stops: Stop[]) {
  return [...stops].sort((a, b) => a.position - b.position || a.id - b.id)
}

function getCoordinates(stop: Stop): Coordinates | null {
  return typeof stop.lat === 'number' && typeof stop.lon === 'number' ? [stop.lat, stop.lon] : null
}

function dayLabel(value: string) {
  return value
    ? new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(
        new Date(value + 'T12:00:00'),
      )
    : 'Flexible Stopps'
}

interface MapProps {
  stops: Stop[]
  connectStops?: boolean
  visibleIds?: ReadonlySet<number>
  onSelect?: (stop: Stop) => void
  onPick?: (coords: Coordinates) => void
  picked?: Coordinates | null
}

function fitPlaces(map: L.Map, coords: Coordinates[]) {
  if (coords.length === 1) map.setView(coords[0], 11, { animate: false })
  else if (coords.length > 1) map.fitBounds(L.latLngBounds(coords), { padding: [32, 32], maxZoom: 13, animate: false })
  else map.setView([46.8, 9.5], 6, { animate: false })
}

/** This is an itinerary overview. The dashed line connects places in visiting order. */
export function TripMap({ stops, visibleIds, onSelect, onPick, picked, connectStops = true }: MapProps) {
  const host = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layersRef = useRef<L.LayerGroup | null>(null)
  const visiblePoints = useRef<Coordinates[]>([])
  const action = useRef({ onPick, onSelect })
  action.current = { onPick, onSelect }
  const lastFit = useRef('')
  const [tileError, setTileError] = useState(false)

  useEffect(() => {
    if (!host.current) return
    const map = L.map(host.current, { scrollWheelZoom: false, zoomControl: false, minZoom: 2 }).setView([46.8, 9.5], 6)
    mapRef.current = map
    const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution:
        '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>',
    })
    let sawTile = false
    tiles.on('loading', () => {
      sawTile = false
    })
    tiles.on('tileload', () => {
      sawTile = true
      setTileError(false)
    })
    tiles.on('load', () => {
      setTileError(!sawTile && !host.current?.querySelector('.leaflet-tile-loaded'))
    })
    tiles.on('tileerror', () => {
      if (!sawTile) setTileError(true)
    })
    tiles.addTo(map)
    L.control.zoom({ position: 'bottomright', zoomInTitle: 'Vergrößern', zoomOutTitle: 'Verkleinern' }).addTo(map)
    map.attributionControl.setPrefix(false)
    layersRef.current = L.layerGroup().addTo(map)
    map.on('click', (event: L.LeafletMouseEvent) =>
      action.current.onPick?.([Number(event.latlng.lat.toFixed(6)), Number(event.latlng.wrap().lng.toFixed(6))]),
    )
    let hidden = !host.current.clientWidth || !host.current.clientHeight
    const resize = new ResizeObserver(() => {
      const nowHidden = !host.current?.clientWidth || !host.current?.clientHeight
      map.invalidateSize()
      if (!nowHidden && hidden) fitPlaces(map, visiblePoints.current)
      hidden = nowHidden
    })
    resize.observe(host.current)
    return () => {
      resize.disconnect()
      map.remove()
      mapRef.current = null
      layersRef.current = null
      lastFit.current = ''
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    const layer = layersRef.current
    if (!map || !layer) return
    layer.clearLayers()
    const route = stops.filter((stop) => !stop.saved)
    const pins = [...route, ...stops.filter((stop) => stop.saved)]
    const routeCoords = route.map(getCoordinates).filter((coord): coord is Coordinates => !!coord)
    if (connectStops && routeCoords.length > 1 && route.some((stop) => !visibleIds || visibleIds.has(stop.id)))
      L.polyline(routeCoords, {
        color: '#29644e',
        weight: 3,
        opacity: 0.8,
        dashArray: '5 8',
        interactive: false,
      }).addTo(layer)
    const allCoords: Coordinates[] = []
    pins.forEach((stop, index) => {
      if (visibleIds && !visibleIds.has(stop.id)) return
      const coords = getCoordinates(stop)
      if (!coords) return
      allCoords.push(coords)
      const style = stop.saved ? 'saved' : stop.kind === 'sleep' ? 'sleep' : 'stop'
      const icon = L.divIcon({
        className: 'rr-map-marker',
        html: '<span class="rr-pin rr-pin-' + style + '">' + (stop.saved ? '★' : index + 1) + '</span>',
        iconSize: [34, 34],
        iconAnchor: [17, 17],
      })
      const label = document.createElement('span')
      label.textContent = stop.title
      const marker = L.marker(coords, { icon, title: stop.title, alt: stop.title })
        .bindTooltip(label, { direction: 'top', offset: [0, -15] })
        .addTo(layer)
      marker.on('click', () => {
        if (action.current.onSelect) action.current.onSelect(stop)
        else marker.openTooltip()
      })
    })
    if (picked) {
      allCoords.push(picked)
      L.circleMarker(picked, {
        radius: 8,
        weight: 3,
        color: 'white',
        fillColor: '#d26937',
        fillOpacity: 1,
        interactive: false,
      }).addTo(layer)
    }
    const signature = allCoords
      .map((coords) => coords.join(','))
      .sort()
      .join('|')
    visiblePoints.current = allCoords
    if (signature !== lastFit.current) {
      lastFit.current = signature
      if (host.current?.clientWidth && host.current.clientHeight) fitPlaces(map, allCoords)
    }
  }, [stops, visibleIds, picked, connectStops])

  return (
    <div className={'rr-map' + (onPick ? ' can-pick' : '')}>
      <div ref={host} className="rr-map-surface" aria-label="Reisekarte" />
      {tileError && (
        <div className="rr-map-warning" role="status">
          <MapIcon size={14} />
          Kartenhintergrund nicht erreichbar
        </div>
      )}
    </div>
  )
}

interface StopDraft {
  title: string
  stage_id: number | null
  variant_id: number | null
  kind: StopKind
  address: string
  lat: string
  lon: string
  notes: string
  date: string
  time: string
  end_date: string
  plan: 'saved' | 'flexible' | 'fixed'
  tags: string[]
}

function draftFor(stop?: Stop, saved = false, coords?: Coordinates): StopDraft {
  return {
    title: stop?.title || '',
    stage_id: stop?.stage_id ?? null,
    variant_id: stop?.variant_id ?? null,
    kind: (stop?.kind as StopKind) || 'stop',
    address: stop?.address || '',
    lat: String(coords?.[0] ?? stop?.lat ?? ''),
    lon: String(coords?.[1] ?? stop?.lon ?? ''),
    date: stop?.date || '',
    end_date: stop?.end_date || '',
    time: stop?.time || '',
    notes: stop?.notes || '',
    plan: (stop?.saved ?? saved) ? 'saved' : stop?.date ? 'fixed' : 'flexible',
    tags: stop?.tags || [],
  }
}

function numberFrom(value: string) {
  return value.trim() ? Number(value.trim().replace(',', '.')) : null
}

function StopEditor({
  stop,
  initial,
  tripId,
  stages,
  suggestions,
  onClose,
  afterSave,
}: {
  stop?: Stop
  initial: StopDraft
  tripId: number
  stages: RouteStage[]
  suggestions: string[]
  onClose: () => void
  afterSave: () => Promise<void>
}) {
  const [draft, setDraft] = useState(initial)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [showMap, setShowMap] = useState(false)
  const [showDetails, setShowDetails] = useState(Boolean(initial.address || initial.lat || initial.notes))
  const change = <K extends keyof StopDraft>(key: K, value: StopDraft[K]) =>
    setDraft((old) => ({ ...old, [key]: value }))
  const fixed = draft.plan === 'fixed'
  const stage = stages.find((item) => item.id === draft.stage_id)
  const lat = numberFrom(draft.lat)
  const lon = numberFrom(draft.lon)
  const validCoordinates =
    lat !== null &&
    lon !== null &&
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lon) <= 180
  const selectedCoords = useMemo<Coordinates | null>(
    () => (validCoordinates ? [lat!, lon!] : null),
    [lat, lon, validCoordinates],
  )
  async function save(event: FormEvent) {
    event.preventDefault()
    if (saving) return
    if (!draft.title.trim()) {
      setError('Gib dem Ort einen Namen.')
      return
    }
    if ((lat !== null || lon !== null) && !validCoordinates) {
      setError('Bitte gib ein gültiges Koordinatenpaar an.')
      return
    }
    if (fixed && draft.kind === 'sleep' && draft.end_date && (!draft.date || draft.end_date < draft.date)) {
      setError('Die Abreise muss am Anreisetag oder später liegen.')
      return
    }
    setSaving(true)
    setError('')
    try {
      await api('/api/trips/' + tripId + '/stops' + (stop ? '/' + stop.id : ''), stop ? 'PATCH' : 'POST', {
        title: draft.title.trim(),
        stage_id: draft.plan === 'saved' ? null : draft.stage_id,
        variant_id: draft.plan === 'saved' ? null : draft.variant_id,
        kind: draft.kind,
        address: draft.address.trim(),
        lat,
        lon,
        notes: draft.notes.trim(),
        saved: draft.plan === 'saved',
        date: fixed ? draft.date : null,
        time: draft.plan === 'saved' ? null : draft.time || null,
        end_date: fixed && draft.kind === 'sleep' ? draft.end_date || null : null,
        tags: draft.tags,
        ...(draft.plan === 'saved' ? { done: false } : {}),
      })
      await afterSave()
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Der Ort konnte nicht gespeichert werden.')
    } finally {
      setSaving(false)
    }
  }
  return (
    <Modal
      title={stop ? 'Ort bearbeiten' : initial.plan === 'saved' ? 'Ort merken' : 'Stopp hinzufügen'}
      onClose={onClose}
    >
      <form className="rr-stop-form" onSubmit={save}>
        <label className="field">
          Name
          <input
            required
            maxLength={250}
            value={draft.title}
            onChange={(e) => change('title', e.target.value)}
            placeholder="z. B. Lago di Braies"
            autoFocus
          />
        </label>
        <div className="rr-form-pair">
          <label className="field">
            Art des Ortes
            <select
              aria-label="Art des Ortes"
              value={draft.kind}
              onChange={(e) => change('kind', e.target.value as StopKind)}
            >
              {Object.entries(kinds).map(([key, item]) => (
                <option key={key} value={key}>
                  {item.title}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Planung
            <select
              aria-label="Planung"
              value={draft.plan}
              onChange={(e) => change('plan', e.target.value as StopDraft['plan'])}
            >
              <option value="flexible">Flexibel in der Route</option>
              <option value="fixed">Mit festem Termin</option>
              <option value="saved">Auf der Merkliste</option>
            </select>
          </label>
        </div>
        {draft.plan !== 'saved' && stages.length > 0 && (
          <div className="rr-form-pair">
            <label className="field">
              Etappe
              <select aria-label="Etappe" value={draft.stage_id ?? ''} onChange={(event) => {
                const id = Number(event.target.value) || null
                setDraft((old) => ({ ...old, stage_id: id, variant_id: null }))
              }}>
                <option value="">Ohne Etappe</option>
                {stages.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
            {!!stage?.variants.length && <label className="field">
              Variante
              <select aria-label="Variante" value={draft.variant_id ?? ''} onChange={(event) => change('variant_id', Number(event.target.value) || null)}>
                <option value="">Alle Varianten</option>
                {stage.variants.map((variant) => <option key={variant.id} value={variant.id}>{variant.name}</option>)}
              </select>
            </label>}
          </div>
        )}
        {draft.plan !== 'saved' && (
          <div className="rr-form-pair">
            {fixed && (
              <label className="field">
                {draft.kind === 'sleep' ? 'Anreise' : 'Datum'}
                <input type="date" required value={draft.date} onChange={(e) => change('date', e.target.value)} />
              </label>
            )}
            <label className="field">
              Uhrzeit
              <input type="time" value={draft.time} onChange={(e) => change('time', e.target.value)} />
            </label>
            {fixed && draft.kind === 'sleep' && (
              <label className="field">
                Abreise
                <input
                  type="date"
                  value={draft.end_date}
                  min={draft.date || undefined}
                  onChange={(e) => change('end_date', e.target.value)}
                />
              </label>
            )}
          </div>
        )}
        <TagEditor value={draft.tags} suggestions={suggestions} onChange={(values) => change('tags', values)} />
        <details
          className="rr-optional-details"
          open={showDetails}
          onToggle={(event) => setShowDetails(event.currentTarget.open)}
        >
          <summary>Adresse, Karte und Notizen</summary>
          <div className="rr-optional-fields">
            <label className="field">
              Adresse oder Ortsangabe
              <input
                value={draft.address}
                maxLength={500}
                onChange={(e) => change('address', e.target.value)}
                placeholder="Straße, Ort oder Treffpunkt"
              />
            </label>
            <div className="rr-form-pair">
              <label className="field">
                Breitengrad
                <input
                  inputMode="decimal"
                  value={draft.lat}
                  onChange={(e) => change('lat', e.target.value)}
                  placeholder="46,694"
                />
              </label>
              <label className="field">
                Längengrad
                <input
                  inputMode="decimal"
                  value={draft.lon}
                  onChange={(e) => change('lon', e.target.value)}
                  placeholder="12,084"
                />
              </label>
            </div>
            <button
              type="button"
              className="rr-text-action"
              aria-expanded={showMap}
              onClick={() => setShowMap(!showMap)}
            >
              <LocateFixed size={15} />
              {showMap ? 'Kartenauswahl schließen' : 'Punkt auf der Karte wählen'}
            </button>
            {showMap && (
              <div className="rr-picker">
                <TripMap
                  stops={[]}
                  picked={selectedCoords}
                  onPick={(coords) => setDraft((old) => ({ ...old, lat: String(coords[0]), lon: String(coords[1]) }))}
                />
              </div>
            )}
            <label className="field">
              Notizen
              <textarea
                rows={2}
                maxLength={16000}
                value={draft.notes}
                onChange={(e) => change('notes', e.target.value)}
                placeholder="Buchung, Parkplatz oder ein Tipp für unterwegs"
              />
            </label>
          </div>
        </details>
        {error && (
          <p className="rr-error" role="alert">
            {error}
          </p>
        )}
        <div className="actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Abbrechen
          </button>
          <button className="btn btn-primary" disabled={saving}>
            {saving ? 'Speichert …' : 'Ort speichern'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

type EditorState = { stop?: Stop; draft: StopDraft }
interface RouteProps {
  data: TripData
  reload: () => Promise<void>
  notify: (message: string) => void
  onJournal: (stop: Stop) => void
}

export default function Route({ data, reload, notify, onJournal }: RouteProps) {
  const [tab, setTab] = useState<'route' | 'saved'>('route')
  const [viewMode, setViewMode] = useState<'sequence' | 'days'>('sequence')
  const [mobilePane, setMobilePane] = useState<'list' | 'map'>('list')
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [remove, setRemove] = useState<Stop | null>(null)
  const [selected, setSelected] = useState<Stop | null>(null)
  const [dragging, setDragging] = useState<number | null>(null)
  const [working, setWorking] = useState(false)
  const [manageStages, setManageStages] = useState(false)
  const allStops = useMemo(() => ordered(data.stops), [data.stops])
  const route = useMemo(() => activeRoute(data), [data])
  const saved = useMemo(() => allStops.filter((stop) => stop.saved), [allStops])
  const mapStops = useMemo(() => [...route, ...saved], [route, saved])
  const numbers = new Map(route.map((stop, index) => [stop.id, index + 1]))
  const list = tab === 'saved' ? saved : route
  const view = useTagView(list)
  const visibleIds = useMemo(() => new Set(view.filtered.map((stop) => stop.id)), [view.filtered])
  const daysView = tab === 'route' && viewMode === 'days' && !view.grouped
  const canSort = tab === 'route' && !daysView && !view.grouped && !view.active
  const byStage = tab === 'route' && !daysView && !view.grouped && data.stages.length > 0
  let sections = view.groups
  if (daysView) {
    const days = new Map<string, Stop[]>()
    for (const stop of view.filtered) {
      const key = stop.date || ''
      if (!days.has(key)) days.set(key, [])
      days.get(key)!.push(stop)
    }
    sections = [...days]
      .sort(([a], [b]) => (a || '9999').localeCompare(b || '9999'))
      .map(([key, items]) => ({ key, label: dayLabel(key), items }))
  }
  const root = '/api/trips/' + data.trip.id + '/stops'
  const create = (coords?: Coordinates, stage?: RouteStage, variantId = stage?.active_variant_id) => setEditor({
    draft: { ...draftFor(undefined, tab === 'saved', coords), stage_id: stage?.id ?? null, variant_id: variantId ?? null },
  })
  const edit = (stop: Stop, planned = false) => {
    setSelected(null)
    setEditor({ stop, draft: { ...draftFor(stop), ...(planned ? { plan: 'flexible' as const } : {}) } })
  }
  const mutate = async (operation: () => Promise<unknown>, success: string) => {
    if (working) return
    setWorking(true)
    try {
      await operation()
      await reload()
      notify(success)
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : 'Die Änderung konnte nicht gespeichert werden.')
    } finally {
      setWorking(false)
    }
  }
  const move = (from: Stop, to: Stop, siblings: Stop[]) => {
    if (!canSort || from.id === to.id || from.saved || to.saved || from.stage_id !== to.stage_id) return
    const routeIds = siblings.map((stop) => stop.id)
    const members = new Set(routeIds)
    const source = routeIds.indexOf(from.id)
    const target = routeIds.indexOf(to.id)
    routeIds.splice(source, 1)
    routeIds.splice(target, 0, from.id)
    let next = 0
    const ids = allStops.map((stop) => (members.has(stop.id) ? routeIds[next++] : stop.id))
    void mutate(() => api(root + '/order', 'PUT', { ids }), 'Reihenfolge gespeichert.')
  }
  const renderStop = (stop: Stop, siblings: Stop[], index: number) => {
    const { Icon, title } = kinds[stop.kind as StopKind] || kinds.stop
    const stage = data.stages.find((item) => item.id === stop.stage_id)
    const branch = stage?.variants.find((variant) => variant.id === stop.variant_id)
    return (
      <article
        className={'rr-stop' + (stop.done ? ' completed' : '') + (dragging === stop.id ? ' dragging' : '')}
        key={stop.id}
        onDragOver={(event) => {
          if (canSort && dragging !== null) event.preventDefault()
        }}
        onDrop={(event) => {
          event.preventDefault()
          const from = siblings.find((item) => item.id === dragging)
          if (from) move(from, stop, siblings)
          setDragging(null)
        }}
      >
        <div
          className={'rr-stop-symbol rr-' + stop.kind}
          aria-label={stop.saved ? undefined : 'Position ' + numbers.get(stop.id)}
        >
          {stop.saved ? <Icon size={19} /> : numbers.get(stop.id)}
        </div>
        <div className="rr-stop-info">
          <div className="rr-stop-overline">
            {!stop.saved && <Icon size={12} aria-hidden="true" />}
            <span>{title}</span>
            {stage && !byStage && <span>· {stage.name}</span>}
            {!!stage?.variants.length && <span>· {branch?.name ?? 'Alle Varianten'}</span>}
            {!stop.saved && (
              <>
                <span aria-hidden="true">·</span>
                <span>{stop.date ? dateLabel(stop.date) : 'Flexibel'}</span>
              </>
            )}
            {!stop.saved && stop.time && (
              <>
                <span aria-hidden="true">·</span>
                <span>{stop.time.slice(0, 5)} Uhr</span>
              </>
            )}
          </div>
          <button className="rr-stop-title" onClick={() => setSelected(stop)}>
            {stop.title}
          </button>
          {stop.address && (
            <div className="rr-stop-address">
              <MapPin size={12} aria-hidden="true" />
              {stop.address}
            </div>
          )}
          {stop.kind === 'sleep' && stop.end_date && <small>Bis {dayLabel(stop.end_date)}</small>}
          <TagChips tags={stop.tags} />
          {stop.done && <button className="rr-journal-action" onClick={() => onJournal(stop)}>
            <BookOpen size={13} /> Ins Tagebuch schreiben
          </button>}
        </div>
        <div className="rr-row-tools">
          {canSort && siblings.length > 1 && (
            <div className="rr-order-tools">
              <button
                disabled={working || index === 0}
                title="Stopp nach oben"
                aria-label={stop.title + ' nach oben'}
                onClick={() => move(stop, siblings[index - 1], siblings)}
              >
                <ArrowUp size={14} />
              </button>
              <span
                className="rr-grip"
                draggable={!working}
                title="An eine andere Routenposition ziehen"
                onDragStart={(e) => {
                  setDragging(stop.id)
                  e.dataTransfer.effectAllowed = 'move'
                  e.dataTransfer.setData('text/plain', String(stop.id))
                }}
                onDragEnd={() => setDragging(null)}
              >
                <GripVertical size={15} />
              </span>
              <button
                disabled={working || index === siblings.length - 1}
                title="Stopp nach unten"
                aria-label={stop.title + ' nach unten'}
                onClick={() => move(stop, siblings[index + 1], siblings)}
              >
                <ArrowDown size={14} />
              </button>
            </div>
          )}
          {stop.saved ? (
            <button
              className="rr-row-open"
              title="In die Route übernehmen"
              aria-label={stop.title + ' einplanen'}
              onClick={() => edit(stop, true)}
            >
              <Plus size={17} />
            </button>
          ) : (
            <button
              className={'rr-done' + (stop.done ? ' checked' : '')}
              aria-pressed={!!stop.done}
              title={stop.done ? 'Wieder offen markieren' : 'Als besucht markieren'}
              aria-label={stop.title + (stop.done ? ' wieder offen markieren' : ' als besucht markieren')}
              disabled={working}
              onClick={() =>
                void mutate(
                  () => api(root + '/' + stop.id, 'PATCH', { done: !stop.done }),
                  stop.done ? 'Stopp wieder geöffnet.' : 'Stopp als besucht markiert.',
                )
              }
            >
              <Check size={13} />
            </button>
          )}
          <button
            className="rr-row-open"
            title="Ortsdetails"
            aria-label={'Details zu ' + stop.title}
            onClick={() => setSelected(stop)}
          >
            <ChevronRight size={17} />
          </button>
        </div>
      </article>
    )
  }
  return (
    <section className="rr-route-page">
      <div className="rr-page-lead">
        <div>
          <p className="eyebrow">REISEPLANUNG</p>
          <h1 className="page-title">Route &amp; Orte</h1>
          <p className="page-intro">Deine Etappen, Schlafplätze und Entdeckungen auf einer Karte.</p>
        </div>
        <div className="rr-route-actions">
          <button className="btn btn-secondary" onClick={() => setManageStages(true)}><Layers3 size={16} /> Etappen verwalten</button>
          <button className="btn btn-primary" onClick={() => create()}>
            <Plus size={17} />
            {tab === 'saved' ? 'Ort merken' : 'Stopp hinzufügen'}
          </button>
        </div>
      </div>
      <div className="rr-mobile-tabs" aria-label="Ansicht">
        <button className={mobilePane === 'list' ? 'active' : ''} onClick={() => setMobilePane('list')}>
          <List size={16} />
          Liste
        </button>
        <button className={mobilePane === 'map' ? 'active' : ''} onClick={() => setMobilePane('map')}>
          <MapIcon size={16} />
          Karte
        </button>
      </div>
      <div className={'rr-route-layout rr-pane-' + mobilePane}>
        <div className="rr-itinerary">
          <div className="rr-tabs" aria-label="Orte anzeigen">
            <button
              aria-pressed={tab === 'route'}
              className={tab === 'route' ? 'active' : ''}
              onClick={() => setTab('route')}
            >
              <RouteIcon size={17} />
              Reiseverlauf <span>{route.length}</span>
            </button>
            <button
              aria-pressed={tab === 'saved'}
              className={tab === 'saved' ? 'active' : ''}
              onClick={() => setTab('saved')}
            >
              <Bookmark size={16} />
              Merkliste <span>{saved.length}</span>
            </button>
          </div>
          {(list.length > 0 || (tab === 'route' && data.stages.length > 0)) && (
            <div className="rr-view-options">
              {tab === 'route' && (
                <div className="rr-sequence-toggle" role="group" aria-label="Reiseverlauf anzeigen">
                  <button
                    className={!daysView && !view.grouped ? 'active' : ''}
                    aria-pressed={!daysView && !view.grouped}
                    disabled={view.grouped}
                    onClick={() => setViewMode('sequence')}
                  >
                    <List size={14} />
                    Routenfolge
                  </button>
                  <button
                    className={daysView ? 'active' : ''}
                    aria-pressed={daysView}
                    disabled={view.grouped}
                    onClick={() => setViewMode('days')}
                  >
                    <CalendarDays size={14} />
                    Nach Reisetag
                  </button>
                </div>
              )}
              {view.controls}
            </div>
          )}
          {tab === 'route' && !canSort && list.length > 1 && (
            <p className="rr-reorder-hint">Zum Umsortieren die ungefilterte Routenfolge öffnen.</p>
          )}
          {byStage && (!view.active || view.filtered.length > 0) ? (
            <>
              {data.stages.map((stage) => {
                const items = view.filtered.filter((stop) => stop.stage_id === stage.id)
                if (!items.length && view.active) return null
                return (
                  <RouteStageCard
                    key={stage.id}
                    stage={stage}
                    count={items.length}
                    stops={allStops}
                    showAlternatives={!view.active}
                    working={working}
                    onSwitch={(variantId) => {
                      const path = '/api/trips/' + data.trip.id + '/stages/' + stage.id + '/variants/' + variantId + '/activate'
                      void mutate(() => api(path, 'PUT'), 'Routenvariante gewechselt.')
                    }}
                    onSelect={setSelected}
                    onMove={move}
                    onAdd={(variantId) => create(undefined, stage, variantId)}
                  >
                    {items.length > 0 && (
                      <div className="rr-day-stops">{items.map((stop, index) => renderStop(stop, items, index))}</div>
                    )}
                  </RouteStageCard>
                )
              })}
              {view.filtered.some((stop) => stop.stage_id === null) && <div className="rr-day">
                <h2>Ohne Etappe</h2>
                <div className="rr-day-stops">{view.filtered.filter((stop) => stop.stage_id === null).map((stop, index, items) => renderStop(stop, items, index))}</div>
              </div>}
            </>
          ) : list.length === 0 ? (
            <div className="rr-empty">
              <span className="rr-empty-icon">{tab === 'saved' ? <Bookmark /> : <Flag />}</span>
              <h2>{tab === 'saved' ? 'Welche Orte möchtest du sehen?' : 'Wo beginnt deine Reise?'}</h2>
              <p>
                {tab === 'saved'
                  ? 'Sammle Ideen für später und plane sie ein, wenn dein Reiseverlauf steht.'
                  : 'Lege deinen ersten Stopp an oder wähle einen Ort auf der Karte.'}
              </p>
              <button className="btn btn-secondary" onClick={() => create()}>
                <Plus size={15} />
                {tab === 'saved' ? 'Ersten Ort merken' : 'Ersten Stopp anlegen'}
              </button>
            </div>
          ) : view.filtered.length === 0 ? (
            <div className="rr-empty">
              <h2>Keine passenden Orte</h2>
              <p>Wähle ein anderes Schlagwort oder zeige alle Orte an.</p>
            </div>
          ) : (
            sections.map(({ key, label, items }) => (
              <div className="rr-day" key={key}>
                {label && (
                  <h2>
                    {daysView && <CalendarDays size={16} />}
                    {label}
                  </h2>
                )}
                <div className="rr-day-stops">{items.map((stop, index) => renderStop(stop, items, index))}</div>
              </div>
            ))
          )}
        </div>
        <div className="rr-map-card">
          <div className="rr-map-heading">
            <div>
              <Compass size={19} />
              <h2>Reisekarte</h2>
            </div>
            <span>{view.filtered.filter((stop) => !!getCoordinates(stop)).length} markiert</span>
          </div>
          <div className="rr-route-map">
            <TripMap stops={mapStops} visibleIds={visibleIds} onPick={create} onSelect={setSelected} />
          </div>
          <p className="rr-map-hint">
            <MapPinPlus size={16} />
            Klicke auf die Karte, um einen Ort zu setzen.
          </p>
        </div>
      </div>
      {manageStages && <StageManager tripId={data.trip.id} stages={data.stages} reload={reload} onClose={() => setManageStages(false)} />}
      {editor && (
        <StopEditor
          tripId={data.trip.id}
          stages={data.stages}
          suggestions={tripTags(data)}
          stop={editor.stop}
          initial={editor.draft}
          onClose={() => setEditor(null)}
          afterSave={async () => {
            await reload()
            notify('Ort gespeichert.')
          }}
        />
      )}
      {selected && (
        <Modal title={selected.title} onClose={() => setSelected(null)}>
          <div className="rr-stop-detail">
            <div className="rr-detail-badges">
              <span>{(kinds[selected.kind as StopKind] || kinds.stop).title}</span>
              {selected.saved && <span>Merkliste</span>}
              {!selected.saved && !selected.date && <span>Flexibel</span>}
              {selected.done && <span>Besucht</span>}
            </div>
            <TagChips tags={selected.tags} />
            {(selected.date || selected.time) && (
              <p>
                <CalendarDays size={17} />
                <span>
                  {selected.date && dayLabel(selected.date)}
                  {selected.time ? (selected.date ? ' · ' : '') + selected.time.slice(0, 5) + ' Uhr' : ''}
                  {selected.end_date ? ' bis ' + dayLabel(selected.end_date) : ''}
                </span>
              </p>
            )}
            {(selected.address || getCoordinates(selected)) && (
              <p>
                <MapPin size={17} />
                <span>{selected.address || getCoordinates(selected)?.join(', ')}</span>
              </p>
            )}
            {selected.notes && <div className="rr-detail-notes">{selected.notes}</div>}
            <button className="rr-text-action" onClick={() => onJournal(selected)}><BookOpen size={16} /> Ins Tagebuch schreiben</button>
            <a href={navUrl(selected)} target="_blank" rel="noreferrer" className="rr-navi">
              <Navigation size={16} />
              Navigation öffnen
              <ExternalLink size={13} />
            </a>
            <div className="rr-detail-actions">
              <button
                title="Ort löschen"
                aria-label="Ort löschen"
                className="btn btn-secondary rr-delete"
                onClick={() => {
                  setRemove(selected)
                  setSelected(null)
                }}
              >
                <Trash2 size={16} />
              </button>
              <button className="btn btn-secondary" onClick={() => edit(selected)}>
                <Pencil size={15} />
                Bearbeiten
              </button>
              {selected.saved && (
                <button className="btn btn-primary" onClick={() => edit(selected, true)}>
                  <Plus size={15} />
                  Einplanen
                </button>
              )}
            </div>
          </div>
        </Modal>
      )}
      {remove && (
        <Modal title="Ort löschen?" onClose={() => setRemove(null)}>
          <p>„{remove.title}“ wird aus dieser Reise entfernt.</p>
          <div className="actions">
            <button className="btn btn-secondary" onClick={() => setRemove(null)}>
              Abbrechen
            </button>
            <button
              className="btn btn-primary"
              disabled={working}
              onClick={() =>
                void mutate(async () => {
                  await api(root + '/' + remove.id, 'DELETE')
                  setRemove(null)
                }, 'Ort gelöscht.')
              }
            >
              Löschen
            </button>
          </div>
        </Modal>
      )}
    </section>
  )
}
