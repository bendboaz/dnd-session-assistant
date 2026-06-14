// Public surface of the STT layer (WP-B).
//
// WP-C wires the app against this barrel: `createProvider(name)` plus the
// contract types from `./types`. Concrete provider classes are exported too for
// the dev/A-B harness and tests.

export type {
  SttProvider,
  SttProviderName,
  SttState,
  SttCallbacks,
  TranscriptSegment,
  SttTokenResponse,
} from './types'

export { createProvider } from './createProvider'
export type { ProviderName, CreateProviderOptions } from './createProvider'

export { SonioxProvider } from './SonioxProvider'
export { DeepgramProvider } from './DeepgramProvider'
export { FakeSttProvider, DEFAULT_SCRIPT } from './FakeSttProvider'
export type { FakeSttOptions, FakeScriptLine } from './FakeSttProvider'

export { startMic, MIC_SAMPLE_RATE, MIC_CHANNELS } from './mic'
export type { MicCapture, MicOptions } from './mic'
