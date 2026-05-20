/**
 * EngineStatus, the inline progress + result panel that renders beneath the
 * file preview after the user clicks Analyze.
 *
 * Renders four flavors of state:
 *
 *   - loading:   downloading and initializing Pyodide. Named steps with
 *                animated indicator so a 5-10s wait reads as deliberate
 *                progress, not a frozen browser.
 *   - computing: Pyodide is already loaded and is now running Python on
 *                the user's data. Usually fast (< 500ms) for v2's
 *                round-trip pass.
 *   - done:      compact confirmation banner showing what came back from
 *                Python. This is the demo moment for session 2.
 *   - error:     red alert with retry. Resets the engine to idle and lets
 *                the user re-click Analyze.
 *
 * For 'idle' and 'ready' we render nothing, the parent controls visibility
 * via the Analyze button (idle/ready means "click to start").
 */

import type { ReactNode } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Loader2, CheckCircle2, AlertCircle, RotateCcw } from 'lucide-react'
import { engine } from '@/lib/pyodide/client'
import type { EngineStatus as EngineStatusType } from '@/lib/pyodide/types'

interface EngineStatusProps {
  status: EngineStatusType
}

export function EngineStatus({ status }: EngineStatusProps) {
  return (
    <AnimatePresence mode="wait">
      {status.kind === 'loading' && (
        <Panel key="loading">
          <LoadingView step={status.step} detail={status.detail} />
        </Panel>
      )}
      {status.kind === 'computing' && (
        <Panel key="computing">
          <LoadingView step="Running analysis" detail={status.detail} />
        </Panel>
      )}
      {status.kind === 'done' && (
        <Panel key="done" tone="success">
          <DoneView
            rows={status.result.rows}
            cols={status.result.cols}
            columnNames={status.result.columnNames}
          />
        </Panel>
      )}
      {status.kind === 'error' && (
        <Panel key="error" tone="error">
          <ErrorView message={status.message} />
        </Panel>
      )}
    </AnimatePresence>
  )
}

/**
 * Wrapper card. Same shape regardless of state, color shifts via `tone`.
 * Wrapping every flavor in the same panel keeps spacing and corner radius
 * consistent as the user clicks through Analyze.
 */
function Panel({
  children,
  tone = 'default',
}: {
  children: ReactNode
  tone?: 'default' | 'success' | 'error'
}) {
  const toneClasses = {
    default: 'border-slate-800 bg-slate-900/40',
    success:
      'border-[var(--color-accent)]/30 bg-[color-mix(in_oklch,var(--color-accent)_5%,transparent)]',
    error: 'border-red-900/60 bg-red-950/20',
  }[tone]

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
      className={`mt-5 rounded-xl border px-5 py-4 ${toneClasses}`}
    >
      {children}
    </motion.div>
  )
}

function LoadingView({ step, detail }: { step: string; detail?: string }) {
  return (
    <div className="flex items-start gap-3">
      <Loader2
        className="mt-0.5 h-4 w-4 flex-shrink-0 animate-spin text-[var(--color-accent-bright)]"
        aria-hidden
      />
      <div className="flex-1">
        <div className="font-mono text-sm text-slate-100">{step}</div>
        {detail && (
          <div className="mt-0.5 text-xs text-slate-500">{detail}</div>
        )}
        {/* Animated dots so a multi-second wait still has visible motion. */}
        <ProgressDots />
      </div>
    </div>
  )
}

/**
 * Three dots that fade in sequence. Subtle, not flashy. The key purpose is
 * to give the user something to watch during the Pyodide cold start so the
 * page never looks frozen.
 */
function ProgressDots() {
  return (
    <div className="mt-2 flex gap-1.5">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="inline-block h-1 w-1 rounded-full bg-[var(--color-accent)]"
          animate={{ opacity: [0.2, 1, 0.2] }}
          transition={{
            duration: 1.2,
            repeat: Infinity,
            delay: i * 0.2,
            ease: 'easeInOut',
          }}
        />
      ))}
    </div>
  )
}

function DoneView({
  rows,
  cols,
  columnNames,
}: {
  rows: number
  cols: number
  columnNames: string[]
}) {
  return (
    <div className="flex items-start gap-3">
      <CheckCircle2
        className="mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--color-accent-bright)]"
        aria-hidden
      />
      <div className="flex-1">
        <div className="text-sm text-slate-100">
          <span className="font-medium">Engine ready.</span>{' '}
          <span className="text-slate-400">
            Loaded{' '}
            <span className="font-mono text-slate-200">
              {rows.toLocaleString()}
            </span>{' '}
            rows ×{' '}
            <span className="font-mono text-slate-200">{cols}</span> columns
            into pandas.
          </span>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {columnNames.map((name) => (
            <span
              key={name}
              className="rounded border border-slate-800 bg-slate-900/60 px-1.5 py-0.5 font-mono text-[10px] text-slate-300"
            >
              {name}
            </span>
          ))}
        </div>
        <div className="mt-3 text-xs text-slate-500">
          Real Python (pandas, numpy) is running locally in your browser. The
          full descriptive engine lands next session.
        </div>
      </div>
    </div>
  )
}

function ErrorView({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-3">
      <AlertCircle
        className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-400"
        aria-hidden
      />
      <div className="flex-1">
        <div className="text-sm font-medium text-red-300">
          The engine hit an error.
        </div>
        <div className="mt-1 text-xs text-red-400/80">{message}</div>
        <button
          type="button"
          onClick={() => engine.reset()}
          className="mt-3 flex items-center gap-1.5 rounded-md border border-red-900/60 bg-red-950/40 px-2.5 py-1 text-xs text-red-200 transition-colors hover:bg-red-950/60"
        >
          <RotateCcw className="h-3 w-3" aria-hidden />
          Reset
        </button>
      </div>
    </div>
  )
}
