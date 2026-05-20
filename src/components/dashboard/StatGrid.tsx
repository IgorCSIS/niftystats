/**
 * StatGrid, the compact key/value grid inside every column card.
 *
 * Designed for scannability: two columns on mobile so labels and values
 * stay on the same line, four columns on desktop so a typical numeric card
 * fits in one row without scrolling.
 *
 * Labels are uppercase + mono so they read as metadata; values use the
 * default sans face so they pop visually. Numbers run tabular by default
 * thanks to the body-level font-variant rule, so columns of values align.
 */

interface StatGridProps {
  items: Array<{
    label: string
    value: string
    /** Optional secondary detail rendered beneath the value in dim text. */
    detail?: string
  }>
}

export function StatGrid({ items }: StatGridProps) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <div className="font-mono text-[10px] uppercase tracking-wider text-slate-500">
            {item.label}
          </div>
          <div className="mt-0.5 truncate font-mono text-sm text-slate-100">
            {item.value}
          </div>
          {item.detail && (
            <div className="mt-0.5 truncate font-mono text-[10px] text-slate-500">
              {item.detail}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
