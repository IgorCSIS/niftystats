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
