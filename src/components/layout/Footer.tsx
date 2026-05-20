/**
 * Footer. Single line, dim, anchored to the bottom of the viewport on the
 * empty landing state. Privacy line is repeated here on purpose: it's our
 * core promise and worth restating.
 */
export function Footer() {
  return (
    <footer className="mt-24 border-t border-slate-800/60">
      <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-2 px-6 py-6 text-xs text-slate-500 sm:flex-row sm:items-center">
        <span className="font-mono">
          built by{' '}
          {/* Routes to the NiftyAi portfolio so a visitor reading the footer
              can click straight through to request a quote. Treat this as the
              primary outbound link on the page. */}
          <a
            href="https://igorcsis.github.io/niftyai-portfolio"
            className="text-slate-300 underline-offset-4 hover:underline"
          >
            NiftyAi
          </a>
        </span>
        <span>your data never leaves this browser tab. zero servers, zero logging.</span>
      </div>
    </footer>
  )
}
