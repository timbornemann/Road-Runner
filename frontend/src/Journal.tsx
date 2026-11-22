import { useState } from 'react'
import {
  BookOpen,
  Bookmark,
  ChevronLeft,
  ChevronRight,
  Download,
  Feather,
  Heart,
  Map,
  MapPin,
  NotebookPen,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react'
import { api, dateLabel, localDate, Modal, type Stop, type TripData } from './shared'
import { JournalEditor } from './JournalEditor'
import { FavoritePlaces, JournalMap, JournalPlaceDetail } from './JournalPlaces'
import type { JournalEntry } from './journal-types'
import './journal.css'

const tabs = [
  { name: 'Tagebuch', Icon: BookOpen },
  { name: 'Reisekarte', Icon: Map },
  { name: 'Lieblingsplätze', Icon: Heart },
] as const
type Tab = (typeof tabs)[number]['name']
type Editor = { entry?: JournalEntry; initialDate?: string; initialStop?: Stop }

function germanDate(day: string, options: Intl.DateTimeFormatOptions) {
  return new Date(day + 'T12:00:00').toLocaleDateString('de-DE', options)
}

function JournalNote({
  entry,
  data,
  edit,
  remove,
  open,
}: {
  entry: JournalEntry
  data: TripData
  edit: () => void
  remove: () => void
  open: (stop: Stop) => void
}) {
  return (
    <article className="journal-note" aria-label={entry.title || 'Tagebucheintrag'}>
      <header>
        {entry.title && <h3>{entry.title}</h3>}
        <div className="journal-note-actions">
          <button
            className="btn-icon"
            aria-label="Eintrag bearbeiten"
            title="Eintrag bearbeiten"
            onClick={edit}
          >
            <Pencil size={15} />
          </button>
          <button className="btn-icon" aria-label="Eintrag löschen" title="Eintrag löschen" onClick={remove}>
            <Trash2 size={15} />
          </button>
        </div>
      </header>
      {entry.text && <p className="journal-prose">{entry.text}</p>}
      {entry.media.length > 0 && (
        <div className="journal-gallery">
          {entry.media.map((media) => (
            <figure key={media.id}>
              {media.mime_type.startsWith('video/') ? (
                <video controls playsInline preload="metadata" aria-label={media.filename} src={media.url} />
              ) : (
                <a
                  href={media.url}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={media.filename + ' in Originalgröße öffnen'}
                >
                  <img loading="lazy" alt={media.filename} src={media.url} />
                </a>
              )}
              <figcaption>
                <span>{media.filename}</span>
                <a
                  href={media.url}
                  download={media.filename}
                  aria-label={media.filename + ' herunterladen'}
                  title="Originaldatei herunterladen"
                >
                  <Download size={14} />
                </a>
              </figcaption>
            </figure>
          ))}
        </div>
      )}
      {entry.stop_ids.length > 0 && (
        <div className="journal-place-links">
          {entry.stop_ids.map((id) => {
            const stop = data.stops.find((item) => item.id === id)
            return (
              stop && (
                <button key={id} onClick={() => open(stop)}>
                  <MapPin size={13} />
                  {stop.title}
                  {data.favorite_stop_ids.includes(id) && <Heart size={11} fill="currentColor" />}
                </button>
              )
            )
          })}
        </div>
      )}
    </article>
  )
}

export default function Journal({
  data,
  reload,
  notify,
  initialStop,
}: {
  data: TripData
  reload: () => Promise<void>
  notify: (message: string) => void
  initialStop?: Stop
}) {
  const [tab, setTab] = useState<Tab>('Tagebuch')
  const [chosenDay, setChosenDay] = useState('')
  const [editor, setEditor] = useState<Editor | null>(initialStop ? { initialStop } : null)
  const [detailId, setDetailId] = useState<number | null>(null)
  const [deleteEntry, setDeleteEntry] = useState<JournalEntry | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [indexOpen, setIndexOpen] = useState(false)
  const { trip, journal_entries: entries } = data
  const dates = [...new Set(entries.map((entry) => entry.date))].sort()
  const activeDay = dates.includes(chosenDay) ? chosenDay : dates.at(-1) || ''
  const index = dates.indexOf(activeDay)
  const dayEntries = entries.filter((entry) => entry.date === activeDay)
  const detail = data.stops.find((stop) => stop.id === detailId)

  function readDay(day: string) {
    setChosenDay(day)
    setTab('Tagebuch')
    setIndexOpen(false)
    setDetailId(null)
  }
  async function confirmDelete() {
    if (!deleteEntry || deleting) return
    setDeleting(true)
    setDeleteError('')
    try {
      await api('/api/trips/' + trip.id + '/journal/' + deleteEntry.id, 'DELETE')
      await reload()
      setDeleteEntry(null)
      notify('Eintrag gelöscht')
    } catch (cause) {
      setDeleteError(cause instanceof Error ? cause.message : 'Löschen fehlgeschlagen.')
    } finally {
      setDeleting(false)
    }
  }
  return (
    <section className="journal-page">
      <header className="journal-heading">
        <h1>Reisetagebuch</h1>
        <button className="btn btn-primary" onClick={() => setEditor({ initialDate: localDate() })}>
          <Feather size={17} /> Eintrag schreiben
        </button>
      </header>
      <nav className="journal-tabs" aria-label="Tagebuchansichten">
        {tabs.map(({ name, Icon }) => (
          <button key={name} aria-current={name === tab ? 'page' : undefined} onClick={() => setTab(name)}>
            <Icon size={16} />
            {name}
          </button>
        ))}
      </nav>
      {tab === 'Tagebuch' && (
        <div className={'journal-book' + (indexOpen ? ' index-open' : '')}>
          <aside className="journal-leaf journal-index">
            <div className="journal-binding-mark" aria-hidden="true">
              <Bookmark size={16} />
            </div>
            <BookOpen size={30} strokeWidth={1.3} className="journal-book-emblem" aria-hidden="true" />
            <h2>{trip.name}</h2>
            {(trip.start_date || trip.end_date) && (
              <p className="journal-period">
                {[trip.start_date, trip.end_date]
                  .filter(Boolean)
                  .map((day) => dateLabel(day!))
                  .join(' – ')}
              </p>
            )}
            <div className="journal-index-heading">
              <h3>Tagesseiten</h3>
              <span>{dates.length}</span>
              {dates.length > 0 && (
                <button
                  className="journal-index-toggle"
                  aria-label="Inhaltsverzeichnis"
                  aria-expanded={indexOpen}
                  onClick={() => setIndexOpen((open) => !open)}
                >
                  {indexOpen ? 'Schließen' : 'Öffnen'}
                </button>
              )}
            </div>
            <div className="journal-index-content">
              {dates.length ? (
                <nav aria-label="Tagesseiten">
                  {dates.map((date, i) => (
                    <button
                      key={date}
                      aria-current={date === activeDay ? 'page' : undefined}
                      onClick={() => readDay(date)}
                    >
                      <span>
                        {germanDate(date, {
                          weekday: 'short',
                          day: 'numeric',
                          month: 'short',
                          year: date.slice(0, 4) === activeDay.slice(0, 4) ? undefined : 'numeric',
                        })}
                      </span>
                      <i aria-hidden="true" />
                      <span>{i + 1}</span>
                    </button>
                  ))}
                </nav>
              ) : (
                <p className="journal-index-empty">Dein erster Eintrag eröffnet die erste Tagesseite.</p>
              )}
            </div>
          </aside>
          <section className="journal-leaf journal-reading" aria-label="Tagebuchseite">
            {activeDay ? (
              <>
                <header className="journal-dateline">
                  <span>{germanDate(activeDay, { weekday: 'long' })}</span>
                  <h2>{germanDate(activeDay, { day: 'numeric', month: 'long', year: 'numeric' })}</h2>
                </header>
                <div className="journal-notes">
                  {dayEntries.map((entry) => (
                    <JournalNote
                      key={entry.id}
                      entry={entry}
                      data={data}
                      edit={() => setEditor({ entry })}
                      remove={() => {
                        setDeleteError('')
                        setDeleteEntry(entry)
                      }}
                      open={(stop) => setDetailId(stop.id)}
                    />
                  ))}
                </div>
                <button className="journal-add-note" onClick={() => setEditor({ initialDate: activeDay })}>
                  <Plus size={15} /> Eintrag für diesen Tag
                </button>
                <footer className="journal-folio">
                  <button
                    disabled={index < 1}
                    aria-label="Vorheriger Tag"
                    onClick={() => readDay(dates[index - 1])}
                  >
                    <ChevronLeft size={19} />
                  </button>
                  <span>
                    Seite {index + 1} von {dates.length}
                  </span>
                  <button
                    disabled={index >= dates.length - 1}
                    aria-label="Nächster Tag"
                    onClick={() => readDay(dates[index + 1])}
                  >
                    <ChevronRight size={19} />
                  </button>
                </footer>
              </>
            ) : (
              <div className="journal-blank">
                <NotebookPen size={34} strokeWidth={1.3} />
                <h2>Die erste Seite</h2>
                <p>
                  Halte fest, wo du warst und was du mitnehmen möchtest. Fotos und Videos haben hier auch
                  Platz.
                </p>
                <button className="journal-add-note" onClick={() => setEditor({})}>
                  <Plus size={15} /> Ersten Eintrag schreiben
                </button>
              </div>
            )}
          </section>
        </div>
      )}
      {tab === 'Reisekarte' && <JournalMap data={data} open={(stop) => setDetailId(stop.id)} />}
      {tab === 'Lieblingsplätze' && (
        <FavoritePlaces data={data} open={(stop) => setDetailId(stop.id)} reload={reload} notify={notify} />
      )}
      {detail && (
        <JournalPlaceDetail
          data={data}
          stop={detail}
          reload={reload}
          onClose={() => setDetailId(null)}
          readDay={readDay}
          write={() => {
            setDetailId(null)
            setEditor({ initialStop: detail })
          }}
        />
      )}
      {editor && (
        <JournalEditor
          data={data}
          reload={reload}
          {...editor}
          onClose={() => setEditor(null)}
          onSave={(day) => {
            setEditor(null)
            readDay(day)
            notify('Tagebucheintrag gespeichert')
          }}
        />
      )}
      {deleteEntry && (
        <Modal
          title="Eintrag löschen?"
          onClose={() => {
            if (!deleting) setDeleteEntry(null)
          }}
        >
          <p>
            Der Eintrag vom {dateLabel(deleteEntry.date)} wird mit allen zugehörigen Fotos und Videos
            gelöscht.
          </p>
          {deleteError && (
            <p className="error" role="alert">
              {deleteError}
            </p>
          )}
          <div className="actions">
            <button disabled={deleting} className="btn btn-secondary" onClick={() => setDeleteEntry(null)}>
              Abbrechen
            </button>
            <button disabled={deleting} className="btn btn-danger" onClick={() => void confirmDelete()}>
              Eintrag löschen
            </button>
          </div>
        </Modal>
      )}
    </section>
  )
}
