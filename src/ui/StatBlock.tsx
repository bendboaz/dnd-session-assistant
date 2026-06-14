// Per-kind stat-block renderer over `CompendiumEntry.data`. One component per
// kind (spell / monster / item / condition). Large text, good contrast, fully
// scrollable — monster blocks are laid out to be scannable at a glance
// (AC/HP/speed line, ability-score row, then actions).

import type { CompendiumEntry } from '../compendium/types'
import type {
  ConditionData,
  ItemData,
  MonsterData,
  SpellData,
} from '../compendium/types'
import { kindMeta } from './kind'

export function StatBlock({ entry }: { entry: CompendiumEntry }) {
  switch (entry.kind) {
    case 'spell':
      return <SpellBlock data={entry.data as SpellData} />
    case 'monster':
      return <MonsterBlock data={entry.data as MonsterData} />
    case 'item':
      return <ItemBlock data={entry.data as ItemData} />
    case 'condition':
      return <ConditionBlock data={entry.data as ConditionData} />
  }
}

// ---- Shared bits ------------------------------------------------------------

function Paragraphs({ desc }: { desc: string[] }) {
  return (
    <div className="flex flex-col gap-2">
      {desc.map((p, i) => (
        <p key={i} className="text-base leading-relaxed text-[var(--color-ink)]">
          {p}
        </p>
      ))}
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  if (!value) return null
  return (
    <p className="text-base text-[var(--color-ink)]">
      <span className="font-semibold text-[var(--color-accent-2)]">{label}: </span>
      {value}
    </p>
  )
}

function SectionTitle({ kind, children }: { kind: CompendiumEntry['kind']; children: string }) {
  return (
    <h3
      className="mt-4 border-b pb-1 text-sm font-bold uppercase tracking-wide"
      style={{ color: kindMeta(kind).colorVar, borderColor: 'var(--color-border)' }}
    >
      {children}
    </h3>
  )
}

function Actions({
  title,
  kind,
  actions,
}: {
  title: string
  kind: CompendiumEntry['kind']
  actions: { name: string; desc: string }[]
}) {
  if (!actions.length) return null
  return (
    <>
      <SectionTitle kind={kind}>{title}</SectionTitle>
      <div className="mt-2 flex flex-col gap-3">
        {actions.map((a, i) => (
          <p key={i} className="text-base leading-relaxed text-[var(--color-ink)]">
            <span className="font-semibold italic">{a.name}. </span>
            {a.desc}
          </p>
        ))}
      </div>
    </>
  )
}

// ---- Spell ------------------------------------------------------------------

function spellLevel(level: number): string {
  if (level === 0) return 'Cantrip'
  const suffix = level === 1 ? 'st' : level === 2 ? 'nd' : level === 3 ? 'rd' : 'th'
  return `${level}${suffix}-level`
}

function SpellBlock({ data }: { data: SpellData }) {
  const subtitle = data.level === 0
    ? `${data.school} cantrip`
    : `${spellLevel(data.level)} ${data.school.toLowerCase()}`
  const components = [
    data.components.join(', '),
    data.material ? `(${data.material})` : '',
  ]
    .filter(Boolean)
    .join(' ')
  const tags = [
    data.concentration ? 'Concentration' : '',
    data.ritual ? 'Ritual' : '',
  ].filter(Boolean)

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm italic text-[var(--color-ink-dim)]">{subtitle}</p>
      {tags.length > 0 && (
        <div className="flex gap-2">
          {tags.map((t) => (
            <span
              key={t}
              className="rounded-full border px-2 py-0.5 text-xs font-semibold text-[var(--color-spell)]"
              style={{ borderColor: 'var(--color-spell)' }}
            >
              {t}
            </span>
          ))}
        </div>
      )}
      <div className="mt-2 flex flex-col gap-1">
        <Field label="Casting Time" value={data.castingTime} />
        <Field label="Range" value={data.range} />
        <Field label="Components" value={components} />
        <Field label="Duration" value={data.duration} />
        {data.classes.length > 0 && (
          <Field label="Classes" value={data.classes.join(', ')} />
        )}
      </div>
      <SectionTitle kind="spell">Description</SectionTitle>
      <div className="mt-2">
        <Paragraphs desc={data.desc} />
      </div>
      {data.higherLevel.length > 0 && (
        <>
          <SectionTitle kind="spell">At Higher Levels</SectionTitle>
          <div className="mt-2">
            <Paragraphs desc={data.higherLevel} />
          </div>
        </>
      )}
    </div>
  )
}

