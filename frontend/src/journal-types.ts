export interface JournalMedia {
  id: number
  filename: string
  mime_type: string
  size: number
  url: string
}

export interface JournalEntry {
  id: number
  trip_id: number
  date: string
  title: string
  text: string
  stop_ids: number[]
  media: JournalMedia[]
}
