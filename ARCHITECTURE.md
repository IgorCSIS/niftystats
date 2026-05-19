# NiftyStats Architecture

One page. Two diagrams worth of words. Update this as the system grows.

## One-line summary

A static React app that runs a Python statistical engine inside the user's browser via Pyodide. No server, no data egress.

## Why this shape

Three constraints drive every architectural choice:

1. **$0 hosting budget.** GitHub Pages only. That forces static-only delivery, which forces all computation client-side.
2. **Privacy is a feature.** Small business owners refuse to upload financials to a SaaS tool they don't recognize. Running the engine in the user's browser turns "we promise not to look" into "we literally cannot look."
3. **Trust through determinism.** A non-technical user reading a stat narrative needs the same words for the same inputs every time. Template-based copy beats LLM output here, even setting aside cost and latency.

## Data flow

```
CSV file -> DropZone -> PapaParse (web worker)
                                  |
                              parsed rows + sniffed types
                                  |
                                  v
                             Pyodide runtime  <-- lazy-loaded once
                                  |
                              engine.run(payload)
                                  |
                                  v
                             AnalysisResult dict
                                  |
                                  v
                       Narrative builders (TypeScript)
                                  |
                                  v
                       Dashboard sections (React + Plotly)
                                  |
                                  v
                       PDF exporter (html2canvas + jsPDF)
```

1. **Upload.** The user drops a CSV into `<DropZone>`. PapaParse streams it client-side into an in-memory array of objects, with type sniffing for numeric vs. categorical vs. datetime columns. Malformed rows surface as parse errors before reaching the engine.

2. **Bootstrap.** `lib/pyodide/client.ts` lazy-loads Pyodide on first upload (CDN bundle, ~10MB), then imports pandas, numpy, scipy, scikit-learn, and statsmodels. The UI shows a deliberate "warming up the engine" state with named steps so the wait reads as intentional progress, not a frozen page.

3. **Compute.** `runStats.ts` serializes the parsed CSV as a payload and calls `engine.run(payload)` inside Pyodide. The Python side reconstructs a DataFrame and dispatches to three modules: `descriptive`, `relational`, `advanced`. Each returns a typed dict matching `src/types/stats.ts`.

4. **Narrate.** Back in JS, the result object feeds templated narrative builders in `lib/narratives/`. Each builder reads thresholds (e.g., |r| > 0.7 = "strong correlation") and emits business-friendly prose. Deterministic, fast, no model calls.

5. **Render.** The dashboard mounts three sections (Descriptive, Relational, Advanced), each gated on whether the data supports it (no time-series section if no date column was detected). Charts render via Plotly with a custom dark theme.

6. **Export.** `ReportExporter` walks the DOM with html2canvas, paginates chart blocks, and assembles a multi-page PDF via jsPDF with NiftyStats branding and a summary header.

## Key boundaries

- **Pyodide is the only computation surface.** No statistical logic lives in JS. JS owns I/O, layout, and narrative templates only. If you find yourself reaching for a stats library on the JS side, the answer is: put it in the Python module.
- **The result object is the contract.** Adding a new analysis means three diffs: a new Python module returning a typed slice of the result, a new narrative builder, and a new React section. Each diff is reviewable on its own.
- **Charts read from the result object, not from raw CSVs.** Keeps the visualization layer dumb and the Python side authoritative.

## Folder map

```
src/
  components/    React components, grouped by feature (upload, dashboard, charts, pdf)
  lib/           JS utilities (pyodide bootstrap, papaparse wrapper, narrative builders)
  python/        Python modules executed inside Pyodide
  types/         TypeScript interfaces, source of truth for the JS<->Python contract
  pages/         Top-level route components
```

## Deployment

`.github/workflows/deploy.yml` builds on push to `main` and publishes `dist/` to GitHub Pages using the official `actions/deploy-pages` action. Vite is configured with `base: '/niftystats/'` so asset paths resolve under the Pages subpath at `https://igorcsis.github.io/niftystats/`.

## Open questions for later milestones

- **Pyodide caching.** First load is ~10s. Service worker for offline + faster repeat visits, or just rely on browser HTTP cache? Decision deferred until milestone 8.
- **CSV streaming.** PapaParse worker mode handles up to ~100k rows comfortably. Above that we need chunked passes through the engine; deferring unless real users hit the wall.
- **Future LLM narratives.** The deterministic templates are v1. A future opt-in "AI explain" mode could call a local Ollama instance via a self-host README path. Not part of any current milestone.
