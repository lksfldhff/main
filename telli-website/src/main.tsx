import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './global.css'
import { App } from './App'

const wurzel = document.getElementById('root')
if (wurzel) {
  createRoot(wurzel).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
