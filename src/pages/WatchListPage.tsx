import { useMemo, useState } from 'react'
import { ADMIN_EMAILS, normalizeEmail } from '../lib/firebase'
import { exportWatchListExcel } from '../lib/exportWatchListExcel'
import { getWatchListMetrics, normalizeAgentName, normalizeCallCenter, watchListFirstTwoNamesMatch } from '../lib/watchList'
import type { QaUser, ReviewRecord, WatchListAgent, WatchListAgentInput, WatchListStatus } from '../types'

interface WatchListPageProps {
  user: QaUser
  agents: WatchListAgent[]
  reviews: ReviewRecord[]
  onSave: (input: WatchListAgentInput, id?: string) => Promise<void>
  onSetStatus: (agent: WatchListAgent, status: WatchListStatus) => Promise<void>
  onRefresh: () => Promise<void>
  busy: boolean
  onOpenPerformance?: (agentName: string) => void
}

type WatchFilter = 'Active' | 'History' | 'All'

function formatWatchDate(value: string): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })
}

function getReviewsSinceAdded(agent: WatchListAgent, matchedReviews: ReviewRecord[]): ReviewRecord[] {
  const addedDate = agent.createdAt ? new Date(agent.createdAt) : null
  const addedDay = addedDate && !Number.isNaN(addedDate.getTime())
    ? new Date(addedDate.getFullYear(), addedDate.getMonth(), addedDate.getDate()).getTime()
    : Number.NaN

  return [...matchedReviews]
    .filter((review) => {
      if (Number.isNaN(addedDay)) return true
      const reviewDate = new Date(review.reviewDate || review.savedTimestamp)
      if (Number.isNaN(reviewDate.getTime())) return true
      const reviewDay = new Date(reviewDate.getFullYear(), reviewDate.getMonth(), reviewDate.getDate()).getTime()
      return reviewDay >= addedDay
    })
    .sort((a, b) => new Date(b.reviewDate || b.savedTimestamp).getTime() - new Date(a.reviewDate || a.savedTimestamp).getTime())
}

const WATCH_LIST_CALL_CENTERS = [
  { value: 'Telus', label: 'Telus' },
  { value: 'WNS', label: 'WNS' },
  { value: 'Concentrix', label: 'Concentrix (CNX)' },
  { value: 'Buwelo-C', label: 'Buwelo-C' },
  { value: 'Buwelo-G', label: 'Buwelo-G' },
  { value: 'TEP', label: 'TEP' },
]

const EMPTY_FORM: WatchListAgentInput = {
  callCenter: '',
  lob: '',
  agentName: '',
  trainer: '',
  wave: '',
  startDate: '',
  endDate: '',
  employeeStatus: 'Active',
  reason: '',
  manualQaScore: null,
  manualReviewCount: null,
  watchStatus: 'Active',
}

