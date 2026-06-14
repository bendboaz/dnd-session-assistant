// Microphone capture helper shared by the real STT providers.
//
// We capture raw PCM via the Web Audio API (an AudioWorklet) rather than
// MediaRecorder: both Soniox and Deepgram accept raw 16-bit little-endian PCM
// over their streaming WebSocket, and PCM avoids the container/codec ambiguity
// (and added latency) of WebM/Opus. The worklet downsamples the browser's
// native sample rate to a provider-friendly 16 kHz mono stream.

/** Target stream format the providers are configured for. */
export const MIC_SAMPLE_RATE = 16_000
export const MIC_CHANNELS = 1

export interface MicCapture {
  /** The provider-ready format of the emitted frames. */
  readonly sampleRate: number
  readonly channels: number
  /** Stop capture and release the OS mic indicator. Idempotent. */
  stop(): void
}

export interface MicOptions {
  /** Called with each PCM16 mono frame (little-endian) ready to send. */
  onFrame: (pcm: ArrayBuffer) => void
}

/**
 * The AudioWorklet processor source. It is registered from a Blob URL so the
 * provider modules stay self-contained (no separate worklet asset to ship).
 * It accumulates input samples and posts ~100 ms PCM16 chunks back to the main
 * thread, resampling from the context rate to {@link MIC_SAMPLE_RATE} with a
 * simple linear interpolation (adequate for speech).
 */
const WORKLET_SRC = `
class PcmDownsampler extends AudioWorkletProcessor {
  constructor(options) {
    super()
    this._targetRate = options.processorOptions.targetRate
    this._ratio = sampleRate / this._targetRate
    this._buffer = []
    // Emit roughly every 100ms of *output* audio.
    this._frameSize = Math.round(this._targetRate * 0.1)
  }

  process(inputs) {
    const input = inputs[0]
    if (!input || input.length === 0) return true
    const channel = input[0]
    if (!channel) return true

    // Linear-interpolation resample from sampleRate -> targetRate.
    for (let i = 0; i < channel.length; i += this._ratio) {
      const idx = Math.floor(i)
      const frac = i - idx
      const a = channel[idx]
      const b = idx + 1 < channel.length ? channel[idx + 1] : a
      this._buffer.push(a + (b - a) * frac)
    }

    while (this._buffer.length >= this._frameSize) {
      const chunk = this._buffer.splice(0, this._frameSize)
      const pcm = new Int16Array(chunk.length)
      for (let j = 0; j < chunk.length; j++) {
        const s = Math.max(-1, Math.min(1, chunk[j]))
        pcm[j] = s < 0 ? s * 0x8000 : s * 0x7fff
      }
      this.port.postMessage(pcm.buffer, [pcm.buffer])
    }
    return true
  }
}
registerProcessor('pcm-downsampler', PcmDownsampler)
`

/**
 * Request mic permission and start streaming PCM16 frames.
 *
 * Throws if `getUserMedia` is unavailable (insecure context) or the user denies
 * permission — callers map that to the `error` STT state. Resolves once capture
 * is running.
 */
export async function startMic(opts: MicOptions): Promise<MicCapture> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Microphone capture is not available in this context (needs HTTPS or localhost).')
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: MIC_CHANNELS,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  })

  // Best-effort cleanup if anything below throws after the stream is open.
  const ctxClass = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!ctxClass) {
    stream.getTracks().forEach((t) => t.stop())
    throw new Error('Web Audio API is not available in this browser.')
  }

  const ctx = new ctxClass()
  const blobUrl = URL.createObjectURL(new Blob([WORKLET_SRC], { type: 'application/javascript' }))
  try {
    await ctx.audioWorklet.addModule(blobUrl)
  } catch (err) {
    URL.revokeObjectURL(blobUrl)
    stream.getTracks().forEach((t) => t.stop())
    await ctx.close()
    throw err instanceof Error ? err : new Error(String(err))
  }
  URL.revokeObjectURL(blobUrl)

  const source = ctx.createMediaStreamSource(stream)
  const worklet = new AudioWorkletNode(ctx, 'pcm-downsampler', {
    numberOfInputs: 1,
    numberOfOutputs: 0,
    processorOptions: { targetRate: MIC_SAMPLE_RATE },
  })
  worklet.port.onmessage = (ev: MessageEvent<ArrayBuffer>) => opts.onFrame(ev.data)
  source.connect(worklet)

  // Some browsers start the context suspended until a user gesture.
  if (ctx.state === 'suspended') {
    await ctx.resume().catch(() => undefined)
  }

  let stopped = false
  return {
    sampleRate: MIC_SAMPLE_RATE,
    channels: MIC_CHANNELS,
    stop() {
      if (stopped) return
      stopped = true
      worklet.port.onmessage = null
      try {
        source.disconnect()
        worklet.disconnect()
      } catch {
        // already disconnected
      }
      stream.getTracks().forEach((t) => t.stop())
      void ctx.close().catch(() => undefined)
    },
  }
}
