/**
 * Pyodide runtime: the JS-side wrapper around the Python interpreter that
 * runs in WebAssembly inside the user's browser.
 *
 * Why a singleton: Pyodide is ~10MB and takes 5-15s to boot the first time.
 * We pay that cost once per session; every component reads from the same
 * instance.
 *
 * Why dynamic import: `await import('pyodide')` lets Vite code-split
 * Pyodide into its own chunk that only loads when the user clicks
 * Analyze. Visitors who don't analyze never pay the Pyodide cost.
 *
 * Why scipy: the descriptive engine uses scipy.stats for normality
 * testing, MAD scaling, and pairwise correlation p-values in the
 * relational engine. The service worker caches scipy after the first
 * visit, so the heavy load is one-time and refresh is near-instant.
 *
 * Why no scikit-learn: we'd love it for cleaner regression code, but
 * adding it to the load would push cold-start to 30-40s on slow
 * connections. The relational engine does OLS directly with numpy and
 * scipy.stats, which costs us maybe 100 lines of Python but saves the
 * user a 5MB download.
 */

import type { EngineListener, EngineStatus } from './types'
import type { AnalysisResult, ColumnType } from '@/types/stats'

// Both Python modules ship as raw text via Vite's `?raw` query. We
// runPython each once at load time to register their top-level functions
// in the Python global namespace, then call those functions per Analyze
// run via globals.set + runPython.
import descriptiveScript from '@/python/descriptive.py?raw'
import relationalScript from '@/python/relational.py?raw'
import clusteringScript from '@/python/clustering.py?raw'
import timeseriesScript from '@/python/timeseries.py?raw'

/**
 * Pyodide CDN index URL. Pin to a specific version. The version here MUST
 * match the version in package.json so the JS bindings and the wasm
 * runtime are compatible.
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
  private scriptsLoaded = false

  /**
   * Subscribe to engine-status updates. Returns an unsubscribe function.
   * The listener fires immediately with the current status so a freshly
   * mounted component never flashes stale UI.
   */
  subscribe(listener: EngineListener): () => void {
    this.listeners.add(listener)
    listener(this.status)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Load Pyodide + packages. Safe to call multiple times. */
  load(): Promise<void> {
    if (this.pyodide && this.scriptsLoaded) return Promise.resolve()
    if (this.loadPromise) return this.loadPromise

    this.loadPromise = this.runLoad().catch((err) => {
      this.loadPromise = null
      const message = err instanceof Error ? err.message : 'Failed to load Pyodide'
      this.update({ kind: 'error', message })
      throw err
    })
    return this.loadPromise
  }

  private async runLoad(): Promise<void> {
    // Each step's `detail` is the place to set expectations. The two key
    // messages we want the user to internalize during the wait:
    //   1. This is a one-time cost. Future analyses are instant.
    //   2. The wait is intentional: real Python is downloading, not a
    //      generic spinner spinning.
    this.update({
      kind: 'loading',
      step: 'Downloading the Python engine',
      detail:
        'About 10MB on first visit. Your browser will cache it after this, so future visits load in under a second.',
    })

    const { loadPyodide } = await import('pyodide')

    this.pyodide = (await loadPyodide({
      indexURL: PYODIDE_INDEX_URL,
      stdout: () => {},
      stderr: () => {},
    })) as unknown as PyodideLike

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
      detail:
        "Statistical tests and robust estimators. Bigger package, hang tight.",
    })
    await this.pyodide.loadPackage(['scipy'])

    this.update({
      kind: 'loading',
      step: 'Loading scikit-learn',
      detail:
        "Machine-learning toolkit for the clustering pass. Last big download, then we're ready.",
    })
    await this.pyodide.loadPackage(['scikit-learn'])

    this.update({
      kind: 'loading',
      step: 'Warming up the engine',
      detail: 'Compiling the NiftyStats analysis modules. Almost done.',
    })
    // Run all three modules. Each registers its top-level entry function
    // (`run_descriptive`, `run_relational`, `run_clustering`) in the
    // Python global namespace; subsequent analyze() calls invoke them
    // directly via globals.set + runPython.
    this.pyodide.runPython(descriptiveScript)
    this.pyodide.runPython(relationalScript)
    this.pyodide.runPython(clusteringScript)
    this.pyodide.runPython(timeseriesScript)
    this.scriptsLoaded = true

    this.update({ kind: 'ready' })
  }

  /**
   * Run both descriptive and relational analysis against the parsed rows.
   * Triggers a load() if Pyodide isn't ready yet.
   *
   * Both passes run in sequence on the Python side, then we package them
   * into an AnalysisResult for the UI. Sequential rather than parallel
   * because they share a Python interpreter (Pyodide isn't multi-threaded
   * from a single JS context), and the descriptive numbers are cheap
   * enough that the user wouldn't notice the parallelism even if we had it.
   */
  async analyze(
    rows: Array<Record<string, string>>,
    columns: ColumnMeta[],
  ): Promise<void> {
    await this.load()
    if (!this.pyodide || !this.scriptsLoaded) {
      this.update({
        kind: 'error',
        message: 'Engine failed to initialize properly.',
      })
      return
    }

    const py = this.pyodide
    const startedAt = performance.now()

    try {
      this.update({
        kind: 'computing',
        detail: 'Computing per-column descriptive statistics.',
      })

      // Set the inputs once. Both Python entry points read the same
      // globals, which keeps the boundary clean.
      py.globals.set('rows_json', JSON.stringify(rows))
      py.globals.set('columns_meta_json', JSON.stringify(columns))

      py.runPython('result_json = run_descriptive(rows_json, columns_meta_json)')
      const descriptiveJson = py.globals.get('result_json') as string
      const descriptive = JSON.parse(descriptiveJson)

      this.update({
        kind: 'computing',
        detail: 'Computing correlations and regressions between numeric columns.',
      })

      py.runPython('result_json = run_relational(rows_json, columns_meta_json)')
      const relationalJson = py.globals.get('result_json') as string
      const relational = JSON.parse(relationalJson)

      this.update({
        kind: 'computing',
        detail: 'Finding natural groupings via k-means clustering.',
      })

      py.runPython('result_json = run_clustering(rows_json, columns_meta_json)')
      const clusteringJson = py.globals.get('result_json') as string
      const clustering = JSON.parse(clusteringJson)

      this.update({
        kind: 'computing',
        detail: 'Tracking values over time and projecting forward.',
      })

      py.runPython('result_json = run_timeseries(rows_json, columns_meta_json)')
      const timeseriesJson = py.globals.get('result_json') as string
      const timeSeries = JSON.parse(timeseriesJson)

      const totalMs = Math.round(performance.now() - startedAt)
      const combined: AnalysisResult = {
        descriptive,
        relational,
        clustering,
        timeSeries,
        generatedAt: descriptive.generatedAt,
        totalMs,
      }

      this.update({ kind: 'done', result: combined })
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
 * Minimal subset of Pyodide's public API we actually touch. Typed by hand
 * so we don't drag the full @types/pyodide graph into this file.
 */
interface PyodideLike {
  loadPackage(packages: string[]): Promise<void>
  runPython(code: string): unknown
  globals: {
    set(key: string, value: unknown): void
    get(key: string): unknown
  }
}

export const engine = new EngineRuntime()
export type { ColumnMeta }
