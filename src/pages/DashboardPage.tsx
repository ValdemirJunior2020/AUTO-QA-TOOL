import { useMemo } from 'react'
import type { QaUser, ReviewRecord, WatchListAgent } from '../types'
import { getWatchListMetrics } from '../lib/watchList'

interface DashboardPageProps {
  user: QaUser
  reviews: ReviewRecord[]
  watchListAgents: WatchListAgent[]
  onOpenWatchList: () => void
  users: QaUser[]
  onNewReview: () => void
  onRefresh: () => void
  refreshing: boolean
  onCreateBackup: () => Promise<void>
  onRestoreLatestBackup: () => Promise<void>
}

function average(values: number[]) {
  return values.length
    ? values.reduce((a, b) => a + b, 0) / values.length
    : 0
}

function todayKey() {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

export function DashboardPage({
  user,
  reviews,
  watchListAgents,
  onOpenWatchList,
  users,
  onNewReview,
  onRefresh,
  refreshing,
  onCreateBackup,
  onRestoreLatestBackup,
}: DashboardPageProps) {
  const stats = useMemo(() => {
    const passed = reviews.filter(
      (review) => review.result === 'PASS',
    ).length

    const today = reviews.filter(
      (review) =>
        String(
          review.reviewDate || review.savedTimestamp,
        ).slice(0, 10) === todayKey(),
    ).length

    const below = new Set(
      reviews
        .filter(
          (review) =>
            review.finalScore < review.kpiTarget,
        )
        .map((review) => review.agentName),
    ).size

    const byCenter = Object.entries(
      reviews.reduce<Record<string, number>>(
        (accumulator, review) => ({
          ...accumulator,
          [review.callCenter || 'Unknown']:
            (accumulator[
              review.callCenter || 'Unknown'
            ] || 0) + 1,
        }),
        {},
      ),
    )
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)

    const byEvaluator = Object.entries(
      reviews.reduce<Record<string, number>>(
        (accumulator, review) => ({
          ...accumulator,
          [review.evaluator || 'Unknown']:
            (accumulator[
              review.evaluator || 'Unknown'
            ] || 0) + 1,
        }),
        {},
      ),
    )
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)

    const issueWords = reviews.flatMap(
      (review) =>
        (review.issueSummary || '')
          .split('|')
          .map((item) => item.trim())
          .filter(Boolean),
    )

    return {
      passed,
      today,
      below,
      avg: average(
        reviews.map(
          (review) => review.finalScore,
        ),
      ),
      byCenter,
      byEvaluator,
      commonIssue:
        issueWords[0] ||
        'No markdown issue recorded yet',
    }
  }, [reviews])

  const recent = [...reviews]
    .sort((a, b) =>
      String(b.savedTimestamp).localeCompare(
        String(a.savedTimestamp),
      ),
    )
    .slice(0, 8)

  const guidedUsers = users.filter(
    (currentUser) =>
      currentUser.guidedMode &&
      currentUser.active,
  ).length

  const activeWatchAgents =
    watchListAgents.filter(
      (agent) =>
        agent.watchStatus === 'Active',
    )

  const watchUnderKpi =
    activeWatchAgents.filter((agent) => {
      const averageScore =
        getWatchListMetrics(
          agent,
          reviews,
          watchListAgents,
        ).averageScore

      return (
        averageScore !== null &&
        averageScore < 90
      )
    }).length

  return (
    <div className="page-stack">

      <section className="hero-panel dashboard-hero-with-watch">
        <div>
          <p className="eyebrow">
            Welcome back, {user.displayName}
          </p>

          <h1>
            Keep every QA review accurate
            and under control.
          </h1>

          <p>
            Live metrics, email tracking,
            protected saves, and reporting
            now run directly on Firebase.
          </p>
        </div>

        <div
          className={`dashboard-watch-card ${
            watchUnderKpi
              ? 'has-alert'
              : ''
          }`}
        >
          <div className="dashboard-watch-title">
            <span className="dashboard-watch-eye">
              👁
            </span>

            <strong>
              Watch List —{' '}
              {activeWatchAgents.length}{' '}
              Agents
            </strong>

            {watchUnderKpi > 0 && (
              <span
                className="dashboard-watch-alert"
                title="At least one Watch List agent is under 90% KPI"
              >
                🔴
              </span>
            )}
          </div>

          <small>
            {watchUnderKpi > 0
              ? `${watchUnderKpi} under 90% KPI`
              : 'No active agents under 90% KPI'}
          </small>

          <button
            type="button"
            className="watch-view-button"
            onClick={onOpenWatchList}
          >
            View All
          </button>
        </div>

        <div className="hero-actions">
          {user.permissions
            .canSubmitReviews && (
            <button
              className="primary-button"
              onClick={onNewReview}
            >
              Start a QA Review
            </button>
          )}

          <button
            className="secondary-button"
            onClick={onRefresh}
            disabled={refreshing}
          >
            {refreshing
              ? 'Refreshing…'
              : 'Refresh Firebase Data'}
          </button>
        </div>
      </section>

      <section className="stat-grid dashboard-expanded-stats">
        <article className="stat-card">
          <span>Reviews Today</span>

          <strong>
            {stats.today}
          </strong>

          <small>
            Based on review date
          </small>
        </article>

        <article className="stat-card">
          <span>Total Reviews</span>

          <strong>
            {reviews.length}
          </strong>

          <small>
            Loaded from Firebase
          </small>
        </article>

        <article className="stat-card success">
          <span>Pass Rate</span>

          <strong>
            {reviews.length
              ? `${Math.round(
                  (stats.passed /
                    reviews.length) *
                    100,
                )}%`
              : '0%'}
          </strong>

          <small>
            {stats.passed} passed
          </small>
        </article>

        <article className="stat-card">
          <span>Average Score</span>

          <strong>
            {stats.avg.toFixed(1)}
          </strong>

          <small>
            Across loaded reviews
          </small>
        </article>

        <article className="stat-card danger">
          <span>
            Agents Below KPI
          </span>

          <strong>
            {stats.below}
          </strong>

          <small>
            Unique agents needing
            attention
          </small>
        </article>

        {user.role === 'admin' && (
          <article className="stat-card guided-card">
            <span>
              Guided Evaluators
            </span>

            <strong>
              {guidedUsers}
            </strong>

            <small>
              Extra checks enabled
            </small>
          </article>
        )}
      </section>

      <section className="dashboard-report-grid">
        <article className="panel">
          <h2>
            Reviews by Call Center
          </h2>

          {stats.byCenter.map(
            ([name, count]) => (
              <div
                className="metric-row"
                key={name}
              >
                <span>
                  {name}
                </span>

                <strong>
                  {count}
                </strong>
              </div>
            ),
          )}
        </article>

        <article className="panel">
          <h2>
            Reviews by Evaluator
          </h2>

          {stats.byEvaluator.map(
            ([name, count]) => (
              <div
                className="metric-row"
                key={name}
              >
                <span>
                  {name}
                </span>

                <strong>
                  {count}
                </strong>
              </div>
            ),
          )}
        </article>

        <article className="panel">
          <h2>
            Most Common Markdown
          </h2>

          <p className="issue-highlight">
            {stats.commonIssue}
          </p>
        </article>
      </section>

      {user.role === 'admin' && (
        <section className="panel backup-panel">
          <div>
            <p className="eyebrow">
              Safety
            </p>

            <h2>
              Backup & Restore
            </h2>

            <p className="muted">
              Use Review History to
              download either the full
              Google-Sheet-style workbook
              or the organized team
              report. Firebase remains
              the live database.
            </p>
          </div>

          <div className="hero-actions">
            <button
              className="secondary-button"
              onClick={() =>
                void onCreateBackup()
              }
            >
              Backup Info
            </button>

            <button
              className="danger-button"
              onClick={() =>
                void onRestoreLatestBackup()
              }
            >
              Legacy Restore Info
            </button>
          </div>
        </section>
      )}

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">
              Latest Activity
            </p>

            <h2>
              Recent Reviews
            </h2>
          </div>

          <span className="muted">
            Showing {recent.length}
          </span>
        </div>

        <div className="review-list">
          {recent.map((review) => (
            <article
              key={review.id}
              className="review-list-row"
            >
              <div>
                <strong>
                  {review.agentName}
                </strong>

                <span>
                  {review.callCenter}
                  {' · '}
                  {review.qaType}
                  {' · '}
                  {review.evaluator}
                </span>
              </div>

              <div className="review-score">
                <strong>
                  {review.finalScore}
                </strong>

                <span
                  className={`result-pill ${review.result.toLowerCase()}`}
                >
                  {review.result}
                </span>
              </div>
            </article>
          ))}
        </div>

        {recent.length === 0 && (
          <div className="empty-state">
            No reviews were returned.
          </div>
        )}
      </section>
    </div>
  )
}