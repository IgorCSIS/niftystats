# NiftyStats

Statistical analysis for the rest of us. Drop in a CSV, get descriptive stats, correlations, regression, time-series, and clustering, each explained in plain English. Runs entirely in your browser. Your data never leaves the page.

[Live demo](https://igorcsis.github.io/niftystats/) (link goes live after first deploy)

## Why

Small business owners sit on CSVs of sales, marketing spend, and customer data and have no easy way to ask basic statistical questions of them. The existing options are spreadsheets (limited stats), SaaS analytics tools (expensive, require uploading sensitive data), or hiring an analyst (slow, costs real money). NiftyStats sits in the middle: a free, in-browser tool that runs a proper statistical engine and explains the results.

The hook for non-technical users: nothing you upload ever leaves your browser. The Python engine that does the math runs locally via WebAssembly.

## What's in v1

- Drag-and-drop CSV upload, in-browser parsing with type sniffing.
- Descriptive statistics: means, medians, distributions, missing-value report, outlier flags.
- Correlation matrix (Pearson and Spearman) with heatmap.
- Linear and logistic regression with coefficient interpretation.
- Time-series detection, trend and seasonality decomposition, light forecasting.
- K-means clustering with auto-elbow.
- Two-sample hypothesis testing (t-test, chi-square).
- Plain-English narratives generated from result thresholds (no LLM calls).
- One-click PDF report export with branding.

## Tech stack

- Vite + React 19 + TypeScript 6
- Tailwind v4 for styling, custom dark + emerald token set
- Pyodide for the statistical engine (pandas, numpy, scipy, scikit-learn, statsmodels)
- Plotly.js for charts
- PapaParse for CSV parsing
- jsPDF + html2canvas for the PDF export
- Framer Motion for tasteful section transitions
- GitHub Pages + GitHub Actions for hosting

## Running locally

```powershell
# from C:\Users\Igor\ProjectsPY\niftystats
pnpm install
pnpm dev          # http://localhost:5173
pnpm build        # production bundle in /dist
pnpm preview      # serve the production build locally
```

## Project layout

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the data flow and folder map.

## Deploy

Pushing to `main` builds and deploys to GitHub Pages automatically. One-time repo setup: Settings → Pages → Source → "GitHub Actions". After that, every push lands at `https://igorcsis.github.io/niftystats/`.

## Roadmap notes

- The deterministic narrative templates are intentional for v1. A future opt-in "AI explain" mode could pipe results through a local Ollama instance for richer prose. That requires the user to self-host, which is a feature, not a friction: it keeps the privacy story intact.
- Excel and JSON inputs are deliberately out of scope for v1. CSV-only ships faster and covers 90% of real-world spreadsheets.

## License

MIT.