// ---- Monster (scannable) ----------------------------------------------------

function modifier(score: number): string {
  const mod = Math.floor((score - 10) / 2)
  return `${score} (${mod >= 0 ? '+' : ''}${mod})`
}

function MonsterBlock({ data }: { data: MonsterData }) {
  const subtitle = [data.size, data.type, data.alignment]
    .filter(Boolean)
    .join(' · ')

  const stats: { label: string; value: string }[] = [
    { label: 'AC', value: data.armorClass },
    { label: 'HP', value: `${data.hitPoints} (${data.hitDice})` },
    { label: 'Speed', value: data.speed },
  ]

  const abilities: { key: string; score: number }[] = [
    { key: 'STR', score: data.abilities.str },
    { key: 'DEX', score: data.abilities.dex },
    { key: 'CON', score: data.abilities.con },
    { key: 'INT', score: data.abilities.int },
    { key: 'WIS', score: data.abilities.wis },
    { key: 'CHA', score: data.abilities.cha },
  ]

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm italic text-[var(--color-ink-dim)]">{subtitle}</p>

      {/* Quick combat line — AC / HP / Speed, big and scannable */}
      <div className="grid grid-cols-3 gap-2">
        {stats.map((s) => (
          <div
            key={s.label}
            className="rounded-lg border bg-[var(--color-surface-2)] px-2 py-2 text-center"
            style={{ borderColor: 'var(--color-border)' }}
          >
            <div className="text-xs font-semibold uppercase text-[var(--color-monster)]">
              {s.label}
            </div>
            <div className="text-sm font-medium text-[var(--color-ink)]">{s.value}</div>
          </div>
        ))}
      </div>

      {/* Ability score row */}
      <div className="grid grid-cols-6 gap-1">
        {abilities.map((a) => (
          <div
            key={a.key}
            className="rounded-lg border bg-[var(--color-surface-2)] py-1.5 text-center"
            style={{ borderColor: 'var(--color-border)' }}
          >
            <div className="text-[10px] font-bold uppercase text-[var(--color-ink-dim)]">
              {a.key}
            </div>
            <div className="text-xs font-medium text-[var(--color-ink)]">
              {modifier(a.score)}
            </div>
          </div>
        ))}
      </div>

      {/* Secondary fields */}
      <div className="flex flex-col gap-1">
        <Field label="Senses" value={data.senses} />
        <Field label="Languages" value={data.languages} />
        <Field
          label="Challenge"
          value={`${data.challengeRating} (${data.xp.toLocaleString()} XP)`}
        />
        <Field
          label="Damage Immunities"
          value={data.damageImmunities.join(', ')}
        />
        <Field
          label="Damage Resistances"
          value={data.damageResistances.join(', ')}
        />
        <Field
          label="Damage Vulnerabilities"
          value={data.damageVulnerabilities.join(', ')}
        />
        <Field
          label="Condition Immunities"
          value={data.conditionImmunities.join(', ')}
        />
      </div>

      <Actions title="Traits" kind="monster" actions={data.specialAbilities} />
      <Actions title="Actions" kind="monster" actions={data.actions} />
      <Actions
        title="Legendary Actions"
        kind="monster"
        actions={data.legendaryActions}
      />
    </div>
  )
}

// ---- Item -------------------------------------------------------------------

function ItemBlock({ data }: { data: ItemData }) {
  const subtitle = [data.category, data.rarity].filter(Boolean).join(' · ')
  return (
    <div className="flex flex-col gap-2">
      {subtitle && (
        <p className="text-sm italic text-[var(--color-ink-dim)]">{subtitle}</p>
      )}
      {data.desc.length > 0 ? (
        <div className="mt-2">
          <Paragraphs desc={data.desc} />
        </div>
      ) : (
        <p className="mt-2 text-sm text-[var(--color-ink-dim)]">
          No description available.
        </p>
      )}
    </div>
  )
}

// ---- Condition --------------------------------------------------------------

function ConditionBlock({ data }: { data: ConditionData }) {
  return (
    <div className="mt-1">
      <Paragraphs desc={data.desc} />
    </div>
  )
}
