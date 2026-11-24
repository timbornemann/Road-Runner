import { useEffect, useMemo, useState } from 'react'
import { CarFront, Compass, MapPinPlus, Route as RouteIcon } from 'lucide-react'
import { api, type RouteStage, type Stop } from './shared'
import { TripMap, type Coordinates } from './TripMap'

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

export default function RoadRouteMap({ tripId, stages, route, visibleIds, onPick, onSelect }: Props) {
  const [roads, setRoads] = useState(false)
  const [stageId, setStageId] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<RoadState | null>(null)
  const stage = stages.find((s) => String(s.id) === stageId)
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
  return (
    <section className="rr-map-card">
      <div className="rr-map-heading">
        <div>
          <Compass size={19} />
          <h2>Routenkarte</h2>
        </div>
        {stages.length > 0 && (
          <select
            className="rr-map-scope"
            aria-label="Kartenausschnitt nach Etappe"
            value={stage?.id ?? ''}
            onChange={(e) => setStageId(e.target.value)}
          >
            <option value="">Gesamte Route</option>
            {stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="rr-tabs rr-map-modes" role="group" aria-label="Kartenverlauf">
        <button className={!roads ? 'active' : ''} aria-pressed={!roads} onClick={() => setRoads(false)}>
          <RouteIcon size={15} /> Reihenfolge
        </button>
        <button className={roads ? 'active' : ''} aria-pressed={roads} onClick={() => setRoads(true)}>
          <CarFront size={15} /> Straßenverlauf
        </button>
      </div>
      <div className="rr-route-map">
        <TripMap
          stops={stops}
          visibleIds={roads ? undefined : visibleIds}
          numbers={numbers}
          roadLegs={roads ? result?.legs : undefined}
          connectStops={!roads}
          onSelect={onSelect}
          onPick={(coords) => onPick(coords, stage)}
        />
      </div>
      {!roads ? (
        <p className="rr-map-hint">
          <MapPinPlus size={16} /> Kartenklick zum Anlegen eines Ortes mit Besuch.
        </p>
      ) : (
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
              <details className="rr-road-legs" open={!result.complete || undefined}>
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
