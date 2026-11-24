import { useState } from 'react'
import { Check, Link2, MapPinPlus, PackagePlus, Plus, Search, X } from 'lucide-react'
import { api, Modal } from './shared'
import { NewNotebookStop } from './Route'
import { PurchaseForm } from './modules/Purchases'
import { ModuleContext } from './modules/context'
import { kindLabels, NotebookBacklinks, useNotebookNavigation } from './NotebookNavigation'
import type { NotebookKind, NotebookSource, NotebookTarget } from './NotebookTypes'

export function NotebookLinks({
  source,
  reload,
  notify,
}: {
  source: NotebookSource
  reload: () => Promise<void>
  notify: (message: string) => void
}) {
  const { data, index, open } = useNotebookNavigation()
  const [dialog, setDialog] = useState<'pick' | 'stop' | 'purchase' | null>(null)
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<NotebookKind | ''>('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (!data) return null
  const path = '/api/trips/' + data.trip.id + '/notebook/links'
  const sourceFields = { source_type: source.kind, source_id: source.id }
  const outgoing = data.notebook.links.filter(
    (l) => l.source_type === source.kind && l.source_id === source.id,
  )
  const linked = new Set(outgoing.map((l) => l.target_type + '/' + l.target_id))
  const results = [...index.values()]
    .filter(
      (t) =>
        !(source.kind === t.kind && source.id === t.id) &&
        (!kind || t.kind === kind) &&
        [t.title, t.detail, kindLabels[t.kind]]
          .join(' ')
          .toLocaleLowerCase('de')
          .includes(query.trim().toLocaleLowerCase('de')),
    )
    .sort((a, b) => a.title.localeCompare(b.title, 'de'))

  async function refresh(message: string) {
    try {
      await reload()
      notify(message)
    } catch {
      notify(message + ' Die Ansicht konnte noch nicht neu geladen werden.')
    }
  }
  async function update(target: NotebookTarget, unlink?: number) {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      if (unlink !== undefined) await api(path + '/' + unlink, 'DELETE')
      else await api(path, 'POST', { ...sourceFields, target_type: target.kind, target_id: target.id })
      await refresh(unlink !== undefined ? 'Verknüpfung entfernt.' : 'Verknüpfung gespeichert.')
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setBusy(false)
    }
  }
  async function create(target_type: 'stop' | 'purchase', fields: unknown) {
    await api(path + '/create-target', 'POST', { ...sourceFields, target_type, fields })
    await refresh(
      target_type === 'stop' ? 'Ort angelegt und verknüpft.' : 'Anschaffung angelegt und verknüpft.',
    )
  }
  const close = () => setDialog(null)
  return (
    <section className="notebook-links">
      <div className="nb-links-head">
        <h3>
          <Link2 size={16} /> Verknüpfungen
        </h3>
        <button
          className="text-link"
          onClick={() => {
            setQuery('')
            setKind('')
            setError('')
            setDialog('pick')
          }}
        >
          <Plus size={15} /> Verknüpfen
        </button>
      </div>
      {outgoing.length > 0 && (
        <ul className="nb-link-chips">
          {outgoing.map((l) => {
            const t = index.get(l.target_type + '/' + l.target_id)
            return (
              t && (
                <li key={l.id}>
                  <button
                    onClick={() => open(t)}
                    title={[kindLabels[t.kind], t.detail, t.title].filter(Boolean).join(' · ')}
                  >
                    <small>{kindLabels[t.kind]}</small> {t.title}
                  </button>
                  <button
                    aria-label={'Verknüpfung zu ' + t.title + ' entfernen'}
                    disabled={busy}
                    onClick={() => void update(t, l.id)}
                  >
                    <X size={13} />
                  </button>
                </li>
              )
            )
          })}
        </ul>
      )}
      <NotebookBacklinks target={source} />
      {error && !dialog && <p role="alert">{error}</p>}
      {dialog === 'pick' && (
        <Modal title="Verknüpfungen hinzufügen" onClose={close}>
          <div className="nb-picker">
            <div className="nb-picker-filters">
              <label>
                <Search size={16} />
                <input
                  aria-label="Einträge suchen"
                  placeholder="Einträge suchen …"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              <select
                aria-label="Art des Eintrags"
                value={kind}
                onChange={(e) => setKind(e.target.value as typeof kind)}
              >
                <option value="">Alle Bereiche</option>
                {Object.entries(kindLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="nb-picker-list">
              {results.map((t) => {
                const key = t.kind + '/' + t.id
                const exists = linked.has(key)
                return (
                  <button key={key} disabled={busy || exists} onClick={() => void update(t)}>
                    <span>
                      <small>{[kindLabels[t.kind], t.detail].filter(Boolean).join(' · ')}</small>
                      <strong>{t.title}</strong>
                    </span>
                    {exists ? <Check size={18} aria-label="Verknüpft" /> : <Plus size={18} />}
                  </button>
                )
              })}
              {!results.length && <p>Keine passenden Einträge gefunden.</p>}
            </div>
            {error && <p role="alert">{error}</p>}
            <div className="nb-picker-create">
              <button disabled={busy} className="btn btn-secondary" onClick={() => setDialog('stop')}>
                <MapPinPlus size={16} /> Ort anlegen
              </button>
              <button disabled={busy} className="btn btn-secondary" onClick={() => setDialog('purchase')}>
                <PackagePlus size={16} /> Anschaffung anlegen
              </button>
              <button className="btn btn-primary" onClick={close}>
                Fertig
              </button>
            </div>
          </div>
        </Modal>
      )}
      {dialog === 'stop' && (
        <NewNotebookStop data={data} onClose={close} createLinked={(fields) => create('stop', fields)} />
      )}
      {dialog === 'purchase' && (
        <ModuleContext.Provider
          value={{ data, save: (_path, _method, fields) => create('purchase', fields) }}
        >
          <PurchaseForm onClose={close} />
        </ModuleContext.Provider>
      )}
    </section>
  )
}
