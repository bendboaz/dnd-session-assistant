// Unit tests for FakeSttProvider.
//
// Covers:
//   1. Full interim → final segment sequence per scripted line.
//   2. State transitions: idle → connecting → listening on start();
//      listening → stopped on stop().

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { FakeSttProvider } from './FakeSttProvider'
import type { SttState, TranscriptSegment } from './types'

// Use fake timers so we don't wait real milliseconds in tests.
beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

// ---------------------------------------------------------------------------
// Helper: collect all state changes + segments from a provider run.
// ---------------------------------------------------------------------------

interface Observation {
  states: SttState[]
  segments: TranscriptSegment[]
}

function observe(provider: FakeSttProvider): Observation {
  const states: SttState[] = []
  const segments: TranscriptSegment[] = []
  provider.start({
    onSegment: (s) => segments.push(s),
    onStateChange: (st) => states.push(st),
  })
  return { states, segments }
}

// ---------------------------------------------------------------------------
// 1. State transitions
// ---------------------------------------------------------------------------

describe('FakeSttProvider — state transitions', () => {
  it('starts in idle', () => {
    const provider = new FakeSttProvider({ script: [] })
    expect(provider.getState()).toBe('idle')
  })

  it('transitions idle → connecting → listening on start()', async () => {
    const provider = new FakeSttProvider({ script: [] })
    const { states } = observe(provider)

    // Immediately after start() the provider is 'connecting'.
    expect(states).toContain('connecting')

    // After the simulated handshake delay, it moves to 'listening'.
    await vi.runAllTimersAsync()
    expect(states).toContain('listening')
    // Final state reflects the sequence.
    expect(provider.getState()).toBe('listening')
  })

  it('transitions listening → stopped on stop()', async () => {
    const provider = new FakeSttProvider({ script: [] })
    const { states } = observe(provider)
    await vi.runAllTimersAsync()

    await provider.stop()
    expect(states[states.length - 1]).toBe('stopped')
    expect(provider.getState()).toBe('stopped')
  })

  it('emits connecting before listening', async () => {
    const provider = new FakeSttProvider({ script: [] })
    const { states } = observe(provider)
    await vi.runAllTimersAsync()

    const connectingIdx = states.indexOf('connecting')
    const listeningIdx = states.indexOf('listening')
    expect(connectingIdx).toBeGreaterThanOrEqual(0)
    expect(listeningIdx).toBeGreaterThan(connectingIdx)
  })

  it('ignores a second start() while already connecting/listening', async () => {
    const provider = new FakeSttProvider({ script: [] })
    const { states } = observe(provider)

    // Call start() again before the handshake completes.
    await provider.start({ onSegment: () => {}, onStateChange: (s) => states.push(s) })

    await vi.runAllTimersAsync()
    // There should be exactly one 'connecting' transition.
    expect(states.filter((s) => s === 'connecting')).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// 2. Interim → final segment sequence
// ---------------------------------------------------------------------------

describe('FakeSttProvider — interim → final segment sequence', () => {
  it('emits an interim segment before the final for lines with interim=true', async () => {
    const provider = new FakeSttProvider({
      script: [{ text: 'fireball', delayMs: 100, interim: true }],
      interimLeadMs: 50,
    })
    const { segments } = observe(provider)
    await vi.runAllTimersAsync()

    // Expect at least one interim and one final.
    const interims = segments.filter((s) => !s.isFinal)
    const finals = segments.filter((s) => s.isFinal)
    expect(interims.length).toBeGreaterThanOrEqual(1)
    expect(finals.length).toBeGreaterThanOrEqual(1)
  })

  it('interim segment comes before the final segment', async () => {
    const provider = new FakeSttProvider({
      script: [{ text: 'fireball', delayMs: 100, interim: true }],
      interimLeadMs: 50,
    })
    const { segments } = observe(provider)
    await vi.runAllTimersAsync()

    const firstInterimIdx = segments.findIndex((s) => !s.isFinal)
    const firstFinalIdx = segments.findIndex((s) => s.isFinal)
    expect(firstInterimIdx).toBeGreaterThanOrEqual(0)
    expect(firstFinalIdx).toBeGreaterThan(firstInterimIdx)
  })

  it('final segment text matches the scripted line text', async () => {
    const text = 'הקוסם מטיל fireball'
    const provider = new FakeSttProvider({
      script: [{ text, delayMs: 100, interim: false }],
    })
    const { segments } = observe(provider)
    await vi.runAllTimersAsync()

    const finalSeg = segments.find((s) => s.isFinal)
    expect(finalSeg).toBeDefined()
    expect(finalSeg!.text).toBe(text)
  })

  it('skips interim when line.interim is false', async () => {
    const provider = new FakeSttProvider({
      script: [{ text: 'hello', delayMs: 100, interim: false }],
    })
    const { segments } = observe(provider)
    await vi.runAllTimersAsync()

    const interims = segments.filter((s) => !s.isFinal)
    expect(interims).toHaveLength(0)
    expect(segments.filter((s) => s.isFinal)).toHaveLength(1)
  })

  it('replays multiple script lines in order', async () => {
    const provider = new FakeSttProvider({
      script: [
        { text: 'first', delayMs: 100, interim: false },
        { text: 'second', delayMs: 100, interim: false },
      ],
    })
    const { segments } = observe(provider)
    await vi.runAllTimersAsync()

    const finals = segments.filter((s) => s.isFinal).map((s) => s.text)
    expect(finals).toContain('first')
    expect(finals).toContain('second')
    expect(finals.indexOf('first')).toBeLessThan(finals.indexOf('second'))
  })

  it('all emitted segments have a ts (epoch ms) field', async () => {
    const provider = new FakeSttProvider({
      script: [{ text: 'hello', delayMs: 100, interim: true }],
    })
    const { segments } = observe(provider)
    await vi.runAllTimersAsync()

    for (const seg of segments) {
      expect(typeof seg.ts).toBe('number')
    }
  })
})
