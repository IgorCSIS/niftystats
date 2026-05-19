/**
 * The canonical result shape returned by the Python statistical engine and
 * consumed by the React dashboard.
 *
 * This file is the contract between JS and Python. When the engine adds a new
 * analysis, the corresponding interface lives here first, then both sides
 * implement against it. Keeps the boundary tight and PRs reviewable.
 *
 * Milestone 1 ships an empty shell. Subsequent milestones fill in:
 *   - milestone 4: DescriptiveResult
 *   - milestone 5: RelationalResult
 *   - milestone 6: AdvancedResult
 */

export type ColumnType = 'numeric' | 'categorical' | 'datetime' | 'boolean' | 'unknown'

export interface ColumnMeta {
  name: string
  type: ColumnType
  missingCount: number
  missingPct: number
  uniqueCount: number
}

export interface DescriptiveResult {
  rowCount: number
  columnCount: number
  columns: ColumnMeta[]
  // Populated in milestone 4.
  summaries: Record<string, unknown>
}

export interface RelationalResult {
  // Populated in milestone 5.
  correlations: unknown
  regressions: unknown
}

export interface AdvancedResult {
  // Populated in milestone 6.
  timeSeries: unknown
  clusters: unknown
  hypothesisTests: unknown
}

export interface AnalysisResult {
  descriptive: DescriptiveResult | null
  relational: RelationalResult | null
  advanced: AdvancedResult | null
  generatedAt: string // ISO timestamp
}
