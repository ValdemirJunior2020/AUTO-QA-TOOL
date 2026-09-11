import { Fragment, useMemo, useState } from 'react'
import type { QaUser, ReviewRecord } from '../types'
import {
  type ColumnDef,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
} from '@tanstack/react-table'
import {
  exportReviewsToExcel,
  exportReviewsGoogleSheetStyle,
  type ReviewExcelFilters,
} from '../lib/exportReviewsExcel'

interface ReviewsPageProps {
  user: QaUser
  reviews: ReviewRecord[]
  onRefresh: () => void
  refreshing: boolean
  onMarkEmailSent: (review: ReviewRecord, sent: boolean) => Promise<void>
}

function formatDate(value?: string): string {
  if (!value) return '—'
  const date = new Date(value.includes('T') ? value : `${value}T12:00:00`)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString()
}

function normalizePastedDate(value: string): string {
  const text = value.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text
  const match = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/)
  if (!match) return ''
  const month = Number(match[1])
  const day = Number(match[2])
  const year = Number(match[3])
  const date = new Date(year, month - 1, day)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return ''
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function normalizePastedMonth(value: string): string {
  const text = value.trim()
  let match = text.match(/^(\d{4})-(\d{1,2})$/)
  if (match) {
    const month = Number(match[2])
    return month >= 1 && month <= 12 ? `${match[1]}-${String(month).padStart(2, '0')}` : ''
  }
  match = text.match(/^(\d{1,2})[\/-](\d{4})$/)
  if (!match) return ''
  const month = Number(match[1])
  return month >= 1 && month <= 12 ? `${match[2]}-${String(month).padStart(2, '0')}` : ''
}

function monthStart(value: string): string {
  return /^\d{4}-\d{2}$/.test(value) ? `${value}-01` : ''
}

