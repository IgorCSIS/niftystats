/**
 * Pyodide runtime, the JS-side wrapper around the Python interpreter that
 * runs in WebAssembly inside the user's browser.
 *
 * Why a singleton: Pyodide is ~10MB and takes 5-10s to boot. We only want to
 * pay that cost once per session, and we want every component that needs
 * Python results to read from the same underlying instance.
 *
 * Why dynamic import: `await import('pyodide')` lets Vite code-split Pyodide
 * into its own chunk that only loads when the user clicks Analyze. Without
 * this, every visitor pays the Pyodide cost on initial page load whether or
 * not they ever upload a file.
 *
 * The public surface is a subscribe/load/analyze API plus the singleton
 * itself. UI components subscribe to status changes, kick off load/analyze
 * via the singleton, and re-render on each status update.
 */

import type {
  EngineListener,
  EngineStatus,
  PyodideRoundTripResult,
} from './types'

/**
 * Pyodide CDN index URL. We pin to a specific version so we don't get
 * surprised by a Pyodide release with breaking changes. The version here
 * MUST match the version in package.json so the JS-side bindings and the
 * wasm-side runtime are compatible.
 */
const PYODIDE_INDEX_URL = 'https://cdn.jsdelivr.net/pyodide/v0.27.7/full/'

/**
 * The minimal Python snippet that runs when the user clicks Analyze. For
 * session 2 we just round-trip the parsed rows through pandas and return
 * the shape and column names. Session 3 will replace this with the real
 * descriptive engine.
 *
 * We use globals to pass data because it's simpler than the runPython
 * return-value path and avoids quoting issues with embedded JSON.
 */
const ROUND_TRIP_SCRIPT = `
import json
import pandas as pd

# rows_json is set as a JS global before runPython is invoked.
rows = json.loads(rows_json)
df = pd.DataFrame(rows)

# Pack the result back into JSON so the JS side can read it without dealing
# with Pyodide proxies. Cheap for small results; we'll move to PyProxy.toJs()
# in milestone 4 when results get bigger.
result_json = json.dumps({
    "rows": int(df.shape[0]),
    "cols": int(df.shape[1]),
    "columnNames": list(df.columns),
})
`

class EngineRuntime {
  private status: EngineStatus = { kind: 'idle' }
  private listeners = new Set<EngineListener>()
  // `unknown` because we don't want the @types/pyodide payload in the type
  // graph at this layer. The concrete type is opaque to callers anyway.
  private pyodide: unknown = null
  private loadPromise: Promise<void> | null = null

  /**
   * Subscribe to engine-status updates. Returns an unsubscribe function.
   * The listener fires immediately with the current status so a freshly
   * mounted component never has to display a flash of stale UI.
   */
  subscribe(listener: EngineListener): () => void {
    this.listeners.add(listener)
    listener(this.status)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
   * Load Pyodide and the packages we need. Safe to call multiple times,
   * concurrent callers share the same in-flight Promise.
   */
  load(): Promise<void> {
    if (this.pyodide) return Promise.resolve()
    if (this.loadPromise) return this.loadPromise

    this.loadPromise = this.runLoad().catch((err) => {
      // Reset the promise so a retry can attempt again instead of being
      // stuck on the failed result.
      this.loadPromise = null
      const message = err instanceof Error ? err.message : 'Failed to load Pyodide'
      this.update({ kind: 'error', message })
      throw err
    })
    return this.loadPromise
  }

  private async runLoad(): Promise<void> {
    this.update({
      kind: 'loading',
      step: 'Downloading engine',
      detail: 'About 10MB the first time, cached after.',
    })

    // Dynamic import so Vite code-splits Pyodide into its own chunk.
    const { loadPyodide } = await import('pyodide')

    this.pyodide = await loadPyodide({
      indexURL: PYODIDE_INDEX_URL,
      // We don't want Pyodide's startup messages spamming the user's
      // console, so we route stdout/stderr through no-op handlers. We can
      // capture them later when debugging Python errors becomes a thing.
      stdout: () => {},
      stderr: () => {},
    })

    this.update({
      kind: 'loading',
      step: 'Loading numpy',
      detail: 'Numerical primitives.',
    })
    await (this.pyodide as PyodideLike).loadPackage(['numpy'])

    this.update({
      kind: 'loading',
      step: 'Loading pandas',
      detail: 'Dataframes and stats.',
    })
    await (this.pyodide as PyodideLike).loadPackage(['pandas'])

    this.update({ kind: 'ready' })
  }

  /**
   * Run the round-trip script against the user's parsed rows. Triggers a
   * load() if Pyodide isn't ready yet.
   */
  async analyze(rows: Array<Record<string, string>>): Promise<void> {
    await this.load()
    this.update({ kind: 'computing', detail: 'Handing your data to pandas.' })

    try {
      const py = this.pyodide as PyodideLike
      // Pass rows in as a global JSON string. JSON keeps the boundary
      // dead simple, the cost is one extra serialize/deserialize per
      // analyze which is negligible at our scale.
      py.globals.set('rows_json', JSON.stringify(rows))
      py.runPython(ROUND_TRIP_SCRIPT)

      // Pull the result string back out and parse it on the JS side.
      const resultJson = py.globals.get('result_json') as string
      const result = JSON.parse(resultJson) as PyodideRoundTripResult

      this.update({ kind: 'done', result })
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Python failed unexpectedly'
      this.update({ kind: 'error', message })
    }
  }

  /** Reset back to idle. Used by retry buttons. */
  reset(): void {
    this.update(this.pyodide ? { kind: 'ready' } : { kind: 'idle' })
  }

  private update(status: EngineStatus): void {
    this.status = status
    for (const listener of this.listeners) listener(status)
  }
}

/**
 * Minimal subset of Pyodide's public API that we actually touch. Typed by
 * hand so we don't have to pull the full @types/pyodide graph through this
 * file (which would also drag the worker types into the main bundle).
 */
interface PyodideLike {
  loadPackage(packages: string[]): Promise<void>
  runPython(code: string): unknown
  globals: {
    set(key: string, value: unknown): void
    get(key: string): unknown
  }
}

/**
 * The one and only EngineRuntime instance. Modules import this directly
 * rather than creating their own, which keeps Pyodide a true singleton
 * across the app.
 */
export const engine = new EngineRuntime()
