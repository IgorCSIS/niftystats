/**
 * Top-of-page header. Wordmark on the left, version + repo link on the right.
 *
 * Kept intentionally sparse: the landing page is dense enough on its own, and
 * the header should fade into the background once the user is reading results.
 */
export function Header() {
  return (
    <header className="border-b border-slate-800/60">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <div className="flex items-center gap-2">
          {/* Brand glyph. Pure CSS dot, not an icon library, because we want
              this to render instantly on first paint with zero asset cost. */}
          <span
            aria-hidden
            className="inline-block h-2 w-2 rounded-full bg-[var(--color-accent)] shadow-[0_0_12px_var(--color-accent)]"
          />
          <span className="font-mono text-sm font-medium tracking-wide text-slate-100">
            niftystats
          </span>
          <span className="ml-2 rounded border border-slate-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-slate-400">
            v0.1
          </span>
        </div>
        <nav className="flex items-center gap-5 text-sm">
          {/* Profile link first (social proof), repo link second (proof of work).
              When niftyai.com goes live we'll swap the first link back. */}
          <a
            href="https://github.com/IgorCSIS"
            className="text-slate-400 transition-colors hover:text-slate-100"
          >
            @IgorCSIS
          </a>
          <a
            href="https://github.com/IgorCSIS/niftystats"
            className="text-slate-400 transition-colors hover:text-slate-100"
          >
            source
          </a>
        </nav>
      </div>
    </header>
  )
}
