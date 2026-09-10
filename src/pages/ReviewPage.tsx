import { useEffect, useMemo, useState } from 'react'
import { createCriterionAnswers, createReviewDraft, localDateInput, pointsForStatus } from '../data/defaults'
import type {
  AppSettings,
  CriterionAnswer,
  CriterionStatus,
  QaType,
  QaUser,
  ReviewDraft,
  WatchListAgent,
} from '../types'
import { findActiveWatchAgent } from '../lib/watchList'
import { checkAutoQaService, runAutoQa, type AutoQaCriterionResult } from '../lib/autoQa'

interface ReviewPageProps {
  user: QaUser
  settings: AppSettings
  evaluators: QaUser[]
  watchListAgents: WatchListAgent[]
  onSave: (review: ReviewDraft) => Promise<void>
  saving: boolean
  initialQaType?: QaType
}

interface ValidationState {
  errors: string[]
  fieldErrors: Record<string, string>
}

function normalizeCallId(value: string): string {
  const cleaned = value.replace(/\s+/g, '')
  if (/^ca/i.test(cleaned)) return `CA${cleaned.slice(2)}`
  return cleaned
}

function isCriticalCriterion(name: string): boolean {
  const normalized = name.toLowerCase()
  return normalized.includes('matrix compliance') || normalized.includes('documentation quality')
}

function isMatrixComplianceCriterion(name: string): boolean {
  return name.toLowerCase().includes('matrix compliance')
}

function criticalReasonsFor(name: string): string[] {
  const normalized = name.toLowerCase()
  if (normalized.includes('documentation quality')) {
    return [
      'No Notes',
      'Voucher # in Notes / Slack / Macro',
      'Other Documentation Critical',
    ]
  }
  return [
    'Required Matrix process was not followed',
    'Required escalation path was not followed',
    'Required Matrix tool/process was used incorrectly',
    'Other Matrix Critical',
  ]
}

function validateReview(review: ReviewDraft, user: QaUser, settings: AppSettings): ValidationState {
  const errors: string[] = []
  const fieldErrors: Record<string, string> = {}
  const add = (field: string, message: string) => {
    fieldErrors[field] = message
    errors.push(message)
  }

  const aiAgentReview = review.callCenter.trim().toLowerCase() === 'ai agents'
  if (!review.agentStartDate && !aiAgentReview) add('agentStartDate', 'Add the agent start date.')
  if (!review.todayDate) add('todayDate', 'Today’s date is missing.')
  if (!review.evaluator) add('evaluator', 'Choose an evaluator.')
  if (!review.agentName.trim()) add('agentName', 'Add the agent name.')
  if (!review.callCenter) add('callCenter', 'Choose the call center.')
  if (settings.rules.callIdRequired && !review.callId.trim()) add('callId', 'Add the Call ID.')
  if (!review.qaType) add('qaType', 'Choose CS, Groups, or Sales.')
  if (review.qaType === 'Sales' && !settings.criteria.Sales.length) add('qaType', 'Sales QA is waiting for the approved Sales scoring matrix from Ann/April.')
  if (settings.rules.confirmationRequired && review.confirmationNumber.trim().length < 2) {
    add('confirmationNumber', 'Add an itinerary, confirmation number, reservation number, or booking reference.')
  }
  if (!review.callLength.trim()) add('callLength', 'Add the call length.')
  if (!review.callDate) add('callDate', 'Add the date of the call.')

  if (user.guidedMode && review.callId.trim()) {
    try {
      const expression = new RegExp(settings.rules.guidedCallIdPattern)
      if (!expression.test(review.callId.trim())) {
        add('callId', 'The Call ID must start with CA and contain exactly 32 hexadecimal characters after CA.')
      }
    } catch {
      add('callId', 'The guided Call ID rule is not configured correctly. Ask an administrator to check Settings.')
    }
  }

  review.criteria.forEach((criterion, index) => {
    if (!criterion.status) {
      add(`criterion-${index}`, `Select a status for criterion ${criterion.number}: ${criterion.name}.`)
    }

    if (
      settings.rules.noteRequiredForMarkdownOrPartial &&
      (criterion.status === '✕ Markdown' || criterion.status === 'Partial') &&
      !criterion.customNote.trim()
    ) {
      add(`note-${index}`, `Add a clear note for criterion ${criterion.number} because ${criterion.status} was selected.`)
    }

    if (criterion.status === 'Critical') {
      if (!isCriticalCriterion(criterion.name)) {
        add(`criterion-${index}`, `Critical can only be selected for Matrix Compliance or Documentation Quality.`)
      } else if (!String(criterion.criticalReason || '').trim()) {
        add(`criterion-${index}`, `Select a Critical reason for criterion ${criterion.number}: ${criterion.name}.`)
      }
    }
  })

  return { errors, fieldErrors }
}

