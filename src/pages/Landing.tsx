/**
 * Landing page (Hello NiftyStats milestone).
 *
 * This is the empty state the user lands on before uploading anything.
 * Milestone 1 ships the hero, trust badge, and "coming soon" upload zone.
 * Milestone 2 will replace the upload placeholder with a real drag-and-drop
 * <DropZone /> and wire up sample CSV downloads.
 *
 * Layout intent: keep the user's eye moving down a single column. No sidebars,
 * no nav menus, no decorative imagery. The landing should feel like the
 * beginning of a focused workflow, not a marketing site.
 */
import { Lock, Sparkles, FileSpreadsheet } from 'lucide-react'
import { Header } from '@/components/layout/Header'
import { Footer } from '@/components/layout/Footer'

export function Landing() {
  return (
    <div className="bg-grain flex min-h-screen flex-col">
      <Header />

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 pt-24 sm:pt-32">
        {/* Eyebrow tag. Small text, mono font, accent color: signals "this is
            a technical product" without screaming it. */}
        <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-slate-800 bg-slate-900/60 px-3 py-1 font-mono text-xs text-[var(--color-accent-bright)]">
          <span
            aria-hidden
            className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--color-accent)]"
          />
          niftystats v0.1 preview
        </div>

        <h1 className="text-4xl font-semibold tracking-tight text-slate-50 sm:text-5xl">
          Statistics for the rest of us.
        </h1>

        <p className="mt-5 max-w-xl text-lg leading-relaxed text-slate-400">
          Drop in a CSV. Get descriptive stats, correlations, regression, time-series,
          and clustering, each one explained in plain English. No code, no signup, no
          uploads to anyone's server.
        </p>

        {/* Trust badge. This is the load-bearing differentiator for small
            business owners who would otherwise refuse to upload financial data
            to a SaaS tool. We say it once here, again in the footer, and a
            third time inside the eventual upload zone. */}
        <div className="mt-8 flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-900/60 px-4 py-3">
          <Lock
            className="h-4 w-4 flex-shrink-0 text-[var(--color-accent-bright)]"
            aria-hidden
          />
          <div className="text-sm">
            <span className="font-medium text-slate-100">Your data never leaves your browser.</span>
            <span className="ml-2 text-slate-400">
              Every calculation runs locally via WebAssembly.
            </span>
          </div>
        </div>

        {/* Upload zone placeholder. Milestone 2 swaps this for a real
            <DropZone />. The dashed border, accent-colored CTA, and helper text
            are already styled correctly so the visual won't shift on swap. */}
        <div
          aria-disabled
          className="mt-10 flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-800 bg-slate-900/30 px-6 py-16 text-center"
        >
          <FileSpreadsheet
            className="mb-4 h-10 w-10 text-slate-600"
            strokeWidth={1.25}
            aria-hidden
          />
          <p className="font-mono text-sm text-slate-500">
            upload coming in milestone 2
          </p>
          <p className="mt-2 max-w-sm text-xs text-slate-600">
            CSV drag-and-drop, in-browser parsing, Pyodide-powered analysis. Wiring it
            up next.
          </p>
        </div>

        {/* What you'll get. Three-line promise. No marketing prose, no emoji,
            no exclamation points. */}
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
      </main>

      <Footer />
    </div>
  )
}

// Static content lives outside the component so it doesn't get re-created on
// every render. Trivial perf detail for three items, but the pattern keeps
// scaling well as the list grows.
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
