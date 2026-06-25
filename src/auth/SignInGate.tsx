// Gate that wraps the whole app: shows a spinner while auth state is loading,
// shows a sign-in screen when no user is present, renders children when signed in.
// Matches the dark D&D theme (see src/index.css for CSS variables).

import type { ReactNode } from 'react'
import { useState } from 'react'
import { useAuth } from './useAuth'
import { authDisabled } from './firebase'

interface Props {
  children: ReactNode
}

export function SignInGate({ children }: Props) {
  // All hooks must run unconditionally (Rules of Hooks) — keep them above any
  // early return.
  const { user, loading, signIn } = useAuth()
  const [signingIn, setSigningIn] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // LOCAL DEV: when auth is disabled, render the app with no gate at all.
  if (authDisabled()) return <>{children}</>

  if (loading) {
    // Reuse the same spinner style as LoadingScreen to keep the UX consistent.
    return (
      <div className="flex min-h-full flex-col items-center justify-center gap-4 p-6 text-center">
        <h1 className="text-2xl font-bold text-[var(--color-accent-2)]">
          D&amp;D Session Assistant
        </h1>
        <div className="flex items-center gap-3 text-[var(--color-ink-dim)]">
          <span
            className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--color-border)] border-t-[var(--color-accent-2)]"
          />
          <span>Checking sign-in…</span>
        </div>
      </div>
    )
  }

  if (!user) {
    const handleSignIn = () => {
      setError(null)
      setSigningIn(true)
      signIn()
        .catch((err: unknown) => {
          // Ignore the "popup closed by user" case — not an error worth showing.
          const code = (err as { code?: string }).code
          if (code !== 'auth/popup-closed-by-user' && code !== 'auth/cancelled-popup-request') {
            setError(err instanceof Error ? err.message : 'Sign-in failed. Please try again.')
          }
        })
        .finally(() => setSigningIn(false))
    }

    return (
      <div className="flex min-h-full flex-col items-center justify-center gap-6 p-6 text-center">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-bold text-[var(--color-accent-2)]">
            D&amp;D Session Assistant
          </h1>
          <p className="text-[var(--color-ink-dim)]">
            Real-time spell &amp; monster lookup for the table
          </p>
        </div>

        <button
          onClick={handleSignIn}
          disabled={signingIn}
          className="flex min-h-[3rem] min-w-[12rem] items-center justify-center gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-3 text-base font-semibold text-[var(--color-ink)] transition-opacity disabled:opacity-60"
        >
          {signingIn ? (
            <>
              <span
                className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--color-border)] border-t-[var(--color-accent-2)]"
              />
              <span>Signing in…</span>
            </>
          ) : (
            <>
              {/* Google "G" icon (inline SVG, no external dep) */}
              <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
                <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.36-8.16 2.36-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
                <path fill="none" d="M0 0h48v48H0z"/>
              </svg>
              <span>Sign in with Google</span>
            </>
          )}
        </button>

        {error && (
          <p className="max-w-xs text-sm text-[var(--color-accent)]">{error}</p>
        )}
      </div>
    )
  }

  // User is authenticated — render the app.
  return <>{children}</>
}
