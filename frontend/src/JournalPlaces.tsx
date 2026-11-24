import { useEffect, useState } from 'react'
import { BedDouble, BookOpen, Camera, Check, Heart, ListPlus, MapPin, Search } from 'lucide-react'
import { api, dateLabel, Modal, type Stop, type TripData } from './shared'
import { TripMap } from './Route'

const placeKinds = {
  sleep: { label: 'Schlafplatz', Icon: BedDouble },
  stop: { label: 'Zwischenstopp', Icon: MapPin },
  sight: { label: 'Sehenswürdigkeit', Icon: Camera },
}

export function JournalMap({ data, open }: { data: TripData; open: (stop: Stop) => void }) {
  const visited = new Set(data.visits.filter(visit => visit.done).map(visit => visit.place_id))
  const places = data.stops.filter(stop => stop.id === stop.place_id && visited.has(stop.id))
  const mapped = places.filter((stop) => stop.lat != null && stop.lon != null)
  return (
    <section className="journal-panel">
      <div className="journal-section-title">
        <MapPin size={20} />
        <h2>Besuchte Orte</h2>
        <small>{places.length}</small>
      </div>
      {mapped.length > 0 && (
        <div className="journal-map">
          <TripMap stops={mapped} connectStops={false} onSelect={open} />
        </div>
      )}
      {!places.length && (
        <p className="empty-inline">
          Hake einen Stopp in deiner Route als besucht ab. Hier wächst daraus deine Reisekarte.
        </p>
      )}
      {places.length > 0 && (
        <div className="journal-places-list">
          {places.map((stop) => {
            const { Icon, label } = placeKinds[stop.kind]
            return (
              <button className="journal-place-row" key={stop.id} onClick={() => open(stop)}>
                <span className="journal-place-icon">
                  <Icon size={17} />
                </span>
                <span>
                  <strong>{stop.title}</strong>
                  <small>
                    {label}
                    {stop.lat == null ? ' · Ohne Kartenposition' : ''}
                  </small>
                </span>
                {data.favorite_stop_ids.includes(stop.id) && (
                  <Heart size={15} fill="currentColor" aria-label="Lieblingsplatz" />
                )}
              </button>
            )
          })}
        </div>
      )}
    </section>
  )
}

interface Favorite {
  stop: Stop
  trip_id: number
  trip_name: string
  copied_to_trip_ids?: number[]
}

