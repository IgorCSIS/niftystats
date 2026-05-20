/**
 * CSV ingestion + type sniffing.
 *
 * Uses PapaParse in worker mode so a 100k-row CSV doesn't freeze the main
 * thread during parse. PapaParse handles delimiter detection, BOM stripping,
 * and quoted-field edge cases for us, so this module focuses on the parts
 * PapaParse doesn't: column type inference and error normalization.
 *
 * The type sniffer is intentionally simple. It looks at up to the first 200
 * non-null values per column and applies cheap heuristics: parseFloat,
 * Date.parse, boolean keywords. We err toward "categorical" on ambiguous
 * data because that's the safest assumption for the downstream stats engine,
 * which can always coerce categorical to numeric if asked but can't go the
 * other way without losing information.
 */

import Papa from 'papaparse'
import type { ColumnType } from '@/types/stats'
import type { ParseError, ParsedColumn, ParsedFile } from '@/types/csv'

/** How many rows we look at when sniffing column types. */
const SNIFF_LIMIT = 200

/** How many sample values per column we keep for the preview UI. */
const SAMPLES_PER_COLUMN = 5

/**
 * Parse a File (from <input type="file"> or drag-drop) into a ParsedFile.
 *
 * Rejects on fatal errors. Resolves with both the data AND any warnings
 * collected during parse so the UI can surface them without blocking.
 */
export function parseCsvFile(
  file: File,
): Promise<{ data: ParsedFile; warnings: ParseError[] }> {
  return new Promise((resolve, reject) => {
    const startedAt = performance.now()
    const warnings: ParseError[] = []

    Papa.parse<Record<string, string>>(file, {
      // Worker mode keeps parsing off the main thread. PapaParse vendors its
      // own worker bundle so we don't need to write one ourselves.
      worker: true,
      header: true,
      // `skipEmptyLines: 'greedy'` drops both fully empty rows AND rows that
      // are just whitespace. Real-world CSVs from Excel exports often have
      // trailing blank rows that would otherwise pollute the row count.
      skipEmptyLines: 'greedy',
      // `dynamicTyping: false` keeps every value as a string at this stage.
      // We'll let Python do the actual type coercion in milestone 3 so the
      // numbers pandas sees match exactly what the preview shows.
      dynamicTyping: false,
      complete: (results) => {
        const parseMs = Math.round(performance.now() - startedAt)

        if (!results.data.length) {
          reject({
            level: 'fatal' as const,
            message: 'The file appears to be empty or contains no data rows.',
          } satisfies ParseError)
          return
        }

        // PapaParse exposes its own non-fatal errors here. Surface them as
        // warnings rather than reject; most are recoverable (a missing field
        // in one row out of 10,000 isn't worth blocking on).
        for (const err of results.errors) {
          warnings.push({
            level: 'warning',
            message: `${err.type}: ${err.message}`,
            row: typeof err.row === 'number' ? err.row + 1 : undefined,
          })
        }

        const headers = results.meta.fields ?? []
        if (!headers.length) {
          reject({
            level: 'fatal' as const,
            message:
              'Could not find a header row. CSV must have column names on the first line.',
          } satisfies ParseError)
          return
        }

        const columns = sniffColumns(results.data, headers)

        resolve({
          data: {
            filename: file.name,
            sizeBytes: file.size,
            rows: results.data,
            columns,
            parseMs,
          },
          warnings,
        })
      },
      error: (err) => {
        reject({
          level: 'fatal' as const,
          message: err.message || 'Unknown error while parsing the CSV.',
        } satisfies ParseError)
      },
    })
  })
}

/**
 * Parse a CSV string (used for the bundled sample CSVs we fetch from /public).
 * Same return shape as parseCsvFile but takes raw text instead of a File.
 */
export async function parseCsvText(
  text: string,
  filename: string,
): Promise<{ data: ParsedFile; warnings: ParseError[] }> {
  const blob = new Blob([text], { type: 'text/csv' })
  const file = new File([blob], filename, { type: 'text/csv' })
  return parseCsvFile(file)
}

/**
 * Walk every column once, look at the first SNIFF_LIMIT non-null values,
 * and decide the column type. Returns a ParsedColumn for each header.
 *
 * Performance note: we iterate the rows array sniff-limit times here (once
 * per column). For 10k row * 50 col tables this is still under 50ms in
 * practice, so we keep the code simple over going column-major.
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

      if (samples.length < SAMPLES_PER_COLUMN) {
        samples.push(value)
      }

      if (nonNullValues.length < SNIFF_LIMIT) {
        nonNullValues.push(value)
      }
    }

    return {
      name,
      type: inferType(nonNullValues),
      missingCount,
      sampleValues: samples,
    }
  })
}

/**
 * Decide a column's type from a sample of non-null values.
 *
 * Order matters: we check boolean first (most restrictive), then datetime,
 * then numeric, then fall through to categorical. Each check requires
 * roughly 90% of samples to match, so a single malformed value doesn't kick
 * a column out of its real type.
 */
function inferType(samples: string[]): ColumnType {
  if (samples.length === 0) return 'unknown'

  // Threshold for a type to "win". 90% gives us tolerance for a few weird
  // rows in a 200-sample window without being so loose that we mis-type.
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
  // Numeric check before datetime because raw timestamps (like 1714857600)
  // would parse as both, and numeric is the safer interpretation.
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
  // Strip thousands separators (commas in US, periods in some EU locales is
  // out of scope for v2; we accept the dominant US convention). The regex
  // covers integers, decimals, leading minus, and scientific notation.
  const cleaned = v.replace(/,/g, '')
  if (cleaned === '') return false
  return /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(cleaned)
}

function isDateLike(v: string): boolean {
  // We require the string to LOOK like a date (contains a separator) before
  // running Date.parse, because Date.parse is famously permissive and would
  // accept things like "10" as October of the current year.
  if (!/[-/:]/.test(v)) return false
  const parsed = Date.parse(v)
  return !Number.isNaN(parsed)
}

/**
 * Format file size for the preview header. Mirrors the convention used by
 * macOS Finder and Windows Explorer: KB at < 1MB, MB above that.
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}
