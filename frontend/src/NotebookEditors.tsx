import { useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Check, Heading, Link as LinkIcon, List, ListChecks, Search, Trash2 } from 'lucide-react'
import { api, Modal, type TripData } from './shared'
import {
  positionOrder,
  topicPath,
  type NotebookArea,
  type NotebookNote,
  type NotebookTarget,
  type NotebookTopic,
} from './NotebookTypes'

type EditorProps = {
  data: TripData
  close: () => void
  saved: (target: NotebookTarget | null) => Promise<void>
}

function EditorForm({
  title,
  close,
  submit,
  children,
  submitLabel = 'Speichern',
  danger = false,
  disabled = false,
}: {
  title: string
  close: () => void
  submit: () => Promise<void>
  children: ReactNode
  submitLabel?: string
  danger?: boolean
  disabled?: boolean
}) {
  const lock = useRef(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function handle(event: FormEvent) {
    event.preventDefault()
    if (lock.current || disabled) return
    lock.current = true
    setBusy(true)
    setError('')
    try {
      await submit()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Änderung fehlgeschlagen.')
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  return (
    <Modal
      title={title}
      onClose={() => {
        if (!lock.current) close()
      }}
    >
      <form onSubmit={handle} className="nb-form">
        <fieldset disabled={busy}>{children}</fieldset>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="actions">
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={close}>
            Abbrechen
          </button>
          <button className={'btn ' + (danger ? 'btn-danger' : 'btn-primary')} disabled={busy || disabled}>
            {danger ? <Trash2 size={16} /> : <Check size={16} />} {submitLabel}
          </button>
        </div>
      </form>
    </Modal>
  )
}

function parentOptions(topics: NotebookTopic[], exclude?: number) {
  return topics
    .map((topic) => ({ id: topic.id, path: topicPath(topics, topic.id) }))
    .filter((item) => !item.path.some((topic) => topic.id === exclude))
    .map((item) => ({ id: item.id, label: item.path.map((topic) => topic.title).join(' › ') }))
    .sort((a, b) => a.label.localeCompare(b.label, 'de'))
    .map((item) => (
      <option key={item.id} value={item.id}>
        {item.label}
      </option>
    ))
}

function PositionField({
  position,
  setPosition,
  items,
}: {
  position: number
  setPosition: (p: number) => void
  items: { id: number; title: string; position: number }[]
}) {
  return (
    <label className="field">
      Reihenfolge
      <select value={Math.min(position, items.length)} onChange={(e) => setPosition(Number(e.target.value))}>
        <option value={0}>An erster Stelle</option>
        {[...items].sort(positionOrder).map((item, i) => (
          <option key={item.id} value={i + 1}>
            Nach „{item.title}“
          </option>
        ))}
      </select>
    </label>
  )
}

export function TopicEditor({
  data,
  close,
  saved,
  topic,
  initialParent,
}: EditorProps & { topic?: NotebookTopic; initialParent: number | null }) {
  const topics = data.notebook.topics
  const [title, setTitle] = useState(topic?.title ?? '')
  const [parent, setParent] = useState(initialParent)
  const [position, setPosition] = useState(topic?.position ?? 0)
  const items = topics.filter((t) => t.parent_id === parent && t.id !== topic?.id)
  async function submit() {
    const url = '/api/trips/' + data.trip.id + '/notebook/topics'
    const payload = topic
      ? {
          ...(title.trim() !== topic.title ? { title: title.trim() } : {}),
          ...(parent !== topic.parent_id ? { parent_id: parent } : {}),
          ...(position !== topic.position || parent !== topic.parent_id
            ? { position: Math.min(position, items.length) }
            : {}),
        }
      : { title: title.trim(), parent_id: parent }
    const result = await api<NotebookTopic>(
      topic ? url + '/' + topic.id : url,
      topic ? 'PATCH' : 'POST',
      payload,
    )
    await saved({ kind: 'topic', id: result.id })
  }
  return (
    <EditorForm
      title={topic ? 'Thema bearbeiten' : initialParent ? 'Unterthema anlegen' : 'Thema anlegen'}
      close={close}
      submit={submit}
    >
      <label className="field">
        Titel
        <input required maxLength={250} value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="field">
        Übergeordnetes Thema
        <select
          value={parent ?? ''}
          onChange={(e) => {
            const next = e.target.value ? Number(e.target.value) : null
            setParent(next)
            setPosition(topics.filter((t) => t.parent_id === next && t.id !== topic?.id).length)
          }}
        >
          <option value="">Oberste Ebene</option>
          {parentOptions(topics, topic?.id)}
        </select>
      </label>
      {topic && <PositionField position={position} setPosition={setPosition} items={items} />}
    </EditorForm>
  )
}

export class NoteConflict extends Error {
  constructor(public current: NotebookNote) {
    super('Diese Notiz wurde inzwischen geändert.')
  }
}

export async function patchNote(
  tripId: number,
  note: NotebookNote,
  changes: Partial<Pick<NotebookNote, 'body' | 'title' | 'position' | 'topic_id'>>,
) {
  const path = '/api/trips/' + tripId + '/notebook/notes/' + note.id
  try {
    return await api<NotebookNote>(path, 'PATCH', { ...changes, revision: note.revision })
  } catch (error) {
    const current = await api<NotebookNote>(path).catch(() => null)
    if (current && current.revision !== note.revision) throw new NoteConflict(current)
    throw error
  }
}

const formats = [
  { label: 'Überschrift', Icon: Heading, prefix: '## ', suffix: '', placeholder: 'Überschrift' },
  { label: 'Aufzählung', Icon: List, prefix: '- ', suffix: '', placeholder: 'Listenpunkt' },
  { label: 'Aufgabe', Icon: ListChecks, prefix: '- [ ] ', suffix: '', placeholder: 'Aufgabe' },
  { label: 'Weblink', Icon: LinkIcon, prefix: '[', suffix: '](https://)', placeholder: 'Linktext' },
]

export function NoteEditor({
  data,
  close,
  saved,
  note,
  initialTopic,
}: EditorProps & { note?: NotebookNote; initialTopic: number }) {
  const [base, setBase] = useState(note)
  const [title, setTitle] = useState(note?.title ?? '')
  const [body, setBody] = useState(note?.body ?? '')
  const [topicId, setTopicId] = useState(initialTopic)
  const [position, setPosition] = useState(note?.position ?? 0)
  const [conflict, setConflict] = useState<NotebookNote | null>(null)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const items = data.notebook.notes.filter((n) => n.topic_id === topicId && n.id !== note?.id)
  function addFormat(format: (typeof formats)[number]) {
    const el = textarea.current
    if (!el) return
    const start = el.selectionStart,
      end = el.selectionEnd
    const newline = format.suffix === '' && start > 0 && body[start - 1] !== '\n' ? '\n' : ''
    const content = body.slice(start, end) || format.placeholder
    setBody(body.slice(0, start) + newline + format.prefix + content + format.suffix + body.slice(end))
    requestAnimationFrame(() => {
      el.focus()
      const selection = start + newline.length + format.prefix.length
      el.setSelectionRange(selection, selection + content.length)
    })
  }
  async function submit() {
    if (!base) {
      const created = await api<NotebookNote>('/api/trips/' + data.trip.id + '/notebook/notes', 'POST', {
        title: title.trim(),
        body,
        topic_id: topicId,
      })
      await saved({ kind: 'note', id: created.id })
      return
    }
    try {
      const stored = await patchNote(data.trip.id, base, {
        title: title.trim(),
        body,
        topic_id: topicId,
        ...(topicId !== base.topic_id || position !== base.position
          ? { position: Math.min(position, items.length) }
          : {}),
      })
      await saved({ kind: 'note', id: stored.id })
    } catch (e) {
      if (e instanceof NoteConflict) {
        setConflict(e.current)
        return
      }
      throw e
    }
  }
  return (
    <EditorForm
      title={note ? 'Notiz bearbeiten' : 'Notiz anlegen'}
      close={close}
      submit={submit}
      disabled={!!conflict}
    >
      <label className="field">
        Titel
        <input required value={title} maxLength={250} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <div className="nb-writing-field">
        <label className="field" htmlFor="nb-note-text">
          Notiztext
        </label>
        <div className="nb-format" role="group" aria-label="Text formatieren">
          {formats.map((format) => (
            <button
              type="button"
              key={format.label}
              title={format.label + ' einfügen'}
              aria-label={format.label + ' einfügen'}
              onClick={() => addFormat(format)}
            >
              <format.Icon size={16} />
            </button>
          ))}
        </div>
        <textarea
          ref={textarea}
          id="nb-note-text"
          value={body}
          rows={9}
          maxLength={100000}
          onChange={(e) => setBody(e.target.value)}
        />
      </div>
      <label className="field">
        Thema
        <select
          value={topicId}
          onChange={(e) => {
            const id = Number(e.target.value)
            setTopicId(id)
            setPosition(data.notebook.notes.filter((n) => n.topic_id === id && n.id !== note?.id).length)
          }}
        >
          {parentOptions(data.notebook.topics)}
        </select>
      </label>
      {note && <PositionField position={position} setPosition={setPosition} items={items} />}
      {conflict && (
        <section className="nb-conflict" role="alert">
          <h3>Eine neuere Fassung liegt vor</h3>
          <p>Dein Entwurf steht oben. Gleiche ihn mit der gespeicherten Fassung ab, bevor du speicherst.</p>
          <strong>{conflict.title}</strong>
          <small>
            {topicPath(data.notebook.topics, conflict.topic_id)
              .map((t) => t.title)
              .join(' › ')}{' '}
            · Position {conflict.position + 1}
          </small>
          <pre>{conflict.body}</pre>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              setBase(conflict)
              setConflict(null)
            }}
          >
            Entwurf abgeglichen
          </button>
        </section>
      )}
    </EditorForm>
  )
}

export function AreaEditor({ data, close, saved, area }: EditorProps & { area?: NotebookArea }) {
  const [name, setName] = useState(area?.name ?? '')
  const [query, setQuery] = useState('')
  const [ids, setIds] = useState(area?.stop_ids ?? [])
  const filtered = data.places.filter((s) =>
    s.title.toLocaleLowerCase('de').includes(query.trim().toLocaleLowerCase('de')),
  )
  async function submit() {
    const url = '/api/trips/' + data.trip.id + '/notebook/areas'
    const value = await api<NotebookArea>(area ? url + '/' + area.id : url, area ? 'PATCH' : 'POST', {
      name: name.trim(),
      stop_ids: ids,
    })
    await saved({ kind: 'area', id: value.id })
  }
  return (
    <EditorForm title={area ? 'Gebiet bearbeiten' : 'Gebiet anlegen'} close={close} submit={submit}>
      <label className="field">
        Name
        <input required value={name} maxLength={250} onChange={(e) => setName(e.target.value)} />
      </label>
      <div>
        <h3>Orte im Gebiet</h3>
        {data.places.length ? (
          <>
            <label className="nb-search">
              <Search size={15} />
              <input
                type="search"
                aria-label="Orte im Gebiet suchen"
                placeholder="Orte suchen"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <div className="nb-area-picker">
              {filtered.map((stop) => (
                <label key={stop.id}>
                  <input
                    type="checkbox"
                    checked={ids.includes(stop.id)}
                    onChange={(e) =>
                      setIds(e.target.checked ? [...ids, stop.id] : ids.filter((id) => id !== stop.id))
                    }
                  />
                  {stop.title}
                </label>
              ))}
              {!filtered.length && <p>Kein passender Ort gefunden.</p>}
            </div>
          </>
        ) : (
          <p>Orte kannst du später hinzufügen.</p>
        )}
      </div>
    </EditorForm>
  )
}

export function DeleteNotebookItem({
  data,
  close,
  saved,
  selection,
  fallback,
  revision,
}: EditorProps & { selection: NotebookTarget; fallback: NotebookTarget | null; revision?: number }) {
  const paths = { topic: 'topics', note: 'notes', area: 'areas' } as const
  if (!(selection.kind in paths)) return null
  const kind = selection.kind as keyof typeof paths
  const noun = { topic: 'Thema', note: 'Notiz', area: 'Gebiet' }[kind]
  return (
    <EditorForm
      title={noun + ' löschen?'}
      submitLabel={noun + ' löschen'}
      danger
      close={close}
      submit={async () => {
        const suffix = kind === 'note' && revision !== undefined ? '?revision=' + revision : ''
        await api(
          '/api/trips/' + data.trip.id + '/notebook/' + paths[kind] + '/' + selection.id + suffix,
          'DELETE',
        )
        await saved(fallback)
      }}
    >
      <p>
        {kind === 'topic'
          ? 'Dieses Thema wird mit allen Unterthemen, Notizen und ihren Verknüpfungen dauerhaft gelöscht.'
          : kind === 'area'
            ? 'Das Gebiet und seine Verknüpfungen werden gelöscht. Die zugeordneten Orte bleiben in der Reise.'
            : 'Diese Notiz und ihre Verknüpfungen werden dauerhaft gelöscht.'}
      </p>
    </EditorForm>
  )
}
