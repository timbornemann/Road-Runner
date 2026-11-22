import { useState } from 'react'
import { TagChips, TagEditor, tripTags } from '../Tags'
import TaggedList from './TaggedList'
import {
  Archive,
  CheckCheck,
  CircleMinus,
  ClipboardList,
  Package,
  Pencil,
  ReceiptText,
  ShoppingBasket,
  ShoppingCart,
  Trash2,
} from 'lucide-react'
import {
  Card,
  Field,
  Header,
  IconButton,
  Metric,
  Modal,
  Row,
  Tabs,
  dayNow,
  moneyLabel,
  qty,
  todayLabel,
} from './ui'
import { checkoutKey, useTrip, type Shopping, type Stock } from './context'
import { MoneyFields, paymentBody, paymentValue } from './money'

type Shelf = 'pantry' | 'shopping'
type Editor = { shelf: Shelf; item?: Stock | Shopping; prefill?: Stock }
function ItemForm({ shelf, item, prefill, onClose }: Editor & { onClose: () => void }) {
  const { data, save } = useTrip()
  const [name, setName] = useState(item?.name || prefill?.name || '')
  const [quantity, setQuantity] = useState(String(item?.quantity ?? 1))
  const [unit, setUnit] = useState(item?.unit || prefill?.unit || 'Stk.')
  const [tags, setTags] = useState(item?.tags ?? prefill?.tags ?? [])
  const stock = shelf === 'pantry'
  async function submit() {
    await save(
      item ? `${shelf}/${item.id}` : shelf,
      item ? 'PATCH' : 'POST',
      { name: name.trim(), quantity: Number(quantity), unit: unit.trim(), tags },
      stock ? 'Vorrat gespeichert.' : 'Einkaufsliste aktualisiert.',
    )
    onClose()
  }
  return (
    <Modal
      title={
        item ? 'Artikel bearbeiten' : stock ? 'Vorrat eintragen' : 'Artikel auf die Einkaufsliste setzen'
      }
      onClose={onClose}
      onSubmit={submit}
    >
      <div className="rr-m-grid">
        <Field full label="Artikel">
          <input
            autoFocus
            required
            value={name}
            maxLength={180}
            list="rr-stock"
            placeholder="z. B. Haferflocken"
            onChange={(e) => {
              setName(e.target.value)
              const match = data.pantry.find((p) => p.name === e.target.value)
              if (match) setUnit(match.unit)
            }}
          />
          <datalist id="rr-stock">
            {Array.from(new Set(data.pantry.map((p) => p.name))).map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
        </Field>
        <Field label="Menge">
          <input
            type="number"
            min={stock ? '0' : '0.001'}
            step="0.001"
            required
            inputMode="decimal"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </Field>
        <Field label="Einheit">
          <input list="rr-unit" maxLength={40} value={unit} onChange={(e) => setUnit(e.target.value)} />
          <datalist id="rr-unit">
            {['Stk.', 'kg', 'g', 'l', 'ml', 'Packung', 'Dose', 'Flasche'].map((u) => (
              <option value={u} key={u} />
            ))}
          </datalist>
        </Field>
        <div className="rr-m-tag-field">
          <TagEditor value={tags} onChange={setTags} suggestions={tripTags(data)} />
        </div>
      </div>
    </Modal>
  )
}
function Consume({ item, onClose }: { item: Stock; onClose: () => void }) {
  const { save } = useTrip()
  const [value, setValue] = useState(String(Math.min(1, item.quantity)))
  return (
    <Modal
      title="Verbrauch abbuchen"
      save="Verbrauch abbuchen"
      onClose={onClose}
      onSubmit={async () => {
        await save(`pantry/${item.id}/consume`, 'POST', { quantity: Number(value) }, 'Verbrauch abgebucht.')
        onClose()
      }}
    >
      <Field
        label={`${item.name} · Verbrauch in ${item.unit || 'Einheiten'}`}
        hint={`Im Vorrat: ${qty(item.quantity)} ${item.unit}`}
      >
        <input
          autoFocus
          type="number"
          inputMode="decimal"
          step="0.001"
          min="0.001"
          max={item.quantity}
          required
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      </Field>
    </Modal>
  )
}
function Checkout({
  items,
  onClose,
  onComplete,
}: {
  items: Shopping[]
  onClose: () => void
  onComplete: () => void
}) {
  const { data, save } = useTrip()
  const [key] = useState(checkoutKey)
  const [amounts, setAmounts] = useState<Record<number, string>>(() =>
    Object.fromEntries(items.map((i) => [i.id, String(i.quantity)])),
  )
  const [title, setTitle] = useState('Lebensmitteleinkauf')
  const [date, setDate] = useState(dayNow)
  const [price, setPrice] = useState(paymentValue(data.trip.currency))
  async function submit() {
    await save(
      'shopping/checkout',
      'POST',
      {
        items: items.map((item) => ({ id: item.id, quantity: Number(amounts[item.id]) })),
        request_id: key,
        title: title.trim(),
        date,
        ...paymentBody(price, data.trip.currency),
      },
      'Einkauf in Vorrat und Ausgabenbuch übernommen.',
    )
    onComplete()
  }
  return (
    <Modal title="Einkauf abschließen" save="Einkauf buchen" onClose={onClose} onSubmit={submit}>
      <div className="rr-m-checkout-items">
        <h3>Gekaufte Mengen</h3>
        {items.map((item) => (
          <Field key={item.id} label={`${item.name} (${item.unit || 'Menge'})`}>
            <input
              type="number"
              aria-label={`Gekaufte Menge ${item.name}`}
              step="0.001"
              required
              min="0.001"
              max={item.quantity}
              value={amounts[item.id]}
              onChange={(e) => setAmounts({ ...amounts, [item.id]: e.target.value })}
            />
          </Field>
        ))}
      </div>
      <div className="rr-m-grid">
        <Field label="Belegbezeichnung" full>
          <input required value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field full label="Einkaufsdatum">
          <input required type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <MoneyFields label="Bon-Gesamtbetrag" value={price} base={data.trip.currency} onChange={setPrice} />
      </div>
    </Modal>
  )
}

export default function Pantry() {
  const { data, save } = useTrip()
  const [tab, setTab] = useState<Shelf>('pantry')
  const [editor, setEditor] = useState<Editor | null>(null)
  const [remove, setRemove] = useState<Editor | null>(null)
  const [consume, setConsume] = useState<Stock | null>(null)
  const [selected, setSelected] = useState<number[]>([])
  const [checkout, setCheckout] = useState<Shopping[] | null>(null)
  const stock = data.pantry.slice().sort((a, b) => a.name.localeCompare(b.name, 'de'))
  const open = data.shopping.filter((i) => !i.done && i.quantity > 0)
  const selection = open.filter((i) => selected.includes(i.id))
  const receipts = data.expenses
    .filter((e) => e.source_type === 'shopping')
    .slice()
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || b.id - a.id)
  const toggle = (id: number) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((n) => n !== id) : [...prev, id]))
  return (
    <div className="rr-module">
      <Header
        title="Vorräte & Einkauf"
        description="Was du dabeihast und was beim nächsten Einkauf fehlt."
        action={tab === 'pantry' ? 'Vorrat eintragen' : 'Artikel hinzufügen'}
        onAction={() => setEditor({ shelf: tab })}
      />
      <div className="rr-m-metrics">
        <Metric
          icon={Archive}
          label="Artikel im Vorrat"
          value={String(data.pantry.filter((p) => p.quantity > 0).length)}
        />
        <Metric icon={ClipboardList} label="Auf der Einkaufsliste" value={String(open.length)} />
        <Metric icon={ReceiptText} label="Einkaufsbelege" value={String(receipts.length)} />
      </div>
      <div className="rr-m-toolrow">
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'pantry', label: 'Vorrat' },
            { value: 'shopping', label: 'Einkaufsliste' },
          ]}
        />
      </div>
      {tab === 'pantry' ? (
        <Card title="Lebensmittelvorrat">
          <TaggedList
            items={stock}
            emptyIcon={Package}
            emptyText="Erfasse die Lebensmittel, die du auf dieser Reise dabeihast."
          >
            {(item) => (
              <Row
                key={item.id}
                icon={Package}
                title={item.name}
                amount={`${qty(item.quantity)} ${item.unit}`}
                actions={
                  <>
                    {item.quantity > 0 && (
                      <IconButton
                        icon={CircleMinus}
                        label={`${item.name} verbrauchen`}
                        onClick={() => setConsume(item)}
                      />
                    )}
                    <IconButton
                      icon={ShoppingCart}
                      label={`${item.name} nachkaufen`}
                      onClick={() => setEditor({ shelf: 'shopping', prefill: item })}
                    />
                    <IconButton
                      icon={Pencil}
                      label={`${item.name} bearbeiten`}
                      onClick={() => setEditor({ shelf: 'pantry', item })}
                    />
                    <IconButton
                      icon={Trash2}
                      label={`${item.name} löschen`}
                      onClick={() => setRemove({ shelf: 'pantry', item })}
                      danger
                    />
                  </>
                }
              >
                <TagChips tags={item.tags} />
              </Row>
            )}
          </TaggedList>
        </Card>
      ) : (
        <>
          <Card
            title="Einkaufsliste"
            action={
              selection.length > 0 ? (
                <button className="rr-m-button primary compact" onClick={() => setCheckout(selection)}>
                  <CheckCheck size={16} />
                  Einkauf abschließen ({selection.length})
                </button>
              ) : undefined
            }
          >
            {open.length > 0 && (
              <p className="rr-m-card-tip">
                Markiere die gekauften Artikel und schließe den Einkauf mit dem Bon-Gesamtbetrag ab.
              </p>
            )}
            <TaggedList items={open} emptyIcon={ShoppingBasket} emptyText="Deine Einkaufsliste ist leer.">
              {(item) => (
                <div className="rr-m-shopping-row" key={item.id}>
                  <label className="rr-m-shopping-check">
                    <input
                      type="checkbox"
                      checked={selected.includes(item.id)}
                      onChange={() => toggle(item.id)}
                    />
                    <span>
                      <strong>{item.name}</strong>
                      <small>
                        {qty(item.quantity)} {item.unit}
                      </small>
                      <TagChips tags={item.tags} />
                    </span>
                  </label>
                  <div className="rr-m-actions">
                    <IconButton
                      icon={Pencil}
                      label={`${item.name} bearbeiten`}
                      onClick={() => setEditor({ shelf: 'shopping', item })}
                    />
                    <IconButton
                      icon={Trash2}
                      label={`${item.name} löschen`}
                      onClick={() => setRemove({ shelf: 'shopping', item })}
                      danger
                    />
                  </div>
                </div>
              )}
            </TaggedList>
          </Card>
          {receipts.length > 0 && (
            <Card title="Einkaufsbelege">
              <TaggedList
                items={receipts}
                emptyIcon={ReceiptText}
                emptyText="Für diese Reise liegen keine Einkaufsbelege vor."
              >
                {(r) => (
                  <Row
                    key={r.id}
                    icon={ReceiptText}
                    title={r.title}
                    sub={todayLabel(r.date)}
                    amount={moneyLabel(r.base_amount, data.trip.currency)}
                    detail={r.currency !== data.trip.currency ? moneyLabel(r.amount, r.currency) : undefined}
                  >
                    <TagChips tags={r.tags} />
                    {!!r.items?.length && (
                      <small>
                        {r.items.map((i) => `${qty(i.quantity)} ${i.unit} ${i.name}`.trim()).join(' · ')}
                      </small>
                    )}
                  </Row>
                )}
              </TaggedList>
            </Card>
          )}
        </>
      )}
      {editor && <ItemForm {...editor} onClose={() => setEditor(null)} />}{' '}
      {consume && <Consume item={consume} onClose={() => setConsume(null)} />}{' '}
      {checkout && (
        <Checkout
          items={checkout}
          onClose={() => setCheckout(null)}
          onComplete={() => {
            setCheckout(null)
            setSelected([])
          }}
        />
      )}{' '}
      {remove?.item && (
        <Modal
          title="Artikel löschen?"
          save="Löschen"
          danger
          onClose={() => setRemove(null)}
          onSubmit={async () => {
            await save(`${remove.shelf}/${remove.item!.id}`, 'DELETE', undefined, 'Artikel gelöscht.')
            setRemove(null)
          }}
        >
          <p>
            „{remove.item.name}“ aus {remove.shelf === 'pantry' ? 'deinem Vorrat' : 'deiner Einkaufsliste'}{' '}
            entfernen?
          </p>
        </Modal>
      )}
    </div>
  )
}
