// Offline STT provider that replays a scripted transcript on a timer.
//
// This needs neither a microphone nor a backend/network, so the UI (WP-C) and
// the matching engine (WP-A) can be exercised end-to-end during development and
// in the Soniox-vs-Deepgram A/B harness before a real provider is wired up. It
// faithfully drives the SttProvider lifecycle: idle → connecting → listening,
// emits interim then final TranscriptSegments per scripted line, and supports
// stop()/restart and a no-op setKeyterms().

import type {
  SttCallbacks,
  SttProvider,
  SttProviderName,
  SttState,
  TranscriptSegment,
} from './types'

/** A single scripted utterance. */
export interface FakeScriptLine {
  /** The (final) text for this line — Hebrew with embedded English terms. */
  text: string
  /** Delay in ms after the previous line before this one is emitted. */
  delayMs: number
  /**
   * If true (default), an interim segment is emitted shortly before the final
   * to mimic a real provider's streaming behaviour. Set false for terse lines.
   */
  interim?: boolean
}

export interface FakeSttOptions {
  /** Script to replay. Defaults to {@link DEFAULT_SCRIPT}. */
  script?: FakeScriptLine[]
  /** Replay the script in a loop (default false — emits once then idles). */
  loop?: boolean
  /** Lead time for the interim segment before its final (default 350 ms). */
  interimLeadMs?: number
}

/**
 * A realistic mixed Hebrew + English D&D table transcript. The English terms
 * (fireball, beholder, Tasha's Hideous Laughter, …) are exactly what the
 * matcher should pick out of the surrounding Hebrew narration.
 */
export const DEFAULT_SCRIPT: FakeScriptLine[] = [
  { text: 'טוב חבר׳ה, אנחנו מתחילים את המפגש.', delayMs: 800, interim: false },
  { text: 'הקוסם מרים את היד ומטיל fireball על הגובלינים.', delayMs: 2200 },
  { text: 'הנזק הוא שמונה קוביות d6, כולם עושים זריקת הצלה.', delayMs: 2600 },
  { text: 'פתאום מהחושך מגיח beholder ענק.', delayMs: 2400 },
  { text: 'הוא משתמש ב־eye ray של petrification.', delayMs: 2300 },
  { text: 'הבארד מטיל Tasha\'s Hideous Laughter על האויב.', delayMs: 2600 },
  { text: 'הלוחם שותה potion of healing ומתאושש.', delayMs: 2400 },
  { text: 'הכומר מטיל cure wounds על הריינג׳ר הפצוע.', delayMs: 2500 },
  { text: 'ואז הם נתקלים ב־mind flayer במסדרון.', delayMs: 2300 },
  { text: 'כולם מגלגלים initiative, הקרב מתחיל.', delayMs: 2200 },
]

const FAKE_NAME: SttProviderName = 'soniox'

export class FakeSttProvider implements SttProvider {
  // The contract's `name` is the union of real providers; the fake masquerades
  // as one so the UI's provider-keyed logic stays simple. It is never used to
  // open a real connection.
  readonly name: SttProviderName = FAKE_NAME

  private state: SttState = 'idle'
  private callbacks: SttCallbacks | null = null
  private readonly script: FakeScriptLine[]
  private readonly loop: boolean
  private readonly interimLeadMs: number

  private timers = new Set<ReturnType<typeof setTimeout>>()
  private keyterms: string[] = []

  constructor(opts: FakeSttOptions = {}) {
    this.script = opts.script ?? DEFAULT_SCRIPT
    this.loop = opts.loop ?? false
    this.interimLeadMs = opts.interimLeadMs ?? 350
  }

  getState(): SttState {
    return this.state
  }

  setKeyterms(terms: string[]): void {
    // No-op for matching purposes, but retained so callers (and tests) can
    // observe the most recent set; mirrors the real providers' clamp behaviour.
    this.keyterms = terms.slice(0, 100)
  }

  /** Exposed for dev/inspection; real providers don't expose this. */
  getKeyterms(): string[] {
    return this.keyterms
  }

  start(callbacks: SttCallbacks): Promise<void> {
    if (this.state === 'listening' || this.state === 'connecting') {
      return Promise.resolve()
    }
    this.callbacks = callbacks
    this.setState('connecting')

    // Simulate a brief connect handshake, then begin replay.
    this.schedule(() => {
      this.setState('listening')
      this.replay(0)
    }, 300)

    return Promise.resolve()
  }

  stop(): Promise<void> {
    this.clearTimers()
    this.setState('stopped')
    return Promise.resolve()
  }

  // --- internals ------------------------------------------------------------

  private replay(index: number): void {
    if (index >= this.script.length) {
      if (this.loop) {
        this.schedule(() => this.replay(0), 1500)
      }
      // Otherwise stay in 'listening' (a real mic would keep an open stream).
      return
    }

    const line = this.script[index]
    this.schedule(() => {
      const emitInterim = line.interim ?? true
      if (emitInterim) {
        // A partial interim of the line, then the final shortly after.
        this.emit({ text: truncateWords(line.text), isFinal: false })
        this.schedule(() => {
          this.emit({ text: line.text, isFinal: true })
          this.replay(index + 1)
        }, this.interimLeadMs)
      } else {
        this.emit({ text: line.text, isFinal: true })
        this.replay(index + 1)
      }
    }, line.delayMs)
  }

  private emit(partial: Pick<TranscriptSegment, 'text' | 'isFinal'>): void {
    const seg: TranscriptSegment = { ...partial, ts: Date.now() }
    this.callbacks?.onSegment(seg)
  }

  private schedule(fn: () => void, ms: number): void {
    const id = setTimeout(() => {
      this.timers.delete(id)
      fn()
    }, ms)
    this.timers.add(id)
  }

  private clearTimers(): void {
    for (const id of this.timers) clearTimeout(id)
    this.timers.clear()
  }

  private setState(next: SttState): void {
    if (this.state === next) return
    this.state = next
    this.callbacks?.onStateChange?.(next)
  }
}

/** Roughly the first ~60% of words, to mimic a streaming interim result. */
function truncateWords(text: string): string {
  const words = text.split(/\s+/)
  const take = Math.max(1, Math.ceil(words.length * 0.6))
  return words.slice(0, take).join(' ')
}
