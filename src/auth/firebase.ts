// Firebase app + Google Auth initialisation.
// All config values come from env vars so this file contains no project-specific
// hard-codes and can be committed safely. The values are non-secret (they're
// embedded in the public HTML by every Firebase web app), but they ARE
// project-specific — see .env.example.
//
// Initialisation is lazy (first call to `auth`) so importing this module in a
// test environment never triggers a real Firebase SDK init (no valid API key
// exists during tests; callers mock this module directly instead).

import { initializeApp, getApps } from 'firebase/app'
import {
  getAuth as fbGetAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut as fbSignOut,
} from 'firebase/auth'
import type { Auth, User } from 'firebase/auth'

// Re-export so callers don't need to import from firebase/auth directly.
export type { User }

// Cache the Auth instance after the first call so we don't re-init on every use.
let _auth: Auth | null = null

/**
 * Whether the sign-in gate is disabled (LOCAL DEV). True when `VITE_AUTH_BYPASS`
 * is "1", or when no Firebase project is configured at all — so `npm run dev`
 * works zero-config without a real Firebase project or a Google sign-in. This is
 * the frontend twin of the backend's `DEV_AUTH_BYPASS`; never set it in prod.
 * On Cloud Run / Firebase Hosting the build always carries a real API key, so
 * this returns false there.
 */
export function authDisabled(): boolean {
  return (
    import.meta.env.VITE_AUTH_BYPASS === '1' ||
    !import.meta.env.VITE_FIREBASE_API_KEY
  )
}

/**
 * Lazily initialise and return the Firebase Auth singleton.
 * Called at runtime (not at module-load time) so test environments that mock
 * this module never trigger the real SDK init with an empty API key.
 */
export function auth(): Auth {
  if (_auth) return _auth
  const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string,
    appId: import.meta.env.VITE_FIREBASE_APP_ID as string,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string,
  }
  // Guard against double-init in HMR environments.
  const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0]!
  _auth = fbGetAuth(app)
  return _auth
}

const googleProvider = new GoogleAuthProvider()

/** Open the Google sign-in popup. Resolves when the user dismisses or completes. */
export function signInWithGoogle(): Promise<void> {
  return signInWithPopup(auth(), googleProvider).then(() => undefined)
}

/** Sign the current user out. No-op in dev-bypass mode (no SDK to touch). */
export function signOut(): Promise<void> {
  if (authDisabled()) return Promise.resolve()
  return fbSignOut(auth())
}

/**
 * Get a fresh ID token for the currently signed-in user, or null if no user
 * is signed in. The Firebase SDK caches and auto-refreshes the token, so this
 * is cheap to call on every request.
 */
export async function getIdToken(): Promise<string | null> {
  // In dev-bypass mode never touch the SDK (no valid config exists to init).
  if (authDisabled()) return null
  return auth().currentUser ? auth().currentUser!.getIdToken() : null
}
