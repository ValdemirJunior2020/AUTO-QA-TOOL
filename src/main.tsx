import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

function normalizePastedDate(value: string): string {
  const text = value.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text

  const match = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/)
  if (!match) return ''

  const month = Number(match[1])
  const day = Number(match[2])
  const year = Number(match[3])
  const date = new Date(year, month - 1, day)

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return ''
  }

  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

// Chrome's native type="date" control is segmented and can swallow a normal
// Ctrl+V paste such as 7/9/2026. Catch the paste before the browser processes
// the individual month/day/year segments, then send a normal input/change
// event so React-controlled date fields update everywhere in the app.
document.addEventListener(
  'paste',
  (event) => {
    const target = event.target
    if (!(target instanceof HTMLInputElement) || target.type !== 'date' || target.disabled || target.readOnly) return

    const normalized = normalizePastedDate(event.clipboardData?.getData('text') || '')
    if (!normalized) return

    event.preventDefault()
    event.stopPropagation()

    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    valueSetter?.call(target, normalized)
    target.dispatchEvent(new Event('input', { bubbles: true }))
    target.dispatchEvent(new Event('change', { bubbles: true }))
  },
  true,
)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
