import { useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, MapPin, Plus } from 'lucide-react'
import type { RouteStage, Stop } from './shared'
import { NotebookBacklinks } from './NotebookNavigation'

interface Props {
  stage: RouteStage
  count: number
  stops: Stop[]
  showAlternatives: boolean
  working: boolean
  onSwitch: (id: number) => void
  onSelect: (stop: Stop) => void
  onMove: (from: Stop, to: Stop, siblings: Stop[]) => void
  onAdd: (variantId: number | null) => void
  children: ReactNode
}

export default function RouteStageCard({
  stage,
  count,
  stops,
  showAlternatives,
  working,
  onSwitch,
  onSelect,
  onMove,
  onAdd,
  children,
}: Props) {
  const foldKey = 'rr.stage.folded.' + stage.trip_id + '.' + stage.id
  const [open, setOpen] = useState(() => sessionStorage.getItem(foldKey) !== 'yes')
  function toggle() {
    if (open) sessionStorage.setItem(foldKey, 'yes')
    else sessionStorage.removeItem(foldKey)
    setOpen(!open)
  }
  const active = stage.variants.find((variant) => variant.id === stage.active_variant_id)
  const alternatives = stage.variants.filter((variant) => variant.id !== stage.active_variant_id)
  return (
    <section className="rr-stage-block">
      <h2>
        <button className="rr-stage-heading" aria-expanded={open} onClick={toggle}>
          {open ? <ChevronDown size={17} /> : <ChevronRight size={17} />}
          <span>{stage.name}</span>
          <small>
            {count} {count === 1 ? 'Stopp' : 'Stopps'}
          </small>
        </button>
      </h2>
      {open && (
        <div className="rr-stage-content">
          {stage.notes && <p>{stage.notes}</p>}
          <NotebookBacklinks target={{kind: 'stage', id: stage.id}} />
          {active && (
            <label className="rr-active-variant">
              Aktive Variante
              <select
                aria-label="Aktive Variante"
                value={active.id}
                disabled={working}
                onChange={(event) => onSwitch(Number(event.target.value))}
              >
                {stage.variants.map((variant) => (
                  <option key={variant.id} value={variant.id}>
                    {variant.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {active?.notes && <p>{active.notes}</p>}
          {active && <NotebookBacklinks target={{kind: 'variant', id: active.id}} />}
          {children}
          <button className="rr-text-action" onClick={() => onAdd(stage.active_variant_id)}>
            <Plus size={15} /> Stopp hinzufügen
          </button>
          {showAlternatives && alternatives.length > 0 && (
            <details className="rr-alternatives">
              <summary>Weitere Varianten vorbereiten</summary>
              {alternatives.map((variant) => (
                <div className="rr-alternative" key={variant.id}>
                  <strong>{variant.name}</strong>
                  {variant.notes && <p>{variant.notes}</p>}
                  <NotebookBacklinks target={{kind: 'variant', id: variant.id}} />
                  {stops
                    .filter((stop) => !stop.saved && stop.variant_id === variant.id)
                    .map((stop, index, siblings) => (
                      <div className="rr-alt-stop-row" key={stop.id}>
                        <button className="rr-alt-stop" onClick={() => onSelect(stop)}>
                          <MapPin size={13} /> {stop.title}
                          <ChevronRight size={13} />
                        </button>
                        {siblings.length > 1 && (
                          <>
                            <button
                              className="btn-icon"
                              disabled={working || index === 0}
                              aria-label={stop.title + ' nach oben'}
                              onClick={() => onMove(stop, siblings[index - 1], siblings)}
                            >
                              <ArrowUp size={14} />
                            </button>
                            <button
                              className="btn-icon"
                              disabled={working || index === siblings.length - 1}
                              aria-label={stop.title + ' nach unten'}
                              onClick={() => onMove(stop, siblings[index + 1], siblings)}
                            >
                              <ArrowDown size={14} />
                            </button>
                          </>
                        )}
                      </div>
                    ))}
                  <button className="rr-text-action" onClick={() => onAdd(variant.id)}>
                    <Plus size={15} /> Stopp für {variant.name} hinzufügen
                  </button>
                </div>
              ))}
            </details>
          )}
        </div>
      )}
    </section>
  )
}
