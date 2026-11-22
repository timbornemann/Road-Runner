import { Field, moneyLabel } from './ui'

export type PaymentValue = { amount: string; currency: string; rate: string }
export function paymentValue(
  base: string,
  amount?: number | null,
  currency?: string | null,
  rate?: number | null,
): PaymentValue {
  return { amount: amount == null ? '' : String(amount), currency: currency || base, rate: String(rate || 1) }
}
export function paymentBody(value: PaymentValue, base: string) {
  return {
    amount: Number(value.amount),
    currency: value.currency.toUpperCase(),
    exchange_rate: value.currency.toUpperCase() === base ? 1 : Number(value.rate),
  }
}
const commonCurrencies = [
  'EUR',
  'USD',
  'GBP',
  'CHF',
  'NOK',
  'SEK',
  'DKK',
  'ISK',
  'PLN',
  'CZK',
  'HUF',
  'RON',
  'BGN',
  'TRY',
  'CAD',
  'AUD',
  'JPY',
  'NZD',
]
export function MoneyFields({
  value,
  base,
  onChange,
  label = 'Betrag',
  optional = false,
}: {
  value: PaymentValue
  base: string
  onChange: (v: PaymentValue) => void
  label?: string
  optional?: boolean
}) {
  const local = value.currency.toUpperCase()
  const foreign = local !== base && local.length === 3
  return (
    <>
      <Field label={label}>
        <input
          type="number"
          min={optional ? '0' : '0.01'}
          step="0.01"
          inputMode="decimal"
          required={!optional}
          placeholder="0,00"
          value={value.amount}
          onChange={(e) => onChange({ ...value, amount: e.target.value })}
        />
      </Field>
      <Field label="Währung">
        <input
          list="rr-currencies"
          required
          pattern="[A-Z]{3}"
          title="Dreistelliger Währungscode, z. B. EUR"
          maxLength={3}
          value={value.currency}
          onChange={(e) => {
            const currency = e.target.value.toUpperCase()
            onChange({ ...value, currency, rate: currency === base ? '1' : '' })
          }}
        />
        <datalist id="rr-currencies">
          {commonCurrencies.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </Field>
      {foreign && (
        <Field
          full
          label={`Wechselkurs · 1 ${local} = … ${base}`}
          hint={
            Number(value.amount) > 0 && Number(value.rate) > 0
              ? `Gegenwert im Reisebudget: ${moneyLabel(Number(value.amount) * Number(value.rate), base)}`
              : undefined
          }
        >
          <input
            type="number"
            required
            value={value.rate}
            min="0.0000000001"
            step="any"
            inputMode="decimal"
            onChange={(e) => onChange({ ...value, rate: e.target.value })}
          />
        </Field>
      )}
    </>
  )
}
