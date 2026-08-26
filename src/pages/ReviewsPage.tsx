import {
  Fragment,
  useMemo,
  useState,
} from 'react'

import type {
  QaUser,
  ReviewRecord,
} from '../types'

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
  onMarkEmailSent: (
    review: ReviewRecord,
    sent: boolean,
  ) => Promise<void>
}

function formatDate(value?: string): string {
  if (!value) return '—'

  const date = new Date(
    value.includes('T')
      ? value
      : `${value}T12:00:00`,
  )

  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString()
}

export function ReviewsPage({
  user,
  reviews,
  onRefresh,
  refreshing,
  onMarkEmailSent,
}: ReviewsPageProps) {
  const [search, setSearch] = useState('')
  const [result, setResult] = useState('ALL')
  const [center, setCenter] = useState('ALL')
  const [qaType, setQaType] = useState('ALL')
  const [evaluator, setEvaluator] =
    useState('ALL')
  const [emailStatus, setEmailStatus] =
    useState('ALL')
  const [dateFrom, setDateFrom] =
    useState('')
  const [dateTo, setDateTo] =
    useState('')
  const [expandedId, setExpandedId] =
    useState<string | null>(null)
  const [updatingRow, setUpdatingRow] =
    useState<number | null>(null)
  const [downloading, setDownloading] =
    useState(false)
  const [downloadMessage, setDownloadMessage] =
    useState('')
  const [progress, setProgress] = useState(0)
  const [progressLabel, setProgressLabel] = useState('')
  const [sorting, setSorting] = useState<SortingState>([{ id: 'reviewDate', desc: true }])

  const centers = useMemo(
    () =>
      Array.from(
        new Set(
          reviews
            .map((review) =>
              review.callCenter,
            )
            .filter(Boolean),
        ),
      ).sort(),
    [reviews],
  )

  const evaluators = useMemo(
    () =>
      Array.from(
        new Set(
          reviews
            .map((review) =>
              review.evaluator,
            )
            .filter(Boolean),
        ),
      ).sort(),
    [reviews],
  )

  const filtered = useMemo(() => {
    const query =
      search.trim().toLowerCase()

    return reviews
      .filter(
        (review) =>
          user.role === 'admin' ||
          user.permissions.canViewHistory ||
          review.evaluator ===
            user.displayName,
      )
      .filter(
        (review) =>
          result === 'ALL' ||
          review.result === result,
      )
      .filter(
        (review) =>
          center === 'ALL' ||
          review.callCenter === center,
      )
      .filter(
        (review) =>
          qaType === 'ALL' ||
          review.qaType === qaType,
      )
      .filter(
        (review) =>
          evaluator === 'ALL' ||
          review.evaluator === evaluator,
      )
      .filter(
        (review) =>
          emailStatus === 'ALL' ||
          (
            emailStatus === 'SENT'
              ? review.emailSent
              : !review.emailSent
          ),
      )
      .filter(
        (review) =>
          !dateFrom ||
          String(
            review.reviewDate ||
            review.savedTimestamp,
          ).slice(0, 10) >= dateFrom,
      )
      .filter(
        (review) =>
          !dateTo ||
          String(
            review.reviewDate ||
            review.savedTimestamp,
          ).slice(0, 10) <= dateTo,
      )
      .filter((review) => {
        if (!query) return true

        return [
          review.agentName,
          review.callCenter,
          review.callId,
          review.itineraryNumber,
          review.evaluator,
        ]
          .join(' ')
          .toLowerCase()
          .includes(query)
      })
      .sort((a, b) =>
        String(b.savedTimestamp)
          .localeCompare(
            String(a.savedTimestamp),
          ),
      )
  }, [
    reviews,
    search,
    result,
    center,
    qaType,
    evaluator,
    emailStatus,
    dateFrom,
    dateTo,
    user,
  ])

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

  const downloadFilteredWorkbook =
    async (format: 'team' | 'sheet' = 'team') => {
      if (downloading || !filtered.length) {
        return
      }

      setDownloading(true)
      setDownloadMessage('')
      setProgress(1)
      setProgressLabel(
        format === 'sheet'
          ? 'Preparing full sheet export'
          : 'Preparing team report',
      )

      const filters: ReviewExcelFilters = {
        search,
        result,
        center,
        qaType,
        evaluator,
        emailStatus,
        dateFrom,
        dateTo,
      }

      const downloadedReviews = [...filtered]

      try {
        const onProgress = (
          percent: number,
          label: string,
        ) => {
          const exportPercent =
            user.role === 'admin'
              ? Math.min(
                  90,
                  Math.max(
                    1,
                    Math.round(
                      percent * 0.9,
                    ),
                  ),
                )
              : percent

          setProgress(exportPercent)
          setProgressLabel(label)
        }

        const filename =
          format === 'sheet'
            ? await exportReviewsGoogleSheetStyle(
                reviews,
                filters,
                onProgress,
              )
            : await exportReviewsToExcel(
                reviews,
                filters,
                onProgress,
              )

        let markedSentCount = 0

        if (user.role === 'admin') {
          const reviewsToMarkSent =
            downloadedReviews.filter(
              (review) =>
                !Boolean(review.emailSent),
            )

          if (reviewsToMarkSent.length > 0) {
            for (
              let index = 0;
              index < reviewsToMarkSent.length;
              index += 1
            ) {
              const review =
                reviewsToMarkSent[index]

              const sentProgress =
                90 +
                Math.round(
                  ((index + 1) /
                    reviewsToMarkSent.length) *
                    10,
                )

              setProgress(
                Math.min(
                  100,
                  sentProgress,
                ),
              )

              setProgressLabel(
                `Marking downloaded reviews as Sent (${index + 1}/${reviewsToMarkSent.length})`,
              )

              await onMarkEmailSent(
                review,
                true,
              )

              markedSentCount += 1
            }
          } else {
            setProgress(100)
            setProgressLabel(
              'Download complete',
            )
          }
        } else {
          setProgress(100)
          setProgressLabel(
            'Download complete',
          )
        }

        if (
          user.role === 'admin' &&
          markedSentCount > 0
        ) {
          setDownloadMessage(
            `${filename} was downloaded. ${markedSentCount} review${markedSentCount === 1 ? '' : 's'} automatically marked Sent.`,
          )
        } else {
          setDownloadMessage(
            `${filename} was downloaded.`,
          )
        }
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : 'The Excel report could not be created.'

        setDownloadMessage(message)
        console.error(
          'Excel download failed:',
          error,
        )
      } finally {
        window.setTimeout(() => {
          setDownloading(false)
          setProgress(0)
          setProgressLabel('')
        }, 700)
      }
    }

  const toggleEmail =
    async (review: ReviewRecord) => {
      setUpdatingRow(review.rowNumber)

      try {
        await onMarkEmailSent(
          review,
          !review.emailSent,
        )
      } finally {
        setUpdatingRow(null)
      }
    }

  return (
    <div className="page-stack">
      <section className="panel">
        <div className="panel-heading wrap-heading">
          <div>
            <p className="eyebrow">
              Agents Reviewed
            </p>

            <h1>Review History</h1>

            <p className="muted">
              Filter reviews, track which QA
              emails were sent, and download a
              clean Excel report.
            </p>
          </div>

          <div className="history-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={() =>
                void downloadFilteredWorkbook('team')
              }
              disabled={
                filtered.length === 0 ||
                downloading
              }
            >
              {downloading
                ? 'Creating Excel…'
                : 'Download Team Report (.xlsx)'}
            </button>

            <button
              type="button"
              className="secondary-button"
              onClick={() => void downloadFilteredWorkbook('sheet')}
              disabled={filtered.length === 0 || downloading}
            >
              {downloading ? 'Creating Excel…' : 'Download Full Google-Sheet Style'}
            </button>

            <button
              type="button"
              className="secondary-button"
              onClick={onRefresh}
              disabled={refreshing}
            >
              {refreshing
                ? 'Refreshing…'
                : 'Refresh from Firebase'}
            </button>
          </div>
        </div>

        {downloadMessage && (
          <p className="muted">
            {downloadMessage}
          </p>
        )}

        {progress > 0 && (
          <div className="operation-progress" aria-live="polite">
            <div className="operation-progress-copy"><span>{progressLabel}</span><strong>{progress}%</strong></div>
            <div className="operation-progress-track"><div className="operation-progress-fill" style={{ width: `${progress}%` }} /></div>
          </div>
        )}

        <div className="filter-grid advanced-filters">
          <label className="field">
            <span>Search</span>

            <input
              value={search}
              onChange={(event) =>
                setSearch(event.target.value)
              }
              placeholder="Agent, Call ID, itinerary…"
            />
          </label>

          <label className="field">
            <span>Result</span>

            <select
              value={result}
              onChange={(event) =>
                setResult(event.target.value)
              }
            >
              <option value="ALL">
                All
              </option>
              <option value="PASS">
                PASS
              </option>
              <option value="FAIL">
                FAIL
              </option>
            </select>
          </label>

          <label className="field">
            <span>Call Center</span>

            <select
              value={center}
              onChange={(event) =>
                setCenter(event.target.value)
              }
            >
              <option value="ALL">
                All
              </option>

              {centers.map((item) => (
                <option
                  key={item}
                  value={item}
                >
                  {item}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>QA Type</span>

            <select
              value={qaType}
              onChange={(event) =>
                setQaType(event.target.value)
              }
            >
              <option value="ALL">
                All
              </option>
              <option value="CS">
                CS
              </option>
              <option value="Groups">
                Groups
              </option>
              <option value="Sales">
                Sales
              </option>
            </select>
          </label>

          <label className="field">
            <span>Evaluator</span>

            <select
              value={evaluator}
              onChange={(event) =>
                setEvaluator(event.target.value)
              }
            >
              <option value="ALL">
                All
              </option>

              {evaluators.map((item) => (
                <option
                  key={item}
                  value={item}
                >
                  {item}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Email Status</span>

            <select
              value={emailStatus}
              onChange={(event) =>
                setEmailStatus(
                  event.target.value,
                )
              }
            >
              <option value="ALL">
                All
              </option>
              <option value="SENT">
                Sent
              </option>
              <option value="NOT_SENT">
                Not sent
              </option>
            </select>
          </label>

          <label className="field">
            <span>From</span>

            <input
              type="date"
              value={dateFrom}
              onChange={(event) =>
                setDateFrom(event.target.value)
              }
            />
          </label>

          <label className="field">
            <span>To</span>

            <input
              type="date"
              value={dateTo}
              onChange={(event) =>
                setDateTo(event.target.value)
              }
            />
          </label>
        </div>

        <p className="muted">
          Showing {filtered.length} of{' '}
          {reviews.length} reviews.
        </p>

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
                    <td>
                      {formatDate(
                        review.reviewDate ||
                        review.savedTimestamp,
                      )}
                    </td>

                    <td>
                      <strong>
                        {review.agentName}
                      </strong>
                    </td>

                    <td>
                      {review.callCenter}
                    </td>

                    <td>
                      {review.evaluator}
                    </td>

                    <td>
                      {review.qaType}
                    </td>

                    <td>
                      <strong>
                        {review.finalScore}
                      </strong>{' '}
                      / {review.kpiTarget}
                    </td>

                    <td>
                      <span
                        className={
                          `result-pill ` +
                          review.result.toLowerCase()
                        }
                      >
                        {review.result}
                      </span>
                    </td>

                    <td>
                      <button
                        type="button"
                        className={
                          `email-status-button ` +
                          (
                            review.emailSent
                              ? 'sent'
                              : 'pending'
                          )
                        }
                        disabled={
                          updatingRow ===
                            review.rowNumber ||
                          user.role === 'viewer'
                        }
                        onClick={() =>
                          void toggleEmail(review)
                        }
                      >
                        {updatingRow ===
                        review.rowNumber
                          ? 'Saving…'
                          : review.emailSent
                            ? '✓ Sent'
                            : '○ Not Sent'}
                      </button>
                    </td>

                    <td>
                      <button
                        type="button"
                        className="text-button"
                        onClick={() =>
                          setExpandedId(
                            expandedId ===
                              review.id
                              ? null
                              : review.id,
                          )
                        }
                      >
                        {expandedId === review.id
                          ? 'Hide'
                          : 'Details'}
                      </button>
                    </td>
                  </tr>

                  {expandedId === review.id && (
                    <tr className="detail-row">
                      <td colSpan={9}>
                        <div className="review-detail-grid">
                          <div>
                            <span>
                              Agent Start Date
                            </span>

                            <strong>
                              {formatDate(
                                review.agentStartDate,
                              )}
                            </strong>
                          </div>

                          <div>
                            <span>
                              Confirmation /
                              Itinerary
                            </span>

                            <strong>
                              {review.itineraryNumber ||
                                '—'}
                            </strong>
                          </div>

                          <div>
                            <span>
                              Call ID
                            </span>

                            <strong>
                              {review.callId ||
                                '—'}
                            </strong>
                          </div>

                          <div>
                            <span>
                              Markdowns
                            </span>

                            <strong>
                              {review.markdowns}
                            </strong>
                          </div>

                          <div>
                            <span>
                              Email Sent At
                            </span>

                            <strong>
                              {review.emailSentAt
                                ? new Date(
                                    review.emailSentAt,
                                  ).toLocaleString()
                                : '—'}
                            </strong>
                          </div>

                          <div>
                            <span>
                              Email Sent By
                            </span>

                            <strong>
                              {review.emailSentBy ||
                                '—'}
                            </strong>
                          </div>
                        </div>

                        <div className="issue-box">
                          <span>
                            Issues and custom notes
                          </span>

                          <p>
                            {review.issueSummary ||
                              'No criterion notes were added.'}
                          </p>
                        </div>

                        <div className="issue-box additional-comments-history">
                          <span>
                            Additional Comments
                          </span>

                          <p>
                            {review.additionalComments ||
                              'No additional comments.'}
                          </p>
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
            <div><button className="secondary-button" type="button" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>Previous</button><button className="secondary-button" type="button" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>Next</button></div>
          </div>
        )}

        {filtered.length === 0 && (
          <div className="empty-state">
            No reviews match the selected
            filters.
          </div>
        )}
      </section>
    </div>
  )
}
