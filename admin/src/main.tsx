import { ClerkProvider } from '@clerk/react'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined
const root = createRoot(document.getElementById('root')!)

root.render(
  <StrictMode>
    {publishableKey ? (
      <ClerkProvider publishableKey={publishableKey} telemetry={false}>
        <App />
      </ClerkProvider>
    ) : (
      <main className="configuration-screen">
        <section role="alert">
          <p className="eyebrow">Configuration required</p>
          <h1>Admin sign-in is not configured</h1>
          <p>Set <code>VITE_CLERK_PUBLISHABLE_KEY</code> for the Clerk instance trusted by the API, then rebuild this app.</p>
        </section>
      </main>
    )}
  </StrictMode>,
)
