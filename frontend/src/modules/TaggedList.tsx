import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { useTagView } from '../Tags'
import { Empty } from './ui'

export default function TaggedList<T extends { tags: string[] }>({
  items,
  emptyText,
  emptyIcon,
  children,
}: {
  items: T[]
  emptyText: string
  emptyIcon: LucideIcon
  children: (item: T) => ReactNode
}) {
  const view = useTagView(items)
  return (
    <>
      {view.controls && <div className="rr-m-list-controls">{view.controls}</div>}
      {view.filtered.length === 0 ? (
        <Empty icon={emptyIcon} text={view.active ? 'Keine passenden Einträge für diesen Tag.' : emptyText} />
      ) : (
        view.groups.map((group) => (
          <div key={group.key} className="rr-m-list-group">
            {view.grouped && <h3 className="rr-m-group-name">{group.label}</h3>}
            {group.items.map(children)}
          </div>
        ))
      )}
    </>
  )
}
