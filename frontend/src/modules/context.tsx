import { createContext, useContext } from 'react'
import type { TripData } from '../shared'

export interface ModuleState {
  data: TripData
  save: (path: string, method: string, body: unknown, message: string) => Promise<void>
}
export const ModuleContext = createContext<ModuleState | null>(null)
export function useTrip() {
  const state = useContext(ModuleContext)
  if (!state) throw new Error('Reise ist nicht geladen.')
  return state
}
export type Expense = TripData['expenses'][number]
export type Purchase = TripData['purchases'][number]
export type Ride = TripData['mobility'][number]
export type Stock = TripData['pantry'][number]
export type Shopping = TripData['shopping'][number]

export function checkoutKey() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (n) => n.toString(16).padStart(2, '0')).join('')
}
