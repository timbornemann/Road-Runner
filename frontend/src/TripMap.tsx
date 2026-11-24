import { useEffect, useRef, useState } from 'react'
import * as L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Map as MapIcon } from 'lucide-react'
import type { Stop } from './shared'
import type { RoadLeg } from './RoadRouteMap'

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
}: MapProps) {
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
    const map = L.map(host.current, { scrollWheelZoom: false, zoomControl: false, minZoom: 2 }).setView(
      [46.8, 9.5],
      6,
    )
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
    L.control
      .zoom({ position: 'bottomright', zoomInTitle: 'Vergrößern', zoomOutTitle: 'Verkleinern' })
      .addTo(map)
    map.attributionControl.setPrefix(false)
    layersRef.current = L.layerGroup().addTo(map)
    map.on('click', (event: L.LeafletMouseEvent) =>
      action.current.onPick?.([
        Number(event.latlng.lat.toFixed(6)),
        Number(event.latlng.wrap().lng.toFixed(6)),
      ]),
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
    const groups = new Map<string, { stop: Stop; label: string }[]>()
    pins.forEach((stop, index) => {
      if (visibleIds && !visibleIds.has(stop.id)) return
      const coords = getCoordinates(stop)
      if (!coords) return
      const key = coords.join(',')
      const group = groups.get(key) ?? []
      group.push({ stop, label: stop.saved ? '★' : String(numbers?.get(stop.id) ?? index + 1) })
      groups.set(key, group)
    })
    groups.forEach((group) => {
      const { stop, label: number } = group[0]
      const coords = getCoordinates(stop)!
      allCoords.push(coords)
      const style = stop.saved ? 'saved' : stop.kind === 'sleep' ? 'sleep' : 'stop'
      const pin = document.createElement('span')
      pin.className = 'rr-pin rr-pin-' + style
      pin.textContent = group.length === 1 ? number : number + '+'
      const icon = L.divIcon({
        className: 'rr-map-marker',
        html: pin,
        iconSize: [34, 34],
        iconAnchor: [17, 17],
      })
      const label = document.createElement('span')
      label.textContent = group.length === 1 ? stop.title : group.length + ' Einträge an diesem Ort'
      const marker = L.marker(coords, { icon, title: label.textContent, alt: label.textContent })
        .bindTooltip(label, { direction: 'top', offset: [0, -15] })
        .addTo(layer)
      if (group.length > 1) {
        const menu = document.createElement('div')
        menu.className = 'rr-overlapping-pins'
        group.forEach(({ stop: visit, label: badge }) => {
          const button = document.createElement('button')
          button.type = 'button'
          button.textContent = [badge, visit.title, visit.date].filter(Boolean).join(' · ')
          button.onclick = () => {
            marker.closePopup()
            action.current.onSelect?.(visit)
          }
          menu.appendChild(button)
        })
        marker.bindPopup(menu)
      } else
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
  }, [stops, visibleIds, picked, connectStops, numbers, roadLegs])

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
