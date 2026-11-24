import { useState } from 'react'
import { TagChips, TagEditor, tripTags } from '../Tags'
import TaggedList from './TaggedList'
import {
  Check,
  CheckCheck,
  ClipboardList,
  ListTodo,
  PackageCheck,
  Pencil,
  ShoppingBag,
  Trash2,
  Wallet,
} from 'lucide-react'
import {
  Card,
  Field,
  Header,
  IconButton,
  Metric,
  Modal,
  Row,
  Status,
  Tabs,
  dayNow,
  moneyLabel,
  qty,
} from './ui'
import { useTrip, type Purchase } from './context'
import { MoneyFields, paymentBody, paymentValue } from './money'

export function PurchaseForm({
  item,
  complete,
  onClose,
}: {
  item?: Purchase
  complete?: boolean
  onClose: () => void
}) {
  const { data, save } = useTrip()
  const expense = data.expenses.find((e) => e.id === item?.expense_id)
  const [title, setTitle] = useState(item?.title || '')
  const [count, setCount] = useState(String(item?.quantity ?? 1))
  const [unit, setUnit] = useState(item?.unit || 'Stk.')
  const [tags, setTags] = useState(item?.tags ?? [])
  const [notes, setNotes] = useState(item?.notes || '')
  const [done, setDone] = useState(complete || !!item?.done)
  const [paid, setPaid] = useState(complete || !!item?.paid)
  const [amount, setAmount] = useState(
    paymentValue(
      data.trip.currency,
      expense?.amount ?? (item?.estimated_cost || undefined),
      expense?.currency ?? item?.currency,
      expense?.exchange_rate ?? item?.exchange_rate,
    ),
  )
  async function submit() {
    const cost = paymentBody(amount, data.trip.currency)
    await save(
      item ? `purchases/${item.id}` : 'purchases',
      item ? 'PATCH' : 'POST',
      {
        title: title.trim(),
        quantity: Number(count),
        unit,
        notes,
        tags,
        done,
        paid,
        estimated_cost: cost.amount,
        currency: cost.currency,
        exchange_rate: cost.exchange_rate,
        ...(complete ? { date: dayNow() } : {}),
      },
      complete ? 'Kauf abgeschlossen.' : 'Anschaffung gespeichert.',
    )
    onClose()
  }
  return (
    <Modal
      title={complete ? 'Kauf abschließen' : item ? 'Anschaffung bearbeiten' : 'Anschaffung planen'}
      onClose={onClose}
      onSubmit={submit}
      save={complete ? 'Kauf abschließen' : 'Speichern'}
    >
      <div className="rr-m-grid">
        <Field full label="Anschaffung">
          <input
            autoFocus
            required
            maxLength={180}
            value={title}
            placeholder="z. B. Gaskocher"
            onChange={(e) => setTitle(e.target.value)}
          />
        </Field>
        <Field label="Menge">
          <input
            type="number"
            min="0.001"
            step="0.001"
            required
            value={count}
            onChange={(e) => setCount(e.target.value)}
          />
        </Field>
        <Field label="Einheit">
          <input value={unit} placeholder="Stk." onChange={(e) => setUnit(e.target.value)} />
        </Field>
        <MoneyFields
          value={amount}
          base={data.trip.currency}
          onChange={setAmount}
          label={paid ? 'Tatsächlicher Gesamtpreis' : 'Geschätzter Gesamtpreis'}
          optional={!complete && !paid}
        />
        <div className="rr-m-tag-field">
          <TagEditor value={tags} onChange={setTags} suggestions={tripTags(data)} />
        </div>
        <Field full label="Notizen">
          <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        {!complete && (
          <div className="rr-m-field wide rr-m-checks">
            <label>
              <input type="checkbox" checked={done} onChange={(e) => setDone(e.target.checked)} /> Anschaffung
              erledigt
            </label>
            <label>
              <input type="checkbox" checked={paid} onChange={(e) => setPaid(e.target.checked)} /> Bereits
              bezahlt
            </label>
          </div>
        )}
      </div>
    </Modal>
  )
}

