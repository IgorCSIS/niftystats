/**
 * Engine status discriminated union.
 *
 * The UI subscribes to engine status and re-renders on every change. Keeping
 * the shape narrow (one `kind` field plus state-specific payload) means
 * React components can `switch (status.kind)` and TypeScript narrows the
 * payload automatically.
 *
 * Lifecycle:
 *   idle -> loading -> ready -> computing -> done -> ready -> computing -> done -> ...
 *   any state can transition to error; user retry sends them back to loading.
 */

/**
 * A single descriptive result. This is intentionally minimal for v2 session 2,
 * the goal here is to prove the JS<->Python round-trip works. Session 3 will
 * replace this with the full AnalysisResult shape from src/types/stats.ts.
 */
export interface PyodideRoundTripResult {
  rows: number
  cols: number
  /** Echoed back from Python so we can confirm the data made it across the boundary. */
  columnNames: string[]
}

export type EngineStatus =
  | { kind: 'idle' }
  /** Pyodide is downloading or initializing. `step` is the human-readable phase. */
  | { kind: 'loading'; step: string; detail?: string }
  /** Pyodide loaded and idle, awaiting an analyze() call. */
  | { kind: 'ready' }
  /** A computation is in flight. */
  | { kind: 'computing'; detail?: string }
  /** Last computation completed, result is available. */
  | { kind: 'done'; result: PyodideRoundTripResult }
  /** Either the load or a computation failed. */
  | { kind: 'error'; message: string }

export type EngineListener = (status: EngineStatus) => void
