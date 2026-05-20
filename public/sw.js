/**
 * NiftyStats service worker.
 *
 * One job: cache the Pyodide CDN bundle so a returning visitor doesn't pay
 * the 10MB download again. Pyodide's URLs are versioned (pyodide/v0.27.7/...)
 * so we can use a permissive cache-first strategy without worrying about
 * stale content. If we bump Pyodide, the URL changes and the cache key
 * misses, which is exactly the behavior we want.
 *
 * We deliberately do NOT cache our own app assets here. Vite already
 * fingerprints them and the browser's HTTP cache handles them fine. Adding
 * them to the service worker would just make debugging stale-bundle issues
 * harder.
 */

const CACHE_NAME = 'niftystats-pyodide-v1'

// Hosts and URL substrings we want to intercept. Tight allowlist so the SW
// never accidentally caches something the app needs to refetch.
const ALLOWED_HOSTS = new Set(['cdn.jsdelivr.net'])
const PATH_MARKER = '/pyodide/'

self.addEventListener('install', (event) => {
  // skipWaiting lets a freshly installed SW take over without forcing the
  // user to close every tab. Safe here because the SW doesn't change app
  // behavior, it only adds caching.
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Wipe any prior cache versions (CACHE_NAME bump). Keeps storage
      // tidy if we ever ship a v2 of this SW logic.
      const keys = await caches.keys()
      await Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)),
      )
      // claim() makes the SW control the page immediately on first load
      // instead of waiting for a refresh.
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  let url
  try {
    url = new URL(request.url)
  } catch {
    return
  }

  if (!ALLOWED_HOSTS.has(url.hostname)) return
  if (!url.pathname.includes(PATH_MARKER)) return

  event.respondWith(cacheFirst(request))
})

/**
 * Cache-first strategy. If we have the response cached, return it. If not,
 * fetch it, stash a copy in the cache, return the original. Errors during
 * fetch propagate to the caller so Pyodide can show its own failure UI.
 *
 * One subtlety: Pyodide makes cross-origin requests, so the responses might
 * be 'opaque' (mode: 'no-cors'). Opaque responses are fine to cache; we just
 * can't inspect their bodies. We don't need to.
 */
async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME)
  const cached = await cache.match(request)
  if (cached) return cached

  const response = await fetch(request)
  // Only cache successful responses. Opaque responses report status 0, but
  // we want to cache them anyway because they ARE valid CDN payloads.
  if (response.ok || response.type === 'opaque') {
    // Clone before cache.put: the response body is a stream and we need a
    // fresh one for the caller.
    cache.put(request, response.clone()).catch((err) => {
      // Cache writes can fail under storage pressure. Log and move on,
      // the user still gets the (uncached) response.
      console.warn('[sw] cache put failed:', err)
    })
  }
  return response
}