function monthEnd(value: string): string {
  if (!/^\d{4}-\d{2}$/.test(value)) return ''
  const [year, month] = value.split('-').map(Number)
  const day = new Date(year, month, 0).getDate()
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function laterDate(a: string, b: string): string {
  if (!a) return b
  if (!b) return a
  return a > b ? a : b
}

function earlierDate(a: string, b: string): string {
  if (!a) return b
  if (!b) return a
  return a < b ? a : b
}

export function ReviewsPage({ user, reviews, onRefresh, refreshing, onMarkEmailSent }: ReviewsPageProps) {
  const [search, setSearch] = useState('')
  const [result, setResult] = useState('ALL')
  const [center, setCenter] = useState('ALL')
  const [qaType, setQaType] = useState('ALL')
  const [evaluator, setEvaluator] = useState('ALL')
  const [emailStatus, setEmailStatus] = useState('ALL')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [monthFrom, setMonthFrom] = useState('')
  const [monthTo, setMonthTo] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [updatingRow, setUpdatingRow] = useState<number | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [downloadMessage, setDownloadMessage] = useState('')
  const [progress, setProgress] = useState(0)
  const [progressLabel, setProgressLabel] = useState('')
  const [sorting, setSorting] = useState<SortingState>([{ id: 'reviewDate', desc: true }])

  const centers = useMemo(() => {
    const values = reviews.map((review) => review.callCenter).filter(Boolean)
    values.push('AI Agents')
    return Array.from(new Set(values.map((value) => value.toLowerCase() === 'ai agents' ? 'AI Agents' : value))).sort()
  }, [reviews])

  const evaluators = useMemo(
    () => Array.from(new Set(reviews.map((review) => review.evaluator).filter(Boolean))).sort(),
    [reviews],
  )

  const effectiveDateFrom = laterDate(dateFrom, monthStart(monthFrom))
  const effectiveDateTo = earlierDate(dateTo, monthEnd(monthTo))

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    return reviews
      .filter((review) => user.role === 'admin' || user.permissions.canViewHistory || review.evaluator === user.displayName)
      .filter((review) => result === 'ALL' || review.result === result)
      .filter((review) => center === 'ALL' || (center === 'AI Agents'
        ? review.callCenter.trim().toLowerCase() === 'ai agents'
        : review.callCenter === center))
      .filter((review) => qaType === 'ALL' || review.qaType === qaType)
      .filter((review) => evaluator === 'ALL' || review.evaluator === evaluator)
      .filter((review) => emailStatus === 'ALL' || (emailStatus === 'SENT' ? review.emailSent : !review.emailSent))
      .filter((review) => !effectiveDateFrom || String(review.reviewDate || review.savedTimestamp).slice(0, 10) >= effectiveDateFrom)
      .filter((review) => !effectiveDateTo || String(review.reviewDate || review.savedTimestamp).slice(0, 10) <= effectiveDateTo)
      .filter((review) => {
        if (!query) return true
        return [review.agentName, review.callCenter, review.callId, review.itineraryNumber, review.evaluator]
          .join(' ')
          .toLowerCase()
          .includes(query)
      })
      .sort((a, b) => String(b.savedTimestamp).localeCompare(String(a.savedTimestamp)))
  }, [reviews, search, result, center, qaType, evaluator, emailStatus, effectiveDateFrom, effectiveDateTo, user])

  const tableColumns = useMemo<ColumnDef<ReviewRecord>[]>(() => [
    { id: 'reviewDate', accessorFn: (review) => String(review.reviewDate || review.savedTimestamp) },
    { id: 'agentName', accessorKey: 'agentName' },
    { id: 'callCenter', accessorKey: 'callCenter' },
    { id: 'evaluator', accessorKey: 'evaluator' },
    { id: 'qaType', accessorKey: 'qaType' },
    { id: 'finalScore', accessorKey: 'finalScore' },
    { id: 'result', accessorKey: 'result' },
  ], [])

  const table = useReactTable({
    data: filtered,
    columns: tableColumns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 25 } },
  })

  const downloadFilteredWorkbook = async (format: 'team' | 'sheet' = 'team') => {
    if (downloading || !filtered.length) return

    setDownloading(true)
    setDownloadMessage('')
    setProgress(1)
    setProgressLabel(format === 'sheet' ? 'Preparing full sheet export' : 'Preparing team report')

    const filters: ReviewExcelFilters = {
      search,
      result,
      center,
      qaType,
      evaluator,
      emailStatus,
      dateFrom: effectiveDateFrom,
      dateTo: effectiveDateTo,
    }

    try {
      const onProgress = (percent: number, label: string) => {
        setProgress(Math.max(1, Math.min(100, Math.round(percent))))
        setProgressLabel(label)
      }
      const filename = format === 'sheet'
        ? await exportReviewsGoogleSheetStyle(reviews, filters, onProgress)
        : await exportReviewsToExcel(reviews, filters, onProgress)

      setProgress(100)
      setProgressLabel('Download complete')
      setDownloadMessage(`${filename} was downloaded. Email status was not changed, so you can download the other report format using the same filters.`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The Excel report could not be created.'
      setDownloadMessage(message)
      console.error('Excel download failed:', error)
    } finally {
      window.setTimeout(() => {
        setDownloading(false)
        setProgress(0)
        setProgressLabel('')
      }, 700)
    }
  }

  const toggleEmail = async (review: ReviewRecord) => {
    setUpdatingRow(review.rowNumber)
    try {
      await onMarkEmailSent(review, !review.emailSent)
    } finally {
      setUpdatingRow(null)
    }
  }

  const handleDatePaste = (setter: (value: string) => void) => (event: React.ClipboardEvent<HTMLInputElement>) => {
    const normalized = normalizePastedDate(event.clipboardData.getData('text'))
    if (!normalized) return
    event.preventDefault()
    setter(normalized)
  }

  const handleMonthPaste = (setter: (value: string) => void) => (event: React.ClipboardEvent<HTMLInputElement>) => {
    const normalized = normalizePastedMonth(event.clipboardData.getData('text'))
    if (!normalized) return
    event.preventDefault()
    setter(normalized)
  }

  return (
    <div className="page-stack">
      <section className="panel">
        <div className="panel-heading wrap-heading">
          <div>
            <p className="eyebrow">Agents Reviewed</p>
            <h1>Review History</h1>
            <p className="muted">Filter reviews, track which QA emails were sent, and download either report format without changing Email Sent status.</p>
          </div>

          <div className="history-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={() => void downloadFilteredWorkbook('team')}
              disabled={filtered.length === 0 || downloading}
            >
              {downloading ? 'Creating Excel…' : 'Download Team Report (.xlsx)'}
            </button>

            <button
              type="button"
              className="secondary-button"
              onClick={() => void downloadFilteredWorkbook('sheet')}
              disabled={filtered.length === 0 || downloading}
            >
              {downloading ? 'Creating Excel…' : 'Download Full Google-Sheet Style'}
            </button>

            <button type="button" className="secondary-button" onClick={onRefresh} disabled={refreshing}>
              {refreshing ? 'Refreshing…' : 'Refresh from Firebase'}
            </button>
          </div>
        </div>

        {downloadMessage && <p className="muted">{downloadMessage}</p>}

        {progress > 0 && (
          <div className="operation-progress" aria-live="polite">
            <div className="operation-progress-copy"><span>{progressLabel}</span><strong>{progress}%</strong></div>
            <div className="operation-progress-track"><div className="operation-progress-fill" style={{ width: `${progress}%` }} /></div>
          </div>
        )}

        <div className="filter-grid advanced-filters">
          <label className="field">
            <span>Search</span>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Agent, Call ID, itinerary…" />
          </label>

          <label className="field">
            <span>Result</span>
            <select value={result} onChange={(event) => setResult(event.target.value)}>
              <option value="ALL">All</option>
              <option value="PASS">PASS</option>
              <option value="FAIL">FAIL</option>
            </select>
          </label>

          <label className="field">
            <span>Call Center</span>
            <select value={center} onChange={(event) => setCenter(event.target.value)}>
              <option value="ALL">All</option>
              {centers.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>

          <label className="field">
            <span>QA Type</span>
            <select value={qaType} onChange={(event) => setQaType(event.target.value)}>
              <option value="ALL">All</option>
              <option value="CS">CS</option>
              <option value="Groups">Groups</option>
              <option value="Sales">Sales</option>
            </select>
          </label>

          <label className="field">
            <span>Evaluator</span>
            <select value={evaluator} onChange={(event) => setEvaluator(event.target.value)}>
              <option value="ALL">All</option>
              {evaluators.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>

          <label className="field">
            <span>Email Status</span>
            <select value={emailStatus} onChange={(event) => setEmailStatus(event.target.value)}>
              <option value="ALL">All</option>
              <option value="SENT">Sent</option>
              <option value="NOT_SENT">Not sent</option>
            </select>
          </label>

          <label className="field">
            <span>From Date</span>
            <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} onPaste={handleDatePaste(setDateFrom)} />
            <em>You can paste MM/DD/YYYY or YYYY-MM-DD.</em>
          </label>

          <label className="field">
            <span>To Date</span>
            <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} onPaste={handleDatePaste(setDateTo)} />
            <em>You can paste MM/DD/YYYY or YYYY-MM-DD.</em>
          </label>

          <label className="field">
            <span>From Month</span>
            <input type="month" value={monthFrom} onChange={(event) => setMonthFrom(event.target.value)} onPaste={handleMonthPaste(setMonthFrom)} />
            <em>Optional month range. Paste MM/YYYY or YYYY-MM.</em>
          </label>

          <label className="field">
            <span>To Month</span>
            <input type="month" value={monthTo} onChange={(event) => setMonthTo(event.target.value)} onPaste={handleMonthPaste(setMonthTo)} />
            <em>Optional month range. Paste MM/YYYY or YYYY-MM.</em>
          </label>
        </div>

        <p className="muted">Showing {filtered.length} of {reviews.length} reviews.</p>

        <div className="table-wrap">
          <table className="history-table">
            <thead>
              <tr>
                <th><button className="table-sort-button" type="button" onClick={() => table.getColumn('reviewDate')?.toggleSorting()}>Date{table.getColumn('reviewDate')?.getIsSorted() === 'asc' ? ' ↑' : table.getColumn('reviewDate')?.getIsSorted() === 'desc' ? ' ↓' : ''}</button></th>
                <th><button className="table-sort-button" type="button" onClick={() => table.getColumn('agentName')?.toggleSorting()}>Agent{table.getColumn('agentName')?.getIsSorted() === 'asc' ? ' ↑' : table.getColumn('agentName')?.getIsSorted() === 'desc' ? ' ↓' : ''}</button></th>
                <th><button className="table-sort-button" type="button" onClick={() => table.getColumn('callCenter')?.toggleSorting()}>Center</button></th>
                <th><button className="table-sort-button" type="button" onClick={() => table.getColumn('evaluator')?.toggleSorting()}>Evaluator</button></th>
                <th><button className="table-sort-button" type="button" onClick={() => table.getColumn('qaType')?.toggleSorting()}>Type</button></th>
                <th><button className="table-sort-button" type="button" onClick={() => table.getColumn('finalScore')?.toggleSorting()}>Score{table.getColumn('finalScore')?.getIsSorted() === 'asc' ? ' ↑' : table.getColumn('finalScore')?.getIsSorted() === 'desc' ? ' ↓' : ''}</button></th>
                <th><button className="table-sort-button" type="button" onClick={() => table.getColumn('result')?.toggleSorting()}>Result</button></th>
                <th>Email Sent</th>
                <th />
              </tr>
            </thead>

            <tbody>
              {table.getRowModel().rows.map(({ original: review }) => (
                <Fragment key={review.id}>
                  <tr>
                    <td>{formatDate(review.reviewDate || review.savedTimestamp)}</td>
                    <td><strong>{review.agentName}</strong></td>
                    <td>{review.callCenter}</td>
                    <td>{review.evaluator}</td>
                    <td>{review.qaType}</td>
                    <td><strong>{review.finalScore}</strong> / {review.kpiTarget}</td>
                    <td><span className={`result-pill ${review.result.toLowerCase()}`}>{review.result}</span></td>
                    <td>
                      <button
                        type="button"
                        className={`email-status-button ${review.emailSent ? 'sent' : 'pending'}`}
                        disabled={updatingRow === review.rowNumber || user.role === 'viewer'}
                        onClick={() => void toggleEmail(review)}
                      >
                        {updatingRow === review.rowNumber ? 'Saving…' : review.emailSent ? '✓ Sent' : '○ Not Sent'}
                      </button>
                    </td>
                    <td>
                      <button type="button" className="text-button" onClick={() => setExpandedId(expandedId === review.id ? null : review.id)}>
                        {expandedId === review.id ? 'Hide' : 'Details'}
                      </button>
                    </td>
                  </tr>

                  {expandedId === review.id && (
                    <tr className="detail-row">
                      <td colSpan={9}>
                        <div className="review-detail-grid">
                          <div><span>Agent Start Date</span><strong>{formatDate(review.agentStartDate)}</strong></div>
                          <div><span>Confirmation / Itinerary</span><strong>{review.itineraryNumber || '—'}</strong></div>
                          <div><span>Call ID</span><strong>{review.callId || '—'}</strong></div>
                          <div><span>Markdowns</span><strong>{review.markdowns}</strong></div>
                          <div><span>Email Sent At</span><strong>{review.emailSentAt ? new Date(review.emailSentAt).toLocaleString() : '—'}</strong></div>
                          <div><span>Email Sent By</span><strong>{review.emailSentBy || '—'}</strong></div>
                        </div>

                        <div className="issue-box">
                          <span>Issues and custom notes</span>
                          <p>{review.issueSummary || 'No criterion notes were added.'}</p>
                        </div>

                        <div className="issue-box additional-comments-history">
                          <span>Additional Comments</span>
                          <p>{review.additionalComments || 'No additional comments.'}</p>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>

        {filtered.length > 0 && (
          <div className="table-pagination">
            <span>Page {table.getState().pagination.pageIndex + 1} of {Math.max(1, table.getPageCount())}</span>
            <div>
              <button className="secondary-button" type="button" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>Previous</button>
              <button className="secondary-button" type="button" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>Next</button>
            </div>
          </div>
        )}

        {filtered.length === 0 && <div className="empty-state">No reviews match the selected filters.</div>}
      </section>
    </div>
  )
}
