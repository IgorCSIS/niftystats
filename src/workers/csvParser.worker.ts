/// <reference lib="webworker" />

/**
 * CSV parsing + type sniffing worker.
 *
 * Loaded from the main thread via `import CsvWorker from '@/workers/csvParser.worker?worker'`.
 * Vite handles the worker bundling (worker chunk, correct base path, type
 * declarations) so we don't rely on PapaParse's own `worker: true` flag,
 * which produces a blob URL that doesn't survive Vite's production build
 * when served from a non-root path like /niftystats/.
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

// Cast self to the worker-specific global. Vite's webworker lib reference
// gives us the right type; the cast just avoids ambient TS quirks.
const ctx = self as unknown as DedicatedWorkerGlobalScope

ctx.addEventListener('message', async (event: MessageEvent<ParseRequest>) => {
  const req = event.data
  const startedAt = performance.now()

  try {
    // Normalize both sources (File and raw text) into a single string +
    // metadata triple so the rest of the function doesn't branch.
    let text: string
    let filename: string
    let sizeBytes: number

    if (req.source.kind === 'file') {
      text = await req.source.file.text()
      filename = req.source.file.name
      sizeBytes = req.source.file.size
    } else {
      text = req.source.text
      filename = req.source.filename
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

    const columns = sniffColumns(results.data, headers)
    const parseMs = Math.round(performance.now() - startedAt)

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
        err instanceof Error ? err.message : 'Unknown error while parsing the CSV.',
    })
  }
})

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
