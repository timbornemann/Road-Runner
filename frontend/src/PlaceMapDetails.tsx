import {
  Check, ChevronRight, ExternalLink, MapPin, MapPinPlus, Navigation,
  Pencil, Plus, Route as RouteIcon, Trash2,
} from 'lucide-react'
import { NotebookBacklinks, useNotebookNavigation } from './NotebookNavigation'
import { categoryIcon, PlaceGlyph, type PlaceIcons } from './PlaceSymbols'
import type { GeoResult } from './PlacesMap'
import { TagChips } from './Tags'
import { dateLabel, navUrl, type Place, type TripData } from './shared'
import './place-map-details.css'

interface Props {
  data: TripData
  place?: Place
  candidate: GeoResult | null
  icons: PlaceIcons
  onVisit: (id: number) => void
  onOpenVisit: (id: number) => void
  onEdit: (place: Place) => void
  onDelete: (place: Place) => void
  onLocate: (place: Place) => void
  onSaveResult: (result: GeoResult) => void
}

export default function PlaceMapDetails({
  data, place, candidate, icons, onVisit, onOpenVisit, onEdit, onDelete, onLocate, onSaveResult,
}: Props) {
  const { open } = useNotebookNavigation()
  const point = place ?? candidate
  if (!point) return null
  const visits = place ? data.visits.filter((visit) => visit.place_id === place.id) : []
  const areas = place ? data.notebook.areas.filter((area) => area.stop_ids.includes(place.id)) : []

  return (
    <article className="pl-place-card" aria-label={point.title}>
      <header className="pl-place-title">
        <span className={'pl-detail-symbol' + (place ? '' : ' external')}>
          <PlaceGlyph
            value={place?.icon ?? categoryIcon(point.category)}
            type={place?.icon_type ?? 'lucide'}
            icons={icons}
            size={23}
          />
        </span>
        <div>
          <small>{point.category}</small>
          <h2>{point.title}</h2>
        </div>
      </header>
      <div className="pl-card-actions">
        {place ? (
          <button className="btn btn-primary" onClick={() => onVisit(place.id)}>
            <RouteIcon size={16} /> Zur Route hinzufügen
          </button>
        ) : candidate && (
          <button className="btn btn-primary" onClick={() => onSaveResult(candidate)}>
            <Plus size={16} /> Ort übernehmen
          </button>
        )}
        <a className="btn btn-secondary pl-card-tool" href={navUrl(point)} target="_blank" rel="noreferrer"
          title="Navigation öffnen" aria-label="Navigation öffnen">
          <Navigation size={17} />
        </a>
        {place && (
          <button className="btn btn-secondary pl-card-tool" onClick={() => onEdit(place)}
            title="Ort bearbeiten" aria-label="Bearbeiten">
            <Pencil size={16} />
          </button>
        )}
      </div>
      {place?.image && (
        <img className="pl-cover" src={place.image.url} alt={'Titelbild von ' + place.title} />
      )}
      {place && <TagChips tags={place.tags} />}
      <div className="pl-card-location">
        {point.address && <p className="pl-address"><MapPin size={14} /> {point.address}</p>}
        {point.lat !== null && point.lon !== null ? (
          <span className="pl-coords">{point.lat.toFixed(5)}, {point.lon.toFixed(5)}</span>
        ) : place && (
          <button className="text-link" onClick={() => onLocate(place)}>
            <MapPinPlus size={15} /> Auf Karte platzieren
          </button>
        )}
      </div>
      {place?.description && <p className="pl-description">{place.description}</p>}
      {!!place?.links.length && (
        <ul className="pl-links">
          {place.links.map((link, idx) => (
            <li key={idx}>
              <a href={link.url} target="_blank" rel="noreferrer">
                <ExternalLink size={14} /> {link.label || link.url}
              </a>
            </li>
          ))}
        </ul>
      )}
      {visits.length > 0 && (
        <section className="pl-visits">
          <h3>In der Routenplanung</h3>
          {visits.map((visit) => {
            const stage = data.stages.find((s) => s.id === visit.stage_id)
            const variant = stage?.variants.find((v) => v.id === visit.variant_id)
            return (
              <button key={visit.id} onClick={() => onOpenVisit(visit.id)}>
                {visit.done ? <Check size={15} aria-label="Besucht" /> : <RouteIcon size={15} />}
                <span>
                  <strong>{stage?.name || 'Ohne Etappe'}{variant && ' · ' + variant.name}</strong>
                  <small>
                    {visit.date ? dateLabel(visit.date) : 'Flexibler Stopp'}
                    {visit.time && ' · ' + visit.time.slice(0, 5) + ' Uhr'}
                  </small>
                </span>
                <ChevronRight size={14} />
              </button>
            )
          })}
        </section>
      )}
      {areas.length > 0 && (
        <div className="pl-areas">
          <span>Gebiete</span>
          {areas.map((area) => (
            <button className="text-link" key={area.id} onClick={() => open({ kind: 'area', id: area.id })}>
              {area.name}
            </button>
          ))}
        </div>
      )}
      {place && <NotebookBacklinks target={{ kind: 'stop', id: place.id }} />}
      <footer className="pl-card-footer">
        {point.osm_type && point.osm_id && (
          <a className="pl-coords" href={'https://www.openstreetmap.org/' + point.osm_type + '/' + point.osm_id}
            target="_blank" rel="noreferrer">
            © OpenStreetMap-Mitwirkende
          </a>
        )}
        {place && (
          <button className="btn-icon" title="Ort löschen" aria-label="Ort löschen" onClick={() => onDelete(place)}>
            <Trash2 size={15} />
          </button>
        )}
      </footer>
    </article>
  )
}
