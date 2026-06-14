// Factory selecting an SttProvider implementation by name.
//
// 'soniox' | 'deepgram' return the real WebSocket providers (which fetch a
// short-lived token from the backend and stream the mic). 'fake' returns the
// offline scripted provider for UI/dev work with no mic or network — letting
// WP-C build and the A/B harness run before a real backend exists.

import type { SttProvider } from './types'
import { SonioxProvider } from './SonioxProvider'
import { DeepgramProvider } from './DeepgramProvider'
import { FakeSttProvider, type FakeSttOptions } from './FakeSttProvider'

/** Includes 'fake' on top of the real provider names from the contract. */
export type ProviderName = 'soniox' | 'deepgram' | 'fake'

export interface CreateProviderOptions {
  /** Options forwarded to the FakeSttProvider when name === 'fake'. */
  fake?: FakeSttOptions
}

export function createProvider(name: ProviderName, opts: CreateProviderOptions = {}): SttProvider {
  switch (name) {
    case 'soniox':
      return new SonioxProvider()
    case 'deepgram':
      return new DeepgramProvider()
    case 'fake':
      return new FakeSttProvider(opts.fake)
    default: {
      // Exhaustiveness guard: a new name must be handled here.
      const _never: never = name
      throw new Error(`Unknown STT provider: ${String(_never)}`)
    }
  }
}