export function WatchListPage({ user, agents, reviews, onSave, onSetStatus, onRefresh, busy, onOpenPerformance }: WatchListPageProps) {
  const canManage = ADMIN_EMAILS.has(normalizeEmail(user.email))
  const [filter, setFilter] = useState<WatchFilter>('Active')
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<WatchListAgent | null>(null)
  const [form, setForm] = useState<WatchListAgentInput>(EMPTY_FORM)
  const [formOpen, setFormOpen] = useState(false)
  const [error, setError] = useState('')

  const visibleAgents = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return agents.filter((agent) => {
      const statusMatch = filter === 'All' || (filter === 'Active' ? agent.watchStatus === 'Active' : agent.watchStatus !== 'Active')
      const textMatch = !needle || [agent.agentName, agent.callCenter, agent.trainer, agent.wave, agent.lob, agent.reason].join(' ').toLowerCase().includes(needle)
      return statusMatch && textMatch
    })
  }, [agents, filter, query])

  const activeCount = agents.filter((agent) => agent.watchStatus === 'Active').length
  const underKpiCount = agents.filter((agent) => agent.watchStatus === 'Active' && getWatchListMetrics(agent, reviews, agents).averageScore !== null && Number(getWatchListMetrics(agent, reviews, agents).averageScore) < 90).length

  const openNew = () => {
    setEditing(null)
    setForm(EMPTY_FORM)
    setError('')
    setFormOpen(true)
  }

  const openEdit = (agent: WatchListAgent) => {
    setEditing(agent)
    setForm({
      callCenter: agent.callCenter,
      lob: agent.lob,
      agentName: agent.agentName,
      trainer: agent.trainer,
      wave: agent.wave,
      startDate: agent.startDate,
      endDate: agent.endDate,
      employeeStatus: agent.employeeStatus,
      reason: agent.reason,
      manualQaScore: agent.manualQaScore ?? null,
      manualReviewCount: agent.manualReviewCount ?? null,
      watchStatus: agent.watchStatus,
    })
    setError('')
    setFormOpen(true)
  }

  const save = async () => {
    setError('')
    if (!form.agentName.trim() || !form.callCenter.trim() || !form.trainer.trim() || !form.wave.trim()) {
      setError('Agent name, call center, trainer, and wave are required.')
      return
    }
    if (form.manualQaScore !== null && form.manualQaScore !== undefined && (Number(form.manualQaScore) < 0 || Number(form.manualQaScore) > 100)) {
      setError('QA Avg Override must be between 0 and 100%.')
      return
    }

    const sameFirstTwoExisting = agents.find((agent) => {
      if (agent.id === editing?.id || agent.watchStatus !== 'Active') return false
      if (normalizeCallCenter(agent.callCenter) !== normalizeCallCenter(form.callCenter)) return false
      if (normalizeAgentName(agent.agentName) === normalizeAgentName(form.agentName)) return false
      return watchListFirstTwoNamesMatch(agent.agentName, form.agentName)
    })

    if (sameFirstTwoExisting) {
      const samePerson = window.confirm(
        `There is already a Watch List agent named "${sameFirstTwoExisting.agentName}" in ${sameFirstTwoExisting.callCenter}.\n\nIs "${form.agentName.trim()}" the same agent?\n\nOK = Yes, open the existing agent.\nCancel = No, save this as a different agent using the full name.`,
      )
      if (samePerson) {
        openEdit(sameFirstTwoExisting)
        return
      }
    }

    try {
      await onSave(form, editing?.id)
      setFormOpen(false)
      setEditing(null)
      setForm(EMPTY_FORM)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The Watch List agent could not be saved.')
    }
  }

  return (
    <div className="page-stack">
      <section className="watch-list-header panel">
        <div>
          <p className="eyebrow">Quality Radar</p>
          <h1>👁 Watch List Agents</h1>
          <p className="muted">Everyone can view this list. Approved administrators can add, edit, clear, remove, or restore agents.</p>
        </div>
        <div className="watch-list-header-actions">
          <button className="secondary-button" type="button" onClick={() => void exportWatchListExcel(agents, reviews)}>Download Excel</button>
          <button className="secondary-button" type="button" onClick={() => void onRefresh()} disabled={busy}>Refresh</button>
          {canManage && <button className="primary-button" type="button" onClick={openNew}>+ Add Agent</button>}
        </div>
      </section>

      <section className="stat-grid watch-list-stats">
        <article className="stat-card"><span>Active Watch</span><strong>{activeCount}</strong><small>Agents currently on the radar</small></article>
        <article className={`stat-card ${underKpiCount ? 'danger' : ''}`}><span>Under 90% KPI</span><strong>{underKpiCount}</strong><small>Based on existing Firebase QA reviews</small></article>
        <article className="stat-card"><span>History</span><strong>{agents.length - activeCount}</strong><small>Cleared or removed records kept</small></article>
      </section>

      <section className="panel">
        <div className="watch-list-toolbar">
          <div className="watch-filter-buttons" role="group" aria-label="Watch List filters">
            {(['Active', 'History', 'All'] as WatchFilter[]).map((value) => (
              <button key={value} type="button" className={filter === value ? 'active' : ''} onClick={() => setFilter(value)}>{value}</button>
            ))}
          </div>
          <input className="watch-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search agent, call center, trainer, wave, LOB..." />
        </div>

        <div className="watch-table-wrap">
          <table className="watch-table">
            <thead>
              <tr>
                <th>Agent</th><th>Call Center</th><th>LOB</th><th>Trainer</th><th>Wave</th><th>Date Added</th><th>QA Review Dates Since Added</th><th>Start</th><th>End</th><th>Employee Status</th><th>QA Avg</th><th>Reviews</th><th>KPI</th><th>Reason</th><th>Watch Status</th>{canManage && <th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {visibleAgents.map((agent) => {
                const metrics = getWatchListMetrics(agent, reviews, agents)
                const reviewsSinceAdded = getReviewsSinceAdded(agent, metrics.matchedReviews)
                return (
                  <tr key={agent.id} className={`watch-row watch-row--${metrics.kpiBand} ${agent.watchStatus !== 'Active' ? 'watch-row--history' : ''}`}>
                    <td><strong>{agent.agentName}</strong>{canManage && onOpenPerformance && <button type="button" className="watch-history-link" onClick={() => onOpenPerformance(agent.agentName)}>View score history</button>}</td>
                    <td>{agent.callCenter || '—'}</td>
                    <td>{agent.lob || '—'}</td>
                    <td>{agent.trainer || '—'}</td>
                    <td>{agent.wave || '—'}</td>
                    <td className="watch-date-added-cell"><strong>{formatWatchDate(agent.createdAt)}</strong><small>{agent.createdByName ? `Added by ${agent.createdByName}` : ''}</small></td>
                    <td className="watch-review-dates-cell">
                      {reviewsSinceAdded.length ? (
                        <div className="watch-review-date-list">
                          {reviewsSinceAdded.map((review) => (
                            <div className="watch-review-date-item" key={review.id || `${review.rowNumber}-${review.reviewDate}`}>
                              <strong>{formatWatchDate(review.reviewDate || review.savedTimestamp)}</strong>
                              <span>{review.evaluator || 'QA'} · {Number(review.finalScore || 0).toFixed(1)}%</span>
                            </div>
                          ))}
                        </div>
                      ) : <span className="muted">No review since added</span>}
                    </td>
                    <td>{agent.startDate || '—'}</td>
                    <td>{agent.endDate || '—'}</td>
                    <td>{agent.employeeStatus || '—'}</td>
                    <td><strong>{metrics.averageScore === null ? '—' : `${metrics.averageScore.toFixed(1)}%`}</strong>{metrics.hasManualScore && <small className="watch-manual-tag"> Manual</small>}</td>
                    <td>{metrics.reviewCount}{metrics.hasManualReviewCount && <small className="watch-manual-tag"> Manual</small>}</td>
                    <td><span className={`watch-kpi-pill watch-kpi-pill--${metrics.kpiBand}`}>{metrics.kpiLabel}</span></td>
                    <td className="watch-reason-cell">{agent.reason || '—'}</td>
                    <td><span className={`watch-status-pill watch-status-pill--${agent.watchStatus.toLowerCase()}`}>{agent.watchStatus}</span></td>
                    {canManage && (
                      <td>
                        <div className="watch-actions">
                          <button type="button" className="text-button" onClick={() => openEdit(agent)}>Edit</button>
                          {agent.watchStatus === 'Active' ? (
                            <>
                              <button type="button" className="text-button" onClick={() => void onSetStatus(agent, 'Cleared')}>Clear</button>
                              <button type="button" className="text-button danger-text" onClick={() => void onSetStatus(agent, 'Removed')}>Remove</button>
                            </>
                          ) : (
                            <button type="button" className="text-button" onClick={() => void onSetStatus(agent, 'Active')}>Restore</button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
          {visibleAgents.length === 0 && <div className="empty-state">No Watch List agents match this view.</div>}
        </div>
      </section>

      {formOpen && canManage && (
        <div className="watch-modal-backdrop" role="presentation" onMouseDown={() => !busy && setFormOpen(false)}>
          <section className="watch-modal" role="dialog" aria-modal="true" aria-label={editing ? 'Edit Watch List agent' : 'Add Watch List agent'} onMouseDown={(event) => event.stopPropagation()}>
            <div className="panel-heading"><div><p className="eyebrow">Watch List</p><h2>{editing ? 'Edit Agent' : 'Add Agent'}</h2></div><button type="button" className="text-button" onClick={() => setFormOpen(false)}>Close</button></div>
            {error && <div className="error-banner">{error}</div>}
            {editing && (() => {
              const autoMetrics = getWatchListMetrics({ ...editing, manualQaScore: null, manualReviewCount: null }, reviews, agents)
              return <div className="watch-auto-summary">Automatic QA from Firebase: <strong>{autoMetrics.averageScore === null ? 'No QA Yet' : `${autoMetrics.averageScore.toFixed(1)}%`}</strong> from <strong>{autoMetrics.reviewCount}</strong> matched review{autoMetrics.reviewCount === 1 ? '' : 's'}. Manual overrides below only change the Watch List display.</div>
            })()}
            <div className="form-grid watch-form-grid">
              <label className="field"><span>Agent Name *</span><input value={form.agentName} onChange={(e) => setForm({ ...form, agentName: e.target.value })} /></label>
              <label className="field"><span>Call Center *</span><select value={form.callCenter} onChange={(e) => setForm({ ...form, callCenter: e.target.value })}><option value="">Select call center</option>{WATCH_LIST_CALL_CENTERS.map((center) => <option key={center.value} value={center.value}>{center.label}</option>)}</select></label>
              <label className="field"><span>Trainer *</span><input value={form.trainer} onChange={(e) => setForm({ ...form, trainer: e.target.value })} /></label>
              <label className="field"><span>LOB</span><input value={form.lob} onChange={(e) => setForm({ ...form, lob: e.target.value })} /></label>
              <label className="field"><span>Wave *</span><input value={form.wave} onChange={(e) => setForm({ ...form, wave: e.target.value })} /></label>
              <label className="field"><span>Start Date</span><input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} /></label>
              <label className="field"><span>End Date</span><input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} /></label>
              <label className="field"><span>Employee Status</span><input value={form.employeeStatus} onChange={(e) => setForm({ ...form, employeeStatus: e.target.value })} /></label>
              <label className="field"><span>Watch Status</span><select value={form.watchStatus || 'Active'} onChange={(e) => setForm({ ...form, watchStatus: e.target.value as WatchListStatus })}><option value="Active">Active</option><option value="Cleared">Cleared</option><option value="Removed">Removed</option></select></label>
              <label className="field"><span>QA Avg Override % <small>(optional)</small></span><input type="number" min="0" max="100" step="0.1" placeholder="Auto from QA reviews" value={form.manualQaScore ?? ''} onChange={(e) => setForm({ ...form, manualQaScore: e.target.value === '' ? null : Number(e.target.value) })} /><small>Leave blank to use the automatic Firebase QA average.</small></label>
              <label className="field"><span>Reviews Override <small>(optional)</small></span><input type="number" min="0" step="1" placeholder="Auto from QA reviews" value={form.manualReviewCount ?? ''} onChange={(e) => setForm({ ...form, manualReviewCount: e.target.value === '' ? null : Math.max(0, Math.trunc(Number(e.target.value))) })} /><small>Leave blank to use the automatic matched review count.</small></label>
              <label className="field watch-reason-field"><span>Reason for Watch <small>(optional)</small></span><textarea rows={3} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></label>
            </div>
            <div className="watch-modal-actions"><button className="secondary-button" type="button" onClick={() => setFormOpen(false)} disabled={busy}>Cancel</button><button className="primary-button" type="button" onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : 'Save Agent'}</button></div>
          </section>
        </div>
      )}
    </div>
  )
}
