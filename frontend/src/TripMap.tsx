import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import * as L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Map as MapIcon } from 'lucide-react'
import type { Stop } from './shared'
import type { RoadLeg } from './RoadRouteMap'
import MapPointPopup from './MapPointPopup'

export type Coordinates = [number, number]

export function getCoordinates(stop: Stop): Coordinates | null {
  return typeof stop.lat === 'number' && typeof stop.lon === 'number' ? [stop.lat, stop.lon] : null
}

interface MapProps {
  stops: Stop[]
  connectStops?: boolean
  numbers?: ReadonlyMap<number, number>
  roadLegs?: RoadLeg[]
  visibleIds?: ReadonlySet<number>
  onSelect?: (stop: Stop) => void
  onPick?: (coords: Coordinates) => void
  picked?: Coordinates | null
  popup?: { stop: Stop; content: ReactNode } | null
  onDismiss?: () => void
  fitRequest?: number
  focusRequest?: number
}

function fitPlaces(map: L.Map, coords: Coordinates[]) {
  if (coords.length === 1) map.setView(coords[0], 11, { animate: false })
  else if (coords.length > 1)
    map.fitBounds(L.latLngBounds(coords), { padding: [32, 32], maxZoom: 13, animate: false })
  else map.setView([46.8, 9.5], 6, { animate: false })
}

