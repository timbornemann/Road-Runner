import { useMemo, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  BedDouble,
  BookOpen,
  CalendarDays,
  Camera,
  Check,
  ChevronRight,
  ExternalLink,
  Flag,
  GripVertical,
  Layers3,
  List,
  Map as MapIcon,
  MapPin,
  Navigation,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react'
import {
  activeRoute,
  api,
  dateLabel,
  Modal,
  navUrl,
  type RouteStage,
  type Stop,
  type TripData,
} from './shared'
import { TagChips, useTagView } from './Tags'
import StageManager from './StageManager'
import RouteStageCard from './RouteStageCard'
import { NotebookBacklinks, useNotebookNavigation } from './NotebookNavigation'
import { getCoordinates, type Coordinates } from './TripMap'
import VisitEditor from './VisitEditor'
import RoadRouteMap from './RoadRouteMap'
export { TripMap } from './TripMap'
import './route.css'

const kinds = {
  stop: { title: 'Zwischenstopp', Icon: MapPin },
  sight: { title: 'Sehenswürdigkeit', Icon: Camera },
  sleep: { title: 'Schlafplatz', Icon: BedDouble },
}
type StopKind = keyof typeof kinds
interface EditorState {
  visit?: Stop
  coordinates?: Coordinates
  stageId?: number
  variantId?: number | null
}

function ordered(stops: Stop[]) {
  return [...stops].sort((a, b) => a.position - b.position || a.id - b.id)
}

function dayLabel(value: string) {
  return value
    ? new Intl.DateTimeFormat('de-DE', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }).format(new Date(value + 'T12:00:00'))
    : 'Flexible Stopps'
}

interface RouteProps {
  data: TripData
  reload: () => Promise<void>
  notify: (message: string) => void
  onJournal: (stop: Stop) => void
}

