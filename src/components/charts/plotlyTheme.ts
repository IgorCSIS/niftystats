/**
 * Plotly theming shared by every chart in the dashboard.
 *
 * These live apart from PlotlyChart.tsx on purpose: a file that exports both
 * a component and plain constants breaks React Fast Refresh, because the
 * bundler can no longer tell whether a change to the module should remount
 * the component tree or not.
 */

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
