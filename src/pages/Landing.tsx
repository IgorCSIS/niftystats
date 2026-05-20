/**
 * Landing page.
 *
 * Two surfaces, swapped based on whether the user has uploaded a CSV yet:
 *
 *   1. Empty state: hero, trust badge, DropZone, sample-CSV buttons, the
 *      three-card "what you'll get" preview. This is what a fresh visitor
 *      sees and what the OG share image mirrors.
 *
 *   2. Preview state: same hero (slightly compressed) plus the FilePreview
 *      component showing dimensions + 10-row sample. The "Analyze" CTA is
 *      stubbed until v2 session 2 lands Pyodide.
 *
 * Holding parsed-file state at this level (rather than inside DropZone)
 * because milestone 3's Pyodide hand-off also reads it. Lifting it now
 * avoids a refactor when we wire the analyze button.
 */

import { useState } from 'react'
import { Lock, Sparkles } from 'lucide-react'
import { Header } from '@/components/layout/Header'
import { Footer } from '@/components/layout/Footer'
import { DropZone } from '@/components/upload/DropZone'
import { FilePreview } from '@/components/upload/FilePreview'
import { SampleRow } from '@/components/upload/SampleButton'
import type { ParsedFile, ParseError } from '@/types/csv'

export function Landing() {
  // null = no file uploaded yet. Pulling this up to the page level keeps the
  // DropZone and FilePreview as siblings rather than parent-child, which is
  // the natural shape since they're mutually exclusive renders.
  const [parsed, setParsed] = useState<{
    file: ParsedFile
    warnings: ParseError[]
  } | null>(null)

  function handleParsed(file: ParsedFile, warnings: ParseError[]) {
    setParsed({ file, warnings })
    // Mirror warnings to the console so the user can dig into the full list
    // (we only show the first one in the FilePreview banner).
    if (warnings.length > 0) {
      console.warn(`[niftystats] ${warnings.length} parse warning(s):`, warnings)
    }
  }

  return (
    <div className="bg-grain flex min-h-screen flex-col">
      <Header />

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 pt-24 sm:pt-28">
        {/* Eyebrow tag, version pill */}
        <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-slate-800 bg-slate-900/60 px-3 py-1 font-mono text-xs text-[var(--color-accent-bright)]">
          <span
            aria-hidden
            className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--color-accent)]"
          />
          niftystats v0.2 preview
        </div>

        <h1 className="text-4xl font-semibold tracking-tight text-slate-50 sm:text-5xl">
          Statistics for the rest of us.
        </h1>

        <p className="mt-5 max-w-xl text-lg leading-relaxed text-slate-400">
          Drop in a CSV. Get descriptive stats, correlations, regression, time-series,
          and clustering, each one explained in plain English. No code, no signup, no
          uploads to anyone's server.
        </p>

        {/* Trust badge stays visible on both states. It's the load-bearing
            differentiator and worth reinforcing right above the upload zone. */}
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

        {/* The interactive surface. Conditional render swaps the empty state
            for the preview once a file is parsed. */}
        <div className="mt-10">
          {parsed ? (
            <FilePreview
              file={parsed.file}
              warnings={parsed.warnings}
              onReset={() => setParsed(null)}
            />
          ) : (
            <>
              <DropZone onParsed={handleParsed} />
              <SampleRow onParsed={handleParsed} />
            </>
          )}
        </div>

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
