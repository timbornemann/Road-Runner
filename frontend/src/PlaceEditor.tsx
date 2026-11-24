import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ImagePlus, Plus, Trash2, X } from 'lucide-react'
import { api, Modal, type Place, type TripData } from './shared'
import { TagEditor, tripTags } from './Tags'
import { categoryIcon, placeCategories, SymbolPicker, type SymbolType } from './PlaceSymbols'
import './places.css'

interface Props {
  data: TripData
  existing?: Place
  initial?: Partial<Place>
  createLinked?: (fields: Partial<Place>) => Promise<Place>
  onClose: () => void
  onSaved: (place: Place) => void | Promise<void>
}
async function multipart<T>(url: string, method: string, body: FormData): Promise<T> {
  const response = await fetch(url, { method, body })
  if (!response.ok) {
    const detail = (await response.json().catch(() => null))?.detail
    throw new Error(
      typeof detail === 'string' ? detail : 'Speichern fehlgeschlagen (' + response.status + ').',
    )
  }
  return response.json()
}
export default function PlaceEditor({ data, existing, initial, createLinked, onClose, onSaved }: Props) {
  const start = initial ?? existing
  const [title, setTitle] = useState(start?.title ?? '')
  const [category, setCategory] = useState(start?.category || 'Ort')
  const [address, setAddress] = useState(start?.address ?? '')
  const [lat, setLat] = useState(start?.lat?.toString() ?? '')
  const [lon, setLon] = useState(start?.lon?.toString() ?? '')
  const [description, setDescription] = useState(start?.description ?? '')
  const [tags, setTags] = useState(start?.tags ?? [])
  const [links, setLinks] = useState(start?.links ?? [])
  const [iconType, setIconType] = useState<SymbolType>(start?.icon_type ?? 'lucide')
  const [icon, setIcon] = useState(start?.icon || categoryIcon(category))
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState('')
  const [removeImage, setRemoveImage] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const saving = useRef(false)
  // A linked creation and its optional upload are separate requests. Remember the committed id for retries.
  const stored = useRef<Place | undefined>(existing)
  const root = '/api/trips/' + data.trip.id + '/places'
  useEffect(() => {
    if (!file) {
      setPreview('')
      return
    }
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])
  async function save(event: FormEvent) {
    event.preventDefault()
    if (saving.current) return
    const latitude = lat.trim() ? Number(lat.replace(',', '.')) : null
    const longitude = lon.trim() ? Number(lon.replace(',', '.')) : null
    if (
      (latitude === null) !== (longitude === null) ||
      (latitude !== null && (!Number.isFinite(latitude) || Math.abs(latitude) > 90)) ||
      (longitude !== null && (!Number.isFinite(longitude) || Math.abs(longitude) > 180))
    ) {
      setError('Gib ein gültiges Koordinatenpaar an oder lass beide Felder leer.')
      return
    }
    const cleanedLinks = links
      .filter((link) => link.label.trim() || link.url.trim())
      .map((link) => ({ label: link.label.trim() || link.url.trim(), url: link.url.trim() }))
    if (file && file.size > 12 * 1024 * 1024) {
      setError('Das Titelbild darf bis zu 12 MiB groß sein.')
      return
    }
    if (cleanedLinks.some((link) => !/^https?:\/\//i.test(link.url))) {
      setError('Weblinks beginnen mit https:// oder http://.')
      return
    }
    saving.current = true
    setBusy(true)
    setError('')
    const fields = {
      title: title.trim(),
      category,
      description,
      address,
      lat: latitude,
      lon: longitude,
      tags,
      links: cleanedLinks,
      icon_type: iconType,
      icon,
      osm_type: start?.osm_type ?? null,
      osm_id: start?.osm_id ?? null,
    }
    try {
      const prior = stored.current
      const path = prior ? root + '/' + prior.id : root
      let place: Place
      if (createLinked && !prior) {
        place = await createLinked(fields)
        stored.current = place
        if (file) {
          const form = new FormData()
          form.set('file', file)
          await multipart(path + '/' + place.id + '/image', 'PUT', form)
        }
      } else if (file) {
        const form = new FormData()
        form.set('payload', JSON.stringify(fields))
        form.set('file', file)
        place = await multipart<Place>(path + '/with-image', prior ? 'PATCH' : 'POST', form)
      } else {
        place = await api<Place>(path, prior ? 'PATCH' : 'POST', fields)
        stored.current = place
        if (prior?.image && removeImage) await api(path + '/image', 'DELETE')
      }
      stored.current = place
      await onSaved(place)
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      saving.current = false
      setBusy(false)
    }
  }
  const img = preview || (!removeImage && existing?.image?.url)
  return (
    <Modal
      title={existing ? 'Ort bearbeiten' : 'Ort anlegen'}
      onClose={() => {
        if (!saving.current) onClose()
      }}
    >
      <form onSubmit={save} className="pl-editor">
        <fieldset disabled={busy}>
          <label className="field">
            Name
            <input
              autoFocus
              required
              maxLength={250}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="z. B. Aussichtspunkt am Fjord"
            />
          </label>
          <div className="pl-editor-pair">
            <label className="field">
              Kategorie
              <select
                aria-label="Kategorie"
                value={category}
                onChange={(e) => {
                  if (iconType === 'lucide' && icon === categoryIcon(category))
                    setIcon(categoryIcon(e.target.value))
                  setCategory(e.target.value)
                }}
              >
                {[...new Set([...placeCategories, category])].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <SymbolPicker
              type={iconType}
              value={icon}
              change={(type, value) => {
                setIconType(type)
                setIcon(value)
              }}
            />
          </div>
          <label className="field">
            Adresse
            <input value={address} maxLength={500} onChange={(e) => setAddress(e.target.value)} />
          </label>
          <div className="pl-editor-pair">
            <label className="field">
              Breitengrad
              <input
                inputMode="decimal"
                value={lat}
                onChange={(e) => setLat(e.target.value)}
                placeholder="−90 bis 90"
              />
            </label>
            <label className="field">
              Längengrad
              <input
                inputMode="decimal"
                value={lon}
                onChange={(e) => setLon(e.target.value)}
                placeholder="−180 bis 180"
              />
            </label>
          </div>
          <label className="field">
            Beschreibung
            <textarea
              rows={3}
              value={description}
              maxLength={16000}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <TagEditor value={tags} onChange={setTags} suggestions={tripTags(data)} />
          <div className="pl-field-block">
            <div className="pl-field-head">
              <h3>Weblinks</h3>
              <button
                type="button"
                className="text-link"
                onClick={() => setLinks([...links, { label: '', url: '' }])}
              >
                <Plus size={14} /> Link hinzufügen
              </button>
            </div>
            {links.map((link, i) => (
              <div className="pl-link-fields" key={i}>
                <input
                  aria-label={'Beschriftung für Link ' + (i + 1)}
                  value={link.label}
                  maxLength={250}
                  placeholder="Beschriftung"
                  onChange={(e) =>
                    setLinks(links.map((l, j) => (j === i ? { ...l, label: e.target.value } : l)))
                  }
                />
                <input
                  aria-label={'Adresse für Link ' + (i + 1)}
                  type="url"
                  maxLength={4096}
                  value={link.url}
                  placeholder="https://…"
                  onChange={(e) =>
                    setLinks(links.map((l, j) => (j === i ? { ...l, url: e.target.value } : l)))
                  }
                />
                <button
                  type="button"
                  className="btn-icon"
                  aria-label={'Link ' + (i + 1) + ' entfernen'}
                  onClick={() => setLinks(links.filter((_, j) => i !== j))}
                >
                  <X size={15} />
                </button>
              </div>
            ))}
          </div>
          <div className="pl-field-block">
            <div className="pl-field-head">
              <h3>Titelbild</h3>
              {img && (
                <button
                  type="button"
                  className="text-link"
                  onClick={() => {
                    setFile(null)
                    setRemoveImage(true)
                  }}
                >
                  <Trash2 size={14} /> Bild entfernen
                </button>
              )}
            </div>
            {img && <img alt="Vorschau des Titelbilds" src={img} className="pl-preview" />}
            <label className="pl-upload">
              <ImagePlus size={18} />
              {img ? 'Bild ersetzen' : 'Bild auswählen'}
              <input
                type="file"
                aria-label="Titelbild hochladen"
                accept="image/jpeg,image/png,image/webp,image/gif"
                onChange={(e) => {
                  const next = e.target.files?.[0]
                  if (next) {
                    setFile(next)
                    setRemoveImage(false)
                  }
                  e.target.value = ''
                }}
              />
            </label>
          </div>
        </fieldset>
        {error && (
          <p className="rr-error" role="alert">
            {error}
          </p>
        )}
        <div className="actions">
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>
            Abbrechen
          </button>
          <button className="btn btn-primary" disabled={busy}>
            {busy ? 'Speichert …' : 'Ort speichern'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
