/// <reference lib="webworker" />

/**
 * Tabular file parsing + type sniffing worker.
 *
 * Handles both CSV and Excel (.xlsx, .xls) inputs. Loaded from the main
 * thread via `import CsvWorker from '@/workers/csvParser.worker?worker'`.
 * Vite handles the worker bundling (worker chunk, correct base path, type
 * declarations) so we don't rely on PapaParse's own `worker: true` flag,
 * which produces a blob URL that doesn't survive Vite's production build
 * when served from a non-root path like /niftystats/.
 *
 * Format dispatch: we sniff the file extension to decide between PapaParse
 * (CSV/TXT) and SheetJS (XLSX/XLS). The SheetJS path lazy-imports the
 * library so the worker chunk only carries it when actually needed; CSV
 * uploads never pay the ~700KB SheetJS cost.
 *
 * Why we do the sniffing in the worker rather than the main thread: the type
 * sniffer is the most expensive part of the pipeline for wide tables (50+
 * columns) because it scans rows once per column. Doing it here keeps the
 * main thread responsive even for the eventual 100k-row, 50-column case.
 *
 * Protocol: main thread sends a `ParseRequest`, worker replies once with a
 * `ParseResponse` and stays alive (the main thread terminates it after the
 * reply lands).
 */

import Papa from 'papaparse'
import type { ParsedColumn, ParsedFile, ParseError } from '@/types/csv'
import type { ColumnType } from '@/types/stats'

// Message contract between main thread and this worker. Exported so the
// main thread can import the types and stay in lockstep.
export interface ParseRequest {
  source:
    | { kind: 'file'; file: File }
    | { kind: 'text'; text: string; filename: string }
}

export type ParseResponse =
  | { ok: true; payload: ParsedFile; warnings: ParseError[] }
  | { ok: false; error: ParseError }

const SNIFF_LIMIT = 200
const SAMPLES_PER_COLUMN = 5

/**
 * Strings we treat as missing-value sentinels. PapaParse keeps them as
 * literal strings ("NA", "N/A", etc.), which would later count as a
 * "category" in categorical columns or break numeric coercion. We map
 * them to empty strings before the column sniff so they show up as
 * proper missing values instead.
 */
const MISSING_SENTINELS = new Set([
  'na',
  'n/a',
  'null',
  'nan',
  '#n/a',
  '#na',
  '-',
  '--',
  '#null!',
])

/** Threshold for the "large file" warning. 5MB or 50k rows. */
const LARGE_FILE_BYTES = 5 * 1024 * 1024
const LARGE_ROW_COUNT = 50_000

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

// Cast self to the worker-specific global. Vite's webworker lib reference
// gives us the right type; the cast just avoids ambient TS quirks.
const ctx = self as unknown as DedicatedWorkerGlobalScope

ctx.addEventListener('message', async (event: MessageEvent<ParseRequest>) => {
  const req = event.data
  const startedAt = performance.now()

  try {
    // Determine filename + format up front so we can dispatch correctly.
    const filename =
      req.source.kind === 'file' ? req.source.file.name : req.source.filename
    const isExcel = /\.xlsx?$/i.test(filename)

    if (isExcel) {
      // Excel path: lazy-load SheetJS, parse the first non-empty sheet,
      // then run the same column-sniffing as CSV. We can only reach this
      // branch with a File source (text doesn't make sense for binary
      // Excel data).
      if (req.source.kind !== 'file') {
        sendError({
          level: 'fatal',
          message: 'Excel content must come from a file upload, not raw text.',
        })
        return
      }
      await handleExcel(req.source.file, filename, startedAt)
      return
    }

    // CSV / TXT path (existing behavior).
    let text: string
    let sizeBytes: number
    if (req.source.kind === 'file') {
      text = await req.source.file.text()
      sizeBytes = req.source.file.size
    } else {
      text = req.source.text
      // Blob is the easiest way to measure UTF-8 byte length without
      // pulling in TextEncoder. Same result, fewer characters of code.
      sizeBytes = new Blob([text]).size
    }

    // Synchronous Papa.parse on the string. Workers are already off the
    // main thread so blocking here is fine.
    const results = Papa.parse<Record<string, string>>(text, {
      header: true,
      skipEmptyLines: 'greedy',
      dynamicTyping: false,
    })

    if (!results.data.length) {
      sendError({
        level: 'fatal',
        message: 'The file appears to be empty or contains no data rows.',
      })
      return
    }

    const headers = results.meta.fields ?? []
    if (!headers.length) {
      sendError({
        level: 'fatal',
        message:
          'Could not find a header row. CSV must have column names on the first line.',
      })
      return
    }

    // Non-fatal parse errors come back via PapaParse's `errors` array.
    // Surface them as warnings so the UI can display them without blocking.
    const warnings: ParseError[] = results.errors.map((err) => ({
      level: 'warning' as const,
      message: `${err.type}: ${err.message}`,
      row: typeof err.row === 'number' ? err.row + 1 : undefined,
    }))

    // Normalize missing-value sentinels in-place. PapaParse hands back
    // "NA", "null", etc. as strings; we map them to empty so downstream
    // consumers (the type sniffer, the Python engine) treat them as missing.
    normalizeSentinels(results.data, headers)

    const columns = sniffColumns(results.data, headers)
    const parseMs = Math.round(performance.now() - startedAt)

    // Big-file awareness: anything past LARGE_FILE_BYTES or LARGE_ROW_COUNT
    // gets a friendly warning so the user knows the Python pass that
    // follows might take noticeable time. Real streaming (chunked Pyodide
    // ingestion) is a future feature; for now the warning at least sets
    // expectations.
    if (sizeBytes >= LARGE_FILE_BYTES || results.data.length >= LARGE_ROW_COUNT) {
      warnings.push({
        level: 'warning',
        message: `Large file (${formatBytes(sizeBytes)}, ${results.data.length.toLocaleString()} rows). Analysis may take a moment.`,
      })
    }

    sendSuccess(
      {
        filename,
        sizeBytes,
        rows: results.data,
        columns,
        parseMs,
      },
      warnings,
    )
  } catch (err) {
    sendError({
      level: 'fatal',
      message:
        err instanceof Error ? err.message : 'Unknown error while parsing the file.',
    })
  }
})

