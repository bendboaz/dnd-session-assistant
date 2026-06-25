// React hook that exposes the Firebase auth state as { user, loading, signIn, signOut }.
// Uses onAuthStateChanged so the app reacts immediately when the SDK restores a
// persisted session (no flicker to the sign-in screen on reload).

import { useEffect, useState } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import { auth as getAuth, authDisabled, signInWithGoogle, signOut } from './firebase'
import type { User } from './firebase'

export interface AuthState {
  /** The signed-in Firebase user, or null when signed out. */
  user: User | null
  /** True while the SDK is resolving the initial auth state (first render). */
  loading: boolean
  /** Trigger a Google sign-in popup. */
  signIn: () => Promise<void>
  /** Sign the current user out. */
  signOut: () => Promise<void>
}

export function useAuth(): AuthState {
  // Start in loading state — we don't know yet whether a session is persisted.
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Dev-bypass: don't init the SDK; settle immediately as "no user". The
    // SignInGate renders children regardless when auth is disabled.
    if (authDisabled()) {
      setLoading(false)
      return
    }
    const unsubscribe = onAuthStateChanged(getAuth(), (next) => {
      setUser(next)
      setLoading(false)
    })
    return unsubscribe
  }, [])

  return { user, loading, signIn: signInWithGoogle, signOut }
}
