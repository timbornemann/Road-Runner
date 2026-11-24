import { useEffect, useRef, useState } from 'react'
import {
  ArrowDownToLine,
  ArrowRight,
  BedDouble,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  Compass,
  Flag,
  Fuel,
  MapPin,
  MapPinned,
  Mountain,
  Navigation,
  PackageCheck,
  Pencil,
  Plus,
  Route as RouteIcon,
  ShoppingBasket,
  Tent,
  Wallet,
  type LucideIcon,
} from 'lucide-react'
import { TripMap } from './Route'
import { activeRoute, localDate, money, navUrl, type Stop, type TripData } from './shared'
import { tripDates, tripStatus } from './Trips'

export type Page = 'overview' | 'notebook' | 'places' | 'route' | 'journal' | 'purchases' | 'pantry' | 'finance' | 'mobility'
type Actions = {
  data: TripData
  go: (page: Page) => void
  quick: (kind: 'expense' | 'fuel') => void
  edit: () => void
}
const stopTitles = { sight: 'Sehenswürdigkeit', sleep: 'Schlafplatz', stop: 'Reiseziel' }
function Stat({
  icon: Icon,
  label,
  value,
  detail,
  tone,
  onClick,
}: {
  icon: LucideIcon
  label: string
  value: string
  detail: string
  tone: string
  onClick: () => void
}) {
  return (
    <button onClick={onClick} className="stat-card">
      <span className="stat-head">
        <span className={'icon-tile ' + tone}>
          <Icon size={18} />
        </span>
        <span>{label}</span>
      </span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </button>
  )
}
function QuickAdd({ quick }: Pick<Actions, 'quick'>) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const dismiss = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', dismiss)
      document.removeEventListener('keydown', escape)
    }
  }, [open])
  return (
    <div className="quick-add" ref={root}>
      <button
        className="btn btn-primary"
        aria-label="Schnell erfassen"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Plus size={17} />
        <span>Schnell erfassen</span>
        <ChevronDown size={15} />
      </button>
      {open && (
        <div className="dropdown">
          {(
            [
              ['expense', Wallet, 'Ausgabe erfassen'],
              ['fuel', Fuel, 'Tankstopp erfassen'],
            ] as const
          ).map(([kind, Icon, title]) => (
            <button
              key={kind}
              onClick={() => {
                setOpen(false)
                quick(kind)
              }}
            >
              <Icon size={17} />
              {title}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
function dateHint(date: string | null) {
  if (!date) return 'Flexibel'
  if (date === localDate()) return 'Heute'
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  if (date === localDate(tomorrow)) return 'Morgen'
  return new Date(date + 'T12:00:00').toLocaleDateString('de-DE', { day: 'numeric', month: 'short' })
}
function dayNumber(date: string) {
  return Date.parse(date + 'T00:00:00Z') / 86_400_000
}

export default function Overview({ data, go, quick, edit }: Actions) {
  const { trip, expenses } = data
  const [mapStop, setMapStop] = useState<Stop | null>(null)
  const today = localDate()
  const itinerary = activeRoute(data)
  const nextStops = itinerary.filter((s) => !s.done)
  const next = nextStops[0]
  const sleep =
    itinerary.find(
      (s) => s.kind === 'sleep' && s.date && s.date <= today && s.end_date && today < s.end_date,
    ) ?? nextStops.find((s) => s.kind === 'sleep')
  const paid = expenses.filter((e) => e.status === 'paid').reduce((sum, e) => sum + e.base_amount, 0)
  const planned = expenses.filter((e) => e.status === 'planned').reduce((sum, e) => sum + e.base_amount, 0)
  const free = trip.budget - paid - planned
  const denom = Math.max(trip.budget, paid + planned, 1)
  const paidPct = (paid / denom) * 100,
    plannedPct = (planned / denom) * 100
  const open = data.shopping.filter((s) => !s.done && s.quantity > 0).length
  const day = trip.start_date ? dayNumber(today) - dayNumber(trip.start_date) + 1 : 0
  const duration =
    trip.start_date && trip.end_date ? dayNumber(trip.end_date) - dayNumber(trip.start_date) + 1 : 0
  const status = tripStatus(trip)
  const categories: [string, number, string][] = [
    ['Bereits bezahlt', paid, 'paid'],
    ['Noch geplant', planned, 'planned'],
    ['Verfügbar', free, 'free'],
  ]
  return (
    <div className="overview">
      <div className="overview-title">
        <h1>Reiseübersicht</h1>
        <QuickAdd quick={quick} />
      </div>
      <div className="overview-summary">
        <section className={'trip-hero' + (trip.is_demo ? '' : ' personal-hero')} aria-label="Aktuelle Reise">
          <div className="hero-body">
            <div className="hero-status">
              <span />
              {status}
            </div>
            <h2>{trip.name}</h2>
            <div className="hero-meta">
              {trip.region && (
                <span>
                  <MapPin />
                  {trip.region}
                </span>
              )}
              <span>
                <CalendarDays />
                {tripDates(trip)}
              </span>
            </div>
          </div>
          <button className="hero-edit" aria-label="Reise bearbeiten" title="Reise bearbeiten" onClick={edit}>
            <Pencil size={16} />
          </button>
          {trip.is_demo && <span className="demo-mark">Beispielreise</span>}
        </section>
        <div className="stats-grid">
          <Stat
            icon={CalendarDays}
            label="Reisetage"
            tone="peach"
            value={status === 'Unterwegs' && day > 0 ? 'Tag ' + day : duration ? String(duration) : 'Offen'}
            detail={
              duration
                ? status === 'Unterwegs'
                  ? 'von ' + duration + ' Reisetagen'
                  : 'Tage insgesamt'
                : 'Zeitraum festlegen'
            }
            onClick={edit}
          />
          <Stat
            icon={RouteIcon}
            label="Routenstopps"
            tone="sage"
            value={String(itinerary.length)}
            detail={itinerary.filter((s) => s.done).length + ' bereits besucht'}
            onClick={() => go('route')}
          />
          <Stat
            icon={Wallet}
            label="Freies Budget"
            tone="gold"
            value={money(free, trip.currency)}
            detail="nach geplanten Ausgaben"
            onClick={() => go('finance')}
          />
          <Stat
            icon={ShoppingBasket}
            label="Einkaufsliste"
            tone="blue"
            value={String(open)}
            detail={open === 1 ? 'offener Artikel' : 'offene Artikel'}
            onClick={() => go('pantry')}
          />
        </div>
      </div>
      <div className="overview-columns">
        <section className="panel dash-panel">
          <header className="panel-heading">
            <div className="heading-pack">
              <span className="heading-icon">
                <RouteIcon size={19} />
              </span>
              <h2>Nächste Stopps</h2>
            </div>
            <button className="text-link" onClick={() => go('route')}>
              Zur Route
              <ArrowRight size={15} />
            </button>
          </header>
          <div className="timeline">
            {nextStops.slice(0, 3).map((stop, index) => {
              const Icon = stop.kind === 'sleep' ? Tent : stop.kind === 'sight' ? Mountain : Flag
              return (
                <div className="timeline-row" key={stop.id}>
                  <span className={'timeline-node pin-' + stop.kind}>
                    <Icon size={18} />
                  </span>
                  <div className="timeline-text">
                    <small>
                      {dateHint(stop.date)}
                      {stop.time && ' · ' + stop.time.slice(0, 5) + ' Uhr'}
                    </small>
                    <h3>{stop.title}</h3>
                    <p>{stopTitles[stop.kind]}</p>
                  </div>
                  {index === 0 ? (
                    <a
                      className="nav-circle"
                      title={'Navigation zu ' + stop.title}
                      aria-label={'Navigation zu ' + stop.title}
                      target="_blank"
                      rel="noreferrer"
                      href={navUrl(stop)}
                    >
                      <Navigation size={16} />
                    </a>
                  ) : null}
                </div>
              )
            })}
            {!next && (
              <p className="empty-inline">
                {itinerary.length
                  ? 'Du hast alle Stopps deiner Route besucht.'
                  : 'Füge deiner Route den ersten Stopp hinzu. Ein Datum kannst du später festlegen.'}
              </p>
            )}
          </div>
        </section>
        <section className="panel dash-panel">
          <header className="panel-heading">
            <div className="heading-pack">
              <span className="heading-icon">
                <CircleDollarSign size={19} />
              </span>
              <h2>Reisebudget</h2>
            </div>
            <button className="text-link" onClick={() => go('finance')}>
              Details
              <ArrowRight size={15} />
            </button>
          </header>
          <div className="budget-summary">
            <p>Gesamtbudget</p>
            <strong>{money(trip.budget, trip.currency)}</strong>
          </div>
          <div
            className="budget-track"
            role="img"
            aria-label={
              'Bezahlt: ' + money(paid, trip.currency) + ', geplant: ' + money(planned, trip.currency)
            }
          >
            <i style={{ width: paidPct + '%' }} />
            <i style={{ width: plannedPct + '%' }} />
          </div>
          <div className="budget-legend">
            {categories.map(([label, val, tone]) => (
              <div key={label}>
                <span>
                  <i className={'legend-dot ' + tone} />
                  {label}
                </span>
                <strong>{money(val, trip.currency)}</strong>
              </div>
            ))}
          </div>
        </section>
        <section className="panel dash-panel">
          <header className="panel-heading">
            <div className="heading-pack">
              <span className="heading-icon">
                <MapPinned size={19} />
              </span>
              <h2>Routenkarte</h2>
            </div>
            <a className="text-link" href="#route/map">
              Karte öffnen
              <ArrowRight size={15} />
            </a>
          </header>
          <div className="dashboard-map">
            <TripMap stops={itinerary} onSelect={setMapStop} />
          </div>
          {mapStop && (
            <div className="map-action">
              <strong>{mapStop.title}</strong>
              <a className="text-link" href={navUrl(mapStop)} target="_blank" rel="noreferrer">
                Navigieren
                <Navigation size={15} />
              </a>
            </div>
          )}
        </section>
        <section className="panel dash-panel">
          <header className="panel-heading">
            <div className="heading-pack">
              <span className="heading-icon">
                <Compass size={19} />
              </span>
              <h2>Unterwegs</h2>
            </div>
          </header>
          <div className="travel-actions">
            <button onClick={() => go('route')}>
              <BedDouble />
              <span>
                <small>Nächster Schlafplatz</small>
                <strong>{sleep?.title || 'Schlafplatz planen'}</strong>
              </span>
              <ChevronRight />
            </button>
            <button onClick={() => go('purchases')}>
              <PackageCheck />
              <span>
                <small>Anschaffungen</small>
                <strong>{data.purchases.filter((p) => !p.done).length} offen</strong>
              </span>
              <ChevronRight />
            </button>
            <a href={'/api/trips/' + trip.id + '/export'} download>
              <ArrowDownToLine />
              <span>
                <small>Reisedaten</small>
                <strong>JSON exportieren</strong>
              </span>
              <ChevronRight />
            </a>
          </div>
        </section>
      </div>
    </div>
  )
}
