import { useRef, useState, type FormEvent } from 'react'
import { Camera, Check, Heart, ImagePlus, MapPin, Search, Trash2, X } from 'lucide-react'
import { api, localDate, Modal, type Stop, type TripData } from './shared'
import type { JournalEntry, JournalMedia } from './journal-types'

const mediaAccept = '.jpg,.jpeg,.png,.webp,.gif,.mp4,.mov,.webm'
const maxFileSize = 100 * 1024 * 1024

async function uploadFile<T>(path: string, file: File, extra: Record<string, string> = {}): Promise<T> {
  const query = new URLSearchParams({ ...extra, filename: file.name })
  const response = await fetch(path + '?' + query, {
    method: 'POST',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  })
  if (!response.ok) {
    const detail = (await response.json().catch(() => null))?.detail
    throw new Error(file.name + ' – ' + (typeof detail === 'string' ? detail : 'Hochladen fehlgeschlagen.'))
  }
  return response.json()
}

export function JournalEditor({
  data,
  entry,
  initialDate,
  initialStop,
  onClose,
  onSave,
  reload,
}: {
  data: TripData
  entry?: JournalEntry
  initialDate?: string
  initialStop?: Stop
  onClose: () => void
  onSave: (date: string) => void
  reload: () => Promise<void>
}) {
  const [date, setDate] = useState(entry?.date || initialDate || localDate())
  const [title, setTitle] = useState(entry?.title || '')
  const [text, setText] = useState(entry?.text || '')
  const [stopIds, setStopIds] = useState(entry?.stop_ids || (initialStop ? [initialStop.place_id] : []))
  const [search, setSearch] = useState('')
  const [favoriteChanges, setFavoriteChanges] = useState<Record<number, boolean>>({})
  const [media, setMedia] = useState(entry?.media || [])
  const [files, setFiles] = useState<File[]>([])
  const [removedMedia, setRemovedMedia] = useState<number[]>([])
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const entryId = useRef(entry?.id)
  const saving = useRef(false)
  const savedChanges = useRef(false)
  const base = '/api/trips/' + data.trip.id
  const selected = data.places.filter((place) => stopIds.includes(place.id))

  function close() {
    if (saving.current) return
    if (savedChanges.current) void reload().catch(() => {})
    onClose()
  }

  function chooseFiles(added: File[]) {
    const valid = added.filter((file) => file.size <= maxFileSize && file.size > 0)
    if (valid.length !== added.length)
      setError('Bitte wähle Dateien mit Inhalt und höchstens 100 MiB pro Datei.')
    else setError('')
    setFiles((current) => [
      ...current,
      ...valid.filter(
        (file) =>
          !current.some(
            (existing) =>
              existing.name === file.name &&
              existing.size === file.size &&
              existing.lastModified === file.lastModified,
          ),
      ),
    ])
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (saving.current) return
    if (!title.trim() && !text.trim() && !stopIds.length && !media.length && !files.length) {
      setError('Schreibe etwas, verknüpfe einen Ort oder füge ein Foto oder Video hinzu.')
      return
    }
    saving.current = true
    setStatus('Speichern …')
    setError('')
    try {
      const payload = { date, title: title.trim(), text: text.trim(), stop_ids: stopIds }
      const existingId = entryId.current
      let firstPending = 0
      if (!existingId) {
        let stored: JournalEntry
        if (!payload.title && !payload.text && !stopIds.length) {
          setStatus('Datei 1 von ' + files.length + ' …')
          stored = await uploadFile<JournalEntry>(base + '/journal/with-media', files[0], { date })
          setMedia(stored.media)
          setFiles((current) => current.filter((next) => next !== files[0]))
          firstPending = 1
        } else {
          stored = await api<JournalEntry>(base + '/journal', 'POST', payload)
        }
        entryId.current = stored.id
        savedChanges.current = true
      }
      const path = base + '/journal/' + entryId.current
      const retainedUploads = new Set<number>()
      for (let index = firstPending; index < files.length; index++) {
        const file = files[index]
        setStatus('Datei ' + (index + 1) + ' von ' + files.length + ' …')
        const uploaded = await uploadFile<JournalMedia>(path + '/media', file)
        savedChanges.current = true
        retainedUploads.add(uploaded.id)
        setFiles((current) => current.filter((next) => next !== file))
        setMedia((current) =>
          current.some((item) => item.id === uploaded.id) ? current : [...current, uploaded],
        )
        setRemovedMedia((current) => current.filter((id) => id !== uploaded.id))
      }
      if (existingId) {
        await api<JournalEntry>(path, 'PATCH', payload)
        savedChanges.current = true
      }
      for (const id of removedMedia) {
        if (retainedUploads.has(id)) continue
        await api(path + '/media/' + id, 'DELETE')
        setRemovedMedia((current) => current.filter((item) => item !== id))
      }
      for (const stop of selected) {
        if (favoriteChanges[stop.id] === undefined) continue
        await api(base + '/favorites/' + stop.id, favoriteChanges[stop.id] ? 'PUT' : 'DELETE')
        setFavoriteChanges((current) => {
          const next = { ...current }
          delete next[stop.id]
          return next
        })
      }
      await reload()
      onSave(date)
    } catch (cause) {
      setError(
        (savedChanges.current ? 'Der Eintrag ist gespeichert. ' : '') +
          (cause instanceof Error ? cause.message : 'Speichern fehlgeschlagen.'),
      )
    } finally {
      saving.current = false
      setStatus('')
    }
  }

  const matching = data.places.filter((stop) =>
    stop.title.toLocaleLowerCase('de').includes(search.trim().toLocaleLowerCase('de')),
  )
  return (
    <Modal title={entry ? 'Eintrag bearbeiten' : 'Eintrag schreiben'} onClose={close}>
      <form onSubmit={save} className="journal-form">
        <fieldset disabled={Boolean(status)} className="journal-fields">
          <div className="journal-field-pair">
            <label className="field">
              Tag
              <input type="date" value={date} required onChange={(event) => setDate(event.target.value)} />
            </label>
            <label className="field">
              Überschrift{' '}
              <input
                value={title}
                maxLength={250}
                placeholder="Optional"
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
          </div>
          <label className="field">
            Dein Eintrag
            <textarea
              rows={5}
              maxLength={100000}
              placeholder="Woran möchtest du dich erinnern?"
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
          </label>
          {data.places.length > 0 && (
            <details className="journal-place-picker">
              <summary>
                <MapPin size={16} /> Orte verknüpfen {stopIds.length > 0 && <span>({stopIds.length})</span>}
              </summary>
              <label className="journal-search">
                <Search size={15} />
                <input
                  type="search"
                  aria-label="Orte der Reise durchsuchen"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Orte dieser Reise suchen"
                />
              </label>
              <div className="journal-checklist">
                {matching.map((stop) => (
                  <label key={stop.id}>
                    <input
                      type="checkbox"
                      checked={stopIds.includes(stop.id)}
                      onChange={(event) =>
                        setStopIds((current) =>
                          event.target.checked
                            ? [...current, stop.id]
                            : current.filter((id) => id !== stop.id),
                        )
                      }
                    />
                    {stop.title}
                  </label>
                ))}
                {!matching.length && <p className="empty-inline">Kein passender Ort gefunden.</p>}
              </div>
            </details>
          )}
          {selected.length > 0 && (
            <div className="journal-selected">
              {selected.map((stop) => {
                const favorite = favoriteChanges[stop.id] ?? data.favorite_stop_ids.includes(stop.id)
                return (
                  <div key={stop.id}>
                    <span>
                      <MapPin size={14} />
                      {stop.title}
                    </span>
                    <button
                      type="button"
                      className={'journal-heart' + (favorite ? ' is-favorite' : '')}
                      aria-pressed={favorite}
                      onClick={() => setFavoriteChanges((current) => ({ ...current, [stop.id]: !favorite }))}
                    >
                      <Heart size={14} fill={favorite ? 'currentColor' : 'none'} />
                      {['Schlafplatz', 'Campingplatz', 'Unterkunft'].includes(stop.category) ? 'Hier würde ich wieder schlafen' : 'Lieblingsplatz'}
                    </button>
                  </div>
                )
              })}
            </div>
          )}
          <div className="journal-attachments">
            <label className="journal-upload">
              <ImagePlus size={21} />
              <span>
                <strong>Fotos oder Videos hinzufügen</strong>
                <small>JPG, PNG, WebP, GIF, MP4, MOV, WebM · je bis zu 100 MiB</small>
              </span>
              <input
                type="file"
                multiple
                accept={mediaAccept}
                onChange={(event) => {
                  chooseFiles(Array.from(event.target.files || []))
                  event.target.value = ''
                }}
              />
            </label>
            <ul>
              {media.map((item) => (
                <li key={item.id}>
                  <Camera size={14} />
                  <span>{item.filename}</span>
                  <button
                    type="button"
                    className="btn-icon"
                    aria-label={item.filename + ' entfernen'}
                    onClick={() => {
                      setMedia((current) => current.filter((m) => m.id !== item.id))
                      setRemovedMedia((current) => [...current, item.id])
                    }}
                  >
                    <Trash2 size={15} />
                  </button>
                </li>
              ))}
              {files.map((file, index) => (
                <li key={index}>
                  <ImagePlus size={14} />
                  <span>{file.name}</span>
                  <button
                    type="button"
                    className="btn-icon"
                    aria-label={file.name + ' entfernen'}
                    onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}
                  >
                    <X size={15} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </fieldset>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="actions">
          <button type="button" className="btn btn-secondary" disabled={Boolean(status)} onClick={close}>
            {savedChanges.current ? 'Schließen' : 'Abbrechen'}
          </button>
          <button type="submit" className="btn btn-primary" disabled={Boolean(status)}>
            <Check size={16} />
            {status || 'Eintrag speichern'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
