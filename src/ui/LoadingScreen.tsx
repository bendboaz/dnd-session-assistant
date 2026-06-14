// Full-screen state shown while the compendium loads, or if loading fails.

export function LoadingScreen({ error }: { error?: string | null }) {
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-2xl font-bold text-[var(--color-accent-2)]">
        D&amp;D Session Assistant
      </h1>
      {error ? (
        <div className="flex flex-col gap-2">
          <p className="text-[var(--color-accent)]">Failed to load the compendium.</p>
          <p className="text-sm text-[var(--color-ink-dim)]">{error}</p>
        </div>
      ) : (
        <div className="flex items-center gap-3 text-[var(--color-ink-dim)]">
          <span
            className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--color-border)]"
            style={{ borderTopColor: 'var(--color-accent-2)' }}
          />
          <span>Loading the compendium…</span>
        </div>
      )}
    </div>
  )
}
