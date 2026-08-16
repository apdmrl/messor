import { createContext, useContext } from 'react'
import type { UserSummary } from '../features/auth/types'

export type SessionState =
  | { status: 'loading' }
  | { status: 'anonymous' }
  | { status: 'authenticated'; user: UserSummary }
  | { status: 'error' }

export interface SessionContextValue {
  session: SessionState
  bootstrap: () => void
  handleAuthenticated: (user: UserSummary) => void
  handleLogout: () => Promise<void>
  logoutPending: boolean
  logoutError: string | null
}

export const SessionContext = createContext<SessionContextValue | null>(null)

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext)
  if (ctx === null) {
    throw new Error('useSession must be used within a SessionContext provider')
  }
  return ctx
}
