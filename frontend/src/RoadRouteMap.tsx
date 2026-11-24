import { useEffect, useMemo, useState, type ReactNode, type RefObject } from 'react'
import { CarFront, Crosshair, Expand, Layers3, Minimize, Route as RouteIcon } from 'lucide-react'
import { api, type RouteStage, type Stop } from './shared'
import { TripMap, type Coordinates } from './TripMap'
import './route-map.css'

export interface RoadLeg {
  from_id: number
  to_id: number
  status: 'ok' | 'missing_coordinates' | 'unavailable' | 'not_calculated'
  distance_m: number | null
  duration_s: number | null
  geometry: Coordinates[]
}
interface RoadResult {
  legs: RoadLeg[]
  distance_m: number
  duration_s: number
  complete: boolean
}
interface RoadState {
  key: string
  result?: RoadResult
  busy: boolean
  error?: string
}
interface Props {
  tripId: number
  stages: RouteStage[]
  route: Stop[]
  visibleIds: ReadonlySet<number>
  onPick: (coords: Coordinates, stage?: RouteStage) => void
  onSelect: (stop: Stop) => void
  selected: Stop | null
  detail: ReactNode
  onDismiss: () => void
  fullscreen: boolean
  onToggleFullscreen: () => void
  fullscreenButtonRef: RefObject<HTMLButtonElement | null>
  focusRequest: number
}

const distanceFormat = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 })
function tripFigures(metres: number, seconds: number) {
  const minutes = Math.round(seconds / 60)
  const time =
    minutes >= 60 ? Math.floor(minutes / 60) + ' Std. ' + (minutes % 60) + ' Min.' : minutes + ' Min.'
  return distanceFormat.format(metres / 1000) + ' km · ' + time
}
const gapLabels = {
  missing_coordinates: 'Lücke · Koordinaten fehlen',
  unavailable: 'Lücke · Straßenverbindung nicht verfügbar',
  not_calculated: 'Noch nicht berechnet',
}

