// Shared fetch stub for SRD integration tests.
//
// Stubs globalThis.fetch to serve the vendored SRD JSON files from disk via
// Vite's import.meta.glob (no @types/node needed). Import and call
// installSrdFetch() inside a beforeAll() block in any test that exercises
// code paths that call fetch() for the SRD data files.
//
// Each Vitest test file runs in an isolated module registry, so this stub
// does not leak between files — it only applies within the file that calls it.

// Eagerly import every vendored SRD JSON, keyed by basename.
const SRD_MODULES = import.meta.glob('../../public/data/srd/*.json', {
  eager: true,
  import: 'default',
}) as Record<string, unknown>

const SRD_BY_FILE = new Map<string, unknown>(
  Object.entries(SRD_MODULES).map(([p, data]) => [p.split('/').pop()!, data]),
)

/** Stub globalThis.fetch to serve vendored SRD JSON from disk. */
export function installSrdFetch(): void {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input.toString()
    const file = url.split('/').pop()!
    const data = SRD_BY_FILE.get(file)
    if (data === undefined) {
      return { ok: false, status: 404, json: async () => null } as Response
    }
    return { ok: true, status: 200, json: async () => data } as Response
  }) as typeof fetch
}
