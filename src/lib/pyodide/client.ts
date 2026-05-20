/**
 * Pyodide runtime, the JS-side wrapper around the Python interpreter that
 * runs in WebAssembly inside the user's browser.
 *
 * Why a singleton: Pyodide is ~10MB and takes 5-10s to boot the first time.
 * We only want to pay that cost once per session, and we want every
 * component that needs Python results to read from the same instance.
 *
 * Why dynamic import: `await import('pyodide')` lets Vite code-split Pyodide
 * into its own chunk that only loads when the user clicks Analyze. Without
 * this, every visitor pays the Pyodide cost on initial page load whether or
 * not they ever upload a file.
 *
 * Why scipy: the descriptive engine uses scipy.stats for normality testing
 * (Shapiro-Wilk, Anderson-Darling) and the median-absolute-deviation scale.
 * scipy adds ~13MB to the load, but the service worker caches it after the
 * first visit and the SW-cached load is sub-second.
 */

import type { EngineListener, EngineStatus } from './types'
import type {
  DescriptiveResult,
  ColumnType,
} from '@/types/stats'

// Vite's `?raw` query inlines the file contents as a string at build time.
// Keeping the Python in its own .py file gives us editor syntax highlighting
// and lets us iterate on the engine without touching TypeScript.
import descriptiveScript from '@/python/descriptive.py?raw'

/**
 * Pyodide CDN index URL. Pin to a specific version so we don't get
 * surprised by a Pyodide release with breaking changes. The version here
 * MUST match the version in package.json.
 */
const PYODIDE_INDEX_URL = 'https://cdn.jsdelivr.net/pyodide/v0.27.7/full/'

/** Minimal column metadata we hand to the Python side. */
interface ColumnMeta {
  name: string
  type: ColumnType
}

class EngineRuntime {
  private status: EngineStatus = { kind: 'idle' }
  private listeners = new Set<EngineListener>()
  private pyodide: PyodideLike | null = null
  private loadPromise: Promise<void> | null = null
  /** Whether descriptiveScript has been runPython'd at least once. */
  private scriptLoaded = false

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
      detail: 'Python runtime, about 10MB the first time. Cached after.',
    })

    const { loadPyodide } = await import('pyodide')

    this.pyodide = (await loadPyodide({
      indexURL: PYODIDE_INDEX_URL,
      stdout: () => {},
      stderr: () => {},
    })) as unknown as PyodideLike

    // Packages load in sequence so we can show meaningful progress per
    // package. Pyodide accepts a single loadPackage([...]) call too but
    // that hides which one the user is waiting on.
    this.update({
      kind: 'loading',
      step: 'Loading numpy',
      detail: 'Numerical arrays and linear algebra.',
    })
    await this.pyodide.loadPackage(['numpy'])

    this.update({
      kind: 'loading',
      step: 'Loading pandas',
      detail: 'Dataframes and column operations.',
    })
    await this.pyodide.loadPackage(['pandas'])

    this.update({
      kind: 'loading',
      step: 'Loading scipy',
      detail: 'Robust statistics and normality tests. Largest package, hang tight.',
    })
    await this.pyodide.loadPackage(['scipy'])

    this.update({
      kind: 'loading',
      step: 'Wiring engine',
      detail: 'Loading the NiftyStats descriptive engine.',
    })
    // Run the descriptive.py module once to register `run_descriptive` in
    // the Python global namespace. Subsequent analyze() calls just invoke
    // the already-defined function.
    this.pyodide.runPython(descriptiveScript)
    this.scriptLoaded = true

    this.update({ kind: 'ready' })
  }

  /**
   * Run the descriptive engine against the user's parsed rows. Triggers a
   * load() if Pyodide isn't ready yet.
   */
  async analyze(
    rows: Array<Record<string, string>>,
    columns: ColumnMeta[],
  ): Promise<void> {
    await this.load()
    if (!this.pyodide || !this.scriptLoaded) {
      this.update({
        kind: 'error',
        message: 'Engine failed to initialize properly.',
      })
      return
    }
    this.update({
      kind: 'computing',
      detail: 'Computing descriptive statistics across every column.',
    })

    try {
      const py = this.pyodide
      // Hand-off contract: rows + column metadata as JSON strings.
      // Mirrors the JSON-in / JSON-out boundary defined in descriptive.py.
      py.globals.set('rows_json', JSON.stringify(rows))
      py.globals.set('columns_meta_json', JSON.stringify(columns))
      py.runPython(
        'result_json = run_descriptive(rows_json, columns_meta_json)',
      )

      const resultJson = py.globals.get('result_json') as string
      const result = JSON.parse(resultJson) as DescriptiveResult

      this.update({ kind: 'done', result })
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Python failed unexpectedly'
      this.update({ kind: 'error', message })
    }
  }

  /** Reset back to ready/idle. Used by retry buttons and reset flows. */
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
 * hand so we don't pull the full @types/pyodide graph into this file.
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

export type { ColumnMeta }
