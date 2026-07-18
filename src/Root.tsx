import { lazy, Suspense } from 'react'

const PatientApp = lazy(() => import('./patient/PatientApp.tsx').then((module) => ({ default: module.PatientApp })))
const ProviderApp = lazy(() => import('./App.tsx'))

export default function Root() {
  const careMatch = window.location.pathname.match(/^\/care\/([^/]+)\/?$/)
  return (
    <Suspense fallback={<main className="loading">Opening Abby…</main>}>
      {careMatch
        ? <PatientApp careId={decodeURIComponent(careMatch[1])} />
        : <ProviderApp />}
    </Suspense>
  )
}
