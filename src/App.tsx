import { Landing } from '@/pages/Landing'

/**
 * App shell. Milestone 1 just mounts the landing page.
 *
 * Routing will be added when we have a separate /report view. Until then, a
 * single page keeps the build tiny and avoids dragging in react-router for
 * one route.
 */
function App() {
  return <Landing />
}

export default App
