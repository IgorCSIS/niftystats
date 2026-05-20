/**
 * ExportButton: triggers the PDF export of the current analysis result.
 *
 * Sits between the dashboard and the user. Shows a clean "Download report"
 * affordance while idle, a loading state during the html2canvas + jsPDF
 * pass (which can take 2-5 seconds for a wide dashboard), and surfaces
 * any export error inline so the user knows what happened.
 *
 * Why a callback (`getTarget`) rather than a ref prop: the dashboard DOM
 * tree mounts in Landing.tsx, but the export logic doesn't need ongoing
 * access to it, only at the moment of click. A lazy getter keeps the
 * coupling loose and makes the button reusable in future contexts (e.g.,
 * a "share" panel that exports the same way).
 */

import { useEffect, useState } from 'react'
import { Download, Loader2, AlertCircle } from 'lucide-react'
import { exportReportPdf } from '@/lib/pdf/exportReport'

/**
 * Rotating progress messages shown while the PDF builds. The export work
 * is opaque to the user (snapshots, page packing, jsPDF assembly), so
 * cycling through these gives them something to read besides a spinner
 * and signals that the process is still alive.
 *
 * The first message sets the expectation that this isn't instant; the
 * later messages are progressively reassuring ("almost there"). Total
 * cycle is ~8 seconds, which lines up with typical export time on a
 * mid-tier laptop for a 3-sample dashboard.
 */
const BUILDING_MESSAGES = [
  'Building PDF, may take up to a minute…',
  'Capturing each section as its own image…',
  'Packing pages so nothing gets cut…',
  'Assembling the final document…',
  'Almost there…',
] as const

/** How long each message stays on screen, in ms. */
const MESSAGE_INTERVAL_MS = 1800

interface ExportButtonProps {
  /** Lazy resolver for the DOM element to capture. Called at click time. */
  getTarget: () => HTMLElement | null
  /** Filename of the analyzed CSV, used for naming and headers. */
  csvFilename: string
}

export function ExportButton({ getTarget, csvFilename }: ExportButtonProps) {
  const [state, setState] = useState<'idle' | 'exporting' | 'error'>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [messageIndex, setMessageIndex] = useState(0)

  // Rotate through the progress messages while exporting. Reset to the
  // first message whenever we leave the exporting state so the next click
  // starts the cycle fresh.
  useEffect(() => {
    if (state !== 'exporting') {
      setMessageIndex(0)
      return
    }
    const id = window.setInterval(() => {
      setMessageIndex((i) => Math.min(i + 1, BUILDING_MESSAGES.length - 1))
    }, MESSAGE_INTERVAL_MS)
    return () => window.clearInterval(id)
  }, [state])

  async function handleClick() {
    const target = getTarget()
    if (!target) {
      setState('error')
      setErrorMessage("Couldn't find the analysis to export. Try clicking Analyze again.")
      return
    }

    setState('exporting')
    setErrorMessage(null)
    try {
      await exportReportPdf({ target, csvFilename })
      setState('idle')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown export error.'
      setErrorMessage(message)
      setState('error')
    }
  }

  return (
    <div className="mt-10 flex flex-col items-start gap-3 rounded-xl border border-slate-800 bg-slate-900/40 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="text-sm">
        <div className="font-medium text-slate-100">Take this with you.</div>
        <div className="mt-0.5 text-xs text-slate-400">
          Download the full analysis as a polished PDF. Generated locally; nothing
          is uploaded.
        </div>
      </div>
      <div className="flex flex-shrink-0 flex-col items-stretch gap-2 sm:items-end">
        <button
          type="button"
          onClick={handleClick}
          disabled={state === 'exporting'}
          className="flex items-center justify-center gap-2 rounded-md border border-[var(--color-accent)]/40 bg-[color-mix(in_oklch,var(--color-accent)_18%,transparent)] px-4 py-2 text-sm font-medium text-[var(--color-accent-bright)] transition-colors hover:bg-[color-mix(in_oklch,var(--color-accent)_28%,transparent)] disabled:cursor-wait disabled:opacity-60"
        >
          {state === 'exporting' ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Building PDF…
            </>
          ) : (
            <>
              <Download className="h-4 w-4" aria-hidden />
              Download report
            </>
          )}
        </button>
        {/* Rotating progress copy beneath the button while exporting.
            Fixed width via max-w keeps the parent layout stable as messages
            change length. aria-live polite so screen readers announce each
            message without interrupting the user. */}
        {state === 'exporting' && (
          <p
            className="max-w-[260px] text-right font-mono text-[11px] leading-snug text-slate-500"
            aria-live="polite"
          >
            {BUILDING_MESSAGES[messageIndex]}
          </p>
        )}
      </div>
      {state === 'error' && errorMessage && (
        <div className="flex w-full items-start gap-2 rounded-md border border-red-900/60 bg-red-950/20 px-3 py-2 text-xs text-red-300 sm:w-auto">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-red-400" aria-hidden />
          {errorMessage}
        </div>
      )}
    </div>
  )
}
