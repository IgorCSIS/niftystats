/**
 * RegressionCard: one card per regression target.
 *
 * Layout mirrors the descriptive ColumnCard structure to keep the
 * dashboard visually consistent:
 *
 *   [target name] [R² badge]
 *   --------------------------------------
 *   StatGrid (R², adjusted R², n, top-predictor name)
 *   --------------------------------------
 *   Coefficient table: feature, raw coef, standardized, p
 *   --------------------------------------
 *   NarrativeList: R² interpretation, top predictor, multicollinearity
 *
 * The coefficient table is the dashboard's most technical surface. We keep
 * it tight (5 rows max) and surface the narrative bullets beneath so a
 * non-technical reader can stop reading after the bullets without missing
 * the headline finding.
 */

import { Target, TrendingUp, AlertTriangle } from 'lucide-react'
import type { RegressionAnalysis } from '@/types/stats'
import { buildRegressionNarratives } from '@/lib/narratives/relational'
import { formatCount, formatNumber } from '@/lib/narratives/format'
import { StatGrid } from './StatGrid'
import { NarrativeList } from './NarrativeList'

interface RegressionCardProps {
  regression: RegressionAnalysis
}

/** How many coefficients we render in the table. Capped so the card stays scannable. */
const COEF_TABLE_LIMIT = 8

export function RegressionCard({ regression }: RegressionCardProps) {
  const narratives = buildRegressionNarratives(regression)
  const visibleCoefs = regression.coefficients.slice(0, COEF_TABLE_LIMIT)

  return (
    <section className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/40">
      <header className="flex items-center justify-between gap-3 border-b border-slate-800 px-5 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="inline-flex flex-shrink-0 items-center gap-1 rounded border border-emerald-900/60 bg-emerald-950/40 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-emerald-300">
            <Target className="h-3 w-3" aria-hidden />
            predicting
          </span>
          <span className="truncate font-mono text-sm font-medium text-slate-100">
            {regression.target}
          </span>
        </div>
        <RSquaredBadge value={regression.rSquared} skipped={!!regression.skippedReason} />
      </header>

      {regression.skippedReason ? (
        <div className="px-5 py-6 text-sm text-slate-400">
          <div className="flex items-start gap-2">
            <AlertTriangle
              className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-400"
              aria-hidden
            />
            <div>{regression.skippedReason}</div>
          </div>
        </div>
      ) : (
        <>
          <div className="px-5 py-4">
            <StatGrid items={buildStatItems(regression)} />
          </div>

          {visibleCoefs.length > 0 && (
            <div className="border-t border-slate-800 px-5 py-4">
              <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-slate-500">
                Predictors (sorted by impact)
              </div>
              {/* overflow-x-auto so the 5-column predictor table can scroll
                  horizontally on narrow viewports (375px mobile) without
                  forcing the entire card layout to break. Tablet+ has
                  enough room to render flush. */}
              <div className="-mx-1 overflow-x-auto">
                <table className="w-full min-w-[460px] text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-500">
                      <th className="py-1.5 pl-1 pr-3 font-mono font-normal">
                        feature
                      </th>
                      <th className="py-1.5 pr-3 text-right font-mono font-normal">
                        coef
                      </th>
                      <th className="py-1.5 pr-3 text-right font-mono font-normal">
                        std. coef
                      </th>
                      <th className="py-1.5 pr-3 text-right font-mono font-normal">
                        p
                      </th>
                      <th className="py-1.5 pr-1 font-mono font-normal"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleCoefs.map((coef) => (
                      <tr
                        key={coef.feature}
                        className="border-b border-slate-800/50 last:border-0"
                      >
                        <td className="py-1.5 pl-1 pr-3 font-mono text-slate-200">
                          {coef.feature}
                        </td>
                        <td className="py-1.5 pr-3 text-right font-mono text-slate-300">
                          {formatNumber(coef.estimate)}
                        </td>
                        <td className="py-1.5 pr-3 text-right font-mono text-slate-300">
                          {formatNumber(coef.standardizedEstimate)}
                        </td>
                        <td className="py-1.5 pr-3 text-right font-mono text-slate-300">
                          {formatPValueShort(coef.pValue)}
                        </td>
                        <td className="py-1.5 pr-1 text-right">
                          {coef.isSignificant ? (
                            <span
                              className="font-mono text-[10px] text-[var(--color-accent-bright)]"
                              title="p < 0.05"
                            >
                              ★
                            </span>
                          ) : (
                            <span className="font-mono text-[10px] text-slate-600">
                              —
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {regression.coefficients.length > COEF_TABLE_LIMIT && (
                <div className="mt-2 font-mono text-[10px] text-slate-500">
                  + {regression.coefficients.length - COEF_TABLE_LIMIT} more,
                  hidden for readability
                </div>
              )}
            </div>
          )}

          <div className="border-t border-slate-800 px-5 pb-5 pt-4">
            <NarrativeList narratives={narratives} />
          </div>
        </>
      )}
    </section>
  )
}

/**
 * Big R² badge in the header. Green band for excellent fit, amber for
 * modest, red-ish for poor. Gives the user a single-glance read on whether
 * the regression is worth looking at in detail.
 */
function RSquaredBadge({ value, skipped }: { value: number; skipped: boolean }) {
  if (skipped) {
    return (
      <span className="font-mono text-xs text-slate-500" title="Not run">
        skipped
      </span>
    )
  }

  let tone: string
  if (value >= 0.7) {
    tone = 'border-emerald-700 bg-emerald-950/60 text-emerald-300'
  } else if (value >= 0.4) {
    tone = 'border-amber-800 bg-amber-950/40 text-amber-300'
  } else {
    tone = 'border-slate-700 bg-slate-900 text-slate-400'
  }
  return (
    <span
      className={`flex flex-shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-xs ${tone}`}
      title={`R² = ${value.toFixed(3)}`}
    >
      <TrendingUp className="h-3 w-3" aria-hidden />
      R² {value.toFixed(2)}
    </span>
  )
}

function buildStatItems(
  reg: RegressionAnalysis,
): Array<{ label: string; value: string; detail?: string }> {
  const items = [
    { label: 'R²', value: reg.rSquared.toFixed(3) },
    { label: 'adj. R²', value: reg.adjustedRSquared.toFixed(3) },
    { label: 'observations', value: formatCount(reg.nObservations) },
    {
      label: 'predictors',
      value: formatCount(reg.coefficients.length),
      detail: `${reg.coefficients.filter((c) => c.isSignificant).length} significant`,
    },
  ]
  return items
}

function formatPValueShort(p: number): string {
  if (p < 0.001) return '< 0.001'
  if (p < 0.01) return p.toFixed(3)
  return p.toFixed(2)
}
