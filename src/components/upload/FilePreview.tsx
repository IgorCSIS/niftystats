/**
 * FilePreview, the post-upload confirmation view.
 *
 * The user has just dropped a CSV and the parser ran. Before we kick off the
 * (expensive) Pyodide bootstrap and stats engine, we show them what we
 * understood: filename, dimensions, the first 10 rows in a table, type
 * badges per column. This earns trust: if the column types look wrong, the
 * user knows to fix the source CSV instead of waiting for nonsense output.
 *
 * Why a 10-row sample and not the full table: real CSVs go to tens of
 * thousands of rows and rendering all of them with virtualization is its
 * own milestone. 10 rows is enough to spot-check the parse without paying
 * for a virtual list.
 */

import type { ReactNode } from 'react'
import { motion } from 'framer-motion'
import {
  RotateCcw,
  AlertTriangle,
  Hash,
  Type,
  Calendar,
  ToggleLeft,
  HelpCircle,
} from 'lucide-react'
import type { ParsedFile, ParseError } from '@/types/csv'
import type { ColumnType } from '@/types/stats'
import { formatFileSize } from '@/lib/csv'

interface FilePreviewProps {
  file: ParsedFile
  warnings: ParseError[]
  /** Clear the parsed file and return to the empty DropZone state. */
  onReset: () => void
}

/** How many rows from the top we render. Keeps the DOM small even for huge files. */
const PREVIEW_ROWS = 10

export function FilePreview({ file, warnings, onReset }: FilePreviewProps) {
  const visibleRows = file.rows.slice(0, PREVIEW_ROWS)

  return (
    // Subtle fade-and-rise on mount so the swap from DropZone feels intentional.
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      className="rounded-xl border border-slate-800 bg-slate-900/40"
    >
      {/* Header bar: filename + dimensions + reset button. */}
      <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3">
        <div className="flex items-center gap-3 overflow-hidden">
          <span
            aria-hidden
            className="inline-block h-2 w-2 flex-shrink-0 rounded-full bg-[var(--color-accent)]"
          />
          <span className="truncate font-mono text-sm text-slate-100">
            {file.filename}
          </span>
        </div>
        <button
          type="button"
          onClick={onReset}
          className="flex flex-shrink-0 items-center gap-1.5 rounded-md border border-slate-800 px-2.5 py-1 text-xs text-slate-400 transition-colors hover:border-slate-700 hover:text-slate-100"
        >
          <RotateCcw className="h-3 w-3" aria-hidden />
          Use a different file
        </button>
      </div>

      {/* Stats strip: rows, cols, size, parse time. */}
      <div className="grid grid-cols-2 gap-px overflow-hidden bg-slate-800/60 sm:grid-cols-4">
        <StatChip label="rows" value={file.rows.length.toLocaleString()} />
        <StatChip label="columns" value={file.columns.length.toString()} />
        <StatChip label="size" value={formatFileSize(file.sizeBytes)} />
        <StatChip label="parsed in" value={`${file.parseMs}ms`} />
      </div>

      {/* Warnings collapse the table layout slightly; render before the table. */}
      {warnings.length > 0 && (
        <div className="border-b border-amber-900/40 bg-amber-950/20 px-5 py-3">
          <div className="flex items-start gap-2">
            <AlertTriangle
              className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-amber-400"
              aria-hidden
            />
            <div className="text-xs text-amber-300/80">
              Parsed with {warnings.length} warning{warnings.length === 1 ? '' : 's'}.{' '}
              {warnings[0].message}
              {warnings.length > 1 && (
                <span className="text-amber-400/60">
                  {' '}
                  (+{warnings.length - 1} more, see browser console)
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Scrollable preview table. Horizontal scroll because real CSVs are
          often wider than the viewport (50+ columns is common in marketing
          exports). */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-slate-800">
              {file.columns.map((col) => (
                <th
                  key={col.name}
                  scope="col"
                  className="whitespace-nowrap px-5 py-3 align-top"
                >
                  <div className="flex flex-col gap-1.5">
                    <span className="font-mono text-xs text-slate-300">{col.name}</span>
                    <TypeBadge type={col.type} missing={col.missingCount} />
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row, i) => (
              <tr
                key={i}
                className="border-b border-slate-800/50 last:border-0 hover:bg-slate-900/40"
              >
                {file.columns.map((col) => (
                  <td
                    key={col.name}
                    className="whitespace-nowrap px-5 py-2.5 font-mono text-xs text-slate-300"
                  >
                    {formatCellValue(row[col.name])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Footer with the next-step CTA. Disabled in v2 session 1, the
          analyze flow lights up when Pyodide ships in v2 session 2. */}
      <div className="flex flex-col items-start justify-between gap-3 border-t border-slate-800 px-5 py-4 sm:flex-row sm:items-center">
        <p className="text-xs text-slate-500">
          Showing the first {Math.min(PREVIEW_ROWS, file.rows.length)} of{' '}
          {file.rows.length.toLocaleString()} rows.
        </p>
        <button
          type="button"
          disabled
          title="The stats engine ships next milestone"
          className="cursor-not-allowed rounded-md border border-slate-800 bg-slate-900 px-4 py-2 text-sm font-medium text-slate-500"
        >
          Analyze (next milestone)
        </button>
      </div>
    </motion.div>
  )
}

/**
 * Small key/value chip used in the stats strip.
 */
function StatChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-slate-950 px-5 py-3">
      <div className="font-mono text-[10px] uppercase tracking-wider text-slate-500">
        {label}
      </div>
      <div className="mt-0.5 font-mono text-sm text-slate-100">{value}</div>
    </div>
  )
}

/**
 * Color-coded type badge with an icon.
 *
 * The color encoding is consistent across the app: emerald = numeric (the
 * stuff we'll do real stats on), violet = categorical, sky = datetime, amber
 * = boolean, slate = unknown. Color carries information so it's reinforced
 * by an icon for users with reduced color discrimination.
 */
function TypeBadge({ type, missing }: { type: ColumnType; missing: number }) {
  const meta = TYPE_META[type]
  const Icon = meta.icon
  return (
    <div className="flex items-center gap-2">
      <span
        className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ${meta.classes}`}
      >
        <Icon className="h-3 w-3" aria-hidden />
        {type}
      </span>
      {missing > 0 && (
        <span
          className="font-mono text-[10px] text-amber-400/70"
          title={`${missing} missing values in this column`}
        >
          {missing} missing
        </span>
      )}
    </div>
  )
}

const TYPE_META: Record<
  ColumnType,
  { icon: typeof Hash; classes: string }
> = {
  numeric: {
    icon: Hash,
    classes: 'border-emerald-900/60 bg-emerald-950/40 text-emerald-300',
  },
  categorical: {
    icon: Type,
    classes: 'border-violet-900/60 bg-violet-950/40 text-violet-300',
  },
  datetime: {
    icon: Calendar,
    classes: 'border-sky-900/60 bg-sky-950/40 text-sky-300',
  },
  boolean: {
    icon: ToggleLeft,
    classes: 'border-amber-900/60 bg-amber-950/40 text-amber-300',
  },
  unknown: {
    icon: HelpCircle,
    classes: 'border-slate-800 bg-slate-900 text-slate-400',
  },
}

/**
 * Light formatting for the cell preview. Empty values render as a dim
 * placeholder; long values are truncated to keep the table scannable.
 */
function formatCellValue(raw: string | undefined): ReactNode {
  const v = typeof raw === 'string' ? raw.trim() : ''
  if (!v) return <span className="text-slate-700">·</span>
  if (v.length > 40) return <span title={v}>{v.slice(0, 40)}…</span>
  return v
}
