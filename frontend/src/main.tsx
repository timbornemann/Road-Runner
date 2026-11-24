import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  ArrowDownToLine,
  BookOpen,
  Cable,
  CalendarDays,
  CarFront,
  Check,
  ChevronRight,
  ChevronsUpDown,
  CircleAlert,
  Compass,
  LayoutDashboard,
  MapPinned,
  Menu,
  MountainSnow,
  NotebookTabs,
  Package,
  Plus,
  Route as RouteIcon,
  ShoppingBasket,
  WalletCards,
  X,
} from 'lucide-react'
import '@fontsource-variable/dm-sans/wght.css'
import './styles.css'
import { AgentConnection, useAgentConnection } from './AgentConnection'
import RouteView from './Route'
import { hashDestination, NotebookNavigation, targetIndex, targetPages } from './NotebookNavigation'
import './notebook-links.css'
import type { NotebookTarget } from './NotebookTypes'
import Modules from './Modules'
import Overview, { type Page } from './Overview'
import { TripChooser, TripEditor, tripStatus } from './Trips'
import { api, type Stop, type Trip, type TripData } from './shared'

const Notebook = lazy(() => import('./Notebook'))
const Journal = lazy(() => import('./Journal'))
const items = [
  { id: 'overview', label: 'Übersicht', icon: LayoutDashboard },
  { id: 'notebook', label: 'Planungsheft', icon: NotebookTabs },
  { id: 'route', label: 'Route & Orte', icon: RouteIcon },
  { id: 'journal', label: 'Reisetagebuch', icon: BookOpen },
  { id: 'purchases', label: 'Anschaffungen', icon: Package },
  { id: 'pantry', label: 'Vorräte & Einkauf', icon: ShoppingBasket },
  { id: 'mobility', label: 'Auto & Verkehr', icon: CarFront },
  { id: 'finance', label: 'Finanzen', icon: WalletCards },
] as const
function hashPage(): Page {
  const id = location.hash.slice(1).split('/')[0]
  return items.find((item) => item.id === id)?.id ?? 'overview'
}
function preferredTrip(trips: Trip[]) {
  return [...trips].sort((a, b) => {
    const rank = (trip: Trip) => ({ Unterwegs: 0, 'In Planung': 1, Abgeschlossen: 2 })[tripStatus(trip)] ?? 3
    return (
      Number(a.is_demo) - Number(b.is_demo) ||
      rank(a) - rank(b) ||
      (rank(a) === 2
        ? (b.end_date || '').localeCompare(a.end_date || '')
        : (a.start_date || '9999').localeCompare(b.start_date || '9999'))
    )
  })[0]
}
function App() {
  const [page, setPage] = useState<Page>(hashPage)
  const [target, setTarget] = useState<NotebookTarget | null>(() => hashDestination()?.target ?? null)
  const [trips, setTrips] = useState<Trip[]>([])
  const [data, setData] = useState<TripData | null>(null)
  const [ready, setReady] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [dialog, setDialog] = useState<'select' | 'edit' | 'new' | 'agent' | null>(null)
  const [editTrip, setEditTrip] = useState<Trip>()
  const [drawer, setDrawer] = useState(false)
  const [toast, setToast] = useState('')
  const [quickAction, setQuickAction] = useState('')
  const [journalStop, setJournalStop] = useState<Stop>()
  const selected = useRef<number | undefined>(undefined)
  const requestedTrip = useRef<number | undefined>(hashDestination()?.tripId)
  const version = useRef(0)
  const tripButton = useRef<HTMLButtonElement>(null)
  const menuButton = useRef<HTMLButtonElement>(null)
  const notify = useCallback((message: string) => setToast(message), [])
  const load = useCallback(async (requested?: number) => {
    if (requested !== undefined) requestedTrip.current = requested
    const seq = ++version.current
    try {
      const list = await api<Trip[]>('/api/trips')
      const lastTrip = list.find((t) => t.id === Number(localStorage.getItem('rr.trip')))
      const preferred = preferredTrip(list)
      const initial =
        lastTrip &&
        preferred &&
        lastTrip.is_demo === preferred.is_demo &&
        tripStatus(lastTrip) === tripStatus(preferred)
          ? lastTrip
          : preferred
      const trip = list.find((t) => t.id === (requestedTrip.current ?? selected.current)) ?? initial
      const contents = trip ? await api<TripData>('/api/trips/' + trip.id) : null
      if (seq !== version.current) return
      selected.current = trip?.id
      requestedTrip.current = undefined
      if (trip) localStorage.setItem('rr.trip', String(trip.id))
      else localStorage.removeItem('rr.trip')
      setTrips(list)
      setData(contents)
      setReady(true)
      setLoadError('')
    } catch (e) {
      if (seq === version.current) {
        setLoadError((e as Error).message)
        setReady(true)
      }
      throw e
    }
  }, [])
  const reload = useCallback(() => load(), [load])
  const connection = useAgentConnection(reload)
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') void load().catch(() => {})
    }
    refresh()
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('focus', refresh)
    const hash = () => {
      const nextPage = hashPage()
      const destination = hashDestination()
      if (destination?.tripId && destination.tripId !== selected.current) void load(destination.tripId).catch(() => {})
      setTarget(destination?.target ?? null)
      setPage(nextPage)
      if (nextPage !== 'journal') setJournalStop(undefined)
      setDrawer(false)
      if (!destination) window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', hash)
    return () => {
      document.removeEventListener('visibilitychange', refresh)
      window.removeEventListener('focus', refresh)
      window.removeEventListener('hashchange', hash)
    }
  }, [load])
  useEffect(() => {
    document.title = (items.find((i) => i.id === page)?.label || 'Reiseübersicht') + ' · Road-Runner'
  }, [page])
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(''), 4200)
    return () => clearTimeout(t)
  }, [toast])
  useEffect(() => {
    if (!drawer) return
    tripButton.current?.focus()
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setDrawer(false)
        menuButton.current?.focus()
      }
    }
    document.addEventListener('keydown', escape)
    return () => document.removeEventListener('keydown', escape)
  }, [drawer])
  function go(to: Page, record: NotebookTarget | null = null) {
    if (to !== 'journal') setJournalStop(undefined)
    location.hash = record && data ? [to, record.kind, record.id, data.trip.id].join('/') : to
    setTarget(record)
    setPage(to)
    setDrawer(false)
    window.scrollTo(0, 0)
  }
  function openRecord(record: NotebookTarget | null) {
    setQuickAction('')
    setJournalStop(undefined)
    go(record ? targetPages[record.kind] : 'notebook', record)
  }
  function edit(trip: Trip) {
    setEditTrip(trip)
    setDialog('edit')
  }
  function newTrip() {
    setDrawer(false)
    setDialog('new')
  }
  async function choose(id: number) {
    await load(id)
    setDialog(null)
    go('overview')
  }
  const current = items.find((i) => i.id === page)!
  const index = useMemo(() => targetIndex(data), [data])
  const nativeKey = [data?.trip.id, page, target?.kind, target?.id].join('/')
  const shell = (
    <div className="app-frame">
      {drawer && (
        <button className="drawer-shade" aria-label="Menü schließen" onClick={() => setDrawer(false)} />
      )}
      <aside className={'sidebar' + (drawer ? ' open' : '')} aria-label="Reise-Navigation">
        <a
          className="brand"
          href="#overview"
          aria-label="Road-Runner Übersicht"
          onClick={() => go('overview')}
        >
          <span className="brand-symbol">
            <MountainSnow size={25} strokeWidth={2.1} />
          </span>
          <span>
            Road<span className="brand-hyphen">-</span>Runner
          </span>
        </a>
        <button
          className="trip-switch"
          ref={tripButton}
          onClick={() => {
            setDialog('select')
            setDrawer(false)
          }}
        >
          <span className="switch-icon">
            <MapPinned size={19} />
          </span>
          <span className="switch-content">
            <small>Meine Reise</small>
            <strong>{data?.trip.name ?? 'Reise wählen'}</strong>
          </span>
          <ChevronsUpDown size={15} />
        </button>
        <span className="nav-heading">Reiseplaner</span>
        <nav>
          {items.map(({ id, label, icon: Icon }) => (
            <a
              key={id}
              href={'#' + id}
              className={'nav-entry' + (page === id ? ' active' : '')}
              aria-current={page === id ? 'page' : undefined}
              onClick={() => {
                go(id)
                setQuickAction('')
              }}
            >
              <Icon size={19} />
              <span>{label}</span>
            </a>
          ))}
        </nav>
        <div className="side-footer">
          <button
            className="side-export agent-link"
            onClick={() => {
              setDrawer(false)
              setDialog('agent')
            }}
          >
            <Cable size={17} />
            KI-Agent verbinden
          </button>
          {data && (
            <a className="side-export" href={'/api/trips/' + data.trip.id + '/export'} download>
              <ArrowDownToLine size={17} />
              Reise exportieren
            </a>
          )}
          <div className="server-status">
            <span className={'connection-dot' + (loadError ? ' disconnected' : '')} />
            {loadError ? 'Verbindung unterbrochen' : ready ? 'Lokal verbunden' : 'Verbinde …'}
          </div>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumbs">
            <button
              ref={menuButton}
              className="btn-icon mobile-toggle"
              aria-label="Navigation öffnen"
              aria-expanded={drawer}
              onClick={() => setDrawer(true)}
            >
              <Menu />
            </button>
            <Compass size={17} />
            <button className="breadcrumb-trips" onClick={() => setDialog('select')}>
              Meine Reisen
            </button>
            <ChevronRight size={13} />
            <strong>{current.label}</strong>
          </div>
          <div className="bar-actions">
            <span className="today-date">
              <CalendarDays size={15} />
              {new Date().toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' })}
            </span>
            <button className="btn btn-secondary top-new" onClick={newTrip}>
              <Plus size={15} />
              Neue Reise
            </button>
          </div>
        </header>
        <main className="main-content">
          {loadError && (
            <div className="network-error" role="alert">
              <CircleAlert size={18} />
              <span>Der Server konnte nicht geladen werden. {loadError}</span>
              <button className="text-link" onClick={() => void reload().catch(() => {})}>
                Erneut versuchen
              </button>
            </div>
          )}
          {!ready ? (
            <div className="panel empty-state">
              <Compass size={30} />
              <h1>Reise wird geladen …</h1>
            </div>
          ) : data ? (
            page === 'overview' ? (
              <Overview
                key={data.trip.id}
                data={data}
                go={go}
                edit={() => edit(data.trip)}
                quick={(kind) => {
                  setQuickAction(kind)
                  go(kind === 'expense' ? 'finance' : 'mobility')
                }}
              />
            ) : page === 'notebook' ? (
              <Suspense fallback={<p role="status">Planungsheft wird geladen …</p>}>
                <Notebook key={data.trip.id} data={data} reload={reload} notify={notify} target={target} onOpen={openRecord} />
              </Suspense>
            ) : page === 'route' ? (
              <RouteView
                key={nativeKey}
                data={data}
                reload={reload}
                notify={notify}
                onJournal={(stop) => {
                  setJournalStop(stop)
                  go('journal')
                }}
              />
            ) : page === 'journal' ? (
              <Suspense fallback={<p role="status">Reisetagebuch wird geladen …</p>}>
                <Journal
                  key={nativeKey}
                  data={data}
                  reload={reload}
                  notify={notify}
                  initialStop={journalStop?.trip_id === data.trip.id ? journalStop : undefined}
                />
              </Suspense>
            ) : (
              <Modules
                key={nativeKey}
                page={page}
                data={data}
                reload={reload}
                notify={notify}
                quickAction={quickAction}
                onQuickHandled={() => setQuickAction('')}
              />
            )
          ) : (
            !loadError && (
              <div className="panel empty-state">
                <MapPinned size={36} />
                <h1>Meine Reisen</h1>
                <p>Lege deine erste Reise mit Ziel, Zeitraum und Budget an.</p>
                <button className="btn btn-primary" onClick={newTrip}>
                  <Plus size={16} />
                  Neue Reise
                </button>
              </div>
            )
          )}
        </main>
      </div>
      {dialog === 'select' && (
        <TripChooser
          trips={trips}
          selected={data?.trip.id}
          choose={(id) => void choose(id).catch((e) => notify(e.message))}
          close={() => setDialog(null)}
          create={newTrip}
          edit={edit}
        />
      )}
      {dialog === 'agent' && <AgentConnection connection={connection} onClose={() => setDialog(null)} />}
      {(dialog === 'edit' || dialog === 'new') && (
        <TripEditor
          trip={dialog === 'edit' ? editTrip : undefined}
          close={() => setDialog(null)}
          saved={async (id) => {
            await choose(id)
            notify(dialog === 'edit' ? 'Reise gespeichert' : 'Reise angelegt')
          }}
          removed={async () => {
            await load()
            setDialog(null)
            go('overview')
            notify('Reise gelöscht')
          }}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          {toast}
          <button aria-label="Meldung schließen" onClick={() => setToast('')}>
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  )
  return (
    <NotebookNavigation.Provider value={{ data, index, target, open: openRecord }}>
      {shell}
    </NotebookNavigation.Provider>
  )
}
createRoot(document.getElementById('root')!).render(<App />)
