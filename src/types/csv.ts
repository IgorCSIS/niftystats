/**
 * Types for the CSV ingestion layer.
 *
 * The flow: a File or URL goes into the parser, comes out as a ParsedFile.
 * The ParsedFile is what the rest of the app reads from. Pyodide will read
 * `rows` and `columns` to build a DataFrame in milestone 3.
 *
 * Keeping these types in their own file (rather than mixed into stats.ts)
 * because the parser ships in v2 while the stats engine ships in v3. Clean
 * boundary keeps refactors easier.
 */

import type { ColumnType } from './stats'

/**
 * Metadata about a single column, inferred during parse.
 *
 * `sampleValues` gives the UI something concrete to show in the preview table
 * without re-reading the rows array. Five samples is enough to communicate
 * "this is a date column" or "these are SKUs" without being noisy.
 */
export interface ParsedColumn {
  name: string
  type: ColumnType
  missingCount: number
  /** Up to five non-null values from the first 200 rows. */
  sampleValues: string[]
}

/**
 * Output of a successful parse.
 *
 * `rows` is plain JS objects (PapaParse output with `header: true`). We keep
 * them as strings here; the stats engine on the Python side casts to proper
 * types based on `columns[i].type`. Doing the cast in Python ensures pandas
 * sees the exact same data we previewed.
 */
export interface ParsedFile {
  filename: string
  /** Size in bytes of the original file (or sample blob). */
  sizeBytes: number
  rows: Array<Record<string, string>>
  columns: ParsedColumn[]
  /** Time it took to parse, in milliseconds. Useful for the eventual perf banner. */
  parseMs: number
}

/**
 * Recoverable parse errors. We surface these in the UI rather than throwing,
 * so the user understands what went wrong and how to fix it.
 *
 * `level: 'warning'` errors mean "we parsed but you should look at this"
 * (e.g., 3 rows had column-count mismatches). `level: 'fatal'` means we
 * couldn't produce a ParsedFile at all (empty file, no header row, etc).
 */
export interface ParseError {
  level: 'warning' | 'fatal'
  message: string
  /** Row number where the issue occurred, if applicable. 1-indexed. */
  row?: number
}
