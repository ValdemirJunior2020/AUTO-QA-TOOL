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

function setDateInputValue(target: HTMLInputElement, rawValue: string): boolean {
  const normalized = normalizePastedDate(rawValue)
  if (!normalized) return false

  const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  valueSetter?.call(target, normalized)
  target.dispatchEvent(new Event('input', { bubbles: true }))
  target.dispatchEvent(new Event('change', { bubbles: true }))
  return true
}

// Native Chrome date controls are segmented and often swallow Ctrl+V.
// Support both the normal paste event and Ctrl/Cmd+V against the focused
// date input so values such as 7/9/2026 paste in one shot.
document.addEventListener(
  'paste',
  (event) => {
    const target = document.activeElement
    if (!(target instanceof HTMLInputElement) || target.type !== 'date' || target.disabled || target.readOnly) return

    if (setDateInputValue(target, event.clipboardData?.getData('text') || '')) {
      event.preventDefault()
      event.stopPropagation()
    }
  },
  true,
)

document.addEventListener(
  'keydown',
  (event) => {
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'v') return

    const target = document.activeElement
    if (!(target instanceof HTMLInputElement) || target.type !== 'date' || target.disabled || target.readOnly) return
    if (!navigator.clipboard?.readText) return

    event.preventDefault()
    event.stopPropagation()

    void navigator.clipboard.readText().then((text) => {
      setDateInputValue(target, text)
    }).catch(() => {
      // If Clipboard API access is unavailable, the regular paste listener above
      // still handles browsers that expose clipboardData on the paste event.
    })
  },
  true,
)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
