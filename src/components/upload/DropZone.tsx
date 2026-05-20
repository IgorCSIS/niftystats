/**
 * DropZone, the upload entry point.
 *
 * UX intent: a single zone that takes a CSV via drag-drop or click. We avoid
 * the "two buttons" pattern (one for drag, one for click) common in older
 * dashboards because it adds noise. The whole zone is the affordance, the
 * label inside teaches both interactions.
 *
 * States we render:
 *   - idle     : default, dashed border, prompt text
 *   - dragging : during a dragover event, accent border + hint
 *   - parsing  : after a file lands but before we have results
 *   - error    : parse failed; show the error message, allow retry
 *
 * Accessibility: the actual <input type="file"> sits behind the visual zone
 * but remains focusable. A keyboard user can Tab to it and press Enter to
 * open the file picker; screen readers announce it as a file input.
 */

import { useCallback, useState } from 'react'
import type { ChangeEvent, DragEvent } from 'react'
import { UploadCloud, FileSpreadsheet, AlertCircle, Loader2 } from 'lucide-react'
import { parseCsvFile } from '@/lib/csv'
import type { ParsedFile, ParseError } from '@/types/csv'
import { cn } from '@/lib/utils'

interface DropZoneProps {
  /** Called with the parsed file + any non-fatal warnings on a successful parse. */
  onParsed: (file: ParsedFile, warnings: ParseError[]) => void
}

type ZoneState =
  | { kind: 'idle' }
  | { kind: 'dragging' }
  | { kind: 'parsing'; filename: string }
  | { kind: 'error'; message: string }

export function DropZone({ onParsed }: DropZoneProps) {
  const [state, setState] = useState<ZoneState>({ kind: 'idle' })

  /**
   * Shared handler: takes a File, kicks off parse, surfaces results.
   * Used by both the drop event and the file input change event.
   */
  const handleFile = useCallback(
    async (file: File) => {
      // Bare minimum sanity check before invoking the parser. We accept any
      // file whose name ends in .csv or .txt, or whose MIME type contains
      // 'csv' (some browsers report 'application/vnd.ms-excel' for .csv).
      const looksLikeCsv =
        file.name.toLowerCase().endsWith('.csv') ||
        file.name.toLowerCase().endsWith('.txt') ||
        file.type.toLowerCase().includes('csv')

      if (!looksLikeCsv) {
        setState({
          kind: 'error',
          message: `Couldn't recognize "${file.name}" as a CSV. Make sure the file ends in .csv.`,
        })
        return
      }

      setState({ kind: 'parsing', filename: file.name })

      try {
        const { data, warnings } = await parseCsvFile(file)
        onParsed(data, warnings)
        // Don't reset to idle here, the parent will unmount this component
        // and render the preview view instead.
      } catch (err) {
        const message =
          (err as ParseError)?.message ?? 'Something went wrong while parsing the file.'
        setState({ kind: 'error', message })
      }
    },
    [onParsed],
  )

  const onDrop = useCallback(
    (e: DragEvent<HTMLLabelElement>) => {
      e.preventDefault()
      const file = e.dataTransfer.files?.[0]
      if (file) handleFile(file)
    },
    [handleFile],
  )

  const onDragOver = useCallback((e: DragEvent<HTMLLabelElement>) => {
    // preventDefault here is what tells the browser we accept the drop.
    // Without it, the file would just open in a new tab.
    e.preventDefault()
    setState((prev) => (prev.kind === 'idle' ? { kind: 'dragging' } : prev))
  }, [])

  const onDragLeave = useCallback(() => {
    setState((prev) => (prev.kind === 'dragging' ? { kind: 'idle' } : prev))
  }, [])

  const onFileChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file) handleFile(file)
      // Reset the input value so picking the same file twice re-triggers the
      // change event (browsers dedupe by default).
      e.target.value = ''
    },
    [handleFile],
  )

  // Styling for the outer label. Border + background flex with state.
  const zoneClass = cn(
    'group relative flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-16 text-center transition-colors',
    state.kind === 'idle' &&
      'border-slate-800 bg-slate-900/30 hover:border-slate-700 hover:bg-slate-900/50',
    state.kind === 'dragging' &&
      'border-[var(--color-accent)] bg-[color-mix(in_oklch,var(--color-accent)_8%,transparent)]',
    state.kind === 'parsing' && 'border-slate-700 bg-slate-900/50 cursor-wait',
    state.kind === 'error' && 'border-red-900/60 bg-red-950/20',
  )

  return (
    <label
      htmlFor="niftystats-csv-input"
      className={zoneClass}
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
    >
      {/* The actual input. visually-hidden but focusable. Hidden via opacity
          rather than display:none so screen readers and keyboard nav still
          reach it. */}
      <input
        id="niftystats-csv-input"
        type="file"
        accept=".csv,.txt,text/csv"
        className="absolute inset-0 cursor-pointer opacity-0"
        onChange={onFileChange}
        disabled={state.kind === 'parsing'}
      />

      <ZoneContent state={state} />
    </label>
  )
}

/**
 * Renders the icon + text inside the zone based on state. Pulled out as its
 * own component to keep the main DropZone body focused on event wiring.
 */
function ZoneContent({ state }: { state: ZoneState }) {
  switch (state.kind) {
    case 'idle':
      return (
        <>
          <UploadCloud
            className="mb-4 h-10 w-10 text-slate-600 transition-colors group-hover:text-slate-400"
            strokeWidth={1.5}
            aria-hidden
          />
          <p className="text-sm text-slate-300">
            <span className="font-medium text-slate-100">Drop a CSV</span> here, or click
            to browse
          </p>
          <p className="mt-2 max-w-sm text-xs text-slate-500">
            Up to ~100k rows. Parsed locally, no upload happens.
          </p>
        </>
      )

    case 'dragging':
      return (
        <>
          <FileSpreadsheet
            className="mb-4 h-10 w-10 text-[var(--color-accent-bright)]"
            strokeWidth={1.5}
            aria-hidden
          />
          <p className="text-sm font-medium text-[var(--color-accent-bright)]">
            Drop to analyze
          </p>
        </>
      )

    case 'parsing':
      return (
        <>
          <Loader2
            className="mb-4 h-10 w-10 animate-spin text-[var(--color-accent-bright)]"
            strokeWidth={1.5}
            aria-hidden
          />
          <p className="text-sm text-slate-200">
            Reading <span className="font-mono">{state.filename}</span>
          </p>
          <p className="mt-2 text-xs text-slate-500">Parsing in a web worker, hang on.</p>
        </>
      )

    case 'error':
      return (
        <>
          <AlertCircle
            className="mb-4 h-10 w-10 text-red-400"
            strokeWidth={1.5}
            aria-hidden
          />
          <p className="text-sm font-medium text-red-300">Couldn't read that file</p>
          <p className="mt-2 max-w-sm text-xs text-red-400/80">{state.message}</p>
          <p className="mt-4 text-xs text-slate-500">Drop a different file to try again.</p>
        </>
      )
  }
}
