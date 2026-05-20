/**
 * Landing page.
 *
 * Surfaces stacked top-to-bottom:
 *
 *   1. Hero (always): wordmark, headline, trust badge.
 *   2. DropZone + sample buttons OR FilePreview (mutually exclusive).
 *   3. EngineStatus (only during loading / computing / error).
 *   4. DescriptiveSection (only when engine status is 'done').
 *
 * State management: parsed-file state lives here, engine status lives in a
 * singleton (lib/pyodide/client.ts) consumed via useEngineStatus().
 */

import { useRef, useState } from 'react'
import { Lock, Sparkles } from 'lucide-react'
import { Header } from '@/components/layout/Header'
import { Footer } from '@/components/layout/Footer'
import { DropZone } from '@/components/upload/DropZone'
import { FilePreview } from '@/components/upload/FilePreview'
import { SampleRow } from '@/components/upload/SampleButton'
import { EngineStatus } from '@/components/upload/EngineStatus'
import { DescriptiveSection } from '@/components/dashboard/DescriptiveSection'
import { RelationalSection } from '@/components/dashboard/RelationalSection'
import { ExportButton } from '@/components/dashboard/ExportButton'
import { engine } from '@/lib/pyodide/client'
import { useEngineStatus } from '@/lib/pyodide/useEngineStatus'
import type { ParsedFile, ParseError } from '@/types/csv'

export function Landing() {
  const [parsed, setParsed] = useState<{
    file: ParsedFile
    warnings: ParseError[]
  } | null>(null)

  // Captured at render time and read by the ExportButton when the user
  // clicks Download. We wrap both descriptive + relational sections inside
  // this ref so the PDF capture includes everything visible in the
  // dashboard, not just one half.
  const dashboardRef = useRef<HTMLDivElement | null>(null)

  const engineStatus = useEngineStatus()

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
    // Hand columns + their inferred types to the engine. The Python side
    // uses the type hint to pick the right summary routine per column.
    const columnsMeta = parsed.file.columns.map((c) => ({
      name: c.name,
      type: c.type,
    }))
    void engine.analyze(parsed.file.rows, columnsMeta)
  }

  function handleReset() {
    setParsed(null)
    engine.reset()
  }

  return (
    <div className="bg-grain flex min-h-screen flex-col">
      <Header />

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 pt-20 sm:px-6 sm:pt-28">
        {/* Hero column. Constrained narrower than the dashboard so the
            descriptive section can spread wider once it shows up. */}
        <div className="mx-auto max-w-3xl">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-slate-800 bg-slate-900/60 px-3 py-1 font-mono text-xs text-[var(--color-accent-bright)]">
            <span
              aria-hidden
              className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--color-accent)]"
            />
            niftystats v0.6 preview
          </div>

          <h1 className="text-4xl font-semibold tracking-tight text-slate-50 sm:text-5xl">
            Statistics for the rest of us.
          </h1>

          <p className="mt-5 max-w-xl text-lg leading-relaxed text-slate-400">
            Drop in a CSV. Get descriptive stats, correlations, regression, time-series,
            and clustering, each one explained in plain English. No code, no signup, no
            uploads to anyone's server.
          </p>

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

          {parsed && <EngineStatus status={engineStatus} />}

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
                  <div className="text-sm font-medium text-slate-100">
                    {item.title}
                  </div>
                  <div className="mt-1 text-xs text-slate-400">{item.body}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Dashboard sits below the hero column and uses the wider main
            wrapper so columns have more breathing room. Only renders once
            the engine has produced a real result. Wrapped in a ref'd
            container so the PDF exporter can capture the whole thing. */}
        {engineStatus.kind === 'done' && (
          <>
            <div ref={dashboardRef}>
              <DescriptiveSection result={engineStatus.result.descriptive} />
              {engineStatus.result.relational && (
                <RelationalSection result={engineStatus.result.relational} />
              )}
            </div>
            {parsed && (
              <ExportButton
                getTarget={() => dashboardRef.current}
                csvFilename={parsed.file.filename}
              />
            )}
          </>
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
