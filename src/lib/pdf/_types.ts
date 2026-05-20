/**
 * Shared types for the PDF export. Split into its own file so the main
 * exportReport.ts can stay focused on the rendering logic.
 */

export interface ExportOptions {
  /** The DOM element to snapshot. Anything inside marked with `data-pdf-block`
   *  will be captured as a separate atomic block. */
  target: HTMLElement
  /** Original CSV filename, included in the PDF header per page. */
  csvFilename: string
}

/**
 * Minimal subset of the jsPDF API we use. Hand-typed so we avoid pulling
 * the full jsPDF type graph into the main bundle's type-check pass.
 */
export interface JsPdfInstance {
  addPage(): void
  setFillColor(color: string): void
  setDrawColor(color: string): void
  setTextColor(color: string): void
  setLineWidth(width: number): void
  setFont(family: string, style: string): void
  setFontSize(size: number): void
  rect(x: number, y: number, w: number, h: number, style?: string): void
  circle(x: number, y: number, r: number, style?: string): void
  line(x1: number, y1: number, x2: number, y2: number): void
  text(text: string, x: number, y: number, options?: { align?: string }): void
  addImage(
    imageData: string,
    format: string,
    x: number,
    y: number,
    w: number,
    h: number,
    alias?: string,
    compression?: string,
  ): void
  save(filename: string): void
}