/**
 * Excel-specific parsing path. Lazy-loads SheetJS, picks the first
 * non-empty sheet in the workbook, converts cells to strings (matching
 * PapaParse's `dynamicTyping: false` output), and feeds the result into
 * the same column-sniffer the CSV path uses.
 */
async function handleExcel(
  file: File,
  filename: string,
  startedAt: number,
): Promise<void> {
  // Dynamic import keeps SheetJS out of the CSV-only chunk graph. Defensive
  // unwrap handles both ESM and CJS module shapes (xlsx ships as CJS).
  const xlsxModule = await import('xlsx')
  const XLSX = (xlsxModule as { default?: unknown }).default ?? xlsxModule

  const buffer = await file.arrayBuffer()
  // `cellDates: true` asks SheetJS to coerce date cells to Date objects.
  // `raw: false` (passed later to sheet_to_json) tells it to use the cell's
  // displayed value rather than the raw stored number, which lines up with
  // what the user sees when they open the file in Excel.
  const workbook = (XLSX as {
    read: (data: ArrayBuffer, opts: Record<string, unknown>) => {
      SheetNames: string[]
      Sheets: Record<string, unknown>
    }
  }).read(buffer, { type: 'array', cellDates: true })

  const sheetNames = workbook.SheetNames
  if (sheetNames.length === 0) {
    sendError({
      level: 'fatal',
      message: 'The Excel workbook has no sheets.',
    })
    return
  }

  // Find the first non-empty sheet. Most business workbooks have a single
  // data sheet plus optional summary/lookup sheets; we pick whichever has
  // rows first. Multi-sheet pickers are a v5 polish item.
  let chosenSheetName: string | null = null
  let rows: Array<Record<string, unknown>> = []
  const toJson = (XLSX as {
    utils: {
      sheet_to_json: (
        ws: unknown,
        opts: Record<string, unknown>,
      ) => Array<Record<string, unknown>>
    }
  }).utils.sheet_to_json
  for (const name of sheetNames) {
    const candidate = toJson(workbook.Sheets[name], {
      raw: false,
      defval: '',
    })
    if (candidate.length > 0) {
      chosenSheetName = name
      rows = candidate
      break
    }
  }

  if (chosenSheetName === null || rows.length === 0) {
    sendError({
      level: 'fatal',
      message: 'The Excel workbook has no rows of data.',
    })
    return
  }

  // SheetJS preserves column order via the first row's keys.
  const headers = Object.keys(rows[0])
  if (headers.length === 0) {
    sendError({
      level: 'fatal',
      message:
        'Could not find a header row. The first row of the sheet must contain column names.',
    })
    return
  }

  // Coerce everything to strings so the downstream type sniffer (and the
  // Python engine, which also reads strings) gets a consistent shape.
  const stringRows: Array<Record<string, string>> = rows.map((row) => {
    const out: Record<string, string> = {}
    for (const header of headers) {
      const value = row[header]
      if (value === null || value === undefined) {
        out[header] = ''
      } else if (value instanceof Date) {
        // ISO 8601 keeps the type-sniffer's datetime check happy.
        out[header] = value.toISOString().slice(0, 10)
      } else {
        out[header] = String(value)
      }
    }
    return out
  })

  // Same sentinel normalization as the CSV path.
  normalizeSentinels(stringRows, headers)

  // Multi-sheet workbooks get a non-fatal warning so the user knows we
  // only looked at one sheet.
  const warnings: ParseError[] = []
  if (sheetNames.length > 1) {
    warnings.push({
      level: 'warning',
      message: `Workbook has ${sheetNames.length} sheets; analyzing "${chosenSheetName}" only.`,
    })
  }

  const columns = sniffColumns(stringRows, headers)
  const parseMs = Math.round(performance.now() - startedAt)

  sendSuccess(
    {
      filename,
      sizeBytes: file.size,
      rows: stringRows,
      columns,
      parseMs,
    },
    warnings,
  )
}

