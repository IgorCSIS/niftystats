/**
 * PDF export.
 *
 * Renders the dashboard to a multi-page A4 PDF by snapshotting each
 * `data-pdf-block` element independently and packing the resulting
 * images onto pages.
 *
 * Why per-block snapshots (not one big snapshot + slicing): the previous
 * "slice one big snapshot at calculated break points" approach had a
 * subtle but fatal flaw. html-to-image clones the DOM into an SVG
 * foreignObject and renders it there. The rendered positions don't
 * exactly match `getBoundingClientRect` values from the live DOM (the
 * foreignObject's CSS resolution context differs slightly from the
 * document's). So break points computed from the live DOM landed inside
 * cards rather than at their natural boundaries in the snapshot.
 *
 * Per-block snapshots dodge this entirely: each block is its own atomic
 * image. There's no way to cut inside a block because we never slice
 * snapshot data. Pages may end with empty space when the next block won't
 * fit, which is the expected behavior of any paginated document with
 * fixed-height pages.
 *
 * Trade-offs: this approach takes more wall time because we run
 * html-to-image once per block instead of once total. For typical
 * dashboards (10-20 blocks) it's still under 10 seconds, which is
 * acceptable for a Download button. We parallelize the snapshots with
 * `Promise.all` to cut wall time.
 */

import type { ExportOptions, JsPdfInstance } from './_types'

// ----- Layout constants (all in millimeters at 72 DPI base) -----

const PAGE_WIDTH_MM = 210
const PAGE_HEIGHT_MM = 297

const MARGIN_X_MM = 12
const MARGIN_TOP_MM = 18
const MARGIN_BOTTOM_MM = 14

const HEADER_HEIGHT_MM = 12
const FOOTER_HEIGHT_MM = 8

const CONTENT_WIDTH_MM = PAGE_WIDTH_MM - MARGIN_X_MM * 2
const CONTENT_HEIGHT_MM =
  PAGE_HEIGHT_MM - MARGIN_TOP_MM - MARGIN_BOTTOM_MM - HEADER_HEIGHT_MM - FOOTER_HEIGHT_MM

/** Vertical gap between blocks on a single page, in mm. */
const BLOCK_GAP_MM = 4

/** Resolution multiplier passed to html-to-image. */
const RENDER_SCALE = 2

const PAGE_BG = '#020617'
const ACCENT = '#10b981'

/**
 * Generate and trigger download of the PDF report. Resolves when the
 * download is initiated. Throws on capture or PDF construction failure
 * so the UI can show a clear error state.
 */
