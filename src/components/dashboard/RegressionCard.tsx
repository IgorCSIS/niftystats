/**
 * RegressionCard: one card per regression target.
 *
 * Handles both linear regression (continuous numeric target) and logistic
 * regression (boolean target) via a discriminated union on `kind`.
 *
 * Linear layout:
 *   [target] [R² badge]
 *   StatGrid: R², adj R², n, predictors
 *   Predictor table: feature, coef, std coef, p
 *   Narratives
 *
 * Logistic layout:
 *   [target] [AUC badge]
 *   StatGrid: AUC, accuracy, n, class balance
 *   Predictor table: feature, odds ratio, std coef, p
 *   Narratives
 *
 * The visual chrome (card layout, hover, type badge) is identical between
 * the two kinds; only the column labels and the badge content change.
 */

import { Target, TrendingUp, AlertTriangle, GitBranch } from 'lucide-react'
import type {
  LinearRegressionAnalysis,
  LogisticRegressionAnalysis,
  RegressionAnalysis,
} from '@/types/stats'
import {
  buildLinearRegressionNarratives,
  buildLogisticRegressionNarratives,
} from '@/lib/narratives/relational'
import { formatCount, formatNumber, formatPct } from '@/lib/narratives/format'
import { StatGrid } from './StatGrid'
import { NarrativeList } from './NarrativeList'

interface RegressionCardProps {
  regression: RegressionAnalysis
}

const COEF_TABLE_LIMIT = 8

export function RegressionCard({ regression }: RegressionCardProps) {
  if (regression.kind === 'linear') {
    return <LinearCard regression={regression} />
  }
  return <LogisticCard regression={regression} />
}

// ----- Linear (kept tightly aligned with the v3 implementation) -----

function LinearCard({ regression }: { regression: LinearRegressionAnalysis }) {
  const narratives = buildLinearRegressionNarratives(regression)
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
        <SkippedBody reason={regression.skippedReason} />
      ) : (
        <>
          <div className="px-5 py-4">
            <StatGrid
              items={[
                { label: 'R²', value: regression.rSquared.toFixed(3) },
                { label: 'adj. R²', value: regression.adjustedRSquared.toFixed(3) },
                { label: 'observations', value: formatCount(regression.nObservations) },
                {
                  label: 'predictors',
                  value: formatCount(regression.coefficients.length),
                  detail: `${regression.coefficients.filter((c) => c.isSignificant).length} significant`,
                },
              ]}
            />
          </div>

          {visibleCoefs.length > 0 && (
            <div className="border-t border-slate-800 px-5 py-4">
              <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-slate-500">
                Predictors (sorted by impact)
              </div>
              <div className="-mx-1 overflow-x-auto">
                <table className="w-full min-w-[460px] text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-500">
                      <th className="py-1.5 pl-1 pr-3 font-mono font-normal">feature</th>
                      <th className="py-1.5 pr-3 text-right font-mono font-normal">coef</th>
                      <th className="py-1.5 pr-3 text-right font-mono font-normal">
                        std. coef
                      </th>
                      <th className="py-1.5 pr-3 text-right font-mono font-normal">p</th>
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
                            <span className="font-mono text-[10px] text-slate-600">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {regression.coefficients.length > COEF_TABLE_LIMIT && (
                <div className="mt-2 font-mono text-[10px] text-slate-500">
                  + {regression.coefficients.length - COEF_TABLE_LIMIT} more, hidden for
                  readability
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

// ----- Logistic -----

function LogisticCard({ regression }: { regression: LogisticRegressionAnalysis }) {
  const narratives = buildLogisticRegressionNarratives(regression)
  const visibleCoefs = regression.coefficients.slice(0, COEF_TABLE_LIMIT)
  const truePct = regression.nObservations
    ? regression.trueCount / regression.nObservations
    : 0

  return (
    <section className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/40">
      <header className="flex items-center justify-between gap-3 border-b border-slate-800 px-5 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="inline-flex flex-shrink-0 items-center gap-1 rounded border border-amber-900/60 bg-amber-950/40 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-amber-300">
            <GitBranch className="h-3 w-3" aria-hidden />
            predicting (true / false)
          </span>
          <span className="truncate font-mono text-sm font-medium text-slate-100">
            {regression.target}
          </span>
        </div>
        <AucBadge value={regression.auc} skipped={!!regression.skippedReason} />
      </header>

      {regression.skippedReason ? (
        <SkippedBody reason={regression.skippedReason} />
      ) : (
        <>
          <div className="px-5 py-4">
            <StatGrid
              items={[
                { label: 'AUC', value: regression.auc.toFixed(3) },
                {
                  label: 'accuracy',
                  value: formatPct(regression.accuracy),
                  detail: 'at threshold 0.5',
                },
                { label: 'observations', value: formatCount(regression.nObservations) },
                {
                  label: 'class balance',
                  value: `${formatPct(truePct)} true`,
                  detail: `${formatCount(regression.trueCount)} / ${formatCount(regression.falseCount)}`,
                },
              ]}
            />
          </div>

          {visibleCoefs.length > 0 && (
            <div className="border-t border-slate-800 px-5 py-4">
              <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-slate-500">
                Predictors (sorted by impact)
              </div>
              <div className="-mx-1 overflow-x-auto">
                <table className="w-full min-w-[460px] text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-500">
                      <th className="py-1.5 pl-1 pr-3 font-mono font-normal">feature</th>
                      <th className="py-1.5 pr-3 text-right font-mono font-normal">
                        odds ratio
                      </th>
                      <th className="py-1.5 pr-3 text-right font-mono font-normal">
                        std. coef
                      </th>
                      <th className="py-1.5 pr-3 text-right font-mono font-normal">p</th>
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
                          {formatNumber(coef.oddsRatio)}
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
                            <span className="font-mono text-[10px] text-slate-600">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {regression.coefficients.length > COEF_TABLE_LIMIT && (
                <div className="mt-2 font-mono text-[10px] text-slate-500">
                  + {regression.coefficients.length - COEF_TABLE_LIMIT} more, hidden for
                  readability
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

// ----- Shared sub-components -----

function SkippedBody({ reason }: { reason: string }) {
  return (
    <div className="px-5 py-6 text-sm text-slate-400">
      <div className="flex items-start gap-2">
        <AlertTriangle
          className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-400"
          aria-hidden
        />
        <div>{reason}</div>
      </div>
    </div>
  )
}

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

function AucBadge({ value, skipped }: { value: number; skipped: boolean }) {
  if (skipped) {
    return (
      <span className="font-mono text-xs text-slate-500" title="Not run">
        skipped
      </span>
    )
  }
  let tone: string
  if (value >= 0.8) {
    tone = 'border-emerald-700 bg-emerald-950/60 text-emerald-300'
  } else if (value >= 0.65) {
    tone = 'border-amber-800 bg-amber-950/40 text-amber-300'
  } else {
    tone = 'border-slate-700 bg-slate-900 text-slate-400'
  }
  return (
    <span
      className={`flex flex-shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-xs ${tone}`}
      title={`AUC = ${value.toFixed(3)}`}
    >
      <TrendingUp className="h-3 w-3" aria-hidden />
      AUC {value.toFixed(2)}
    </span>
  )
}

function formatPValueShort(p: number): string {
  if (p < 0.001) return '< 0.001'
  if (p < 0.01) return p.toFixed(3)
  return p.toFixed(2)
}
