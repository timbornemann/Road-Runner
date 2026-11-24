export type NotebookKind =
  | 'topic'
  | 'note'
  | 'area'
  | 'stop'
  | 'stage'
  | 'variant'
  | 'purchase'
  | 'pantry'
  | 'shopping'
  | 'mobility'
  | 'expense'
  | 'journal'
export interface NotebookTarget {
  kind: NotebookKind | 'visit'
  id: number
}
export interface NotebookSource {
  kind: 'topic' | 'note'
  id: number
}
export interface NotebookTopic {
  id: number
  trip_id: number
  title: string
  parent_id: number | null
  position: number
}
export interface NotebookNote {
  id: number
  trip_id: number
  title: string
  topic_id: number
  body: string
  position: number
  revision: number
}
export interface NotebookArea {
  id: number
  trip_id: number
  name: string
  stop_ids: number[]
}
export interface NotebookLink {
  id: number
  trip_id: number
  source_type: 'topic' | 'note'
  source_id: number
  target_type: NotebookKind
  target_id: number
}
export interface NotebookData {
  topics: NotebookTopic[]
  notes: NotebookNote[]
  areas: NotebookArea[]
  links: NotebookLink[]
}

export function topicPath(topics: NotebookTopic[], id: number | null) {
  const path: NotebookTopic[] = []
  const seen = new Set<number>()
  while (id !== null && !seen.has(id)) {
    seen.add(id)
    const topic = topics.find((item) => item.id === id)
    if (!topic) break
    path.unshift(topic)
    id = topic.parent_id
  }
  return path
}

export function positionOrder(a: { position: number; id: number }, b: { position: number; id: number }) {
  return a.position - b.position || a.id - b.id
}