export default function RoadRouteMap({
  tripId, stages, route, visibleIds, onPick, onSelect, selected, detail, onDismiss,
  fullscreen, onToggleFullscreen, fullscreenButtonRef, focusRequest,
}: Props) {
  const [roads, setRoads] = useState(false)
  const [stageId, setStageId] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<RoadState | null>(null)
  const [fitRequest, setFitRequest] = useState(0)
  const requestedStage = stages.find((s) => String(s.id) === stageId)
  const outsideStage = !!(requestedStage && selected && selected.stage_id !== requestedStage.id)
  const stage = outsideStage ? undefined : requestedStage
  useEffect(() => {
    if (outsideStage) setStageId('')
  }, [outsideStage])
  const stops = useMemo(() => (stage ? route.filter((s) => s.stage_id === stage.id) : route), [stage, route])
  const numbers = useMemo(() => new Map(route.map((s, i) => [s.id, i + 1])), [route])
  const byId = new Map(stops.map((s) => [s.id, s]))
  const coordinateKey = JSON.stringify(stops.map((s) => [s.id, s.lat, s.lon]))
  const idsKey = JSON.stringify(stops.map((s) => s.id))
  const requestKey = tripId + '/' + coordinateKey
  useEffect(() => {
    if (!roads || idsKey === '[]') return
    const ids: number[] = JSON.parse(idsKey)
    if (ids.length < 2) return
    let active = true
    const path = '/api/trips/' + tripId + '/road-route'
    async function read() {
      let available: RoadResult | undefined
      setState({ key: requestKey, busy: true })
      try {
        available = await api<RoadResult>(path, 'POST', { visit_ids: ids, calculate: false })
        if (!active) return
        if (available.legs.some((leg) => leg.status === 'not_calculated' || leg.status === 'unavailable')) {
          setState({ key: requestKey, result: available, busy: true })
          available = await api<RoadResult>(path, 'POST', { visit_ids: ids, calculate: true })
        }
        if (active) setState({ key: requestKey, result: available, busy: false })
      } catch (cause) {
        if (active)
          setState({
            key: requestKey,
            result: available,
            busy: false,
            error: cause instanceof Error ? cause.message : 'Straßenverlauf konnte nicht geladen werden.',
          })
      }
    }
    void read()
    return () => {
      active = false
    }
  }, [roads, tripId, idsKey, requestKey, attempt])
  const current = roads && state?.key === requestKey ? state : null
  const result = current?.result
  const retry =
    current && !current.busy && (current.error || result?.legs.some((l) => l.status === 'unavailable'))
  const hasDistances = result?.legs.some((l) => l.status === 'ok')
  const pins = useMemo(() => {
    if (roads) return undefined
    if (!selected || visibleIds.has(selected.id)) return visibleIds
    return new Set([...visibleIds, selected.id])
  }, [roads, selected, visibleIds])
  function fit() {
    onDismiss()
    setFitRequest((previous) => previous + 1)
  }
  const fullscreenLabel = fullscreen ? 'Vollbild beenden' : 'Karte im Vollbild öffnen'
  return (
    <section className="rr-map-card rr-road-map-workspace" aria-label="Routenkarte">
      <div className="rr-road-map-tools">
        <div className="rr-road-map-buttons">
          <button type="button" className="rr-map-command" onClick={fit}
            title="Routenausschnitt einpassen" aria-label="Routenausschnitt einpassen">
            <Crosshair size={17} />
          </button>
          <button type="button" className="rr-map-command" ref={fullscreenButtonRef} onClick={onToggleFullscreen}
            aria-pressed={fullscreen} aria-label={fullscreenLabel} title={fullscreenLabel}>
            {fullscreen ? <Minimize size={17} /> : <Expand size={17} />}
          </button>
        </div>
        {stages.length > 0 && (
          <label className="rr-route-scope" title={stage?.name ?? 'Gesamte Route'}>
            <Layers3 size={16} />
            <select aria-label="Kartenausschnitt nach Etappe" value={stage?.id ?? ''} onChange={(e) => {
              onDismiss()
              setStageId(e.target.value)
              setFitRequest((previous) => previous + 1)
            }}>
              <option value="">Gesamte Route</option>
              {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
        )}
        <div className="rr-road-map-modes" role="group" aria-label="Kartenverlauf">
          <button aria-label="Reihenfolge" title="Reihenfolge" aria-pressed={!roads} onClick={() => setRoads(false)}>
            <RouteIcon size={15} /><span>Reihenfolge</span>
          </button>
          <button aria-label="Straßenverlauf" title="Straßenverlauf" aria-pressed={roads} onClick={() => setRoads(true)}>
            <CarFront size={15} /><span>Straßenverlauf</span>
          </button>
        </div>
      </div>
      <div className="rr-route-map">
        <TripMap
          stops={stops}
          visibleIds={pins}
          numbers={numbers}
          roadLegs={roads ? result?.legs : undefined}
          connectStops={!roads}
          onSelect={onSelect}
          onPick={(coords) => onPick(coords, stage)}
          popup={selected ? { stop: selected, content: detail } : null}
          onDismiss={onDismiss}
          fitRequest={fitRequest}
          focusRequest={focusRequest}
        />
      </div>
      {roads && !selected && (
        <div className="rr-road-result" aria-label="Berechnete Fahrstrecke">
          {stops.length < 2 && <p>Für einen Straßenverlauf braucht es zwei Besuche.</p>}
          {stops.length >= 2 && (!current || current.busy) && (
            <p role="status">Straßenverlauf wird berechnet …</p>
          )}
          {current?.error && <p role="alert">{current.error}</p>}
          {result && (
            <>
              <div className="rr-road-total">
                <span>{result.complete ? (stage ? 'Etappe gesamt' : 'Route gesamt') : 'Teilsumme'}</span>
                <strong>
                  {hasDistances
                    ? tripFigures(result.distance_m, result.duration_s)
                    : 'Keine berechnete Strecke'}
                </strong>
              </div>
              <details key={requestKey} className="rr-road-legs">
                <summary>Fahrabschnitte ({result.legs.length})</summary>
                <ol>
                  {result.legs.map((leg) => (
                    <li key={leg.from_id + '/' + leg.to_id}>
                      <span>
                        {byId.get(leg.from_id)?.title} → {byId.get(leg.to_id)?.title}
                      </span>
                      <strong>
                        {leg.status === 'ok'
                          ? tripFigures(leg.distance_m ?? 0, leg.duration_s ?? 0)
                          : gapLabels[leg.status]}
                      </strong>
                    </li>
                  ))}
                </ol>
              </details>
            </>
          )}
          {retry && (
            <button className="rr-text-action" onClick={() => setAttempt((n) => n + 1)}>
              Erneut berechnen
            </button>
          )}
          <small className="rr-routing-credit">
            <a href="https://project-osrm.org/" target="_blank" rel="noreferrer">
              Routing mit OSRM
            </a>{' '}
            ·{' '}
            <a href="https://www.openstreetmap.org/fixthemap" target="_blank" rel="noreferrer">
              Kartenfehler melden
            </a>
          </small>
        </div>
      )}
    </section>
  )
}
