/**
 * SampleButton, plus a SampleRow that renders the standard trio of buttons.
 *
 * Why this exists: most portfolio visitors won't have a CSV at hand when
 * they land. Without a one-click sample, they bounce. Three samples cover
 * the most common "interesting" shapes:
 *
 *   - sales:     time-series + numeric + categorical channels (regression-friendly)
 *   - marketing: a wider table with booleans and dates (good categorical demo)
 *   - customers: includes missing values and a binary outcome (churn) for
 *                logistic regression in v3
 *
 * Each button fetches the static CSV from /public, runs it through the same
 * parseCsvText pipeline as a user-uploaded file, then hands the result up
 * to the parent. Keeps the data flow identical for samples and real uploads.
 */

import { useState } from 'react'
import { Sparkles, Loader2 } from 'lucide-react'
import { parseCsvText } from '@/lib/csv'
import type { ParsedFile, ParseError } from '@/types/csv'

interface SampleButtonProps {
  label: string
  path: string
  filename: string
  onParsed: (file: ParsedFile, warnings: ParseError[]) => void
}

export function SampleButton({ label, path, filename, onParsed }: SampleButtonProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleClick() {
    setError(null)
    setLoading(true)
    try {
      // Vite serves /public assets from the base URL, so this path resolves
      // correctly both locally (/) and in production (/niftystats/).
      const url = `${import.meta.env.BASE_URL}samples/${path}`
      const res = await fetch(url)
      if (!res.ok) throw new Error(`Couldn't load sample (HTTP ${res.status})`)
      const text = await res.text()
      const { data, warnings } = await parseCsvText(text, filename)
      onParsed(data, warnings)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load sample data'
      setError(msg)
      setLoading(false)
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading}
      className="flex items-center gap-2 rounded-md border border-slate-800 bg-slate-900/60 px-3 py-1.5 font-mono text-xs text-slate-300 transition-colors hover:border-slate-700 hover:bg-slate-900 hover:text-slate-100 disabled:cursor-wait"
      title={error ?? `Load the ${label} sample`}
    >
      {loading ? (
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
      ) : (
        <Sparkles className="h-3 w-3 text-[var(--color-accent-bright)]" aria-hidden />
      )}
      {label}
    </button>
  )
}

/**
 * The three-button row shown beneath the DropZone. Lives here rather than
 * inline in Landing.tsx because the sample list will grow (eventually we
 * want a "load your last file" entry) and centralizing keeps that easy.
 */
export function SampleRow({
  onParsed,
}: {
  onParsed: (file: ParsedFile, warnings: ParseError[]) => void
}) {
  return (
    <div className="mt-5 flex flex-col items-start gap-3 sm:flex-row sm:items-center">
      <span className="font-mono text-xs uppercase tracking-wider text-slate-500">
        or try a sample
      </span>
      <div className="flex flex-wrap gap-2">
        <SampleButton
          label="sales"
          path="sales-sample.csv"
          filename="sales-sample.csv"
          onParsed={onParsed}
        />
        <SampleButton
          label="marketing"
          path="marketing-sample.csv"
          filename="marketing-sample.csv"
          onParsed={onParsed}
        />
        <SampleButton
          label="customers"
          path="customers-sample.csv"
          filename="customers-sample.csv"
          onParsed={onParsed}
        />
      </div>
    </div>
  )
}