/**
 * Walk every row and replace any cell whose trimmed lowercase value is in
 * `MISSING_SENTINELS` with an empty string. Mutates the rows in place; we
 * own them at this point so mutation is fine and saves a copy.
 */
function normalizeSentinels(
  rows: Array<Record<string, string>>,
  headers: string[],
): void {
  for (const row of rows) {
    for (const header of headers) {
      const raw = row[header]
      if (typeof raw === 'string' && raw.length > 0) {
        const trimmed = raw.trim().toLowerCase()
        if (MISSING_SENTINELS.has(trimmed)) {
          row[header] = ''
        }
      }
    }
  }
}

function sendSuccess(payload: ParsedFile, warnings: ParseError[]): void {
  const response: ParseResponse = { ok: true, payload, warnings }
  ctx.postMessage(response)
}

function sendError(error: ParseError): void {
  const response: ParseResponse = { ok: false, error }
  ctx.postMessage(response)
}

/**
 * Type-sniff every column from the first SNIFF_LIMIT non-null values.
 *
 * We err toward "categorical" on ambiguous data because the stats engine
 * downstream can always coerce categorical to numeric if asked, but can't
 * recover lost categorical information.
 */
function sniffColumns(
  rows: Array<Record<string, string>>,
  headers: string[],
): ParsedColumn[] {
  return headers.map((name) => {
    let missingCount = 0
    const samples: string[] = []
    const nonNullValues: string[] = []

    for (let i = 0; i < rows.length; i++) {
      const raw = rows[i]?.[name]
      const value = typeof raw === 'string' ? raw.trim() : ''

      if (!value) {
        missingCount++
        continue
      }

      if (samples.length < SAMPLES_PER_COLUMN) samples.push(value)
      if (nonNullValues.length < SNIFF_LIMIT) nonNullValues.push(value)
    }

    return {
      name,
      type: inferType(nonNullValues),
      missingCount,
      sampleValues: samples,
    }
  })
}

function inferType(samples: string[]): ColumnType {
  if (samples.length === 0) return 'unknown'

  // 90% threshold tolerates a few oddball values without mis-typing.
  const threshold = Math.ceil(samples.length * 0.9)

  let booleanHits = 0
  let dateHits = 0
  let numericHits = 0

  for (const v of samples) {
    if (isBooleanLike(v)) booleanHits++
    if (isDateLike(v)) dateHits++
    if (isNumericLike(v)) numericHits++
  }

  if (booleanHits >= threshold) return 'boolean'
  // Numeric before datetime: raw unix timestamps parse as both, and numeric
  // is the safer interpretation in that ambiguous case.
  if (numericHits >= threshold) return 'numeric'
  if (dateHits >= threshold) return 'datetime'
  return 'categorical'
}

const BOOLEAN_TRUE = new Set(['true', 'yes', 'y', '1', 't'])
const BOOLEAN_FALSE = new Set(['false', 'no', 'n', '0', 'f'])

function isBooleanLike(v: string): boolean {
  const lower = v.toLowerCase()
  return BOOLEAN_TRUE.has(lower) || BOOLEAN_FALSE.has(lower)
}

function isNumericLike(v: string): boolean {
  const cleaned = v.replace(/,/g, '')
  if (cleaned === '') return false
  return /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(cleaned)
}

function isDateLike(v: string): boolean {
  // Require a real separator first because Date.parse is permissive enough
  // to accept "10" as October of the current year.
  if (!/[-/:]/.test(v)) return false
  const parsed = Date.parse(v)
  return !Number.isNaN(parsed)
}
