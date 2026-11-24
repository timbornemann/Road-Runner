import { api, type TripData } from './shared'
import { ModuleContext } from './modules/context'
import Finance from './modules/Finance'
import Mobility from './modules/Mobility'
import Pantry from './modules/Pantry'
import Purchases from './modules/Purchases'
import './modules.css'

interface Props {
  page: 'finance' | 'pantry' | 'purchases' | 'mobility'
  data: TripData
  reload: () => Promise<void>
  notify: (s: string) => void
  quickAction?: string
  onQuickHandled: () => void
}
export default function Modules({ page, data, reload, notify, quickAction, onQuickHandled }: Props) {
  async function save(path: string, method: string, body: unknown, message: string) {
    await api(`/api/trips/${data.trip.id}/${path}`, method, body)
    try {
      await reload()
    } catch {
      notify(`${message} Die Ansicht konnte noch nicht aktualisiert werden.`)
      return
    }
    notify(message)
  }
  return (
    <ModuleContext.Provider value={{ data, save }}>
      <div key={data.trip.id} className={'module-workspace module-' + page}>
        {page === 'finance' ? (
          <Finance startExpense={quickAction === 'expense'} onHandled={onQuickHandled} />
        ) : page === 'mobility' ? (
          <Mobility startFuel={quickAction === 'fuel'} onHandled={onQuickHandled} />
        ) : page === 'pantry' ? (
          <Pantry />
        ) : (
          <Purchases />
        )}
      </div>
    </ModuleContext.Provider>
  )
}
