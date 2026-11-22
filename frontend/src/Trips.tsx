import { useState, type FormEvent } from 'react'
import { ArrowRight, CalendarDays, Check, MapPin, Pencil, Plus, Trash2 } from 'lucide-react'
import { api, dateLabel, localDate, Modal, type Trip } from './shared'

export function tripStatus(trip: Trip) {
  const today = localDate()
  if (trip.end_date && trip.end_date < today) return 'Abgeschlossen'
  if (trip.start_date && trip.start_date <= today && (!trip.end_date || today <= trip.end_date))
    return 'Unterwegs'
  return 'In Planung'
}
export function tripDates(trip: Trip) {
  if (trip.start_date && trip.end_date) {
    const format = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'short', year: 'numeric' })
    return format.formatRange(new Date(trip.start_date + 'T12:00:00'), new Date(trip.end_date + 'T12:00:00'))
  }
  return trip.start_date
    ? 'Ab ' + dateLabel(trip.start_date)
    : trip.end_date
      ? 'Bis ' + dateLabel(trip.end_date)
      : 'Zeitraum offen'
}
export function TripChooser({
  trips,
  selected,
  choose,
  edit,
  create,
  close,
}: {
  trips: Trip[]
  selected?: number
  choose: (id: number) => void
  edit: (trip: Trip) => void
  create: () => void
  close: () => void
}) {
  return (
    <Modal title="Meine Reisen" onClose={close}>
      <div className="trip-list">
        {trips.map((trip) => (
          <div className="trip-choice" key={trip.id}>
            <button onClick={() => choose(trip.id)} className="trip-choice-main">
              <span className="trip-symbol">
                <MapPin size={20} />
              </span>
              <span>
                <strong>{trip.name}</strong>
                <small>
                  {tripStatus(trip)} · {tripDates(trip)}
                  {trip.is_demo ? ' · Beispielreise' : ''}
                </small>
              </span>
              {trip.id === selected ? <Check size={17} /> : <ArrowRight size={17} />}
            </button>
            <button
              className="btn-icon"
              title="Reise bearbeiten"
              aria-label={trip.name + ' bearbeiten'}
              onClick={() => edit(trip)}
            >
              <Pencil size={16} />
            </button>
          </div>
        ))}
      </div>
      <div className="actions">
        <button className="btn btn-primary" onClick={create}>
          <Plus size={16} />
          Neue Reise
        </button>
      </div>
    </Modal>
  )
}
export function TripEditor({
  trip,
  close,
  saved,
  removed,
}: {
  trip?: Trip
  close: () => void
  saved: (id: number) => Promise<void>
  removed: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [start, setStart] = useState(trip?.start_date || '')
  const currencyCodes = Array.from(
    new Set([
      trip?.currency || 'EUR',
      'EUR',
      'CHF',
      'NOK',
      'SEK',
      'DKK',
      'GBP',
      'USD',
      'CAD',
      'ISK',
      'PLN',
      'CZK',
      'HUF',
      'JPY',
      'AUD',
      ...Intl.supportedValuesOf('currency'),
    ]),
  )
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const form = new FormData(event.currentTarget)
    setBusy(true)
    setError('')
    try {
      const payload = {
        name: String(form.get('name')).trim(),
        region: String(form.get('region')).trim(),
        description: String(form.get('description')).trim(),
        start_date: start || null,
        end_date: form.get('end') || null,
        budget: Number(form.get('budget')),
        currency: form.get('currency'),
      }
      const result = await api<Trip>(
        trip ? '/api/trips/' + trip.id : '/api/trips',
        trip ? 'PATCH' : 'POST',
        payload,
      )
      await saved(result.id)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  async function remove() {
    if (!trip || busy) return
    setBusy(true)
    setError('')
    try {
      await api('/api/trips/' + trip.id, 'DELETE')
      await removed()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      title={deleting ? 'Reise löschen?' : trip ? 'Reise bearbeiten' : 'Neue Reise'}
      onClose={() => {
        if (!busy) close()
      }}
    >
      {deleting ? (
        <>
          <p>„{trip?.name}“ und alle zugehörigen Stopps, Vorräte und Buchungen werden dauerhaft gelöscht.</p>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <div className="actions">
            <button className="btn btn-secondary" disabled={busy} onClick={() => setDeleting(false)}>
              Abbrechen
            </button>
            <button className="btn btn-danger" disabled={busy} onClick={remove}>
              Reise löschen
            </button>
          </div>
        </>
      ) : (
        <form onSubmit={submit}>
          <div className="form-grid">
            <label className="field wide">
              Reisename
              <input
                name="name"
                required
                maxLength={160}
                defaultValue={trip?.name}
                placeholder="z. B. Mit dem Camper nach Schweden"
              />
            </label>
            <label className="field wide">
              Region oder Reiseziel
              <input name="region" defaultValue={trip?.region} placeholder="z. B. Südschweden" />
            </label>
            <label className="field">
              Beginn
              <input name="start" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
            </label>
            <label className="field">
              Ende
              <input name="end" type="date" min={start || undefined} defaultValue={trip?.end_date || ''} />
            </label>
            <label className="field">
              Reisebudget
              <input
                name="budget"
                type="number"
                min="0"
                step="0.01"
                required
                defaultValue={trip?.budget ?? 0}
              />
            </label>
            <label className="field">
              Basiswährung
              <select name="currency" defaultValue={trip?.currency || 'EUR'}>
                {currencyCodes.map((code) => (
                  <option key={code}>{code}</option>
                ))}
              </select>
            </label>
            <label className="field wide">
              Notizen
              <textarea name="description" rows={2} defaultValue={trip?.description} />
            </label>
          </div>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="actions">
            {trip && (
              <button
                type="button"
                className="btn text-danger push-left"
                disabled={busy}
                onClick={() => setDeleting(true)}
              >
                <Trash2 size={16} />
                Löschen
              </button>
            )}
            <button type="button" className="btn btn-secondary" onClick={close} disabled={busy}>
              Abbrechen
            </button>
            <button className="btn btn-primary" disabled={busy}>
              {trip ? <Check size={16} /> : <CalendarDays size={16} />} {trip ? 'Speichern' : 'Reise anlegen'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  )
}
