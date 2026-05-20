/**
 * React hook for subscribing to engine status.
 *
 * Re-renders the calling component whenever the singleton's status changes.
 * Returns the current status, so usage is the typical:
 *
 *     const status = useEngineStatus()
 *     if (status.kind === 'ready') ...
 *
 * Why a hook (rather than passing status down via props): the engine state
 * is intrinsically global, multiple components on the page may want to read
 * it concurrently. Putting it through React Context would work too, but a
 * subscribe-based singleton is one fewer provider to wrap the app in.
 */

import { useEffect, useState } from 'react'
import { engine } from './client'
import type { EngineStatus } from './types'

export function useEngineStatus(): EngineStatus {
  const [status, setStatus] = useState<EngineStatus>({ kind: 'idle' })

  useEffect(() => {
    // engine.subscribe fires the listener once immediately with the current
    // state, so we don't need a separate sync after subscribing.
    return engine.subscribe(setStatus)
  }, [])

  return status
}