export default function Route({ data, reload, notify, onJournal }: RouteProps) {
  const { target, open } = useNotebookNavigation()
  const [viewMode, setViewMode] = useState<'sequence' | 'days'>('sequence')
  const [mobilePane, setMobilePane] = useState<'list' | 'map'>('list')
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [remove, setRemove] = useState<Stop | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(target?.kind === 'visit' ? target.id : null)
  const selected = data.stops.find((stop) => !stop.saved && stop.id === selectedId)
  const selectedPlace = selected && data.places.find(place => place.id === selected.place_id)
  const setSelected = (stop: Stop | null) => setSelectedId(stop?.id ?? null)
  const areas = selected && data.notebook.areas.filter((area) => area.stop_ids.includes(selected.place_id))
  const [dragging, setDragging] = useState<number | null>(null)
  const [working, setWorking] = useState(false)
  const [manageStages, setManageStages] = useState(target?.kind === 'stage' || target?.kind === 'variant')
  const allStops = useMemo(() => ordered(data.stops.filter((s) => !s.saved)), [data.stops])
  const route = useMemo(() => activeRoute(data), [data])
  const numbers = new Map(route.map((stop, index) => [stop.id, index + 1]))
  const view = useTagView(route)
  const visibleIds = useMemo(() => new Set(view.filtered.map((stop) => stop.id)), [view.filtered])
  const daysView = viewMode === 'days' && !view.grouped
  const canSort = !daysView && !view.grouped && !view.active
  const byStage = !daysView && !view.grouped && data.stages.length > 0
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
  const root = '/api/trips/' + data.trip.id + '/visits'
  const create = (coordinates?: Coordinates, stage?: RouteStage, variantId = stage?.active_variant_id) =>
    setEditor({ coordinates, stageId: stage?.id, variantId })
  const edit = (visit: Stop) => {
    setSelected(null)
    setEditor({ visit })
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
    if (!canSort || from.id === to.id || from.stage_id !== to.stage_id) return
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
        <div className={'rr-stop-symbol rr-' + stop.kind} aria-label={'Position ' + numbers.get(stop.id)}>
          {numbers.get(stop.id)}
        </div>
        <div className="rr-stop-info">
          <div className="rr-stop-overline">
            <Icon size={12} aria-hidden="true" />
            <span>{title}</span>
            {stage && !byStage && <span>· {stage.name}</span>}
            {!!stage?.variants.length && <span>· {branch?.name ?? 'Alle Varianten'}</span>}
            <span aria-hidden="true">·</span>
            <span>{stop.date ? dateLabel(stop.date) : 'Flexibel'}</span>
            {stop.time && (
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
          {stop.done && (
            <button className="rr-journal-action" onClick={() => onJournal(stop)}>
              <BookOpen size={13} /> Ins Tagebuch schreiben
            </button>
          )}
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
          <button
            className="rr-row-open"
            title="Besuchsdetails"
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
          <h1 className="page-title">Routenplanung</h1>
          <p className="page-intro">Plane die Reihenfolge deiner Besuche, Etappen und Übernachtungen.</p>
        </div>
        <div className="rr-route-actions">
          <button className="btn btn-secondary" onClick={() => setManageStages(true)}>
            <Layers3 size={16} /> Etappen verwalten
          </button>
          <button className="btn btn-primary" onClick={() => create()}>
            <Plus size={17} />
            Stopp hinzufügen
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
          {(route.length > 0 || data.stages.length > 0) && (
            <div className="rr-view-options">
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
              {view.controls}
            </div>
          )}
          {!canSort && route.length > 1 && (
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
                      const path =
                        '/api/trips/' +
                        data.trip.id +
                        '/stages/' +
                        stage.id +
                        '/variants/' +
                        variantId +
                        '/activate'
                      void mutate(() => api(path, 'PUT'), 'Routenvariante gewechselt.')
                    }}
                    onSelect={setSelected}
                    onMove={move}
                    onAdd={(variantId) => create(undefined, stage, variantId)}
                  >
                    {items.length > 0 && (
                      <div className="rr-day-stops">
                        {items.map((stop, index) => renderStop(stop, items, index))}
                      </div>
                    )}
                  </RouteStageCard>
                )
              })}
              {view.filtered.some((stop) => stop.stage_id === null) && (
                <div className="rr-day">
                  <h2>Ohne Etappe</h2>
                  <div className="rr-day-stops">
                    {view.filtered
                      .filter((stop) => stop.stage_id === null)
                      .map((stop, index, items) => renderStop(stop, items, index))}
                  </div>
                </div>
              )}
            </>
          ) : route.length === 0 ? (
            <div className="rr-empty">
              <span className="rr-empty-icon">
                <Flag />
              </span>
              <h2>Wo beginnt deine Reise?</h2>
              <p>Wähle deinen ersten Ort aus der Sammlung oder lege direkt ein neues Ziel an.</p>
              <button className="btn btn-secondary" onClick={() => create()}>
                <Plus size={15} />
                Ersten Stopp anlegen
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
                <div className="rr-day-stops">
                  {items.map((stop, index) => renderStop(stop, items, index))}
                </div>
              </div>
            ))
          )}
        </div>
        <RoadRouteMap
          tripId={data.trip.id}
          stages={data.stages}
          route={route}
          visibleIds={visibleIds}
          onPick={create}
          onSelect={setSelected}
        />
      </div>
      {manageStages && (
        <StageManager
          tripId={data.trip.id}
          stages={data.stages}
          reload={reload}
          onClose={() => setManageStages(false)}
        />
      )}
      {editor && (
        <VisitEditor
          data={data}
          {...editor}
          reload={reload}
          notify={notify}
          onClose={() => setEditor(null)}
        />
      )}
      {selected && (
        <Modal title={selected.title} onClose={() => setSelected(null)}>
          <div className="rr-stop-detail">
            {selectedPlace?.image && <img className="rr-visit-image" src={selectedPlace.image.url} alt={selectedPlace.title} />}
            <div className="rr-detail-badges">
              <span>{(kinds[selected.kind as StopKind] || kinds.stop).title}</span>
              {!selected.date && <span>Flexibel</span>}
              {selected.done && <span>Besucht</span>}
            </div>
            <button className="rr-text-action" onClick={() => open({ kind: 'stop', id: selected.place_id })}>
              <MapPin size={16} /> Ort auf der Ortekarte öffnen
            </button>
            <TagChips tags={selected.tags} />
            <NotebookBacklinks target={{ kind: 'stop', id: selected.place_id }} />
            {!!areas?.length && (
              <div className="notebook-backlinks">
                <span>Gebiete</span>
                {areas.map((area) => (
                  <button key={area.id} onClick={() => open({ kind: 'area', id: area.id })}>
                    {area.name}
                  </button>
                ))}
              </div>
            )}
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
            {selectedPlace?.links.map((link, index) => (
              <a key={index} href={link.url} className="rr-text-action" target="_blank" rel="noreferrer">
                <ExternalLink size={14} /> {link.label}
              </a>
            ))}
            <button className="rr-text-action" onClick={() => onJournal(selected)}>
              <BookOpen size={16} /> Ins Tagebuch schreiben
            </button>
            <a href={navUrl(selected)} target="_blank" rel="noreferrer" className="rr-navi">
              <Navigation size={16} />
              Navigation öffnen
              <ExternalLink size={13} />
            </a>
            <div className="rr-detail-actions">
              <button
                title="Aus Route entfernen"
                aria-label="Aus Route entfernen"
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
            </div>
          </div>
        </Modal>
      )}
      {remove && (
        <Modal title="Besuch aus Route entfernen?" onClose={() => setRemove(null)}>
          <p>
            Diesen Besuch von „{remove.title}“ aus der Route entfernen? Den Ort findest du weiterhin auf der
            Ortekarte.
          </p>
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
                }, 'Besuch aus der Route entfernt.')
              }
            >
              Besuch entfernen
            </button>
          </div>
        </Modal>
      )}
    </section>
  )
}
