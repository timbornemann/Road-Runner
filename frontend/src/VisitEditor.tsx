import { useRef, useState, type FormEvent } from 'react'
import { MapPin, Plus } from 'lucide-react'
import { api, Modal, type Stop, type TripData } from './shared'
import { categoryIcon, placeCategories } from './PlaceSymbols'

type Coordinates = [number, number]
type VisitKind = Stop['kind']
interface Props {
  data: TripData
  placeId?: number
  visit?: Stop
  stageId?: number | null
  variantId?: number | null
  coordinates?: Coordinates
  reload: () => Promise<void>
  notify: (message: string) => void
  onClose: () => void
}

function defaultKind(category?: string): VisitKind {
  if (category === 'Campingplatz' || category === 'Schlafplatz') return 'sleep'
  if (['Sehenswürdigkeit', 'Aussichtspunkt', 'Park', 'Berg'].includes(category ?? '')) return 'sight'
  return 'stop'
}

export default function VisitEditor({
  data,
  placeId,
  visit,
  coordinates,
  stageId = null,
  variantId = null,
  reload,
  notify,
  onClose,
}: Props) {
  const [mode, setMode] = useState<'existing' | 'new'>(
    coordinates || (!placeId && !visit && data.places.length === 0) ? 'new' : 'existing',
  )
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<number | null>(visit?.place_id ?? placeId ?? null)
  const selected = data.places.find((p) => p.id === selectedId)
  const [kind, setKind] = useState<VisitKind>(visit?.kind ?? defaultKind(selected?.category))
  const [name, setName] = useState('')
  const [category, setCategory] = useState('Ort')
  const [address, setAddress] = useState('')
  const [lat, setLat] = useState(String(coordinates?.[0] ?? ''))
  const [lon, setLon] = useState(String(coordinates?.[1] ?? ''))
  const [stage, setStage] = useState(visit?.stage_id ?? stageId)
  const [variant, setVariant] = useState(visit?.variant_id ?? variantId)
  const [position, setPosition] = useState(visit ? 'keep' : 'last')
  const [date, setDate] = useState(visit?.date ?? '')
  const [time, setTime] = useState(visit?.time ?? '')
  const [endDate, setEndDate] = useState(visit?.end_date ?? '')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const lock = useRef(false)
  const fixedPlace = Boolean(visit || placeId)
  const currentStage = data.stages.find((item) => item.id === stage)
  const otherVisits = data.stops
    .filter((s) => !s.saved && s.id !== visit?.id)
    .sort((a, b) => a.position - b.position || a.id - b.id)
  const siblings = otherVisits.filter(
    (s) => s.stage_id === stage && (!variant || !s.variant_id || s.variant_id === variant),
  )
  const search = query.trim().toLocaleLowerCase('de')
  const matches = data.places.filter(
    (p) =>
      p.id === selectedId ||
      [p.title, p.address, p.category, ...p.tags].join(' ').toLocaleLowerCase('de').includes(search),
  )
  const chooseMode = (next: typeof mode) => {
    setMode(next)
    setKind(defaultKind(next === 'new' ? category : selected?.category))
    setError('')
  }
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (lock.current) return
    if (mode === 'new' && (!name.trim() || Boolean(lat.trim()) !== Boolean(lon.trim()))) {
      setError(!name.trim() ? 'Gib einen Ortsnamen ein.' : 'Gib beide Koordinaten an.')
      return
    }
    if (mode === 'existing' && !selected) {
      setError('Wähle einen Ort aus der Sammlung.')
      return
    }
    if (kind === 'sleep' && endDate && (!date || endDate < date)) {
      setError('Für eine Übernachtung muss die Abreise am Anreisetag oder später liegen.')
      return
    }
    const orderedPosition =
      position === 'last' ? otherVisits.length : otherVisits.findIndex((s) => String(s.id) === position)
    const schedule = {
      kind,
      stage_id: stage,
      variant_id: stage ? variant : null,
      date: date || null,
      time: time || null,
      end_date: kind === 'sleep' ? endDate || null : null,
      ...(position !== 'keep' && orderedPosition >= 0 ? { position: orderedPosition } : {}),
    }
    const source =
      mode === 'new'
        ? {
            place: {
              title: name.trim(),
              category,
              icon_type: 'lucide',
              icon: categoryIcon(category),
              address: address.trim(),
              lat: lat.trim() ? Number(lat) : null,
              lon: lon.trim() ? Number(lon) : null,
            },
          }
        : { place_id: selectedId }
    lock.current = true
    setSaving(true)
    setError('')
    try {
      const path = '/api/trips/' + data.trip.id + '/visits'
      if (visit) await api(path + '/' + visit.id, 'PATCH', schedule)
      else await api(path, 'POST', { ...source, ...schedule })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Der Besuch konnte nicht gespeichert werden.')
      lock.current = false
      setSaving(false)
      return
    }
    try {
      await reload()
      notify(visit ? 'Besuch gespeichert.' : 'Besuch zur Route hinzugefügt.')
    } catch {
      notify('Besuch gespeichert. Die Ansicht konnte noch nicht aktualisiert werden.')
    }
    onClose()
  }
  return (
    <Modal
      title={visit ? 'Besuch bearbeiten' : 'Zur Route hinzufügen'}
      onClose={() => {
        if (!lock.current) onClose()
      }}
    >
      <form className="rr-stop-form" onSubmit={submit}>
        {!fixedPlace && (
          <div className="rr-tabs rr-visit-mode" role="group" aria-label="Ort wählen">
            <button
              type="button"
              aria-pressed={mode === 'existing'}
              className={mode === 'existing' ? 'active' : ''}
              onClick={() => chooseMode('existing')}
            >
              <MapPin size={15} /> Aus Ortekarte
            </button>
            <button
              type="button"
              aria-pressed={mode === 'new'}
              className={mode === 'new' ? 'active' : ''}
              onClick={() => chooseMode('new')}
            >
              <Plus size={15} /> Neuer Ort
            </button>
          </div>
        )}
        {fixedPlace ? (
          <div className="rr-visit-place">
            <MapPin size={19} />
            <div>
              <strong>{selected?.title ?? visit?.title}</strong>
              <small>{[selected?.category, selected?.address].filter(Boolean).join(' · ')}</small>
            </div>
          </div>
        ) : mode === 'existing' ? (
          <>
            <label className="field">
              Ortsammlung durchsuchen
              <input
                type="search"
                value={query}
                placeholder="Name, Kategorie oder Tag"
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <label className="field">
              Ort aus der Sammlung
              <select
                aria-label="Ort aus der Sammlung"
                required
                value={selectedId ?? ''}
                onChange={(e) => {
                  const place = data.places.find((p) => p.id === Number(e.target.value))
                  setSelectedId(place?.id ?? null)
                  setKind(defaultKind(place?.category))
                }}
              >
                <option value="">{matches.length ? 'Ort auswählen' : 'Keine passenden Orte'}</option>
                {matches.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                    {p.address ? ' · ' + p.address : ''}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : (
          <>
            <label className="field">
              Name des Ortes
              <input required maxLength={250} value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="field">
              Kategorie
              <select
                aria-label="Kategorie"
                value={category}
                onChange={(e) => {
                  setCategory(e.target.value)
                  setKind(defaultKind(e.target.value))
                }}
              >
                {placeCategories.map((cat) => (
                  <option key={cat}>{cat}</option>
                ))}
              </select>
            </label>
            <label className="field">
              Adresse
              <input value={address} maxLength={500} onChange={(e) => setAddress(e.target.value)} />
            </label>
            <div className="rr-form-pair">
              <label className="field">
                Breitengrad
                <input
                  type="number"
                  min={-90}
                  max={90}
                  step="any"
                  value={lat}
                  onChange={(e) => setLat(e.target.value)}
                />
              </label>
              <label className="field">
                Längengrad
                <input
                  type="number"
                  min={-180}
                  max={180}
                  step="any"
                  value={lon}
                  onChange={(e) => setLon(e.target.value)}
                />
              </label>
            </div>
          </>
        )}
        {data.stages.length > 0 && (
          <div className="rr-form-pair">
            <label className="field">
              Etappe
              <select
                aria-label="Etappe"
                value={stage ?? ''}
                onChange={(e) => {
                  const next = data.stages.find((s) => s.id === Number(e.target.value))
                  setStage(next?.id ?? null)
                  setVariant(next?.active_variant_id ?? null)
                  setPosition('last')
                }}
              >
                <option value="">Ohne Etappe</option>
                {data.stages.map((s) => (
                  <option value={s.id} key={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            {!!currentStage?.variants.length && (
              <label className="field">
                Variante
                <select
                  aria-label="Variante"
                  value={variant ?? ''}
                  onChange={(e) => {
                    setVariant(e.target.value ? Number(e.target.value) : null)
                    setPosition('last')
                  }}
                >
                  <option value="">Alle Varianten</option>
                  {currentStage.variants.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        )}
        <div className="rr-form-pair">
          <label className="field">
            Art des Besuchs
            <select aria-label="Art des Besuchs" value={kind} onChange={(e) => setKind(e.target.value as VisitKind)}>
              <option value="stop">Zwischenstopp</option>
              <option value="sight">Besichtigung</option>
              <option value="sleep">Übernachtung</option>
            </select>
          </label>
          <label className="field">
            Position
            <select aria-label="Position" value={position} onChange={(e) => setPosition(e.target.value)}>
              {visit && <option value="keep">Bisherige Position</option>}
              {siblings.map((s, i) => (
                <option value={s.id} key={s.id}>
                  Vor {i + 1}. {s.title}
                </option>
              ))}
              <option value="last">Am Ende</option>
            </select>
          </label>
        </div>
        <div className="rr-form-pair">
          <label className="field">
            {kind === 'sleep' ? 'Anreise' : 'Datum'}
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="field">
            Uhrzeit
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </label>
        </div>
        {kind === 'sleep' && (
          <label className="field">
            Abreise
            <input
              type="date"
              min={date || undefined}
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </label>
        )}
        {error && (
          <p className="rr-error" role="alert">
            {error}
          </p>
        )}
        <div className="actions">
          <button type="button" disabled={saving} className="btn btn-secondary" onClick={onClose}>
            Abbrechen
          </button>
          <button disabled={saving} className="btn btn-primary">
            {saving ? 'Speichert …' : visit ? 'Besuch speichern' : 'Besuch hinzufügen'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