export function FavoritePlaces({
  data,
  reload,
  notify,
  open,
}: {
  data: TripData
  reload: () => Promise<void>
  notify: (message: string) => void
  open: (stop: Stop) => void
}) {
  const [favorites, setFavorites] = useState<Favorite[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const tripIds = data.favorite_stop_ids.join(',')
  useEffect(() => {
    let current = true
    setLoading(true)
    setError('')
    api<Favorite[]>('/api/favorites')
      .then((list) => {
        if (current) setFavorites(list)
      })
      .catch((cause) => {
        if (current)
          setError(cause instanceof Error ? cause.message : 'Lieblingsplätze konnten nicht geladen werden.')
      })
      .finally(() => {
        if (current) setLoading(false)
      })
    return () => {
      current = false
    }
  }, [tripIds, refresh])

  async function action(favorite: Favorite, copy: boolean) {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      if (copy) {
        await api('/api/trips/' + data.trip.id + '/favorites/' + favorite.stop.id + '/copy', 'POST')
        notify('Ort auf der Ortekarte dieser Reise gespeichert')
      } else {
        await api('/api/trips/' + favorite.trip_id + '/favorites/' + favorite.stop.id, 'DELETE')
        notify('Aus den Lieblingsplätzen entfernt')
      }
      await reload()
      setRefresh((current) => current + 1)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Die Änderung konnte nicht gespeichert werden.')
    } finally {
      setBusy(false)
    }
  }
  const filter = query.trim().toLocaleLowerCase('de')
  const matching = favorites.filter((favorite) =>
    [favorite.stop.title, favorite.trip_name, favorite.stop.address].some((value) =>
      value.toLocaleLowerCase('de').includes(filter),
    ),
  )
  return (
    <section className="journal-panel">
      <div className="journal-section-title">
        <Heart size={20} />
        <h2>Lieblingsplätze aller Reisen</h2>
      </div>
      {!!favorites.length && (
        <label className="journal-search">
          <Search size={16} />
          <input
            type="search"
            aria-label="Lieblingsplätze durchsuchen"
            placeholder="Ort oder Reise suchen"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      )}
      {error && (
        <p className="error" role="alert">
          {error}{' '}
          <button className="text-link" onClick={() => setRefresh((current) => current + 1)}>
            Erneut laden
          </button>
        </p>
      )}
      {loading && (
        <p className="empty-inline" role="status">
          Lieblingsplätze werden geladen …
        </p>
      )}
      {!loading && !error && !matching.length && (
        <p className="empty-inline">
          {favorites.length
            ? 'Kein passender Ort gefunden.'
            : 'Markiere einen Ort im Tagebuch mit einem Herz. Du findest ihn hier auch auf deiner nächsten Reise wieder.'}
        </p>
      )}
      <div className="journal-favorites">
        {matching.map((favorite) => {
          const { stop } = favorite
          const { Icon } = placeKinds[stop.kind]
          const current = favorite.trip_id === data.trip.id
          const copied = favorite.copied_to_trip_ids?.includes(data.trip.id)
          return (
            <article key={stop.id}>
              <div className="journal-favorite-name">
                <Icon size={17} />
                <div>
                  <small>{favorite.trip_name}</small>
                  <h3>{stop.title}</h3>
                </div>
                <button
                  className="btn-icon journal-heart is-favorite"
                  disabled={busy}
                  aria-label={stop.title + ' aus den Lieblingsplätzen entfernen'}
                  title="Aus den Lieblingsplätzen entfernen"
                  onClick={() => void action(favorite, false)}
                >
                  <Heart size={17} fill="currentColor" />
                </button>
              </div>
              {stop.address && <p>{stop.address}</p>}
              {stop.notes && <p className="journal-favorite-note">{stop.notes}</p>}
              {current ? (
                <button className="text-link" onClick={() => open(stop)}>
                  <BookOpen size={14} /> Ort im Tagebuch öffnen
                </button>
              ) : (
                <button
                  className="text-link"
                  disabled={busy || copied}
                  onClick={() => void action(favorite, true)}
                >
                  {copied ? <Check size={15} /> : <ListPlus size={15} />}
                  {copied ? 'In dieser Reise gespeichert' : 'Auf die Ortekarte dieser Reise'}
                </button>
              )}
            </article>
          )
        })}
      </div>
    </section>
  )
}

export function JournalPlaceDetail({
  data,
  stop,
  reload,
  onClose,
  readDay,
  write,
}: {
  data: TripData
  stop: Stop
  reload: () => Promise<void>
  onClose: () => void
  readDay: (day: string) => void
  write: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const liked = data.favorite_stop_ids.includes(stop.id)
  const entries = data.journal_entries.filter((entry) => entry.stop_ids.includes(stop.id))
  async function like() {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await api('/api/trips/' + data.trip.id + '/favorites/' + stop.id, liked ? 'DELETE' : 'PUT')
      await reload()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Änderung konnte nicht gespeichert werden.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal title={stop.title} onClose={onClose}>
      <div className="journal-place-detail">
        <p className="empty-inline">
          {placeKinds[stop.kind].label}
          {stop.address ? ' · ' + stop.address : ''}
        </p>
        {stop.notes && <p>{stop.notes}</p>}
        <button
          className={'btn btn-secondary journal-heart' + (liked ? ' is-favorite' : '')}
          aria-pressed={liked}
          disabled={busy}
          onClick={() => void like()}
        >
          <Heart size={16} fill={liked ? 'currentColor' : 'none'} />
          {stop.kind === 'sleep' ? 'Hier würde ich wieder schlafen' : 'Lieblingsplatz'}
        </button>
        <div className="journal-place-entries">
          <h3>Verknüpfte Einträge</h3>
          {entries.length ? (
            entries.map((entry) => (
              <button className="text-link" key={entry.id} onClick={() => readDay(entry.date)}>
                <BookOpen size={15} />
                {dateLabel(entry.date)}
                {entry.title && ' · ' + entry.title}
              </button>
            ))
          ) : (
            <p className="empty-inline">Zu diesem Ort gibt es noch keinen Eintrag.</p>
          )}
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="btn btn-primary" onClick={write}>
          Eintrag zu diesem Ort schreiben
        </button>
      </div>
    </Modal>
  )
}