export default function Purchases() {
  const { data, save } = useTrip()
  const [filter, setFilter] = useState<'all' | 'open' | 'done'>('all')
  const [editor, setEditor] = useState<{ item?: Purchase; complete?: boolean } | null>(null)
  const [remove, setRemove] = useState<Purchase | null>(null)
  const open = data.purchases.filter((p) => !p.done)
  const planned = data.expenses
    .filter((e) => e.source_type === 'purchases' && e.status === 'planned')
    .reduce((v, e) => v + e.base_amount, 0)
  const visible = data.purchases
    .filter((p) => filter === 'all' || (filter === 'done' ? p.done : !p.done))
    .slice()
    .sort((a, b) => Number(a.done) - Number(b.done) || b.id - a.id)
  return (
    <div className="rr-module">
      <Header
        title="Anschaffungen"
        description="Plane deine Ausrüstung und behalte offene Käufe im Blick."
        action="Anschaffung planen"
        onAction={() => setEditor({})}
      />
      <div className="rr-m-metrics">
        <Metric icon={ListTodo} label="Noch offen" value={String(open.length)} />
        <Metric icon={PackageCheck} label="Erledigt" value={String(data.purchases.length - open.length)} />
        <Metric icon={Wallet} label="Geplante Kosten" value={moneyLabel(planned, data.trip.currency)} />
      </div>
      <Card
        title="Anschaffungsliste"
        action={
          <Tabs
            value={filter}
            onChange={setFilter}
            tabs={[
              { value: 'all', label: 'Alle' },
              { value: 'open', label: 'Offen' },
              { value: 'done', label: 'Erledigt' },
            ]}
          />
        }
      >
        <TaggedList
          items={visible}
          emptyIcon={ClipboardList}
          emptyText={
            filter === 'all'
              ? 'Trage ein, was du für deine Reise noch besorgen möchtest.'
              : 'Keine Anschaffungen mit diesem Status.'
          }
        >
          {(p) => {
            const e = data.expenses.find((x) => x.id === p.expense_id)
            return (
              <Row
                key={p.id}
                target={{kind: 'purchase', id: p.id}}
                icon={p.done ? CheckCheck : ShoppingBag}
                title={p.title}
                sub={`${qty(p.quantity)} ${p.unit || 'Stk.'}${p.notes ? ` · ${p.notes}` : ''}`}
                amount={e ? moneyLabel(e.base_amount, data.trip.currency) : undefined}
                detail={
                  e?.currency && e.currency !== data.trip.currency
                    ? moneyLabel(e.amount, e.currency)
                    : undefined
                }
                actions={
                  <>
                    {!p.done && (
                      <IconButton
                        icon={Check}
                        label={`${p.title} als gekauft abhaken`}
                        onClick={() => setEditor({ item: p, complete: true })}
                      />
                    )}
                    <IconButton
                      icon={Pencil}
                      label={`${p.title} bearbeiten`}
                      onClick={() => setEditor({ item: p })}
                    />
                    <IconButton
                      icon={Trash2}
                      label={`${p.title} löschen`}
                      onClick={() => setRemove(p)}
                      danger
                    />
                  </>
                }
              >
                <Status done={!!p.done} label={p.done ? 'Erledigt' : 'Offen'} />
                {e && (
                  <span className="rr-m-inline-note">
                    {e.status === 'paid' ? 'Bezahlt' : 'Zahlung geplant'}
                  </span>
                )}
                <TagChips tags={p.tags} />
              </Row>
            )
          }}
        </TaggedList>
      </Card>
      {editor && <PurchaseForm {...editor} onClose={() => setEditor(null)} />}{' '}
      {remove && (
        <Modal
          title="Anschaffung löschen?"
          save="Löschen"
          danger
          onClose={() => setRemove(null)}
          onSubmit={async () => {
            await save(`purchases/${remove.id}`, 'DELETE', undefined, 'Anschaffung gelöscht.')
            setRemove(null)
          }}
        >
          <p>„{remove.title}“ mit der zugehörigen Buchung entfernen?</p>
        </Modal>
      )}
    </div>
  )
}
