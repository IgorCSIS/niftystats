import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// React 19's root API. StrictMode runs effects twice in dev to surface
// non-idempotent code: leave it on, it'll catch real bugs in Pyodide
// initialization where reentrancy matters.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

/**
 * Service worker registration.
 *
 * The SW caches the Pyodide CDN bundle so a returning visitor or a page
 * refresh doesn't pay the 10MB download again. We register inside a
 * window-load handler so the SW install doesn't compete with the initial
 * page render for bandwidth.
 *
 * `BASE_URL` is '/' in dev and '/niftystats/' in production. The SW path
 * resolves against that automatically so the scope matches our app.
 */
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  // Dev mode skips registration on purpose. SW caching while iterating
  // on the app would make hot reload behave strangely.
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
      .catch((err) => {
        console.warn('[niftystats] service worker registration failed:', err)
      })
  })
}
