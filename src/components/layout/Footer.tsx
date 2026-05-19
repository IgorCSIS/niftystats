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
          <a
            href="https://github.com/IgorCSIS"
            className="text-slate-300 underline-offset-4 hover:underline"
          >
            @IgorCSIS
          </a>
        </span>
        <span>your data never leaves this browser tab. zero servers, zero logging.</span>
      </div>
    </footer>
  )
}