export function TripMap({
  stops,
  visibleIds,
  onSelect,
  onPick,
  picked,
  connectStops = true,
  numbers,
  roadLegs,
  popup,
  onDismiss,
  fitRequest,
  focusRequest,
}: MapProps) {
  const host = useRef<HTMLDivElement>(null)
  const [map, setMap] = useState<L.Map | null>(null)
  const layersRef = useRef<L.LayerGroup | null>(null)
  const markers = useRef(new Map<string, L.Marker>())
  const visiblePoints = useRef<Coordinates[]>([])
  const [stack, setStack] = useState<string | null>(null)
  const lastPin = useRef<number | null>(null)
  const action = useRef({ onPick, onSelect, popup, onDismiss, stack })
  action.current = { onPick, onSelect, popup, onDismiss, stack }
  const lastFit = useRef('')
  const [tileError, setTileError] = useState(false)
  const immersive = fitRequest !== undefined

  useEffect(() => {
    if (!host.current) return
    const map = L.map(host.current, { scrollWheelZoom: immersive, zoomControl: false, minZoom: 2 }).setView(
      [46.8, 9.5],
      6,
    )
    setMap(map)
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
    L.control
      .zoom({ position: immersive ? 'topright' : 'bottomright', zoomInTitle: 'Vergrößern', zoomOutTitle: 'Verkleinern' })
      .addTo(map)
    map.attributionControl.setPrefix(false)
    layersRef.current = L.layerGroup().addTo(map)
    map.on('click', (event: L.LeafletMouseEvent) => {
      if (action.current.popup || action.current.stack) {
        action.current.onDismiss?.()
        setStack(null)
        return
      }
      action.current.onPick?.([
        Number(event.latlng.lat.toFixed(6)),
        Number(event.latlng.wrap().lng.toFixed(6)),
      ])
    })
    let hidden = !host.current.clientWidth || !host.current.clientHeight
    const resize = new ResizeObserver(() => {
      const nowHidden = !host.current?.clientWidth || !host.current?.clientHeight
      map.invalidateSize()
      if (nowHidden && !hidden) setStack(null)
      if (!nowHidden && hidden && !action.current.popup) fitPlaces(map, visiblePoints.current)
      hidden = nowHidden
    })
    resize.observe(host.current)
    return () => {
      resize.disconnect()
      map.remove()
      layersRef.current = null
      markers.current.clear()
      lastFit.current = ''
    }
  }, [immersive])

  const groups = useMemo(() => {
    const groups = new Map<string, { stop: Stop; label: string }[]>()
    const pins = [...stops.filter((s) => !s.saved), ...stops.filter((s) => s.saved)]
    pins.forEach((stop, index) => {
      if (visibleIds && !visibleIds.has(stop.id)) return
      const coords = getCoordinates(stop)
      if (!coords) return
      const key = coords.join(',')
      const group = groups.get(key) ?? []
      group.push({ stop, label: stop.saved ? '★' : String(numbers?.get(stop.id) ?? index + 1) })
      groups.set(key, group)
    })
    return groups
  }, [stops, visibleIds, numbers])

  useEffect(() => {
    const layer = layersRef.current
    if (!map || !layer) return
    layer.clearLayers()
    markers.current.clear()
    const route = stops.filter((stop) => !stop.saved)
    const allCoords: Coordinates[] = []
    if (connectStops) {
      route.slice(1).forEach((to, i) => {
        const from = route[i]
        const a = getCoordinates(from),
          b = getCoordinates(to)
        if (a && b && (!visibleIds || (visibleIds.has(from.id) && visibleIds.has(to.id)))) {
          L.polyline([a, b], {
            color: '#29644e',
            weight: 3,
            opacity: 0.8,
            dashArray: '5 8',
            interactive: false,
          }).addTo(layer)
        }
      })
    }
    for (const leg of roadLegs ?? []) {
      if (leg.status !== 'ok' || leg.geometry.length < 2) continue
      const line = L.polyline(leg.geometry, { color: '#24654b', weight: 4, interactive: false }).addTo(layer)
      const bounds = line.getBounds()
      allCoords.push([bounds.getSouth(), bounds.getWest()], [bounds.getNorth(), bounds.getEast()])
    }
    groups.forEach((group, key) => {
      const active = group.find((pin) => pin.stop.id === popup?.stop.id)
      const { stop, label: number } = active ?? group[0]
      const coords = getCoordinates(stop)!
      allCoords.push(coords)
      const style = stop.saved ? 'saved' : stop.kind === 'sleep' ? 'sleep' : 'stop'
      const pin = document.createElement('span')
      pin.className = 'rr-pin rr-pin-' + style + (active ? ' rr-pin-selected' : '')
      pin.textContent = group.length === 1 ? number : number + '+'
      const icon = L.divIcon({
        className: 'rr-map-marker',
        html: pin,
        iconSize: [34, 34],
        iconAnchor: [17, 17],
      })
      const label = document.createElement('span')
      label.textContent = group.length === 1 ? stop.title : group.length + ' Einträge an diesem Ort'
      const marker = L.marker(coords, { icon, title: label.textContent, alt: label.textContent, zIndexOffset: active ? 1000 : 0 })
        .bindTooltip(label, { direction: 'top', offset: [0, -15] })
        .addTo(layer)
      markers.current.set(key, marker)
      function activate() {
        marker.closeTooltip()
        if (group.length > 1) {
          action.current.onDismiss?.()
          setStack(key)
        } else if (action.current.onSelect) {
          setStack(null)
          lastPin.current = stop.id
          action.current.onSelect(stop)
        } else marker.openTooltip()
      }
      marker.on('click', activate)
      marker.getElement()?.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        event.stopPropagation()
        if (!event.repeat) activate()
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
      if (!action.current.popup && host.current?.clientWidth && host.current.clientHeight) fitPlaces(map, allCoords)
    }
  }, [map, stops, groups, visibleIds, picked, connectStops, roadLegs, popup?.stop.id])

  useEffect(() => {
    setStack(null)
    if (map && fitRequest) fitPlaces(map, visiblePoints.current)
  }, [map, fitRequest])

  const latitude = popup?.stop.lat
  const longitude = popup?.stop.lon
  useEffect(() => {
    if (!map || latitude == null || longitude == null) return
    setStack(null)
    if (lastPin.current !== action.current.popup?.stop.id) {
      const coords: Coordinates = [latitude, longitude]
      map.setView(coords, Math.max(map.getZoom(), 12), { animate: false })
      map.eachLayer((layer) => { if (layer instanceof L.Popup) layer.setLatLng(coords) })
    }
    lastPin.current = null
  }, [map, popup?.stop.id, latitude, longitude, focusRequest])

  const choices = stack ? groups.get(stack) : undefined
  const choiceCount = choices?.length ?? 0
  useEffect(() => {
    if (stack && choiceCount < 2) setStack(null)
  }, [stack, choiceCount])
  const coords = popup ? getCoordinates(popup.stop) : choices && choiceCount > 1 ? getCoordinates(choices[0].stop) : null
  const close = () => {
    setStack(null)
    onDismiss?.()
    const key = coords?.join(',')
    requestAnimationFrame(() => {
      const target = (key && markers.current.get(key)?.getElement()) || host.current
      target?.focus({ preventScroll: true })
    })
  }

  return (
    <div className={'rr-map' + (onPick ? ' can-pick' : '')}>
      <div ref={host} className="rr-map-surface" aria-label="Reisekarte" />
      {map && coords && (popup || choices) && (
        <MapPointPopup key={popup ? popup.stop.id : stack} map={map} coords={coords} onClose={close}
          label={popup ? 'Besuchsdetails' : 'Besuch auswählen'}>
          {popup ? popup.content : (
            <div className="pl-popup-choices">
              <h2>Besuche an diesem Ort</h2>
              {choices?.map(({stop, label}) => (
                <button type="button" key={stop.id} onClick={() => {
                  setStack(null)
                  lastPin.current = stop.id
                  onSelect?.(stop)
                }}>
                  <b>{label}</b><span>{[stop.title, stop.date, stop.time].filter(Boolean).join(' · ')}</span>
                </button>
              ))}
            </div>
          )}
        </MapPointPopup>
      )}
      {tileError && (
        <div className="rr-map-warning" role="status">
          <MapIcon size={14} />
          Kartenhintergrund nicht erreichbar
        </div>
      )}
    </div>
  )
}
