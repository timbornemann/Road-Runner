import { useState } from 'react'
import { TagChips, TagEditor, tripTags } from '../Tags'
import TaggedList from './TaggedList'
import {
  Banknote,
  CalendarClock,
  Check,
  CircleDollarSign,
  Pencil,
  ReceiptText,
  Trash2,
  Wallet,
  type LucideIcon,
  ShoppingBag,
  Fuel,
  BedDouble,
  CarFront,
  Utensils,
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
  categories,
  dayNow,
  moneyLabel,
  qty,
  todayLabel,
} from './ui'
import { useTrip, type Expense } from './context'
import { MoneyFields, paymentBody, paymentValue } from './money'

const categoryIcons: Record<string, LucideIcon> = {
  mobility: CarFront,
  food: Utensils,
  purchase: ShoppingBag,
  lodging: BedDouble,
}
type Editor = { item?: Expense; pay?: boolean }

function ExpenseForm({ item, pay, onClose }: Editor & { onClose: () => void }) {
  const { data, save } = useTrip()
  const base = data.trip.currency
  const [title, setTitle] = useState(item?.title ?? '')
  const [date, setDate] = useState(pay ? dayNow() : item?.date || dayNow())
  const [category, setCategory] = useState(item?.category || 'other')
  const [status, setStatus] = useState<string>(pay ? 'paid' : item?.status || 'paid')
  const [tags, setTags] = useState(item?.tags ?? [])
  const [notes, setNotes] = useState(item?.notes || '')
  const [amount, setAmount] = useState(paymentValue(base, item?.amount, item?.currency, item?.exchange_rate))
  async function submit() {
    await save(
      item ? `expenses/${item.id}` : 'expenses',
      item ? 'PATCH' : 'POST',
      { title: title.trim(), date, category, status, notes, tags, ...paymentBody(amount, base) },
      item ? 'Buchung aktualisiert.' : 'Ausgabe erfasst.',
    )
    onClose()
  }
  return (
    <Modal
      title={pay ? 'Zahlung bestätigen' : item ? 'Buchung bearbeiten' : 'Ausgabe erfassen'}
      onClose={onClose}
      onSubmit={submit}
      save={pay ? 'Als bezahlt speichern' : 'Speichern'}
    >
      <div className="rr-m-grid">
        <Field full label="Bezeichnung">
          <input
            autoFocus
            required
            maxLength={180}
            placeholder="z. B. Eintritt Nationalpark"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </Field>
        <Field label="Kategorie">
          <Select value={category} onChange={setCategory}>
            {!categories[category] && <option value={category}>{category}</option>}
            {Object.entries(categories).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Datum">
          <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <MoneyFields value={amount} base={base} onChange={setAmount} />
        <Field full label="Zahlungsstatus">
          <Select value={status} onChange={setStatus}>
            <option value="paid">Bezahlt</option>
            {item?.source_type !== 'shopping' && <option value="planned">Geplant</option>}
          </Select>
        </Field>
        <div className="rr-m-tag-field">
          <TagEditor value={tags} onChange={setTags} suggestions={tripTags(data)} />
        </div>
        <Field full label="Notizen">
          <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
      {!!item?.items?.length && (
        <div className="rr-m-receipt">
          <h3>Artikel auf diesem Bon</h3>
          {item.items.map((line, idx) => (
            <p key={idx}>
              <span>{line.name}</span>
              <span>
                {qty(line.quantity)} {line.unit}
              </span>
            </p>
          ))}
        </div>
      )}
    </Modal>
  )
}

export default function Finance({
  startExpense,
  onHandled,
}: {
  startExpense: boolean
  onHandled: () => void
}) {
  const { data, save } = useTrip()
  const [filter, setFilter] = useState<'all' | 'planned' | 'paid'>('all')
  const [editor, setEditor] = useState<Editor | null>(null)
  const [remove, setRemove] = useState<Expense | null>(null)
  const base = data.trip.currency
  const paid = data.expenses.reduce((n, e) => n + (e.status === 'paid' ? e.base_amount : 0), 0)
  const planned = data.expenses.reduce((n, e) => n + (e.status === 'planned' ? e.base_amount : 0), 0)
  const remaining = data.trip.budget - paid - planned
  const total = data.trip.budget
  const visible = data.expenses
    .filter((e) => filter === 'all' || filter === e.status)
    .slice()
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || b.id - a.id)
  const booked = Math.min(100, Math.max(0, total > 0 ? (paid / total) * 100 : 0))
  const reserved = Math.min(100 - booked, Math.max(0, total > 0 ? (planned / total) * 100 : 0))
  const close = () => {
    setEditor(null)
    if (startExpense) onHandled()
  }
  return (
    <div className="rr-module">
      <Header
        title="Finanzen"
        description="Dein Budget, geplante Kosten und Zahlungen für diese Reise."
        action="Ausgabe erfassen"
        onAction={() => setEditor({})}
      />
      <div className="rr-m-metrics">
        <Metric icon={Banknote} label="Bereits bezahlt" value={moneyLabel(paid, base)} />
        <Metric icon={CalendarClock} label="Noch geplant" value={moneyLabel(planned, base)} />
        <Metric icon={Wallet} label="Nach Planung verfügbar" value={moneyLabel(remaining, base)} />
      </div>
      <section className="rr-m-budget">
        <div>
          <strong>Reisebudget</strong>
          <span>{moneyLabel(total, base)}</span>
        </div>
        <div className="rr-m-track" aria-hidden="true">
          <span style={{ width: `${booked}%` }} />
          <i style={{ width: `${reserved}%` }} />
        </div>
        <small>{moneyLabel(paid + planned, base)} durch Buchungen belegt</small>
      </section>
      <Card
        title="Ausgabenbuch"
        action={
          <Tabs
            value={filter}
            onChange={setFilter}
            tabs={[
              { value: 'all', label: 'Alle' },
              { value: 'planned', label: 'Geplant' },
              { value: 'paid', label: 'Bezahlt' },
            ]}
          />
        }
      >
        <TaggedList
          items={visible}
          emptyIcon={ReceiptText}
          emptyText={
            filter === 'all'
              ? 'Hier erscheinen deine Ausgaben und geplanten Kosten.'
              : 'Keine Buchungen mit diesem Status.'
          }
        >
          {(e) => (
            <Row
              key={e.id}
              icon={categoryIcons[e.category] ?? (e.source_type === 'mobility' ? Fuel : CircleDollarSign)}
              title={e.title}
              sub={`${todayLabel(e.date)} · ${categories[e.category] ?? e.category}`}
              amount={moneyLabel(e.base_amount, base)}
              detail={e.currency !== base ? moneyLabel(e.amount, e.currency) : undefined}
              actions={
                <>
                  {e.status === 'planned' && (
                    <IconButton
                      icon={Check}
                      label={`${e.title} bezahlen`}
                      onClick={() => setEditor({ item: e, pay: true })}
                    />
                  )}
                  <IconButton
                    icon={Pencil}
                    label={`${e.title} bearbeiten`}
                    onClick={() => setEditor({ item: e })}
                  />
                  <IconButton
                    icon={Trash2}
                    label={`${e.title} löschen`}
                    onClick={() => setRemove(e)}
                    danger
                  />
                </>
              }
            >
              <Status done={e.status === 'paid'} />
              <TagChips tags={e.tags} />
            </Row>
          )}
        </TaggedList>
      </Card>
      {(editor || startExpense) && <ExpenseForm item={editor?.item} pay={editor?.pay} onClose={close} />}{' '}
      {remove && (
        <Modal
          title="Buchung löschen?"
          save="Löschen"
          danger
          onClose={() => setRemove(null)}
          onSubmit={async () => {
            await save(`expenses/${remove.id}`, 'DELETE', undefined, 'Buchung gelöscht.')
            setRemove(null)
          }}
        >
          <p>„{remove.title}“ aus dem Ausgabenbuch entfernen?</p>
        </Modal>
      )}
    </div>
  )
}
