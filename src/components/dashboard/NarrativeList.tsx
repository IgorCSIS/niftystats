/**
 * NarrativeList renders the threshold-driven bullets beneath every column.
 *
 * Each bullet has a severity that tints the left-edge accent: emerald for
 * the dominant story (info), slate for secondary notes, amber for
 * data-quality warnings the user should act on. The user can scan the
 * accent colors down a column card and immediately spot warnings without
 * reading every word.
 */

import { Info, AlertTriangle, MessageSquare } from 'lucide-react'
import type { Narrative } from '@/lib/narratives/descriptive'

interface NarrativeListProps {
  narratives: Narrative[]
}

export function NarrativeList({ narratives }: NarrativeListProps) {
  if (narratives.length === 0) return null
  return (
    <ul className="space-y-2.5">
      {narratives.map((narrative, i) => (
        <Item key={i} narrative={narrative} />
      ))}
    </ul>
  )
}

function Item({ narrative }: { narrative: Narrative }) {
  const meta = SEVERITY_META[narrative.severity]
  const Icon = meta.icon
  return (
    <li
      className={`flex gap-2.5 rounded-md border-l-2 bg-slate-950/40 py-2 pl-3 pr-2 ${meta.borderClass}`}
    >
      <Icon
        className={`mt-0.5 h-3.5 w-3.5 flex-shrink-0 ${meta.iconClass}`}
        aria-hidden
      />
      <div className="flex-1">
        <div className="text-sm font-medium text-slate-100">
          {narrative.headline}
        </div>
        {narrative.body && (
          <div className="mt-1 text-xs leading-relaxed text-slate-400">
            {narrative.body}
          </div>
        )}
      </div>
    </li>
  )
}

const SEVERITY_META = {
  info: {
    icon: Info,
    borderClass: 'border-[var(--color-accent)]',
    iconClass: 'text-[var(--color-accent-bright)]',
  },
  note: {
    icon: MessageSquare,
    borderClass: 'border-slate-700',
    iconClass: 'text-slate-400',
  },
  warning: {
    icon: AlertTriangle,
    borderClass: 'border-amber-700',
    iconClass: 'text-amber-400',
  },
} as const