export function ReviewPage({ user, settings, evaluators, watchListAgents, onSave, saving, initialQaType = 'CS' }: ReviewPageProps) {
  const [review, setReview] = useState<ReviewDraft>(() => createReviewDraft(settings, user.displayName, initialQaType))
  const [validation, setValidation] = useState<ValidationState>({ errors: [], fieldErrors: {} })
  const [showChecklist, setShowChecklist] = useState(false)
  const [draftRestored, setDraftRestored] = useState(false)
  const [criticalModal, setCriticalModal] = useState<{ index: number; reason: string; note: string } | null>(null)
  const [audioFile, setAudioFile] = useState<File | null>(null)
  const [documentation, setDocumentation] = useState('')
  const [autoQaBusy, setAutoQaBusy] = useState(false)
  const [autoQaMessage, setAutoQaMessage] = useState('')
  const [autoQaTranscript, setAutoQaTranscript] = useState('')
  const [autoQaEvidence, setAutoQaEvidence] = useState<Record<number, AutoQaCriterionResult>>({})
  const [autoQaServiceOnline, setAutoQaServiceOnline] = useState<boolean | null>(null)
  const [manualOverrides, setManualOverrides] = useState<Set<number>>(() => new Set())
  const draftKey = `qa-review-draft:${user.email}:${initialQaType.toLowerCase()}`

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(draftKey)
      if (saved) {
        const parsed = JSON.parse(saved) as ReviewDraft
        if (parsed && parsed.agentName !== undefined && Array.isArray(parsed.criteria)) {
          setReview(parsed)
          setDraftRestored(true)
          return
        }
      }
    } catch {
      window.localStorage.removeItem(draftKey)
    }

    setReview((current) => ({
      ...current,
      evaluator: user.role === 'admin' ? current.evaluator || user.displayName : user.displayName,
      todayDate: localDateInput(),
    }))
  }, [draftKey, user.displayName, user.role])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      window.localStorage.setItem(draftKey, JSON.stringify(review))
    }, 500)
    return () => window.clearTimeout(timer)
  }, [draftKey, review])

  useEffect(() => {
    if (!settings.autoQa?.enabled) return
    let cancelled = false
    void checkAutoQaService(settings).then((result) => {
      if (!cancelled) setAutoQaServiceOnline(result.ok)
    })
    return () => { cancelled = true }
  }, [settings])

  const executeAutoQa = async (recheck = false) => {
    if (!settings.autoQa?.enabled) {
      setAutoQaMessage('Auto QA is disabled in Admin settings.')
      return
    }
    if (!recheck && !audioFile) {
      setAutoQaMessage('Choose an audio file first.')
      return
    }
    if (!documentation.trim()) {
      setAutoQaMessage('Paste the itinerary / documentation notes before finishing Auto QA.')
      return
    }
    setAutoQaBusy(true)
    setAutoQaMessage(recheck ? 'Rechecking the QA with the current transcript, documentation and Matrix…' : 'Transcribing the call and reviewing it against the QA form, documentation and Matrix…')
    try {
      const result = await runAutoQa({
        audioFile: recheck && autoQaTranscript ? undefined : (audioFile || undefined),
        transcript: recheck ? autoQaTranscript : '',
        documentation,
        qaType: review.qaType,
        settings,
      })

      const byNumber = new Map(result.criteria.map((item) => [Number(item.number), item]))
      setReview((current) => ({
        ...current,
        confirmationNumber: current.confirmationNumber.trim() || result.detectedItinerary || current.confirmationNumber,
        callLength: current.callLength.trim() || result.detectedCallLength || current.callLength,
        callDate: current.callDate || (result.detectedCallDate && /^\d{4}-\d{2}-\d{2}$/.test(result.detectedCallDate) ? result.detectedCallDate : ''),
        criteria: current.criteria.map((criterion) => {
          const ai = byNumber.get(Number(criterion.number))
          if (!ai || (recheck && manualOverrides.has(Number(criterion.number)))) return criterion
          let status = ai.status
          let criticalReason = ai.criticalReason || ''
          if (status === '✕ Markdown' && current.qaType !== 'Groups' && isMatrixComplianceCriterion(criterion.name)) {
            status = 'Critical'
            criticalReason = criticalReason || 'Required Matrix process was not followed'
          }
          if (status === 'Critical' && !isCriticalCriterion(criterion.name)) status = '✕ Markdown'
          return {
            ...criterion,
            status,
            customNote: ai.note || '',
            criticalReason: status === 'Critical' ? (criticalReason || (criterion.name.toLowerCase().includes('documentation quality') ? 'Other Documentation Critical' : 'Other Matrix Critical')) : '',
            partialPoints: criterion.points / 2,
            autoPoints: pointsForStatus(criterion.points, status),
          }
        }),
      }))
      if (!recheck) setManualOverrides(new Set())
      setAutoQaTranscript(result.transcript || autoQaTranscript)
      setAutoQaEvidence(Object.fromEntries(result.criteria.map((item) => [Number(item.number), item])) as Record<number, AutoQaCriterionResult>)
      setValidation({ errors: [], fieldErrors: {} })
      setAutoQaServiceOnline(true)
      setAutoQaMessage(`QA review complete. Overall confidence ${Math.round(result.overallConfidence || 0)}%. Review the answers and edit any note you want before saving.`)
    } catch (error) {
      setAutoQaServiceOnline(false)
      setAutoQaMessage(error instanceof Error ? error.message : 'Auto QA failed.')
    } finally {
      setAutoQaBusy(false)
    }
  }

  const score = useMemo(
    () => review.criteria.reduce((sum, criterion) => sum + criterion.autoPoints, 0),
    [review.criteria],
  )
  const kpi = review.qaType === 'Groups' ? settings.rules.groupsKpi : review.qaType === 'Sales' ? settings.rules.salesKpi : settings.rules.csKpi
  const hasCriticalError = review.qaType !== 'Groups' && Boolean(
    review.criteria.some((criterion) => criterion.status === 'Critical') ||
    review.criticalErrors?.noNotes ||
    review.criticalErrors?.voucherReference
  )
  const displayedScore = hasCriticalError ? 0 : score
  const result = !hasCriticalError && score >= kpi ? 'PASS' : 'FAIL'
  const markdowns = review.criteria.filter((criterion) => criterion.status === '✕ Markdown').length
  const watchListMatch = useMemo(() => findActiveWatchAgent(review.agentName, watchListAgents, review.callCenter), [review.agentName, review.callCenter, watchListAgents])

  const updateField = <K extends keyof ReviewDraft>(field: K, value: ReviewDraft[K]) => {
    setReview((current) => ({ ...current, [field]: value }))
    setValidation((current) => {
      const next = { ...current.fieldErrors }
      delete next[String(field)]
      return { errors: current.errors, fieldErrors: next }
    })
  }

  const updateQaType = (qaType: QaType) => {
    setReview((current) => ({
      ...current,
      qaType,
      criteria: createCriterionAnswers(settings, qaType),
    }))
    setValidation({ errors: [], fieldErrors: {} })
    setAutoQaEvidence({})
    setManualOverrides(new Set())
  }

  const updateCriterion = (index: number, patch: Partial<CriterionAnswer>) => {
    const criterionNumber = Number(review.criteria[index]?.number)
    if (Number.isFinite(criterionNumber)) setManualOverrides((current) => new Set(current).add(criterionNumber))
    setReview((current) => ({
      ...current,
      criteria: current.criteria.map((criterion, criterionIndex) => {
        if (criterionIndex !== index) return criterion

        const updated = { ...criterion, ...patch }

        // Custom notes stay available for Followed so evaluators can leave
        // optional positive/context notes. Markdown and Partial remain required
        // by validation. Only clear an old note when the status is reset to blank.
        if (patch.status !== undefined && patch.status === '') {
          updated.customNote = ''
          updated.criticalReason = ''
        }
        if (patch.status !== undefined && patch.status !== 'Critical') {
          updated.criticalReason = ''
        }

        updated.partialPoints = updated.points / 2
        updated.autoPoints = pointsForStatus(updated.points, updated.status)
        return updated
      }),
    }))

    setValidation((current) => {
      const next = { ...current.fieldErrors }
      delete next[`criterion-${index}`]

      // Clear any note error as soon as the status no longer requires a note,
      // or as soon as the evaluator starts typing a note.
      if (
        patch.customNote !== undefined ||
        (patch.status !== undefined &&
          patch.status !== '✕ Markdown' &&
          patch.status !== 'Partial' &&
          patch.status !== 'Critical')
      ) {
        delete next[`note-${index}`]
      }

      return { errors: current.errors, fieldErrors: next }
    })
  }

  const prepareSubmit = () => {
    const nextReview = {
      ...review,
      callId: normalizeCallId(review.callId),
      todayDate: localDateInput(),
      evaluator: user.role === 'admin' ? review.evaluator : user.displayName,
    }
    setReview(nextReview)

    const nextValidation = validateReview(nextReview, user, settings)
    setValidation(nextValidation)

    if (nextValidation.errors.length) {
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }

    if (user.guidedMode) {
      setShowChecklist(true)
      return
    }

    void submit(nextReview)
  }

  const resetReviewForm = (qaType: QaType) => {
    setReview(createReviewDraft(settings, user.displayName, qaType))
    setValidation({ errors: [], fieldErrors: {} })
    setShowChecklist(false)
    setDraftRestored(false)
    window.localStorage.removeItem(draftKey)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const submit = async (value = review) => {
    try {
      await onSave(value)
      resetReviewForm(value.qaType)
    } catch {
      setShowChecklist(false)
    }
  }

  if (!user.permissions.canSubmitReviews) {
    return (
      <section className="panel empty-state">
        Your account can’t submit reviews. An administrator can change this in Admin Control.
      </section>
    )
  }

  return (
    <div className="page-stack">
      {draftRestored && (
        <section className="draft-restored-banner">Draft restored automatically. Your unfinished review was recovered from this browser.</section>
      )}

      {user.guidedMode && (
        <section className="guided-banner">
          <div className="guided-icon">✓</div>
          <div>
            <strong>Guided Mode is on</strong>
            <p>
              This mode gives friendly reminders, keeps scoring fields locked, and asks for a final double-check before saving.
            </p>
          </div>
        </section>
      )}

      {validation.errors.length > 0 && (
        <section className="error-summary" role="alert">
          <strong>Please fix {validation.errors.length} item{validation.errors.length === 1 ? '' : 's'} before saving:</strong>
          <ul>
            {validation.errors.slice(0, 8).map((error) => <li key={error}>{error}</li>)}
          </ul>
        </section>
      )}

      {user.guidedMode && (
        <section className="guided-progress-card">
          <strong>Review progress</strong>
          <div className="guided-progress-grid">
            <span className={review.agentName && review.callCenter && review.callId ? 'complete' : ''}>Call details {review.agentName && review.callCenter && review.callId ? '✓' : '○'}</span>
            <span className={review.criteria.every((item) => item.status) ? 'complete' : ''}>Criteria selected {review.criteria.every((item) => item.status) ? '✓' : '○'}</span>
            <span className={review.criteria.every((item) => !['✕ Markdown', 'Partial'].includes(item.status) || item.customNote.trim()) ? 'complete' : ''}>Markdown / Partial notes {review.criteria.every((item) => !['✕ Markdown', 'Partial'].includes(item.status) || item.customNote.trim()) ? '✓' : '○'}</span>
            <span className={validation.errors.length === 0 ? 'complete' : ''}>Ready to save {validation.errors.length === 0 ? '✓' : '○'}</span>
          </div>
        </section>
      )}

      <section className="qa-sheet-card">
        <div className="qa-sheet-header">
          <div>
            <p>HotelPlanner Quality Assurance</p>
            <h1>QA Scorer</h1>
          </div>
          <p className="qa-instruction">Select ✓ / ✕ / N/A / Partial for every criterion. Matrix and Documentation also allow Critical.</p>
        </div>

        <div className="form-score-layout">
          <div className="details-grid">
            <label className={validation.fieldErrors.agentStartDate ? 'field invalid' : 'field'}>
              <span>Agent Start Date</span>
              <input
                type="date"
                value={review.agentStartDate}
                onChange={(event) => updateField('agentStartDate', event.target.value)}
                disabled={!user.permissions.canEditAgentDetails}
              />
              {validation.fieldErrors.agentStartDate && <small>{validation.fieldErrors.agentStartDate}</small>}
            </label>

            <label className="field locked-field">
              <span>Today’s Date</span>
              <input type="date" value={review.todayDate} readOnly />
            </label>

            <label className={validation.fieldErrors.evaluator ? 'field invalid' : 'field'}>
              <span>Evaluator</span>
              {user.role === 'admin' ? (
                <select value={review.evaluator} onChange={(event) => updateField('evaluator', event.target.value)}>
                  {evaluators.filter((evaluator) => evaluator.active).map((evaluator) => (
                    <option key={evaluator.email} value={evaluator.displayName}>{evaluator.displayName}</option>
                  ))}
                </select>
              ) : (
                <input value={user.displayName} readOnly />
              )}
            </label>

            <label className={validation.fieldErrors.agentName ? 'field invalid' : 'field'}>
              <span>Agent Name</span>
              <input
                value={review.agentName}
                onChange={(event) => updateField('agentName', event.target.value)}
                placeholder=""
                disabled={!user.permissions.canEditAgentDetails}
              />
              {validation.fieldErrors.agentName && <small>{validation.fieldErrors.agentName}</small>}
              {watchListMatch && (
                <div className="watch-agent-warning" role="status">
                  <strong>👁 WATCH LIST AGENT</strong>
                  <span>{watchListMatch.wave}{watchListMatch.trainer ? ` · Trainer: ${watchListMatch.trainer}` : ''}</span>
                </div>
              )}
            </label>

            <label className={validation.fieldErrors.callCenter ? 'field invalid' : 'field'}>
              <span>Call Center</span>
              <input
                list="qa-call-centers"
                value={review.callCenter}
                onChange={(event) => updateField('callCenter', event.target.value)}
                placeholder="Pick or type a call center"
                autoComplete="off"
                disabled={!user.permissions.canEditAgentDetails}
              />
              <datalist id="qa-call-centers">
                {settings.callCenters.map((center) => <option key={center} value={center} />)}
              </datalist>
              <em>Choose an existing call center or type a new one.</em>
              {validation.fieldErrors.callCenter && <small>{validation.fieldErrors.callCenter}</small>}
            </label>

            <label className={validation.fieldErrors.callId ? 'field invalid' : 'field'}>
              <span>Call ID</span>
              <input
                value={review.callId}
                onChange={(event) => updateField('callId', event.target.value)}
                onBlur={() => updateField('callId', normalizeCallId(review.callId))}
                placeholder=""
                disabled={!user.permissions.canEditAgentDetails}
              />
              {user.guidedMode && <em>Use CA followed by 32 hexadecimal characters.</em>}
              {validation.fieldErrors.callId && <small>{validation.fieldErrors.callId}</small>}
            </label>

            <label className={validation.fieldErrors.qaType ? 'field invalid' : 'field'}>
              <span>QA Type</span>
              <select value={review.qaType} onChange={(event) => updateQaType(event.target.value as QaType)}>
                <option value="CS">CS</option>
                <option value="Groups">Groups</option>
                <option value="Sales" disabled={!settings.criteria.Sales.length}>Sales{!settings.criteria.Sales.length ? ' — matrix pending approval' : ''}</option>
              </select>
            </label>

            <label className={validation.fieldErrors.confirmationNumber ? 'field invalid' : 'field'}>
              <span>Confirmation / Itinerary #</span>
              <input
                value={review.confirmationNumber}
                onChange={(event) => updateField('confirmationNumber', event.target.value)}
                placeholder=""
                disabled={!user.permissions.canEditAgentDetails}
              />
              
              {validation.fieldErrors.confirmationNumber && <small>{validation.fieldErrors.confirmationNumber}</small>}
            </label>

            <label className={validation.fieldErrors.callLength ? 'field invalid' : 'field'}>
              <span>Length of Call</span>
              <input
                value={review.callLength}
                onChange={(event) => updateField('callLength', event.target.value)}
                placeholder=""
                disabled={!user.permissions.canEditAgentDetails}
              />
              {validation.fieldErrors.callLength && <small>{validation.fieldErrors.callLength}</small>}
            </label>

            <label className={validation.fieldErrors.callDate ? 'field invalid' : 'field'}>
              <span>Date of Call</span>
              <input
                type="date"
                value={review.callDate}
                onChange={(event) => updateField('callDate', event.target.value)}
                disabled={!user.permissions.canEditAgentDetails}
              />
              {validation.fieldErrors.callDate && <small>{validation.fieldErrors.callDate}</small>}
            </label>
          </div>

          {settings.autoQa?.enabled && (
            <section className="autoqa-review-panel">
              <div className="autoqa-review-heading">
                <div>
                  <p className="eyebrow">Auto QA</p>
                  <h3>Call + Documentation Review</h3>
                  <p className="muted">Upload the call, paste the booking documentation, then review every prefilled QA answer before saving.</p>
                </div>
                <span className={`service-status ${autoQaServiceOnline === true ? 'online' : autoQaServiceOnline === false ? 'offline' : ''}`}>
                  {autoQaServiceOnline === true ? 'Local service online' : autoQaServiceOnline === false ? 'Local service offline' : 'Checking local service…'}
                </span>
              </div>

              <div className="autoqa-input-grid">
                <label className="field">
                  <span>Call Audio</span>
                  <input
                    type="file"
                    accept="audio/*,.wav,.mp3,.m4a,.aac,.ogg,.flac,.wma,.mp4,.webm"
                    onChange={(event) => {
                      setAudioFile(event.target.files?.[0] || null)
                      setAutoQaTranscript('')
                      setAutoQaEvidence({})
                    }}
                    disabled={autoQaBusy}
                  />
                  <em>{audioFile ? audioFile.name : 'WAV, MP3, M4A, AAC, OGG, FLAC, WMA, MP4 and other FFmpeg-supported formats.'}</em>
                </label>

                <label className="field autoqa-documentation-field">
                  <span>Documentation / Itinerary Notes</span>
                  <textarea
                    value={documentation}
                    onChange={(event) => setDocumentation(event.target.value)}
                    placeholder="Copy and paste the full Refunds / Notes / Zendesk / itinerary documentation here…"
                    disabled={autoQaBusy}
                  />
                </label>
              </div>

              <div className="autoqa-actions">
                <button type="button" className="primary-button" onClick={() => void executeAutoQa(false)} disabled={!audioFile || autoQaBusy}>
                  {autoQaBusy ? 'Reviewing…' : 'Run Auto QA'}
                </button>
                <button type="button" className="secondary-button" onClick={() => void executeAutoQa(true)} disabled={!autoQaTranscript || autoQaBusy}>
                  Recheck QA with Ollama
                </button>
                {autoQaTranscript && <span className="muted">Transcript ready · {autoQaTranscript.split(/\s+/).filter(Boolean).length} words{manualOverrides.size ? ` · ${manualOverrides.size} manual edit${manualOverrides.size === 1 ? '' : 's'} protected` : ''}</span>}
              </div>
              {autoQaMessage && <div className="validation-banner"><span>{autoQaMessage}</span></div>}
            </section>
          )}

          <aside className="score-panel">
            <div><span>Final Score</span><strong>{displayedScore}</strong></div>
            <div><span>KPI Target</span><strong>{kpi}</strong></div>
            <div><span>Result</span><strong className={result === 'PASS' ? 'pass-text' : 'fail-text'}>{result}</strong></div>
            <div><span>Markdowns</span><strong>{markdowns}</strong></div>
          </aside>
        </div>

        <div className="criteria-table-wrap">
          <table className="criteria-table">
            <thead>
              <tr>
                <th>#</th>
                <th>QA Criteria</th>
                <th>Max</th>
                <th>Select</th>
                <th>Partial Points</th>
                <th>Auto Points</th>
                <th>Notes / Issue Found</th>
                <th>Custom Notes</th>
              </tr>
            </thead>
            <tbody>
              {review.criteria.map((criterion, index) => (
                <tr key={`${review.qaType}-${criterion.number}`}>
                  <td data-label="#">{criterion.number}</td>
                  <td data-label="QA Criteria"><strong>{criterion.name}</strong></td>
                  <td data-label="Max">{criterion.points}</td>
                  <td data-label="Select" className={validation.fieldErrors[`criterion-${index}`] ? 'cell-invalid' : ''}>
                    <select
                      value={criterion.status}
                      onChange={(event) => {
                        const nextStatus = event.target.value as CriterionStatus
                        if (nextStatus === 'Critical') {
                          setCriticalModal({ index, reason: criterion.criticalReason || '', note: criterion.customNote || '' })
                          return
                        }
                        if (nextStatus === '✕ Markdown' && review.qaType !== 'Groups' && isMatrixComplianceCriterion(criterion.name)) {
                          updateCriterion(index, {
                            status: 'Critical',
                            criticalReason: 'Required Matrix process was not followed',
                          })
                          return
                        }
                        updateCriterion(index, { status: nextStatus })
                      }}
                      disabled={!user.permissions.canEditCriteriaSelections}
                    >
                      <option value="">Select</option>
                      {settings.statusOptions.filter((status) => status !== 'Critical').map((status) => <option key={status} value={status}>{status}</option>)}
                      {review.qaType !== 'Groups' && isCriticalCriterion(criterion.name) && <option value="Critical">Critical</option>}
                    </select>
                    {criterion.status === 'Critical' && criterion.criticalReason && (
                      <button
                        type="button"
                        className="critical-reason-button"
                        onClick={() => setCriticalModal({ index, reason: criterion.criticalReason || '', note: criterion.customNote || '' })}
                      >
                        Reason: {criterion.criticalReason}
                      </button>
                    )}
                    {validation.fieldErrors[`criterion-${index}`] && <small>{validation.fieldErrors[`criterion-${index}`]}</small>}
                  </td>
                  <td data-label="Partial Points">{criterion.status === 'Partial' ? criterion.partialPoints : ''}</td>
                  <td data-label="Auto Points"><strong>{hasCriticalError ? (criterion.status ? 0 : '') : (criterion.autoPoints || (criterion.status ? 0 : ''))}</strong></td>
                  <td data-label="Notes / Issue Found"><p>{criterion.notes}</p></td>
                  <td data-label="Custom Notes" className={validation.fieldErrors[`note-${index}`] ? 'cell-invalid' : ''}>
                    {criterion.status ? (
                      <>
                        <textarea
                          value={criterion.customNote}
                          onChange={(event) => updateCriterion(index, { customNote: event.target.value })}
                          placeholder={
                            criterion.status === '✕ Markdown' || criterion.status === 'Partial'
                              ? 'Required: explain the issue clearly…'
                              : criterion.status === 'Critical'
                                ? 'Optional coaching comments. The Critical reason is saved above…'
                              : criterion.status === '✓ Followed'
                                ? 'Optional: add a positive note or extra context…'
                                : 'Optional note…'
                          }
                          disabled={!user.permissions.canEditCustomNotes}
                        />
                        {criterion.status === '✓ Followed' && !criterion.customNote.trim() && (
                          <small className="optional-note-hint">Optional for Followed.</small>
                        )}
                        {validation.fieldErrors[`note-${index}`] && <small>{validation.fieldErrors[`note-${index}`]}</small>}
                        {autoQaEvidence[criterion.number] && (
                          <details className={`autoqa-evidence ${autoQaEvidence[criterion.number].confidence < 75 ? 'review-me' : ''}`}>
                            <summary>Confidence {Math.round(autoQaEvidence[criterion.number].confidence)}%{autoQaEvidence[criterion.number].confidence < 75 ? ' · Review Me' : ''} · View Evidence</summary>
                            <div className="autoqa-evidence-body">
                              <p><strong>Call:</strong> {autoQaEvidence[criterion.number].transcriptEvidence || 'No direct call evidence.'}</p>
                              <p><strong>Documentation:</strong> {autoQaEvidence[criterion.number].documentationEvidence || 'No direct documentation evidence.'}</p>
                              <p><strong>Matrix:</strong> {autoQaEvidence[criterion.number].matrixEvidence || 'No Matrix excerpt used.'}</p>
                            </div>
                          </details>
                        )}
                      </>
                    ) : (
                      <span className="note-not-required">Select a status first.</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {hasCriticalError && (
          <section className="critical-errors-panel">
            <div className="validation-banner">
              <strong>CRITICAL FAIL — Final QA is 0% / FAIL.</strong>
              <span>All other categories remain editable for scoring selections and coaching comments, but their saved points are zeroed for this QA.</span>
            </div>
          </section>
        )}

        <div className="review-additional-comments">
          <label className="field">
            <span>Additional Comments (Optional)</span>
            <textarea
              value={review.additionalComments || ''}
              onChange={(event) => updateField('additionalComments', event.target.value)}
              placeholder="Add general observations that do not affect scoring, such as line quality, background noise, customer behavior, or positive feedback about the agent…"
              disabled={!user.permissions.canEditCustomNotes}
            />
            <em>Optional. This does not affect the QA score.</em>
          </label>
        </div>

        <div className="save-bar">
          <div>
            <strong>Ready to save?</strong>
            <span>The review will be saved directly to Firebase and included in both Excel export formats.</span>
          </div>
          <button type="button" className="primary-button save-button" onClick={prepareSubmit} disabled={saving}>
            {saving ? 'Saving Review…' : 'Save Review'}
          </button>
        </div>
      </section>

      {criticalModal && review.criteria[criticalModal.index] && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal-card critical-modal" role="dialog" aria-modal="true" aria-labelledby="critical-title">
            <p className="eyebrow">Critical QA</p>
            <h2 id="critical-title">Select the reason for this Critical</h2>
            <p className="muted"><strong>{review.criteria[criticalModal.index].name}</strong></p>
            <p className="critical-warning-copy">Choosing Critical makes the entire QA 0% / FAIL. You can still complete every category and add coaching comments.</p>
            <label className="field">
              <span>Critical Reason</span>
              <select
                value={criticalModal.reason}
                onChange={(event) => setCriticalModal((current) => current ? { ...current, reason: event.target.value } : current)}
                autoFocus
              >
                <option value="">Select a reason</option>
                {criticalReasonsFor(review.criteria[criticalModal.index].name).map((reason) => <option key={reason} value={reason}>{reason}</option>)}
              </select>
            </label>
            <label className="field">
              <span>Coaching Comment (Optional)</span>
              <textarea
                value={criticalModal.note}
                onChange={(event) => setCriticalModal((current) => current ? { ...current, note: event.target.value } : current)}
                placeholder="Add details the Call Center team can use for coaching…"
              />
            </label>
            <div className="modal-actions">
              <button type="button" className="secondary-button" onClick={() => setCriticalModal(null)}>Cancel</button>
              <button
                type="button"
                className="primary-button danger-button"
                onClick={() => {
                  if (!criticalModal.reason.trim()) {
                    window.alert('Please select a Critical reason.')
                    return
                  }
                  updateCriterion(criticalModal.index, {
                    status: 'Critical',
                    criticalReason: criticalModal.reason,
                    customNote: criticalModal.note,
                  })
                  setCriticalModal(null)
                }}
              >
                Apply Critical
              </button>
            </div>
          </section>
        </div>
      )}

      {showChecklist && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal-card checklist-modal" role="dialog" aria-modal="true" aria-labelledby="checklist-title">
            <p className="eyebrow">Friendly final check</p>
            <h2 id="checklist-title">Please confirm these details</h2>
            <div className="checklist">
              <label><input type="checkbox" required /> The Call ID belongs to this exact call.</label>
              <label><input type="checkbox" required /> The booking reference belongs to this guest.</label>
              <label><input type="checkbox" required /> The call center, QA type, call length, and call date are correct.</label>
              <label><input type="checkbox" required /> Every criterion status was checked. Followed comments are optional; Markdown / Partial notes were added where required.</label>
            </div>
            <p className="kind-note">Take your time. This extra check is here to help prevent small mistakes.</p>
            <div className="modal-actions">
              <button type="button" className="secondary-button" onClick={() => setShowChecklist(false)}>Go Back</button>
              <button
                type="button"
                className="primary-button"
                onClick={() => {
                  const checkboxes = Array.from(document.querySelectorAll<HTMLInputElement>('.checklist input[type="checkbox"]'))
                  if (!checkboxes.every((checkbox) => checkbox.checked)) {
                    window.alert('Please check all four boxes before saving.')
                    return
                  }
                  void submit(review)
                }}
                disabled={saving}
              >
                {saving ? 'Saving…' : 'Confirm and Save'}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}