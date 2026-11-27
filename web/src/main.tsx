import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { PostHogProvider } from './components/PostHogProvider.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PostHogProvider>
      <App />
    </PostHogProvider>
  </StrictMode>,
)
