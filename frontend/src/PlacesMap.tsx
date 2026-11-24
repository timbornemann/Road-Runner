import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import * as L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { ChevronRight, Layers3, MapPin } from 'lucide-react'
import type { Place } from './shared'
import { categoryIcon, iconBody, type PlaceIcons, type SymbolType } from './PlaceSymbols'
import MapPointPopup from './MapPointPopup'

export interface GeoResult {
  title: string
  address: string
  lat: number
  lon: number
  category: string
  osm_type: 'node' | 'way' | 'relation' | null
  osm_id: number | null
}
export interface Viewport {
  north: number
  south: number
  east: number
  west: number
  lat: number
  lon: number
}
export const geoKey = (r: GeoResult) =>
  r.osm_type && r.osm_id ? r.osm_type + '/' + r.osm_id : r.title + '/' + r.lat + '/' + r.lon
export type Focus = { coords: [number, number] } | { overview: true }
interface Props {
  places: Place[]
  results: GeoResult[]
  focus: Focus | null
  contextKey: string
  selectedId?: number
  icons: PlaceIcons
  onPlace: (place: Place) => void
  onResult: (r: GeoResult) => void
  onClick: (coords: [number, number]) => void
  onMove: (view: Viewport) => void
  placing: boolean
  popup: { key: string; coords: [number, number]; content: ReactNode } | null
  onDismissPopup: () => void
}
interface Point {
  lat: number
  lon: number
  title: string
  type: SymbolType
  value: string
  style: string
  select: () => void
}
function pin(type: SymbolType, value: string, icons: PlaceIcons, variant: string, count: number) {
  const inner = document.createElement('span')
  inner.className = 'pl-pin ' + variant
  if (type === 'emoji') inner.textContent = value
  else {
    const body = iconBody(icons, value)
    if (body) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      svg.setAttribute('viewBox', '0 0 24 24')
      svg.setAttribute('width', '18')
      svg.setAttribute('height', '18')
      svg.innerHTML = body
      inner.append(svg)
    } else inner.textContent = '●'
  }
  if (count > 1) {
    const badge = document.createElement('b')
    badge.className = 'pl-cluster-count'
    badge.textContent = String(count)
    inner.append(badge)
  }
  return L.divIcon({ html: inner, className: 'pl-marker', iconSize: [34, 34], iconAnchor: [17, 31] })
}
export default function PlacesMap(props: Props) {
  const host = useRef<HTMLDivElement>(null)
  const [map, setMap] = useState<L.Map | null>(null)
  const groupRef = useRef<L.LayerGroup | null>(null)
  const markers = useRef(new Map<string, L.Marker>())
  const [stack, setStack] = useState<string | null>(null)
  const stackRef = useRef<string | null>(null)
  stackRef.current = stack
  const latest = useRef(props)
  latest.current = props
  const [tilesMissing, setTilesMissing] = useState(false)
  function overview(map: L.Map, places: Place[]) {
    const points = places.flatMap((p) =>
      p.lat !== null && p.lon !== null ? [[p.lat, p.lon] as [number, number]] : [],
    )
    if (points.length)
      map.fitBounds(L.latLngBounds(points), { padding: [36, 36], maxZoom: 13, animate: false })
    else map.setView([51, 10], 5, { animate: false })
  }
  useEffect(() => {
    if (!host.current) return
    const map = L.map(host.current, { zoomControl: false, minZoom: 2, worldCopyJump: true })
    setMap(map)
    overview(map, latest.current.places)
    L.control
      .zoom({ position: 'topright', zoomInTitle: 'Vergrößern', zoomOutTitle: 'Verkleinern' })
      .addTo(map)
    const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution:
        '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap-Mitwirkende</a>',
    }).addTo(map)
    map.attributionControl.setPrefix(false)
    tiles.on('load tileerror', () => setTilesMissing(!host.current?.querySelector('.leaflet-tile-loaded')))
    tiles.on('tileload', () => setTilesMissing(false))
    groupRef.current = L.layerGroup().addTo(map)
    function view() {
      const b = map.getBounds(),
        center = map.getCenter().wrap()
      latest.current.onMove({
        north: b.getNorth(),
        south: b.getSouth(),
        west: b.getWest(),
        east: b.getEast(),
        lat: center.lat,
        lon: center.lng,
      })
    }
    map.on('moveend zoomend resize', view)
    map.on('click', (e: L.LeafletMouseEvent) => {
      if (!latest.current.placing && (latest.current.popup || stackRef.current)) {
        latest.current.onDismissPopup()
        setStack(null)
        return
      }
      const point = e.latlng.wrap()
      latest.current.onClick([Number(point.lat.toFixed(6)), Number(point.lng.toFixed(6))])
    })
    view()
    const observer = new ResizeObserver(() => map.invalidateSize())
    observer.observe(host.current)
    return () => {
      observer.disconnect()
      map.off('moveend zoomend resize', view)
      map.remove()
      groupRef.current = null
      markers.current.clear()
    }
  }, [])
  const positions = useMemo(() => {
    const positions = new Map<string, Point[]>()
    function add(point: Point) {
      const key = point.lat + ',' + point.lon
      const points = positions.get(key)
      if (points) points.push(point)
      else positions.set(key, [point])
    }
    props.places.forEach((p) => {
      if (p.lat !== null && p.lon !== null)
        add({
          lat: p.lat,
          lon: p.lon,
          title: p.title,
          type: p.icon_type,
          value: p.icon,
          style: p.id === props.selectedId ? 'selected' : 'owned',
          select: () => latest.current.onPlace(p),
        })
    })
    props.results.forEach((r) =>
      add({
        lat: r.lat,
        lon: r.lon,
        title: r.title,
        type: 'lucide',
        value: categoryIcon(r.category),
        style: props.popup?.key === 'geo/' + geoKey(r) ? 'selected' : 'external',
        select: () => latest.current.onResult(r),
      }),
    )
    return positions
  }, [props.places, props.results, props.selectedId, props.popup?.key])
  useEffect(() => {
    const group = groupRef.current
    if (!group) return
    group.clearLayers()
    markers.current.clear()
    positions.forEach((points, key) => {
      const front = points.find((p) => p.style === 'selected') ?? points[0]
      const name = points.length === 1 ? front.title : points.length + ' Orte an dieser Position'
      const tooltip = document.createElement('span')
      tooltip.textContent = name
      const marker = L.marker([front.lat, front.lon], {
        title: name,
        alt: name,
        icon: pin(front.type, front.value, props.icons, front.style, points.length),
        zIndexOffset: front.style === 'selected' ? 2000 : front.style === 'owned' ? 1000 : 0,
      })
        .addTo(group)
        .bindTooltip(tooltip, { direction: 'top', offset: [0, -23] })
      markers.current.set(key, marker)
      function activate() {
        marker.closeTooltip()
        if (latest.current.placing) {
          latest.current.onClick([front.lat, front.lon])
        } else if (points.length === 1) {
          setStack(null)
          front.select()
        } else {
          latest.current.onDismissPopup()
          setStack(key)
        }
      }
      marker.on('click', activate)
      marker.getElement()?.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        event.stopPropagation()
        if (!event.repeat) activate()
      })
    })
  }, [positions, props.icons])
  useEffect(() => {
    setStack(null)
    if (!map || !props.focus) return
    if ('coords' in props.focus) {
      const coords = props.focus.coords
      map.setView(coords, Math.max(13, map.getZoom()), { animate: false })
      // Selecting the same list row again recenters the pin beneath its open card.
      // Let Leaflet fit the full card inside this new view, too.
      map.eachLayer((layer) => {
        if (layer instanceof L.Popup) layer.setLatLng(coords)
      })
    } else overview(map, latest.current.places)
  }, [map, props.focus])
  useEffect(() => {
    setStack(null)
  }, [props.contextKey, props.placing])
  const choices = stack ? positions.get(stack) : undefined
  const choice = choices?.[0]
  const popup = props.popup ?? (choice && choices ? {
    key: 'stack/' + stack,
    coords: [choice.lat, choice.lon] as [number, number],
    content: (
      <div className="pl-popup-choices">
        <h2>Orte an diesem Punkt</h2>
        {choices.map((point, index) => (
          <button key={index} type="button" onClick={() => { setStack(null); point.select() }}>
            <MapPin size={15} /><span>{point.title}</span><ChevronRight size={15} />
          </button>
        ))}
      </div>
    ),
  } : null)
  function closePopup() {
    const markerKey = popup?.coords.join(',')
    setStack(null)
    latest.current.onDismissPopup()
    requestAnimationFrame(() => {
      const target = (markerKey && markers.current.get(markerKey)?.getElement()) || host.current
      target?.focus({ preventScroll: true })
    })
  }
  return (
    <div className={'pl-map' + (props.placing ? ' placing' : '')}>
      <div
        className="pl-map-surface"
        ref={host}
        aria-label="Ortekarte mit gespeicherten Orten und Suchtreffern"
      />
      {map && popup && (
        <MapPointPopup key={popup.key} map={map} coords={popup.coords} onClose={closePopup}
          label={props.popup ? 'Ortsdetails' : 'Ort auswählen'}>
          {popup.content}
        </MapPointPopup>
      )}
      {tilesMissing && (
        <span className="pl-tile-status" role="status">
          <Layers3 size={14} /> Kartenhintergrund nicht erreichbar
        </span>
      )}
    </div>
  )
}
