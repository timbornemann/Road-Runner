import { useState, type FormEvent } from 'react'
import { ArrowDown, ArrowLeft, ArrowUp, Check, Pencil, Plus, Trash2 } from 'lucide-react'
import { api, Modal, type RouteStage, type RouteVariant } from './shared'

type Target = { stage?: RouteStage; variant?: RouteVariant; type: 'stage' | 'variant' }
type Screen = { mode: 'list' } | { mode: 'form' | 'delete'; target: Target }

export default function StageManager({
  stages,
  tripId,
  reload,
  onClose,
}: {
  stages: RouteStage[]
  tripId: number
  reload: () => Promise<void>
  onClose: () => void
}) {
  const [screen, setScreen] = useState<Screen>({ mode: 'list' })
  const [name, setName] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')
  const [working, setWorking] = useState(false)
  const base = '/api/trips/' + tripId + '/stages'

  function form(target: Target) {
    const item = target.type === 'stage' ? target.stage : target.variant
    setName(item?.name ?? '')
    setNotes(item?.notes ?? '')
    setError('')
    setScreen({ mode: 'form', target })
  }
  function path(target: Target) {
    if (!target.stage) return base
    const stage = base + '/' + target.stage.id
    return target.type === 'stage'
      ? stage
      : stage + '/variants' + (target.variant ? '/' + target.variant.id : '')
  }
  async function run(request: () => Promise<unknown>) {
    if (working) return
    setWorking(true)
    setError('')
    try {
      await request()
      await reload()
      setScreen({ mode: 'list' })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Änderung fehlgeschlagen.')
    } finally {
      setWorking(false)
    }
  }
  function save(event: FormEvent) {
    event.preventDefault()
    if (screen.mode !== 'form') return
    const { target } = screen
    const editing = target.type === 'stage' ? target.stage : target.variant
    void run(() => api(path(target), editing ? 'PATCH' : 'POST', { name, notes }))
  }
  function move(index: number, step: number) {
    const ids = stages.map((stage) => stage.id)
    ;[ids[index], ids[index + step]] = [ids[index + step], ids[index]]
    void run(() => api(base + '/order', 'PUT', { ids }))
  }
  function itemActions(target: Target) {
    const label = target.type === 'stage' ? target.stage!.name : target.variant!.name
    return (
      <>
        <button
          type="button"
          className="btn-icon"
          disabled={working}
          aria-label={label + ' bearbeiten'}
          onClick={() => form(target)}
        >
          <Pencil size={15} />
        </button>
        <button
          type="button"
          className="btn-icon"
          disabled={working}
          aria-label={label + ' löschen'}
          onClick={() => {
            setError('')
            setScreen({ mode: 'delete', target })
          }}
        >
          <Trash2 size={15} />
        </button>
      </>
    )
  }
  const entity = screen.mode === 'list' || screen.target.type === 'stage' ? 'Etappe' : 'Variante'
  const editing =
    screen.mode === 'form' && (screen.target.type === 'stage' ? screen.target.stage : screen.target.variant)
  const title =
    screen.mode === 'list'
      ? 'Etappen & Varianten'
      : screen.mode === 'delete'
        ? entity + ' löschen?'
        : entity + (editing ? ' bearbeiten' : ' anlegen')
  return (
    <Modal title={title} onClose={onClose}>
      {screen.mode === 'list' && (
        <div className="rr-stage-management">
          {!stages.length && (
            <p>
              Gliedere deine Reise in Etappen. Innerhalb einer Etappe kannst du mehrere Routenvarianten
              vorbereiten.
            </p>
          )}
          {stages.map((stage, index) => (
            <section className="rr-stage-admin" key={stage.id}>
              <div className="rr-stage-admin-row">
                <strong>{stage.name}</strong>
                <button
                  className="btn-icon"
                  aria-label={stage.name + ' nach oben'}
                  disabled={working || !index}
                  onClick={() => move(index, -1)}
                >
                  <ArrowUp size={15} />
                </button>
                <button
                  className="btn-icon"
                  aria-label={stage.name + ' nach unten'}
                  disabled={working || index === stages.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDown size={15} />
                </button>
                {itemActions({ type: 'stage', stage })}
              </div>
              {stage.variants.map((variant) => (
                <div key={variant.id} className="rr-stage-admin-row rr-stage-admin-variant">
                  <span>{variant.name}</span>
                  {stage.active_variant_id === variant.id && (
                    <small>
                      <Check size={12} /> Aktiv
                    </small>
                  )}
                  {itemActions({ type: 'variant', stage, variant })}
                </div>
              ))}
              <button
                className="rr-text-action"
                disabled={working}
                onClick={() => form({ type: 'variant', stage })}
              >
                <Plus size={15} /> Variante anlegen
              </button>
            </section>
          ))}
          <button className="btn btn-primary" disabled={working} onClick={() => form({ type: 'stage' })}>
            <Plus size={16} /> Etappe anlegen
          </button>
        </div>
      )}
      {screen.mode === 'form' && (
        <form className="rr-stop-form" onSubmit={save}>
          {screen.target.type === 'variant' && <small>Etappe {screen.target.stage?.name}</small>}
          <label className="field">
            Name
            <input
              key={title}
              autoFocus
              required
              maxLength={250}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={entity === 'Etappe' ? 'z. B. Lofoten' : 'z. B. Küstenroute'}
            />
          </label>
          <label className="field">
            Notizen
            <textarea
              maxLength={16000}
              rows={3}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </label>
          <div className="actions">
            <button
              type="button"
              className="btn btn-secondary"
              disabled={working}
              onClick={() => {
                setError('')
                setScreen({ mode: 'list' })
              }}
            >
              <ArrowLeft size={15} /> Zurück
            </button>
            <button className="btn btn-primary" disabled={working || !name.trim()}>
              Speichern
            </button>
          </div>
        </form>
      )}
      {screen.mode === 'delete' && (
        <>
          <p>
            „{screen.target.type === 'stage' ? screen.target.stage?.name : screen.target.variant?.name}“
            löschen? Stopps der aktiven Route bleiben eingeplant. Orte aus entfernten, inaktiven Varianten
            kommen auf die Merkliste.
          </p>
          <div className="actions">
            <button
              className="btn btn-secondary"
              disabled={working}
              onClick={() => {
                setError('')
                setScreen({ mode: 'list' })
              }}
            >
              Abbrechen
            </button>
            <button
              className="btn btn-primary"
              disabled={working}
              onClick={() => void run(() => api(path(screen.target), 'DELETE'))}
            >
              Löschen
            </button>
          </div>
        </>
      )}
      {error && (
        <p className="rr-error" role="alert">
          {error}
        </p>
      )}
    </Modal>
  )
}