export async function exportReportPdf(options: ExportOptions): Promise<void> {
  const { target, csvFilename } = options

  const [htmlToImageModule, jsPdfModule] = await Promise.all([
    import('html-to-image'),
    import('jspdf'),
  ])
  const toCanvasFn = (htmlToImageModule.toCanvas ??
    (htmlToImageModule as { default?: { toCanvas?: unknown } }).default?.toCanvas) as
    | ((el: HTMLElement, opts?: Record<string, unknown>) => Promise<HTMLCanvasElement>)
    | undefined
  const jsPDFCtor = (jsPdfModule.jsPDF ?? (jsPdfModule as { default?: unknown }).default) as
    | (new (opts: Record<string, unknown>) => JsPdfInstance)
    | undefined

  if (typeof toCanvasFn !== 'function' || !jsPDFCtor) {
    throw new Error('PDF libraries failed to load.')
  }

  // Let any animations or chart layouts settle before snapshotting.
  await new Promise((resolve) => setTimeout(resolve, 400))

  // Find every block. Order matters: querySelectorAll returns elements in
  // document order, which is the order we want them to appear in the PDF.
  let blockEls = Array.from(
    target.querySelectorAll<HTMLElement>('[data-pdf-block]'),
  )
  // Fallback: if nothing is marked, snapshot the whole target as a single
  // unit. Better than producing an empty PDF.
  if (blockEls.length === 0) blockEls = [target]

  const snapshotOpts = {
    backgroundColor: PAGE_BG,
    pixelRatio: RENDER_SCALE,
    cacheBust: true,
  }

  // Snapshot all blocks in parallel. html-to-image releases the event
  // loop while waiting for image loads, so we get most of the throughput
  // benefit even on a single CPU core.
  const canvases = await Promise.all(
    blockEls.map((el) => toCanvasFn(el, snapshotOpts)),
  )

  // Pair each canvas with its rendered mm-height. We scale each block to
  // CONTENT_WIDTH_MM (fixed) and let the height scale proportionally.
  const blocks: Array<{ canvas: HTMLCanvasElement; heightMm: number }> = []
  for (const canvas of canvases) {
    if (canvas.width === 0 || canvas.height === 0) continue
    const heightMm = (canvas.height / canvas.width) * CONTENT_WIDTH_MM
    blocks.push({ canvas, heightMm })
  }

  if (blocks.length === 0) {
    throw new Error('Nothing to export, the dashboard appears empty.')
  }

  // Pack blocks onto pages, greedy fill. When the next block won't fit on
  // the current page, start a new page. Blocks taller than a full page
  // get capped at the page height (rare; would only happen on extremely
  // wide correlation heatmaps or huge top-values tables).
  type PackedBlock = {
    canvas: HTMLCanvasElement
    heightMm: number
    topMm: number
  }
  const pages: PackedBlock[][] = [[]]
  let currentTop = 0
  for (const block of blocks) {
    const effectiveHeight = Math.min(block.heightMm, CONTENT_HEIGHT_MM)

    // Start a new page if this block won't fit AND the current page
    // already has something on it. (The "already has something" check
    // avoids producing infinite blank pages for an oversized first block.)
    if (
      currentTop + effectiveHeight > CONTENT_HEIGHT_MM &&
      pages[pages.length - 1].length > 0
    ) {
      pages.push([])
      currentTop = 0
    }

    pages[pages.length - 1].push({
      canvas: block.canvas,
      heightMm: effectiveHeight,
      topMm: currentTop,
    })
    currentTop += effectiveHeight + BLOCK_GAP_MM
  }

  // Build the PDF.
  const pdf = new jsPDFCtor({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
    compress: true,
  })

  const generatedAt = new Date().toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })

  for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
    if (pageIndex > 0) pdf.addPage()

    pdf.setFillColor(PAGE_BG)
    pdf.rect(0, 0, PAGE_WIDTH_MM, PAGE_HEIGHT_MM, 'F')

    drawHeader(pdf, {
      csvFilename,
      generatedAt,
      pageIndex,
      pageCount: pages.length,
    })

    const contentTopMm = MARGIN_TOP_MM + HEADER_HEIGHT_MM
    for (const block of pages[pageIndex]) {
      const imgData = block.canvas.toDataURL('image/jpeg', 0.92)
      pdf.addImage(
        imgData,
        'JPEG',
        MARGIN_X_MM,
        contentTopMm + block.topMm,
        CONTENT_WIDTH_MM,
        block.heightMm,
        undefined,
        'FAST',
      )
    }

    drawFooter(pdf)
  }

  const safeName = csvFilename
    .replace(/\.csv$/i, '')
    .replace(/[^a-z0-9_-]+/gi, '-')
    .toLowerCase()
  const dateStamp = new Date().toISOString().slice(0, 10)
  pdf.save(`niftystats-${safeName}-${dateStamp}.pdf`)
}

// ----- Header / footer drawing helpers -----

function drawHeader(
  pdf: JsPdfInstance,
  meta: {
    csvFilename: string
    generatedAt: string
    pageIndex: number
    pageCount: number
  },
): void {
  const y = MARGIN_TOP_MM
  const dotRadius = 1.5

  pdf.setFillColor(ACCENT)
  pdf.circle(MARGIN_X_MM + dotRadius, y + dotRadius + 0.5, dotRadius, 'F')

  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(10)
  pdf.setTextColor('#f8fafc')
  pdf.text('NIFTYSTATS', MARGIN_X_MM + dotRadius * 2 + 2, y + dotRadius + 1.5)

  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(8)
  pdf.setTextColor('#94a3b8')
  const metaLine = `${meta.csvFilename}  ·  ${meta.generatedAt}  ·  Page ${meta.pageIndex + 1} of ${meta.pageCount}`
  pdf.text(metaLine, PAGE_WIDTH_MM - MARGIN_X_MM, y + dotRadius + 1.5, {
    align: 'right',
  })

  pdf.setDrawColor('#1e293b')
  pdf.setLineWidth(0.2)
  pdf.line(
    MARGIN_X_MM,
    y + HEADER_HEIGHT_MM - 4,
    PAGE_WIDTH_MM - MARGIN_X_MM,
    y + HEADER_HEIGHT_MM - 4,
  )
}

function drawFooter(pdf: JsPdfInstance): void {
  const y = PAGE_HEIGHT_MM - MARGIN_BOTTOM_MM

  pdf.setDrawColor('#1e293b')
  pdf.setLineWidth(0.2)
  pdf.line(MARGIN_X_MM, y - 3, PAGE_WIDTH_MM - MARGIN_X_MM, y - 3)

  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(7.5)
  pdf.setTextColor('#64748b')
  pdf.text(
    'Generated by NiftyStats. Your data never left your browser, this report was produced locally on your machine.',
    PAGE_WIDTH_MM / 2,
    y + 1,
    { align: 'center' },
  )
}
