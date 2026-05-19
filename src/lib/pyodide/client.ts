/**
 * Pyodide singleton + lifecycle.
 *
 * Pyodide is ~10MB and takes 5-10s to initialize (download wasm, instantiate,
 * import pandas/numpy). We only want to pay that cost once per session, so
 * this module exposes a single getPyodide() that lazily boots on first call
 * and caches the instance.
 *
 * Milestone 3 fills in the implementation. Sketch of what goes here:
 *
 *   import { loadPyodide } from 'pyodide'
 *
 *   let instance: Awaited<ReturnType<typeof loadPyodide>> | null = null
 *   let bootingPromise: ReturnType<typeof loadPyodide> | null = null
 *
 *   export async function getPyodide() {
 *     if (instance) return instance
 *     if (!bootingPromise) {
 *       bootingPromise = loadPyodide({
 *         indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.27.2/full/'
 *       })
 *     }
 *     instance = await bootingPromise
 *     await instance.loadPackage(['pandas', 'numpy', 'scipy', 'scikit-learn'])
 *     return instance
 *   }
 *
 * The UI subscribes to the booting state via a small event emitter so the
 * loading screen can show "Downloading engine... Loading pandas...
 * Ready" instead of a spinner with no context.
 */

export type PyodideStatus = 'idle' | 'booting' | 'ready' | 'error'

export async function getPyodide(): Promise<unknown> {
  throw new Error('Pyodide bootstrap lands in milestone 3.')
}
