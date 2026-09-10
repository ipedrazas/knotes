import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/kalam/400.css'
import '@fontsource/kalam/700.css'
import '@fontsource/caveat/600.css'
import '@fontsource/caveat/700.css'
import '@fontsource/special-elite/400.css'
import './styles.css'
import { App } from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
