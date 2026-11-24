import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Layers,
  MapPin,
  NotebookPen,
  Pencil,
  Plus,
  Search,
  Trash2,
} from 'lucide-react'
import type { TripData } from './shared'
import { NotebookLinks } from './NotebookLinks'
import { NotebookBacklinks } from './NotebookNavigation'
import {
  AreaEditor,
  DeleteNotebookItem,
  NoteConflict,
  NoteEditor,
  patchNote,
  TopicEditor,
} from './NotebookEditors'
import { NotebookText, toggleTask } from './NotebookText'
import {
  positionOrder,
  topicPath,
  type NotebookArea,
  type NotebookNote,
  type NotebookTarget,
  type NotebookTopic,
} from './NotebookTypes'
import './notebook.css'

interface Props {
  data: TripData
  target: NotebookTarget | null
  onOpen: (target: NotebookTarget | null) => void
  reload: () => Promise<void>
  notify: (message: string) => void
}
type Editor =
  | { kind: 'topic'; topic?: NotebookTopic; parent: number | null }
  | { kind: 'note'; note?: NotebookNote; topic: number }
  | { kind: 'area'; area?: NotebookArea }
  | { kind: 'delete'; selection: NotebookTarget; fallback: NotebookTarget | null; revision?: number }

function TopicBranch({
  topic,
  topics,
  current,
  folded,
  toggle,
  open,
}: {
  topic: NotebookTopic
  topics: NotebookTopic[]
  current: number | undefined
  folded: Set<number>
  toggle: (id: number) => void
  open: (id: number) => void
}) {
  const children = topics.filter((item) => item.parent_id === topic.id)
  const expanded = !folded.has(topic.id)
  return (
    <li>
      <div className={'nb-branch' + (current === topic.id ? ' active' : '')}>
        {children.length > 0 ? (
          <button
            className="nb-branch-toggle"
            aria-label={topic.title + (expanded ? ' einklappen' : ' ausklappen')}
            aria-expanded={expanded}
            onClick={() => toggle(topic.id)}
          >
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        ) : (
          <span className="nb-branch-spacer" />
        )}
        <button
          className="nb-branch-title"
          aria-current={current === topic.id ? 'page' : undefined}
          onClick={() => open(topic.id)}
        >
          {current === topic.id ? <FolderOpen size={16} /> : <Folder size={16} />}
          <span>{topic.title}</span>
        </button>
      </div>
      {expanded && children.length > 0 && (
        <ul>
          {children.map((child) => (
            <TopicBranch
              key={child.id}
              topic={child}
              topics={topics}
              current={current}
              folded={folded}
              toggle={toggle}
              open={open}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

function EntryList({ children }: { children: ReactNode }) {
  return <div className="nb-entry-list">{children}</div>
}

function EntryButton({
  icon,
  title,
  detail,
  open,
}: {
  icon: ReactNode
  title: string
  detail?: string
  open: () => void
}) {
  return (
    <button className="nb-entry" onClick={open}>
      <span className="nb-entry-icon">{icon}</span>
      <span className="nb-entry-label">
        <strong>{title}</strong>
        {detail && <small>{detail}</small>}
      </span>
      <ChevronRight size={15} />
    </button>
  )
}

function EditActions({ noun, edit, remove }: { noun: string; edit: () => void; remove: () => void }) {
  return (
    <div className="nb-edit-actions">
      <button
        className="btn-icon"
        title={noun + ' bearbeiten'}
        aria-label={noun + ' bearbeiten'}
        onClick={edit}
      >
        <Pencil size={16} />
      </button>
      <button className="btn-icon" title={noun + ' löschen'} aria-label={noun + ' löschen'} onClick={remove}>
        <Trash2 size={16} />
      </button>
    </div>
  )
}

function notePreview(body: string) {
  return body
    .replace(/^[ \t]*(?:#{1,6}\s+|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 150)
}

export default function Notebook({ data, target, onOpen, reload, notify }: Props) {
  const book = data.notebook
  const topics = [...book.topics].sort(positionOrder)
  const areas = [...book.areas].sort((a, b) => a.name.localeCompare(b.name, 'de'))
  const note = target?.kind === 'note' ? book.notes.find((n) => n.id === target.id) : undefined
  const topicId = note?.topic_id ?? (target?.kind === 'topic' ? target.id : undefined)
  const topic = topics.find((item) => item.id === topicId)
  const area = target?.kind === 'area' ? areas.find((item) => item.id === target.id) : undefined
  const path = topicPath(topics, topic?.id ?? null)
  const children = topics.filter((item) => item.parent_id === (topic?.id ?? null))
  const notes = book.notes.filter((n) => n.topic_id === topic?.id).sort(positionOrder)
  const [folded, setFolded] = useState<Set<number>>(() => new Set())
  const [query, setQuery] = useState('')
  const [indexVisible, setIndexVisible] = useState(!target)
  const [editor, setEditor] = useState<Editor | null>(null)
  const [pendingCheck, setPendingCheck] = useState<{ noteId: number; body: string } | null>(null)
  const checkLock = useRef(false)
  const page = useRef<HTMLElement>(null)
  const needle = query.trim().toLocaleLowerCase('de')

  useEffect(() => {
    setIndexVisible(!target)
    if (target) {
      const ancestors = topicPath(topics, topic?.parent_id ?? null).map((t) => t.id)
      setFolded((current) => new Set([...current].filter((id) => !ancestors.includes(id))))
      page.current?.scrollTo(0, 0)
    }
  }, [target?.kind, target?.id, topic?.parent_id])

  function open(selected: NotebookTarget | null) {
    setQuery('')
    setIndexVisible(!selected)
    onOpen(selected)
  }
  function openTopic(id: number) {
    open({ kind: 'topic', id })
  }
  const close = () => setEditor(null)
  async function saved(selected: NotebookTarget | null) {
    try {
      await reload()
      notify('Planungsheft gespeichert')
    } catch {
      notify('Gespeichert. Die Ansicht konnte noch nicht aktualisiert werden.')
    }
    setEditor(null)
    open(selected)
  }
  async function checkTask(index: number) {
    if (!note || checkLock.current) return
    checkLock.current = true
    const body = toggleTask(note.body, index)
    setPendingCheck({ noteId: note.id, body })
    try {
      await patchNote(data.trip.id, note, { body })
      await reload()
    } catch (e) {
      if (e instanceof NoteConflict) {
        await reload().catch(() => {})
        notify('Die Notiz wurde inzwischen geändert. Prüfe die aktuelle Checkliste.')
      } else notify(e instanceof Error ? e.message : 'Aufgabe konnte nicht gespeichert werden.')
    } finally {
      checkLock.current = false
      setPendingCheck(null)
    }
  }
  function remove(kind: 'topic' | 'note' | 'area', id: number, parent: number | null, revision?: number) {
    setEditor({
      kind: 'delete',
      selection: { kind, id },
      fallback: parent ? { kind: 'topic', id: parent } : null,
      revision,
    })
  }
  function topicRow(item: NotebookTopic) {
    const count = book.notes.filter((n) => n.topic_id === item.id).length
    const subs = topics.filter((t) => t.parent_id === item.id).length
    const detail = [
      subs ? subs + ' ' + (subs === 1 ? 'Unterthema' : 'Unterthemen') : '',
      count ? count + ' ' + (count === 1 ? 'Notiz' : 'Notizen') : '',
    ]
      .filter(Boolean)
      .join(' · ')
    return (
      <EntryButton
        key={item.id}
        title={item.title}
        detail={detail}
        icon={<Folder size={18} />}
        open={() => openTopic(item.id)}
      />
    )
  }
  function areaRow(item: NotebookArea) {
    return (
      <EntryButton
        key={item.id}
        icon={<Layers size={17} />}
        title={item.name}
        detail={item.stop_ids.length + ' ' + (item.stop_ids.length === 1 ? 'Ort' : 'Orte')}
        open={() => open({ kind: 'area', id: item.id })}
      />
    )
  }
  const pathLabel = (id: number | null) =>
    topicPath(topics, id)
      .map((t) => t.title)
      .join(' › ')
  const matches = (...parts: string[]) => parts.join(' ').toLocaleLowerCase('de').includes(needle)
  const searchResults = needle
    ? [
        ...topics
          .map((t) => ({
            target: { kind: 'topic', id: t.id } as NotebookTarget,
            title: t.title,
            path: pathLabel(t.parent_id),
            icon: <Folder size={16} />,
          }))
          .filter((t) => matches(t.path, t.title)),
        ...book.notes
          .map((n) => ({
            target: { kind: 'note', id: n.id } as NotebookTarget,
            title: n.title,
            path: pathLabel(n.topic_id),
            body: n.body,
            icon: <FileText size={16} />,
          }))
          .filter((n) => matches(n.path, n.title, n.body)),
        ...areas
          .filter((a) => matches(a.name))
          .map((a) => ({
            target: { kind: 'area', id: a.id } as NotebookTarget,
            title: a.name,
            path: 'Gebiete',
            icon: <Layers size={16} />,
          })),
      ]
    : []
  const layoutClass = 'nb-layout ' + (indexVisible ? 'nb-show-index' : 'nb-show-page')
  const editorProps = { data, close, saved }
  return (
    <section className="nb-shell">
      <header className="nb-head">
        <h1>Planungsheft</h1>
        <div className="nb-head-actions">
          <button className="btn btn-secondary" onClick={() => setEditor({ kind: 'area' })}>
            <Layers size={16} /> Gebiet anlegen
          </button>
          <button className="btn btn-primary" onClick={() => setEditor({ kind: 'topic', parent: null })}>
            <FolderPlus size={17} /> Thema anlegen
          </button>
        </div>
      </header>
      <div className={layoutClass}>
        <aside className="nb-index">
          <label className="nb-search">
            <Search size={16} />
            <input
              value={query}
              type="search"
              aria-label="Planungsheft durchsuchen"
              placeholder="Planungsheft durchsuchen"
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          {needle ? (
            <>
              <h2>Suchergebnisse</h2>
              {searchResults.length ? (
                <EntryList>
                  {searchResults.map((item) => (
                    <EntryButton
                      key={item.target.kind + item.target.id}
                      title={item.title}
                      detail={item.path || 'Oberste Ebene'}
                      icon={item.icon}
                      open={() => open(item.target)}
                    />
                  ))}
                </EntryList>
              ) : (
                <p className="nb-muted">Keine passenden Themen, Notizen oder Gebiete.</p>
              )}
            </>
          ) : (
            <>
              <div className="nb-section-head">
                <h2>Themen</h2>
                <button
                  className="btn-icon"
                  aria-label="Thema auf oberster Ebene anlegen"
                  onClick={() => setEditor({ kind: 'topic', parent: null })}
                >
                  <Plus size={16} />
                </button>
              </div>
              {topics.length > 0 ? (
                <nav aria-label="Themenbaum">
                  <ul className="nb-tree">
                    {topics
                      .filter((t) => t.parent_id === null)
                      .map((t) => (
                        <TopicBranch
                          key={t.id}
                          topic={t}
                          topics={topics}
                          current={topic?.id}
                          folded={folded}
                          toggle={(id) =>
                            setFolded((old) => {
                              const next = new Set(old)
                              if (next.has(id)) next.delete(id)
                              else next.add(id)
                              return next
                            })
                          }
                          open={openTopic}
                        />
                      ))}
                  </ul>
                </nav>
              ) : (
                <p className="nb-muted">Hier erscheinen deine Themen.</p>
              )}
              <div className="nb-section-head">
                <h2>Gebiete</h2>
                <button
                  className="btn-icon"
                  aria-label="Neues Gebiet"
                  onClick={() => setEditor({ kind: 'area' })}
                >
                  <Plus size={16} />
                </button>
              </div>
              {areas.length ? (
                <nav className="nb-area-nav" aria-label="Gebiete">
                  {areas.map((a) => (
                    <button
                      key={a.id}
                      aria-current={area?.id === a.id ? 'page' : undefined}
                      onClick={() => open({ kind: 'area', id: a.id })}
                    >
                      <Layers size={15} />
                      {a.name}
                    </button>
                  ))}
                </nav>
              ) : (
                <p className="nb-muted">Fasse Orte in einem Gebiet zusammen.</p>
              )}
            </>
          )}
        </aside>
        <section className="nb-content" ref={page} aria-label="Heftseite">
          <button className="nb-mobile-back" onClick={() => setIndexVisible(true)}>
            <ArrowLeft size={16} /> Themenliste
          </button>
          <nav className="nb-crumbs" aria-label="Themenpfad">
            <button onClick={() => open(null)}>{data.trip.name}</button>
            {path.map((t) => (
              <span key={t.id}>
                <ChevronRight size={13} />
                <button onClick={() => openTopic(t.id)}>{t.title}</button>
              </span>
            ))}
          </nav>
          {note ? (
            <>
              <div className="nb-title">
                <h2>{note.title}</h2>
                <EditActions
                  noun="Notiz"
                  edit={() => setEditor({ kind: 'note', note, topic: note.topic_id })}
                  remove={() => remove('note', note.id, note.topic_id, note.revision)}
                />
              </div>
              {note.body ? (
                <NotebookText
                  body={pendingCheck?.noteId === note.id ? pendingCheck.body : note.body}
                  toggle={(index) => void checkTask(index)}
                  busy={pendingCheck !== null}
                />
              ) : (
                <p className="nb-muted">Diese Notiz hat noch keinen Text.</p>
              )}
              <NotebookLinks
                key={'note' + note.id}
                source={{ kind: 'note', id: note.id }}
                reload={reload}
                notify={notify}
              />
            </>
          ) : area ? (
            <>
              <div className="nb-title">
                <h2>{area.name}</h2>
                <EditActions
                  noun="Gebiet"
                  edit={() => setEditor({ kind: 'area', area })}
                  remove={() => remove('area', area.id, null)}
                />
              </div>
              <div className="nb-section-head">
                <h3>Orte im Gebiet</h3>
                <button className="text-link" onClick={() => setEditor({ kind: 'area', area })}>
                  <MapPin size={15} /> Orte zuordnen
                </button>
              </div>
              {area.stop_ids.length ? (
                <EntryList>
                  {area.stop_ids.map((id) => {
                    const stop = data.stops.find((s) => s.id === id)
                    return (
                      stop && (
                        <EntryButton
                          key={id}
                          title={stop.title}
                          detail={stop.address}
                          icon={<MapPin size={17} />}
                          open={() => onOpen({ kind: 'stop', id })}
                        />
                      )
                    )
                  })}
                </EntryList>
              ) : (
                <p className="nb-muted">Diesem Gebiet sind noch keine Orte zugeordnet.</p>
              )}
              <NotebookBacklinks target={{ kind: 'area', id: area.id }} />
            </>
          ) : topic ? (
            <>
              <div className="nb-title">
                <h2>{topic.title}</h2>
                <EditActions
                  noun="Thema"
                  edit={() => setEditor({ kind: 'topic', topic, parent: topic.parent_id })}
                  remove={() => remove('topic', topic.id, topic.parent_id)}
                />
              </div>
              <div className="nb-section-head">
                <h3>Unterthemen</h3>
                <button className="text-link" onClick={() => setEditor({ kind: 'topic', parent: topic.id })}>
                  <FolderPlus size={15} /> Unterthema anlegen
                </button>
              </div>
              {children.length > 0 && <EntryList>{children.map(topicRow)}</EntryList>}
              <div className="nb-section-head">
                <h3>Notizen</h3>
                <button className="text-link" onClick={() => setEditor({ kind: 'note', topic: topic.id })}>
                  <Plus size={15} /> Notiz anlegen
                </button>
              </div>
              {notes.length ? (
                <EntryList>
                  {notes.map((n) => (
                    <EntryButton
                      key={n.id}
                      title={n.title}
                      detail={notePreview(n.body)}
                      icon={<FileText size={17} />}
                      open={() => open({ kind: 'note', id: n.id })}
                    />
                  ))}
                </EntryList>
              ) : (
                <p className="nb-muted">Hier ist Platz für deine erste Notiz zu diesem Thema.</p>
              )}
              <NotebookLinks
                key={'topic' + topic.id}
                source={{ kind: 'topic', id: topic.id }}
                reload={reload}
                notify={notify}
              />
            </>
          ) : (
            <>
              <div className="nb-title">
                <h2>{topics.length || areas.length ? 'Themenübersicht' : 'Dein Planungsheft'}</h2>
              </div>
              {!topics.length && !areas.length ? (
                <div className="nb-empty">
                  <NotebookPen size={34} strokeWidth={1.3} />
                  <p>
                    Beginne mit einem Thema für deine Reise. Darin sammelst du Notizen, Aufgaben und passende
                    Reisedaten.
                  </p>
                  <button
                    className="btn btn-secondary"
                    onClick={() => setEditor({ kind: 'topic', parent: null })}
                  >
                    <FolderPlus size={16} /> Erstes Thema anlegen
                  </button>
                </div>
              ) : (
                <>
                  {children.length > 0 && <EntryList>{children.map(topicRow)}</EntryList>}
                  {areas.length > 0 && (
                    <>
                      <h3 className="nb-index-areas-title">Gebiete</h3>
                      <EntryList>{areas.map(areaRow)}</EntryList>
                    </>
                  )}
                </>
              )}
            </>
          )}
        </section>
      </div>
      {editor?.kind === 'topic' && (
        <TopicEditor {...editorProps} topic={editor.topic} initialParent={editor.parent} />
      )}
      {editor?.kind === 'note' && (
        <NoteEditor {...editorProps} note={editor.note} initialTopic={editor.topic} />
      )}
      {editor?.kind === 'area' && <AreaEditor {...editorProps} area={editor.area} />}
      {editor?.kind === 'delete' && (
        <DeleteNotebookItem
          {...editorProps}
          selection={editor.selection}
          fallback={editor.fallback}
          revision={editor.revision}
        />
      )}
    </section>
  )
}
