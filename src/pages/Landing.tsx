/**
 * Landing page.
 *
 * Three surfaces, stacked:
 *
 *   1. Hero (always visible): wordmark, headline, trust badge.
 *   2. Either DropZone + samples (no file uploaded) or FilePreview (file
 *      uploaded). Mutually exclusive.
 *   3. EngineStatus, only rendered after the first Analyze click. Shows
 *      loading progress for the Pyodide cold start, then the round-trip
 *      confirmation, then sits there as a permanent badge of "this is
 *      what Python saw" until the user resets.
 *
 * State management: parsed-file state lives here, engine status lives in a
 * singleton (lib/pyodide/client.ts) that we subscribe to via the
 * useEngineStatus hook. Two reasons for that split: the engine is global by
 * nature (we don't want two competing Pyodide instances), and engine state
 * needs to outlive any single component's mount cycle so future "show
 * cached result" UX still works after a reset.
 */

import { useState } from 'react'
import { Lock, Sparkles } from 'lucide-react'
import { Header } from '@/components/layout/Header'
import { Footer } from '@/components/layout/Footer'
import { DropZone } from '@/components/upload/DropZone'
import { FilePreview } from '@/components/upload/FilePreview'
import { SampleRow } from '@/components/upload/SampleButton'
import { EngineStatus } from '@/components/upload/EngineStatus'
import { engine } from '@/lib/pyodide/client'
import { useEngineStatus } from '@/lib/pyodide/useEngineStatus'
import type { ParsedFile, ParseError } from '@/types/csv'

export function Landing() {
  const [parsed, setParsed] = useState<{
    file: ParsedFile
    warnings: ParseError[]
  } | null>(null)

  const engineStatus = useEngineStatus()

  // 'isBusy' is the union of "engine is loading" and "engine is computing."
  // We collapse them for the FilePreview button because the user doesn't
  // care about the distinction at that level, they just need to know the
  // button shouldn't be clicked again right now.
  const isBusy =
    engineStatus.kind === 'loading' || engineStatus.kind === 'computing'

  function handleParsed(file: ParsedFile, warnings: ParseError[]) {
    setParsed({ file, warnings })
    if (warnings.length > 0) {
      console.warn(`[niftystats] ${warnings.length} parse warning(s):`, warnings)
    }
  }

  function handleAnalyze() {
    if (!parsed) return
    // Fire-and-forget. The engine pushes status updates through the listener
    // hook, so we don't need to await or handle the promise here. Errors
    // surface in engineStatus.kind === 'error' and the EngineStatus
    // component shows a retry button.
    void engine.analyze(parsed.file.rows)
  }

  function handleReset() {
    setParsed(null)
    engine.reset()
  }

  return (
    <div className="bg-grain flex min-h-screen flex-col">
      <Header />

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 pt-24 sm:pt-28">
        {/* Eyebrow tag, version pill. v0.3 reflects the Pyodide engine landing. */}
        <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-slate-800 bg-slate-900/60 px-3 py-1 font-mono text-xs text-[var(--color-accent-bright)]">
          <span
            aria-hidden
            className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--color-accent)]"
          />
          niftystats v0.3 preview
        </div>

        <h1 className="text-4xl font-semibold tracking-tight text-slate-50 sm:text-5xl">
          Statistics for the rest of us.
        </h1>

        <p className="mt-5 max-w-xl text-lg leading-relaxed text-slate-400">
          Drop in a CSV. Get descriptive stats, correlations, regression, time-series,
          and clustering, each one explained in plain English. No code, no signup, no
          uploads to anyone's server.
        </p>

        {/* Trust badge stays anchored above the upload zone on every state. */}
        <div className="mt-8 flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-900/60 px-4 py-3">
          <Lock
            className="h-4 w-4 flex-shrink-0 text-[var(--color-accent-bright)]"
            aria-hidden
          />
          <div className="text-sm">
            <span className="font-medium text-slate-100">
              Your data never leaves your browser.
            </span>
            <span className="ml-2 text-slate-400">
              Every calculation runs locally via WebAssembly.
            </span>
          </div>
        </div>

        {/* Interactive surface, swaps based on whether a CSV has been parsed. */}
        <div className="mt-10">
          {parsed ? (
            <FilePreview
              file={parsed.file}
              warnings={parsed.warnings}
              onReset={handleReset}
              onAnalyze={handleAnalyze}
              isBusy={isBusy}
            />
          ) : (
            <>
              <DropZone onParsed={handleParsed} />
              <SampleRow onParsed={handleParsed} />
            </>
          )}
        </div>

        {/* Engine status sits beneath the preview. Renders nothing for 'idle'
            and 'ready' states, so it only takes up space when there's
            something to communicate. */}
        {parsed && <EngineStatus status={engineStatus} />}

        {/* What-you'll-get cards. Hidden once a file is loaded since they'd
            duplicate the user's mental model at that point. */}
        {!parsed && (
          <div className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-3">
            {WHATS_NEXT.map((item) => (
              <div
                key={item.title}
                className="rounded-lg border border-slate-800 border-l-2 border-l-[var(--color-accent)] bg-slate-900/50 p-4"
              >
                <div className="mb-2 flex items-center gap-2">
                  <Sparkles
                    className="h-3.5 w-3.5 text-[var(--color-accent-bright)]"
                    aria-hidden
                  />
                  <span className="font-mono text-[11px] uppercase tracking-wider text-slate-500">
                    {item.label}
                  </span>
                </div>
                <div className="text-sm font-medium text-slate-100">{item.title}</div>
                <div className="mt-1 text-xs text-slate-400">{item.body}</div>
              </div>
            ))}
          </div>
        )}
      </main>

      <Footer />
    </div>
  )
}

const WHATS_NEXT = [
  {
    label: 'describe',
    title: 'Summary statistics',
    body: 'Means, medians, distributions, outliers, missing-value report.',
  },
  {
    label: 'relate',
    title: 'Correlations & regression',
    body: 'See which variables move together and which actually predict.',
  },
  {
    label: 'forecast',
    title: 'Trends & clusters',
    body: 'Time-series decomposition and customer segmentation, on demand.',
  },
] as const
