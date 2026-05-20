/**
 * CSV ingestion, main-thread entry point.
 *
 * This module is the API surface for the rest of the app. The heavy lifting
 * (PapaParse + type sniffing) happens in a Web Worker bundled by Vite via
 * the `?worker` import syntax, so neither the parse nor the sniff can block
 * the main thread on big files.
 *
 * We create a fresh worker per parse and terminate it on completion. That
 * costs a few milliseconds of startup per file, which is negligible
 * compared to even a small parse (~50ms for a 1k-row CSV). The alternative,
 * keeping a long-lived worker, would let us pool but complicates lifecycle
 * (race conditions if two parses overlap, leak risk if a parse never
 * resolves). Spinning up per parse is simpler and easy to reason about.
 */

import CsvWorker from '@/workers/csvParser.worker?worker'
import type {
  ParseRequest,
  ParseResponse,
} from '@/workers/csvParser.worker'
import type { ParseError, ParsedFile } from '@/types/csv'

/** Parse a File (drag-drop or click-to-select) into a ParsedFile via worker. */
export function parseCsvFile(
  file: File,
): Promise<{ data: ParsedFile; warnings: ParseError[] }> {
  return runWorker({ source: { kind: 'file', file } })
}

/** Parse a string (used for the bundled /public sample CSVs) via worker. */
export function parseCsvText(
  text: string,
  filename: string,
): Promise<{ data: ParsedFile; warnings: ParseError[] }> {
  return runWorker({ source: { kind: 'text', text, filename } })
}

/**
 * Send a ParseRequest to a fresh worker and resolve once it replies.
 *
 * Both success and error paths terminate the worker so we don't leak. The
 * Promise rejects with the structured ParseError from the worker, which
 * preserves the level (fatal vs warning) for the UI to render.
 */
function runWorker(
  request: ParseRequest,
): Promise<{ data: ParsedFile; warnings: ParseError[] }> {
  return new Promise((resolve, reject) => {
    const worker = new CsvWorker()

    worker.addEventListener(
      'message',
      (event: MessageEvent<ParseResponse>) => {
        const resp = event.data
        worker.terminate()
        if (resp.ok) {
          resolve({ data: resp.payload, warnings: resp.warnings })
        } else {
          reject(resp.error)
        }
      },
      { once: true },
    )

    worker.addEventListener(
      'error',
      (event) => {
        worker.terminate()
        // The browser fires this for uncaught exceptions inside the worker.
        // Wrap into our ParseError shape so the caller has consistent
        // handling regardless of failure mode.
        reject({
          level: 'fatal',
          message: event.message || 'CSV parser worker crashed unexpectedly.',
        } satisfies ParseError)
      },
      { once: true },
    )

    worker.postMessage(request)
  })
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
