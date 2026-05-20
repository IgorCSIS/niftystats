/**
 * Engine status discriminated union.
 *
 * The UI subscribes to engine status and re-renders on every change. Keeping
 * the shape narrow (one `kind` field plus state-specific payload) means
 * React components can `switch (status.kind)` and TypeScript narrows the
 * payload automatically.
 *
 * Lifecycle:
 *   idle -> loading -> ready -> computing -> done -> ready -> computing -> ...
 *   any state can transition to error; user retry sends them back to loading.
 */

import type { DescriptiveResult } from '@/types/stats'

export type EngineStatus =
  | { kind: 'idle' }
  /** Pyodide is downloading or initializing. `step` is the human-readable phase. */
  | { kind: 'loading'; step: string; detail?: string }
  /** Pyodide loaded and idle, awaiting an analyze() call. */
  | { kind: 'ready' }
  /** A computation is in flight. */
  | { kind: 'computing'; detail?: string }
  /** Last computation completed, full descriptive result is available. */
  | { kind: 'done'; result: DescriptiveResult }
  /** Either the load or a computation failed. */
  | { kind: 'error'; message: string }

export type EngineListener = (status: EngineStatus) => void
