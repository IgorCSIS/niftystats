/**
 * PlotlyChart, a lazy-loaded React wrapper around Plotly.js.
 *
 * Why lazy: Plotly is ~1MB minified. Loading it on initial page-render
 * would bloat the bundle for visitors who never click Analyze. With
 * React.lazy + Suspense, Plotly's chunk only downloads when the dashboard
 * first tries to render a chart.
 *
 * Why the factory: `react-plotly.js` exports a default component that pulls
 * in the full Plotly bundle. We use the factory variant paired with
 * `plotly.js-dist-min` to ship the smaller bundle while keeping the React
 * binding the same.
 *
 * Why loose typing on the wrapper props: Plotly's TS types are detailed
 * but expressing every valid combination of trace types in our chart
 * builders would triple the amount of code with no runtime benefit. We
 * accept `data` and `layout` as `unknown` here, cast once inside, and let
 * each chart component own its own shape. Runtime is unaffected.
 */

import { Suspense, lazy } from 'react'
import type { CSSProperties, ComponentType } from 'react'
import type { PlotParams } from 'react-plotly.js'

/**
 * Lazy chunk: react-plotly.js/factory + plotly.js-dist-min.
 *
 * Both are CommonJS modules whose ESM-interop shape varies across bundlers
 * (default-on-module vs module-is-the-default vs nested-default), so we
 * resolve the actual function/library defensively rather than assuming a
 * fixed shape. Belt-and-suspenders, but it's the only way to survive Vite
 * dev mode, Vite prod build, and whatever Rollup decides to do per release.
 */
const PlotComponent = lazy(async () => {
  const [factoryModule, plotlyModule] = await Promise.all([
    import('react-plotly.js/factory'),
    import('plotly.js-dist-min'),
  ])

  const createPlotlyComponent = resolveCallable(factoryModule)
  if (!createPlotlyComponent) {
    throw new Error(
      "Could not resolve the react-plotly.js/factory export. Module shape: " +
        describeModule(factoryModule),
    )
  }

  const plotlyLib = resolveDefault(plotlyModule)
  const Plot = createPlotlyComponent(plotlyLib)
  return { default: Plot as unknown as ComponentType<PlotParams> }
})

/**
 * Walk the common CJS-default shapes looking for a function. Returns the
 * function if found, otherwise null. Used to dig the factory function out
 * of whatever wrapping Vite has applied to the CJS export.
 */
function resolveCallable(mod: unknown): ((plotly: unknown) => unknown) | null {
  if (typeof mod === 'function') return mod as (plotly: unknown) => unknown
  const candidate = mod as { default?: unknown }
  if (typeof candidate?.default === 'function') {
    return candidate.default as (plotly: unknown) => unknown
  }
  // Some bundlers wrap CJS defaults twice (mod.default.default). Cheap to check.
  const inner = (candidate?.default as { default?: unknown })?.default
  if (typeof inner === 'function') return inner as (plotly: unknown) => unknown
  return null
}

/**
 * Same idea as resolveCallable but for non-callable defaults (the Plotly
 * library object). Returns the module itself if it has no `default`.
 */
function resolveDefault(mod: unknown): unknown {
  const candidate = mod as { default?: unknown }
  return candidate?.default ?? mod
}

/** Diagnostic helper for the error path. Never runs in the happy path. */
function describeModule(mod: unknown): string {
  if (mod === null || mod === undefined) return String(mod)
  if (typeof mod !== 'object') return typeof mod
  return Object.keys(mod as object).join(',') || '(no enumerable keys)'
}

/**
 * Shared dark-theme layout. Component-specific layouts can spread this and
 * override individual fields.
 */
export const DARK_LAYOUT = {
  paper_bgcolor: 'rgba(0,0,0,0)',
  plot_bgcolor: 'rgba(0,0,0,0)',
  font: {
    color: '#94a3b8', // slate-400
    family: "Inter, 'Segoe UI', system-ui, sans-serif",
    size: 11,
  },
  xaxis: {
    gridcolor: '#1e293b', // slate-800
    linecolor: '#334155', // slate-700
    zerolinecolor: '#334155',
    tickcolor: '#334155',
    tickfont: { color: '#94a3b8', size: 10 },
  },
  yaxis: {
    gridcolor: '#1e293b',
    linecolor: '#334155',
    zerolinecolor: '#334155',
    tickcolor: '#334155',
    tickfont: { color: '#94a3b8', size: 10 },
  },
  margin: { t: 10, b: 35, l: 50, r: 10 },
  showlegend: false,
  hoverlabel: {
    bgcolor: '#0f172a',
    bordercolor: '#1e293b',
    font: {
      color: '#e2e8f0',
      family: 'JetBrains Mono, monospace',
      size: 11,
    },
  },
} as const

/** Default Plotly config: hide the modebar (noisy on dashboards). */
export const PLOTLY_CONFIG = {
  displayModeBar: false,
  responsive: true,
  staticPlot: false,
} as const

/** Skeleton shown while the Plotly chunk downloads. */
function ChartSkeleton({ height }: { height: number }) {
  return (
    <div
      role="status"
      aria-label="Loading chart"
      className="flex items-center justify-center rounded border border-slate-800 bg-slate-950/40"
      style={{ height }}
    >
      <div className="font-mono text-[10px] uppercase tracking-wider text-slate-600">
        loading chart…
      </div>
    </div>
  )
}

/**
 * Public props. We deliberately accept `unknown` for data/layout/config so
 * each chart component can author its Plotly shape in plain object form
 * without fighting the TS types. The wrapper does the cast.
 */
interface PlotlyChartProps {
  data: unknown
  layout?: unknown
  config?: unknown
  height?: number
  style?: CSSProperties
}

export function PlotlyChart({
  data,
  layout,
  config,
  height = 220,
  style,
}: PlotlyChartProps) {
  return (
    <Suspense fallback={<ChartSkeleton height={height} />}>
      <PlotComponent
        data={data as PlotParams['data']}
        layout={layout as PlotParams['layout']}
        config={config as PlotParams['config']}
        style={{ width: '100%', height, ...style }}
        useResizeHandler
      />
    </Suspense>
  )
}
