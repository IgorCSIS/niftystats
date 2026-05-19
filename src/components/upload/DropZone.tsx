/**
 * DropZone. Milestone 2 will fill this in.
 *
 * Planned behavior:
 *   - Drag-and-drop a CSV anywhere on the zone.
 *   - Click-to-select fallback for keyboard / accessibility users.
 *   - PapaParse worker for parsing without blocking the main thread on big
 *     files (100k rows is the rough upper bound for v1).
 *   - Type-sniffing pass that infers numeric vs. categorical vs. datetime per
 *     column, so the stats engine gets clean inputs.
 *   - Surface parse errors clearly. Real CSVs from small business owners are
 *     mixed-encoding, sometimes BOM-prefixed, occasionally semicolon-delimited.
 *     We catch and explain instead of failing silently.
 */
export function DropZone() {
  return null
}
