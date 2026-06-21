/// <reference types="vite/client" />

// Augment ImportMetaEnv with all VITE_* variables used by this project.
// Do NOT add vars to src/stt/types.ts (contract-frozen) — extend here instead.

interface ImportMetaEnv {
  // Backend base URL (empty = same-origin / Vite dev proxy).
  readonly VITE_API_BASE: string | undefined
  // Set to "1" to disable the sign-in gate (LOCAL DEV). Also auto-disabled when
  // no VITE_FIREBASE_API_KEY is configured. Pairs with backend DEV_AUTH_BYPASS.
  readonly VITE_AUTH_BYPASS: string | undefined
  // Which STT provider to request a token for: "soniox" | "deepgram"
  readonly VITE_STT_PROVIDER: string | undefined
  // Firebase web config (non-secret; from Firebase console > Project settings).
  readonly VITE_FIREBASE_API_KEY: string | undefined
  readonly VITE_FIREBASE_AUTH_DOMAIN: string | undefined
  readonly VITE_FIREBASE_PROJECT_ID: string | undefined
  readonly VITE_FIREBASE_APP_ID: string | undefined
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID: string | undefined
  readonly VITE_FIREBASE_STORAGE_BUCKET: string | undefined
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
