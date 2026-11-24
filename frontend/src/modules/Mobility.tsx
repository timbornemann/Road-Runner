import { useState } from 'react'
import { TagChips, TagEditor, tripTags } from '../Tags'
import TaggedList from './TaggedList'
import {
  CarFront,
  Check,
  CircleParking,
  Droplet,
  Fuel,
  Gauge,
  MapPin,
  Pencil,
  Ship,
  Ticket,
  TrainFront,
  Trash2,
  Wallet,
  type LucideIcon,
} from 'lucide-react'
import {
  Card,
  Field,
  Header,
  IconButton,
  Metric,
  Modal,
  Row,
  Select,
  Status,
  Tabs,
  dayNow,
  kindNames,
  moneyLabel,
  qty,
  todayLabel,
} from './ui'
import { useTrip, type Ride } from './context'
import { MoneyFields, paymentBody, paymentValue } from './money'

const kinds: Record<string, string> = { ...kindNames, parking: 'Parken', toll: 'Maut' }
const icons: Record<string, LucideIcon> = {
  fuel: Fuel,
  ferry: Ship,
  train: TrainFront,
  parking: CircleParking,
  toll: Ticket,
  other: CarFront,
}
function timeLabel(date?: string | null) {
  if (!date) return ''
  const [d, t] = date.split('T')
  return `${todayLabel(d)}${t ? `, ${t.slice(0, 5)} Uhr` : ''}`
}
function RideForm({ item, fuel, onClose }: { item?: Ride; fuel?: boolean; onClose: () => void }) {
  const { data, save } = useTrip()
  const e = data.expenses.find((e) => e.id === item?.expense_id)
  const [kind, setKind] = useState<string>(item?.kind || (fuel ? 'fuel' : 'ferry'))
  const [title, setTitle] = useState(item?.title || '')
  const [date, setDate] = useState(item?.date || dayNow())
  const [origin, setOrigin] = useState(item?.origin || '')
  const [destination, setDestination] = useState(item?.destination || '')
  const [dep, setDep] = useState(item?.departure?.slice(0, 16) || '')
  const [arr, setArr] = useState(item?.arrival?.slice(0, 16) || '')
  const [litres, setLitres] = useState(String(item?.quantity ?? ''))
  const [km, setKm] = useState(String(item?.odometer ?? ''))
  const [stop, setStop] = useState(String(item?.stop_id ?? ''))
  const [tags, setTags] = useState(item?.tags ?? [])
  const [notes, setNotes] = useState(item?.notes || '')
  const [done, setDone] = useState(item ? !!item.done : !!fuel)
  const [paid, setPaid] = useState(item ? !!item.paid : !!fuel)
  const [amount, setAmount] = useState(
    paymentValue(
      data.trip.currency,
      e?.amount ?? (item?.estimated_cost || undefined),
      e?.currency ?? item?.currency,
      e?.exchange_rate ?? item?.exchange_rate,
    ),
  )
  const transit = kind === 'train' || kind === 'ferry'
  const chooseKind = (k: string) => {
    setKind(k)
    if (!item) {
      setPaid(['fuel', 'toll', 'parking'].includes(k))
      setDone(['fuel', 'toll', 'parking'].includes(k))
    }
  }
  async function submit() {
    const p = paymentBody(amount, data.trip.currency)
    await save(
      item ? `mobility/${item.id}` : 'mobility',
      item ? 'PATCH' : 'POST',
      {
        title: title.trim() || kinds[kind],
        kind,
        date,
        stop_id: stop ? Number(stop) : null,
        quantity: kind === 'fuel' && litres ? Number(litres) : null,
        odometer: kind === 'fuel' && km ? Number(km) : null,
        origin: transit ? origin : '',
        destination: transit ? destination : '',
        departure: transit && dep ? dep : null,
        arrival: transit && arr ? arr : null,
        notes,
        tags,
        done,
        paid,
        estimated_cost: p.amount,
        currency: p.currency,
        exchange_rate: p.exchange_rate,
      },
      'Mobilitätseintrag gespeichert.',
    )
    onClose()
  }
  return (
    <Modal
      title={
        item ? 'Mobilitätseintrag bearbeiten' : fuel ? 'Tankstopp erfassen' : 'Mobilitätseintrag hinzufügen'
      }
      onClose={onClose}
      onSubmit={submit}
    >
      <div className="rr-m-grid">
        <Field label="Art">
          <Select value={kind} onChange={chooseKind}>
            {Object.entries(kinds).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Reisetag / Datum">
          <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Bezeichnung" full>
          <input
            autoFocus
            value={title}
            maxLength={180}
            placeholder={kind === 'fuel' ? 'z. B. Tankstopp in Bergen' : kinds[kind]}
            onChange={(e) => setTitle(e.target.value)}
          />
        </Field>
        {kind === 'fuel' && (
          <>
            <Field label="Getankte Liter">
              <input
                type="number"
                required
                min="0.001"
                step="0.001"
                inputMode="decimal"
                value={litres}
                onChange={(e) => setLitres(e.target.value)}
              />
            </Field>
            <Field label="Kilometerstand (km)">
              <input
                type="number"
                required
                min="0"
                step="0.001"
                inputMode="decimal"
                value={km}
                onChange={(e) => setKm(e.target.value)}
              />
            </Field>
          </>
        )}
        {transit && (
          <>
            <Field label="Start">
              <input value={origin} placeholder="Abfahrtsort" onChange={(e) => setOrigin(e.target.value)} />
            </Field>
            <Field label="Ziel">
              <input
                value={destination}
                placeholder="Ankunftsort"
                onChange={(e) => setDestination(e.target.value)}
              />
            </Field>
            <Field label="Abfahrt">
              <input
                type="datetime-local"
                value={dep}
                onChange={(e) => {
                  setDep(e.target.value)
                  if (e.target.value) setDate(e.target.value.slice(0, 10))
                }}
              />
            </Field>
            <Field label="Ankunft">
              <input
                type="datetime-local"
                min={dep || undefined}
                value={arr}
                onChange={(e) => setArr(e.target.value)}
              />
            </Field>
          </>
        )}
        {data.places.length > 0 && (
          <Field full label="Zugehöriger Stopp">
            <Select value={stop} onChange={setStop}>
              <option value="">Ohne Zuordnung</option>
              {data.places.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <MoneyFields
          label={paid ? 'Gezahlter Betrag' : 'Geplante Kosten'}
          optional={!paid}
          base={data.trip.currency}
          value={amount}
          onChange={setAmount}
        />
        <div className="rr-m-tag-field">
          <TagEditor value={tags} onChange={setTags} suggestions={tripTags(data)} />
        </div>
        <Field full label="Notizen">
          <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <div className="rr-m-field wide rr-m-checks">
          <label>
            <input type="checkbox" checked={done} onChange={(e) => setDone(e.target.checked)} /> Erledigt
          </label>
          <label>
            <input type="checkbox" checked={paid} onChange={(e) => setPaid(e.target.checked)} /> Bezahlt
          </label>
        </div>
      </div>
    </Modal>
  )
}

export default function Mobility({ startFuel, onHandled }: { startFuel: boolean; onHandled: () => void }) {
  const { data, save } = useTrip()
  const [filter, setFilter] = useState<'all' | 'fuel' | 'trips'>('all')
  const [editor, setEditor] = useState<{ item?: Ride; fuel?: boolean } | null>(null)
  const [remove, setRemove] = useState<Ride | null>(null)
  const [finish, setFinish] = useState<Ride | null>(null)
  const fuel = data.mobility.filter((r) => r.kind === 'fuel')
  const total = data.expenses
    .filter((e) => e.source_type === 'mobility' && e.status === 'paid')
    .reduce((n, e) => n + e.base_amount, 0)
  const visible = data.mobility
    .filter((r) => filter === 'all' || (filter === 'fuel' ? r.kind === 'fuel' : r.kind !== 'fuel'))
    .slice()
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || b.id - a.id)
  const close = () => {
    setEditor(null)
    if (startFuel) onHandled()
  }
  return (
    <div className="rr-module">
      <Header
        title="Auto & Verkehr"
        description="Tankstopps, Überfahrten und weitere Wege deiner Reise."
        action="Eintrag hinzufügen"
        onAction={() => setEditor({})}
      />
      <div className="rr-m-metrics">
        <Metric icon={Fuel} label="Tankstopps" value={String(fuel.length)} />
        <Metric
          icon={Droplet}
          label="Getankte Menge"
          value={`${qty(fuel.reduce((n, r) => n + (r.quantity || 0), 0))} l`}
        />
        <Metric icon={Wallet} label="Bereits bezahlt" value={moneyLabel(total, data.trip.currency)} />
      </div>
      <Card
        title="Fahrtenbuch"
        action={
          <Tabs
            value={filter}
            onChange={setFilter}
            tabs={[
              { value: 'all', label: 'Alle' },
              { value: 'fuel', label: 'Tankbuch' },
              { value: 'trips', label: 'Fahrten & Kosten' },
            ]}
          />
        }
      >
        <TaggedList
          items={visible}
          emptyIcon={Gauge}
          emptyText="Hier findest du deine erfassten Fahrten, Tankstopps und Verkehrskosten."
        >
          {(r) => {
            const e = data.expenses.find((v) => v.id === r.expense_id)
            const details = [
              kinds[r.kind],
              todayLabel(r.date),
              r.kind === 'fuel' && r.quantity != null ? `${qty(r.quantity)} l` : '',
              r.kind === 'fuel' && r.odometer != null ? `${qty(r.odometer)} km` : '',
            ].filter(Boolean)
            return (
              <Row
                key={r.id}
                target={{kind: 'mobility', id: r.id}}
                icon={icons[r.kind] ?? CarFront}
                title={r.title}
                sub={details.join(' · ')}
                amount={e ? moneyLabel(e.base_amount, data.trip.currency) : undefined}
                detail={
                  e?.currency && e.currency !== data.trip.currency
                    ? moneyLabel(e.amount, e.currency)
                    : undefined
                }
                actions={
                  <>
                    {!r.done && (
                      <IconButton
                        icon={Check}
                        label={`${r.title} als erledigt markieren`}
                        onClick={() => setFinish(r)}
                      />
                    )}
                    <IconButton
                      icon={Pencil}
                      label={`${r.title} bearbeiten`}
                      onClick={() => setEditor({ item: r })}
                    />
                    <IconButton
                      icon={Trash2}
                      label={`${r.title} löschen`}
                      onClick={() => setRemove(r)}
                      danger
                    />
                  </>
                }
              >
                {(r.origin || r.destination) && (
                  <small className="rr-m-journey">
                    <MapPin size={13} />
                    {[r.origin, r.destination].filter(Boolean).join(' → ')}
                  </small>
                )}
                {(r.departure || r.arrival) && (
                  <small>{[timeLabel(r.departure), timeLabel(r.arrival)].filter(Boolean).join(' – ')}</small>
                )}
                <Status done={!!r.done} label={r.done ? 'Erledigt' : 'Offen'} />
                {e && (
                  <span className="rr-m-inline-note">
                    {e.status === 'paid' ? 'Bezahlt' : 'Zahlung geplant'}
                  </span>
                )}
                <TagChips tags={r.tags} />
              </Row>
            )
          }}
        </TaggedList>
      </Card>
      {(editor || startFuel) && (
        <RideForm item={editor?.item} fuel={startFuel || editor?.fuel} onClose={close} />
      )}{' '}
      {finish && (
        <Modal
          title="Eintrag abhaken"
          save="Als erledigt markieren"
          onClose={() => setFinish(null)}
          onSubmit={async () => {
            await save(`mobility/${finish.id}`, 'PATCH', { done: true }, 'Eintrag abgehakt.')
            setFinish(null)
          }}
        >
          <p>„{finish.title}“ als erledigt markieren?</p>
        </Modal>
      )}{' '}
      {remove && (
        <Modal
          title="Mobilitätseintrag löschen?"
          save="Löschen"
          danger
          onClose={() => setRemove(null)}
          onSubmit={async () => {
            await save(`mobility/${remove.id}`, 'DELETE', undefined, 'Eintrag gelöscht.')
            setRemove(null)
          }}
        >
          <p>„{remove.title}“ mit der zugehörigen Buchung entfernen?</p>
        </Modal>
      )}
    </div>
  )
}
