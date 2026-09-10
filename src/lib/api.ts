import type { ApiResponse, AppSettings, AuthSession, BootstrapResponse, CriterionAnswer, QaUser, ReviewDraft, ReviewRecord, WatchListAgent, WatchListAgentInput, WatchListStatus } from '../types'
import { DEFAULT_SETTINGS } from '../data/defaults'
import { STARTER_WATCH_LIST } from '../data/watchListSeed'
import { ADMIN_EMAILS, SUPER_ADMIN_EMAILS, firestore, normalizeEmail, realtimeDb } from './firebase'

export interface PresenceUser {
  email: string
  displayName: string
  role: string
  currentPage: string
  lastSeen: string
  sessionId: string
  online: boolean
}

const viewerPermissions = {
  canSubmitReviews: false,
  canViewHistory: true,
  canEditAgentDetails: false,
  canEditCriteriaSelections: false,
  canEditCustomNotes: false,
}

function viewerFromSession(session: AuthSession): QaUser {
  return {
    email: normalizeEmail(session.email),
    displayName: session.name || session.email,
    role: 'viewer',
    active: true,
    guidedMode: false,
    notes: 'Viewer access. An administrator must add this account before it can submit reviews.',
    permissions: { ...viewerPermissions },
  }
}

function sanitizeUser(raw: any, fallback?: QaUser): QaUser {
  const base = fallback || viewerFromSession({ idToken: '', email: raw?.email || '', name: raw?.displayName || raw?.email || '' })
  return {
    ...base,
    ...raw,
    email: normalizeEmail(raw?.email || base.email),
    displayName: String(raw?.displayName || base.displayName || raw?.email || '').trim(),
    permissions: { ...base.permissions, ...(raw?.permissions || {}) },
  }
}

function dateOnly(value: unknown): string {
  if (!value) return ''

  // HTML date inputs already give us a local calendar date (YYYY-MM-DD).
  // Parsing that string with new Date() treats it as UTC and can move it to
  // the previous day in US time zones, so preserve date-only values exactly.
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed
  }

  const date = value instanceof Date ? value : new Date(String(value))
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10)
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function friendlyFirebaseError(error: any): Error {
  const code = String(error?.code || '')
  if (code.includes('permission-denied')) return new Error('Firebase blocked this action because your account does not have permission.')
  if (code.includes('unavailable')) return new Error('Firebase is temporarily unavailable. Check your internet connection and try again.')
  if (code.includes('failed-precondition')) return new Error('Firebase needs an index or setup change for this action. Contact Junior.')
  return error instanceof Error ? error : new Error('The Firebase request could not be completed.')
}

export function getFriendlyApiError(error: unknown): string {
  return friendlyFirebaseError(error).message
}

export function requiresNewLogin(_error: unknown): boolean { return false }

function isFormerTepCallCenter(value: unknown): boolean {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
  return normalized === 'tep' || normalized === 'teleperformance'
}

function removeFormerTepCenters(values: unknown): string[] {
  const source = Array.isArray(values) ? values : []
  return source.map((value) => String(value || '').trim()).filter((value) => value && !isFormerTepCallCenter(value))
}

const fullAdminPermissions = {
  canSubmitReviews: true,
  canViewHistory: true,
  canEditAgentDetails: true,
  canEditCriteriaSelections: true,
  canEditCustomNotes: true,
}

function builtInAdminFromSession(storedUser: QaUser, email: string, exists: boolean): QaUser {
  const displayNames: Record<string, string> = {
    'infojr.83@gmail.com': 'Junior',
    'barbara.kalchik8reserve@gmail.com': 'Barbara',
    'april.grantham@hotelplanner.com': 'April Grantham',
    'jim.fryer@hotelplanner.com': 'Jim Fryer',
    'karen.caldas@hotelplanner.com': 'Karen Caldas',
  }

  const isSuperAdmin = SUPER_ADMIN_EMAILS.has(email)
  return {
    ...storedUser,
    email,
    displayName: storedUser.displayName || displayNames[email] || email,
    role: 'admin',
    // Super Admins are protected. Regular approved admins can still be blocked
    // by a Super Admin through their Firestore user document.
    active: isSuperAdmin ? true : (exists ? storedUser.active !== false : true),
    guidedMode: false,
    permissions: { ...fullAdminPermissions },
  }
}

export async function bootstrap(session: AuthSession): Promise<BootstrapResponse> {
  try {
    const email = normalizeEmail(session.email)
    const userRef = firestore.collection('users').doc(email)
    const userSnap = await userRef.get()
    const fallback = viewerFromSession(session)
    const storedUser = userSnap.exists ? sanitizeUser(userSnap.data(), fallback) : fallback

    const user: QaUser = ADMIN_EMAILS.has(email)
      ? builtInAdminFromSession(storedUser, email, userSnap.exists)
      : storedUser

    if (!user.active) throw new Error('This QA app account is blocked. Contact Junior or Barbara.')

    // Auto-provision/repair the five approved admin profiles after a verified
    // Firebase login. This means April, Jim, and Karen do not need a Google account.
    if (ADMIN_EMAILS.has(email)) {
      await userRef.set({
        ...user,
        updatedAt: new Date().toISOString(),
        updatedBy: email,
      }, { merge: true })
    }

    const settingsSnap = await firestore.collection('settings').doc('main').get()
    const storedSettings = settingsSnap.exists ? (settingsSnap.data() || {}) : {}
    const settings: AppSettings = {
      ...DEFAULT_SETTINGS,
      ...storedSettings,
      callCenters: removeFormerTepCenters(storedSettings.callCenters || DEFAULT_SETTINGS.callCenters),
      criteria: { ...DEFAULT_SETTINGS.criteria, ...(storedSettings.criteria || {}) },
      rules: { ...DEFAULT_SETTINGS.rules, ...(storedSettings.rules || {}) },
      autoQa: { ...DEFAULT_SETTINGS.autoQa, ...(storedSettings.autoQa || {}) },
    }

    let users: QaUser[] = [user]
    if (user.role === 'admin' && ADMIN_EMAILS.has(email)) {
      const usersSnap = await firestore.collection('users').get()
      users = usersSnap.docs.map((doc: any) => sanitizeUser(doc.data())).filter((item: QaUser) => Boolean(item.email))
      if (!users.some((item) => normalizeEmail(item.email) === email)) users.unshift(user)
    }

    return { success: true, user, users, settings }
  } catch (error) {
    throw friendlyFirebaseError(error)
  }
}

export async function fetchReviews(_session: AuthSession, _refresh = false): Promise<ReviewRecord[]> {
  try {
    const snapshot = await firestore.collection('reviews').orderBy('savedTimestamp', 'desc').get()
    return snapshot.docs
      .map((doc: any) => ({ id: doc.id, ...doc.data() } as ReviewRecord))
      .filter((review: ReviewRecord) => !isFormerTepCallCenter(review.callCenter))
  } catch (error: any) {
    // During first setup, an empty collection can be read without an index issue.
    throw friendlyFirebaseError(error)
  }
}

function calculateReview(review: ReviewDraft, settings: AppSettings, actor: QaUser): ReviewRecord {
  if (!actor.permissions.canSubmitReviews) throw new Error('Your account cannot submit QA reviews.')
  const aiAgentReview = review.callCenter.trim().toLowerCase() === 'ai agents'
  if (!review.agentStartDate && !aiAgentReview) throw new Error('Add the agent start date.')
  if (!review.agentName.trim()) throw new Error('Add the agent name.')
  if (!review.callCenter.trim()) throw new Error('Add or choose a call center.')
  if (isFormerTepCallCenter(review.callCenter)) throw new Error('TEP / Teleperformance is no longer an available call center.')
  if (settings.rules.callIdRequired && !review.callId.trim()) throw new Error('Add the Call ID.')
  if (settings.rules.confirmationRequired && review.confirmationNumber.trim().length < 2) throw new Error('Add an itinerary, confirmation number, reservation number, or booking reference.')
  if (!review.callLength.trim()) throw new Error('Add the call length.')
  if (!review.callDate) throw new Error('Add the date of the call.')
  if (actor.guidedMode && !(new RegExp(settings.rules.guidedCallIdPattern)).test(review.callId.trim())) throw new Error('The Call ID does not match the Guided Mode format.')

  let finalScore = 0
  let markdowns = 0
  let criteria: CriterionAnswer[] = settings.criteria[review.qaType].map((definition, index) => {
    const answer = review.criteria.find((item) => Number(item.number) === Number(definition.number)) || review.criteria[index]
    const selectedStatus = answer?.status || ''
    const normalizedName = definition.name.toLowerCase()
    const isMatrixCompliance = normalizedName.includes('matrix compliance')
    const criticalEligible = review.qaType !== 'Groups' && (isMatrixCompliance || normalizedName.includes('documentation quality'))
    const matrixMarkdownBecomesCritical = review.qaType !== 'Groups' && isMatrixCompliance && selectedStatus === '✕ Markdown'
    const status = matrixMarkdownBecomesCritical ? 'Critical' : selectedStatus
    const allowedStatus = settings.statusOptions.includes(selectedStatus as any) || (status === 'Critical' && criticalEligible)
    if (!allowedStatus) throw new Error(`Select a status for criterion ${definition.number}: ${definition.name}.`)
    const customNote = String(answer?.customNote || '').trim()
    const criticalReason = String(answer?.criticalReason || '').trim() || (matrixMarkdownBecomesCritical ? 'Required Matrix process was not followed' : '')
    if (settings.rules.noteRequiredForMarkdownOrPartial && (selectedStatus === '✕ Markdown' || selectedStatus === 'Partial') && !customNote) throw new Error(`Add a clear note for criterion ${definition.number} because ${selectedStatus} was selected.`)
    if (status === 'Critical' && !criticalReason) throw new Error(`Select a Critical reason for criterion ${definition.number}: ${definition.name}.`)
    if (!actor.permissions.canEditCustomNotes && customNote) throw new Error('Your account cannot add custom notes.')
    const autoPoints = status === '✓ Followed' || status === 'N/A' ? definition.points : status === 'Partial' ? definition.points / 2 : 0
    if (selectedStatus === '✕ Markdown') markdowns += 1
    finalScore += autoPoints
    return { ...definition, status, partialPoints: status === 'Partial' ? definition.points / 2 : 0, autoPoints, customNote, criticalReason }
  })

  const kpiTarget = review.qaType === 'Groups' ? settings.rules.groupsKpi : review.qaType === 'Sales' ? settings.rules.salesKpi : settings.rules.csKpi
  const criticalCriteria = criteria.filter((item) => item.status === 'Critical')
  const legacyNoNotes = Boolean(review.criticalErrors?.noNotes)
  const legacyVoucherReference = Boolean(review.criticalErrors?.voucherReference)
  const criticalErrors = {
    noNotes: legacyNoNotes || criticalCriteria.some((item) => item.criticalReason === 'No Notes'),
    voucherReference: legacyVoucherReference || criticalCriteria.some((item) => item.criticalReason === 'Voucher # in Notes / Slack / Macro'),
  }
  const hasCriticalError = review.qaType !== 'Groups' && (criticalCriteria.length > 0 || criticalErrors.noNotes || criticalErrors.voucherReference)
  if (hasCriticalError) {
    finalScore = 0
    criteria = criteria.map((item) => ({ ...item, autoPoints: 0 }))
  }
  const result = !hasCriticalError && finalScore >= kpiTarget ? 'PASS' : 'FAIL'
  const now = new Date().toISOString()
  return {
    id: review.requestId || `review-${Date.now()}`,
    rowNumber: 0,
    savedTimestamp: now,
    agentStartDate: dateOnly(review.agentStartDate),
    reviewDate: dateOnly(review.todayDate || now),
    evaluator: actor.role === 'admin' ? review.evaluator : actor.displayName,
    agentName: review.agentName.trim(),
    callCenter: review.callCenter.trim(),
    callId: review.callId.trim().replace(/\s+/g, ''),
    itineraryNumber: review.confirmationNumber.trim(),
    emailSent: false,
    qaType: review.qaType,
    finalScore,
    kpiTarget,
    result,
    markdowns,
    issueSummary: [
      ...criteria
        .filter((item) => item.status === 'Critical')
        .map((item) => `CRITICAL: ${item.name} — ${item.criticalReason}${item.customNote ? ` — ${item.customNote}` : ''} — automatic 0% QA / FAIL`),
      ...criteria
        .filter((item) => item.status !== 'Critical' && item.customNote)
        .map((item) => `${item.name} - ${item.status} - ${item.customNote}`),
      ...(legacyNoNotes && !criticalCriteria.some((item) => item.criticalReason === 'No Notes') ? ['CRITICAL: No Notes — automatic 0% QA / FAIL'] : []),
      ...(legacyVoucherReference && !criticalCriteria.some((item) => item.criticalReason === 'Voucher # in Notes / Slack / Macro') ? ['CRITICAL: Voucher # in Notes / Slack / Macro — automatic 0% QA / FAIL; escalate with IT# and Agent Name'] : []),
    ].join(' | '),
    callLength: review.callLength.trim(),
    callDate: dateOnly(review.callDate),
    criteria,
    additionalComments: String(review.additionalComments || '').trim(),
    criticalErrors,
  }
}

async function nextRowNumber(): Promise<number> {
  const counterRef = firestore.collection('meta').doc('reviews')
  return firestore.runTransaction(async (transaction: any) => {
    const snap = await transaction.get(counterRef)
    const next = Math.max(2, Number(snap.data()?.nextRowNumber || 2))
    transaction.set(counterRef, { nextRowNumber: next + 1, updatedAt: new Date().toISOString() }, { merge: true })
    return next
  })
}

export async function saveReview(session: AuthSession, review: ReviewDraft): Promise<ApiResponse> {
  try {
    const boot = await bootstrap(session)
    const record = calculateReview(review, boot.settings, boot.user)
    record.rowNumber = await nextRowNumber()
    const docId = review.requestId || `review-${record.rowNumber}-${Date.now()}`
    record.id = docId
    await firestore.collection('reviews').doc(docId).set({ ...record, createdByEmail: normalizeEmail(session.email), createdByUid: session.uid || '' })
    await addAudit('REVIEW SAVED', session, '', { reviewId: docId, rowNumber: record.rowNumber, evaluator: record.evaluator, agentName: record.agentName, finalScore: record.finalScore })
    return { success: true, message: `Review saved to Firebase (review row ${record.rowNumber}).`, review: record }
  } catch (error) { throw friendlyFirebaseError(error) }
}

function normalizeSavedUser(user: QaUser): QaUser {
  const email = normalizeEmail(user.email)
  if (SUPER_ADMIN_EMAILS.has(email)) {
    return {
      ...user,
      email,
      role: 'admin',
      active: true,
      guidedMode: false,
      permissions: { ...fullAdminPermissions },
    }
  }
  if (ADMIN_EMAILS.has(email)) {
    return {
      ...user,
      email,
      role: 'admin',
      guidedMode: false,
      permissions: { ...fullAdminPermissions },
    }
  }
  return { ...user, email }
}

export async function saveUser(session: AuthSession, user: QaUser): Promise<ApiResponse<QaUser>> {
  try {
    const actor = normalizeEmail(session.email)
    const target = normalizeEmail(user.email)
    const actorIsSuperAdmin = SUPER_ADMIN_EMAILS.has(actor)
    const targetIsSuperAdmin = SUPER_ADMIN_EMAILS.has(target)
    const targetIsAdmin = ADMIN_EMAILS.has(target)

    if (!ADMIN_EMAILS.has(actor)) throw new Error('Only an administrator can perform this action.')

    if (targetIsSuperAdmin) {
      throw new Error('Junior and Barbara are protected Super Admin accounts and cannot be changed from Admin Control.')
    }

    if (user.role === 'admin' && !ADMIN_EMAILS.has(target)) {
      throw new Error('The Admin role is reserved for Junior, Barbara, April, Jim, and Karen.')
    }

    if (targetIsAdmin && !actorIsSuperAdmin) {
      throw new Error('Only Junior or Barbara can create or change an administrator account.')
    }

    const saved = normalizeSavedUser({
      ...user,
      email: target,
      updatedAt: new Date().toISOString(),
      updatedBy: actor,
    })

    await firestore.collection('users').doc(target).set(saved, { merge: true })
    await addAudit('USER UPSERTED', session, target, saved)
    return { success: true, message: `${saved.displayName} was saved.`, user: saved }
  } catch (error) { throw friendlyFirebaseError(error) }
}

export async function setUserBlocked(session: AuthSession, email: string, blocked: boolean): Promise<ApiResponse> {
  try {
    const actor = normalizeEmail(session.email)
    const target = normalizeEmail(email)
    const actorIsSuperAdmin = SUPER_ADMIN_EMAILS.has(actor)

    if (!ADMIN_EMAILS.has(actor)) throw new Error('Only an administrator can perform this action.')
    if (SUPER_ADMIN_EMAILS.has(target)) throw new Error('Junior and Barbara are protected Super Admin accounts and cannot be blocked.')
    if (ADMIN_EMAILS.has(target) && !actorIsSuperAdmin) throw new Error('Only Junior or Barbara can block or unblock another administrator.')

    await firestore.collection('users').doc(target).set({ active: !blocked, updatedAt: new Date().toISOString(), updatedBy: actor }, { merge: true })
    await addAudit(blocked ? 'USER BLOCKED' : 'USER UNBLOCKED', session, target, {})
    return { success: true, message: `Account ${blocked ? 'blocked' : 'unblocked'}.` }
  } catch (error) { throw friendlyFirebaseError(error) }
}

export async function saveSettings(session: AuthSession, settings: AppSettings): Promise<ApiResponse<AppSettings>> {
  try {
    if (!ADMIN_EMAILS.has(normalizeEmail(session.email))) throw new Error('Only an administrator can change QA settings.')
    const cleanedSettings = { ...settings, callCenters: removeFormerTepCenters(settings.callCenters) }
    await firestore.collection('settings').doc('main').set({ ...cleanedSettings, updatedAt: new Date().toISOString(), updatedBy: normalizeEmail(session.email) })
    await addAudit('SETTINGS UPDATED', session, '', {})
    return { success: true, message: 'QA settings were saved to Firebase.', settings: cleanedSettings }
  } catch (error) { throw friendlyFirebaseError(error) }
}

export async function markReviewEmailSent(session: AuthSession, review: ReviewRecord, sent: boolean): Promise<ApiResponse<ReviewRecord>> {
  try {
    if (!ADMIN_EMAILS.has(normalizeEmail(session.email))) throw new Error('Only an administrator can change the email-sent status.')
    const patch = { emailSent: sent, emailSentAt: sent ? new Date().toISOString() : '', emailSentBy: sent ? session.name : '', updatedAt: new Date().toISOString() }
    await firestore.collection('reviews').doc(review.id).update(patch)
    return { success: true, message: `Email marked ${sent ? 'sent' : 'not sent'}.`, review: { ...review, ...patch } }
  } catch (error) { throw friendlyFirebaseError(error) }
}

async function addAudit(action: string, session: AuthSession, targetEmail: string, details: unknown) {
  try {
    await firestore.collection('auditLogs').add({ action, actorEmail: normalizeEmail(session.email), actorName: session.name, targetEmail: normalizeEmail(targetEmail), details, createdAt: new Date().toISOString() })
  } catch (error) { console.warn('Audit log write failed.', error) }
}


export async function purgeFormerTepData(session: AuthSession): Promise<{ reviewsDeleted: number; watchListDeleted: number }> {
  const actor = normalizeEmail(session.email)
  if (actor !== 'infojr.83@gmail.com') return { reviewsDeleted: 0, watchListDeleted: 0 }

  const cleanupRef = firestore.collection('meta').doc('retired-call-center-cleanup')
  const cleanupSnap = await cleanupRef.get()
  if (cleanupSnap.exists && cleanupSnap.data()?.completed === true) return { reviewsDeleted: 0, watchListDeleted: 0 }

  const [reviewsSnap, watchListSnap, settingsSnap] = await Promise.all([
    firestore.collection('reviews').get(),
    firestore.collection('watchListAgents').get(),
    firestore.collection('settings').doc('main').get(),
  ])

  const reviewDocs = reviewsSnap.docs.filter((doc: any) => isFormerTepCallCenter(doc.data()?.callCenter))
  const watchDocs = watchListSnap.docs.filter((doc: any) => isFormerTepCallCenter(doc.data()?.callCenter))
  const refs = [...reviewDocs, ...watchDocs].map((doc: any) => doc.ref)

  for (let start = 0; start < refs.length; start += 400) {
    const batch = firestore.batch()
    refs.slice(start, start + 400).forEach((ref: any) => batch.delete(ref))
    await batch.commit()
  }

  if (settingsSnap.exists) {
    const stored = settingsSnap.data() || {}
    const cleanedCenters = removeFormerTepCenters(stored.callCenters || [])
    await settingsSnap.ref.set({ callCenters: cleanedCenters, updatedAt: new Date().toISOString(), updatedBy: actor }, { merge: true })
  }

  await cleanupRef.set({ completed: true, completedAt: new Date().toISOString(), completedBy: actor, reviewsDeleted: reviewDocs.length, watchListDeleted: watchDocs.length }, { merge: true })

  return { reviewsDeleted: reviewDocs.length, watchListDeleted: watchDocs.length }
}

export async function updatePresence(session: AuthSession, currentPage: string, sessionId: string): Promise<PresenceUser | null> {
  if (!session.uid) return null
  const userSnap = await firestore.collection('users').doc(normalizeEmail(session.email)).get().catch(() => null)
  const role = userSnap?.exists ? String(userSnap.data()?.role || 'viewer') : 'viewer'
  const presence: PresenceUser = { email: normalizeEmail(session.email), displayName: session.name || session.email, role, currentPage, lastSeen: new Date().toISOString(), sessionId, online: true }
  await realtimeDb.ref(`presence/${session.uid}`).set(presence)
  realtimeDb.ref(`presence/${session.uid}`).onDisconnect().remove().catch(() => undefined)
  return presence
}

export async function getPresence(_session: AuthSession): Promise<PresenceUser[]> {
  const snapshot = await realtimeDb.ref('presence').once('value')
  const values = snapshot.val() || {}
  const cutoff = Date.now() - 120000
  return Object.values(values).map((item: any) => ({ ...item, online: new Date(item.lastSeen || 0).getTime() >= cutoff })) as PresenceUser[]
}

export async function removePresence(session: AuthSession, _sessionId: string): Promise<void> {
  if (session.uid) await realtimeDb.ref(`presence/${session.uid}`).remove()
}

export async function createQaBackup(_session: AuthSession): Promise<ApiResponse> {
  return { success: true, message: 'Use “Download Full Google-Sheet Style” in Review History for a complete offline backup.' }
}

export async function restoreLatestQaBackup(_session: AuthSession): Promise<ApiResponse> {
  return { success: false, message: 'Automatic Google Sheet restore was removed. Use the Legacy Firebase Import in Admin Control to restore/import an Excel workbook safely.' }
}

// Kept for compatibility with old imports. Client-side Excel export no longer calls a backend.
export async function exportReviewsWorkbook(): Promise<{ filename: string; base64: string }> {
  throw new Error('Server-side export was removed. Use the browser Excel export buttons.')
}

function normalizeAgentName(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

function sanitizeWatchListAgent(id: string, raw: any): WatchListAgent {
  return {
    id,
    callCenter: String(raw?.callCenter || '').trim(),
    lob: String(raw?.lob || '').trim(),
    agentName: String(raw?.agentName || '').trim(),
    trainer: String(raw?.trainer || '').trim(),
    wave: String(raw?.wave || '').trim(),
    startDate: dateOnly(raw?.startDate),
    endDate: dateOnly(raw?.endDate),
    employeeStatus: String(raw?.employeeStatus || '').trim(),
    reason: String(raw?.reason || '').trim(),
    manualQaScore: raw?.manualQaScore === null || raw?.manualQaScore === undefined || raw?.manualQaScore === '' ? null : Number(raw.manualQaScore),
    manualReviewCount: raw?.manualReviewCount === null || raw?.manualReviewCount === undefined || raw?.manualReviewCount === '' ? null : Math.max(0, Math.trunc(Number(raw.manualReviewCount))),
    watchStatus: (['Active', 'Cleared', 'Removed'].includes(String(raw?.watchStatus)) ? raw.watchStatus : 'Active') as WatchListStatus,
    createdAt: String(raw?.createdAt || ''),
    createdBy: normalizeEmail(raw?.createdBy || ''),
    createdByName: String(raw?.createdByName || raw?.createdBy || ''),
    updatedAt: String(raw?.updatedAt || ''),
    updatedBy: normalizeEmail(raw?.updatedBy || ''),
    updatedByName: String(raw?.updatedByName || raw?.updatedBy || ''),
    clearedAt: String(raw?.clearedAt || ''),
    clearedBy: normalizeEmail(raw?.clearedBy || ''),
    clearedByName: String(raw?.clearedByName || raw?.clearedBy || ''),
  }
}

function assertWatchListAdmin(session: AuthSession) {
  if (!ADMIN_EMAILS.has(normalizeEmail(session.email))) {
    throw new Error('Only an administrator can add, edit, remove, or restore Watch List agents.')
  }
}

export async function fetchWatchListAgents(_session: AuthSession): Promise<WatchListAgent[]> {
  try {
    const snapshot = await firestore.collection('watchListAgents').get()
    return snapshot.docs
      .map((doc: any) => sanitizeWatchListAgent(doc.id, doc.data()))
      .filter((agent: WatchListAgent) => !isFormerTepCallCenter(agent.callCenter))
      .sort((a: WatchListAgent, b: WatchListAgent) => {
        if (a.watchStatus === 'Active' && b.watchStatus !== 'Active') return -1
        if (a.watchStatus !== 'Active' && b.watchStatus === 'Active') return 1
        return a.agentName.localeCompare(b.agentName)
      })
  } catch (error) {
    throw friendlyFirebaseError(error)
  }
}

export async function seedStarterWatchList(session: AuthSession): Promise<boolean> {
  try {
    assertWatchListAdmin(session)
    const snapshot = await firestore.collection('watchListAgents').limit(1).get()
    if (!snapshot.empty) return false

    const batch = firestore.batch()
    const now = new Date().toISOString()
    STARTER_WATCH_LIST.forEach((agent, index) => {
      const ref = firestore.collection('watchListAgents').doc(`starter-${String(index + 1).padStart(2, '0')}`)
      batch.set(ref, {
        ...agent,
        normalizedName: normalizeAgentName(agent.agentName),
        watchStatus: 'Active',
        createdAt: now,
        createdBy: normalizeEmail(session.email),
        createdByName: session.name || session.email,
        updatedAt: now,
        updatedBy: normalizeEmail(session.email),
        updatedByName: session.name || session.email,
      })
    })
    await batch.commit()
    await addAudit('WATCH LIST STARTER IMPORTED', session, '', { count: STARTER_WATCH_LIST.length })
    return true
  } catch (error) {
    throw friendlyFirebaseError(error)
  }
}

export async function saveWatchListAgent(session: AuthSession, input: WatchListAgentInput, id?: string): Promise<WatchListAgent> {
  try {
    assertWatchListAdmin(session)
    if (!input.agentName.trim()) throw new Error('Agent name is required.')
    if (!input.callCenter.trim()) throw new Error('Call center is required.')
    if (isFormerTepCallCenter(input.callCenter)) throw new Error('TEP / Teleperformance is no longer an available call center.')
    if (!input.trainer.trim()) throw new Error('Trainer name is required.')
    if (!input.wave.trim()) throw new Error('Wave is required.')

    const normalizedName = normalizeAgentName(input.agentName)
    const existing = await firestore.collection('watchListAgents').where('normalizedName', '==', normalizedName).get()
    const duplicate = existing.docs.find((doc: any) => doc.id !== id && String(doc.data()?.watchStatus || 'Active') === 'Active')
    if (duplicate) throw new Error(`${input.agentName.trim()} is already on the active Watch List.`)

    const now = new Date().toISOString()
    const actor = normalizeEmail(session.email)
    const ref = id ? firestore.collection('watchListAgents').doc(id) : firestore.collection('watchListAgents').doc()
    const previous = id ? await ref.get() : null
    const previousData = previous?.exists ? previous.data() : null
    const nextWatchStatus = input.watchStatus || previousData?.watchStatus || 'Active'
    const statusMovedToHistory = nextWatchStatus === 'Cleared' || nextWatchStatus === 'Removed'
    const payload = {
      ...input,
      callCenter: input.callCenter.trim(),
      agentName: input.agentName.trim(),
      trainer: input.trainer.trim(),
      normalizedName,
      watchStatus: nextWatchStatus,
      manualQaScore: input.manualQaScore === null || input.manualQaScore === undefined || Number.isNaN(Number(input.manualQaScore)) ? null : Math.max(0, Math.min(100, Number(input.manualQaScore))),
      manualReviewCount: input.manualReviewCount === null || input.manualReviewCount === undefined || Number.isNaN(Number(input.manualReviewCount)) ? null : Math.max(0, Math.trunc(Number(input.manualReviewCount))),
      createdAt: previousData?.createdAt || now,
      createdBy: previousData?.createdBy || actor,
      createdByName: previousData?.createdByName || session.name || session.email,
      updatedAt: now,
      updatedBy: actor,
      updatedByName: session.name || session.email,
      clearedAt: statusMovedToHistory ? (previousData?.clearedAt || now) : '',
      clearedBy: statusMovedToHistory ? (previousData?.clearedBy || actor) : '',
      clearedByName: statusMovedToHistory ? (previousData?.clearedByName || session.name || session.email) : '',
    }
    await ref.set(payload, { merge: true })
    await addAudit(id ? 'WATCH LIST AGENT UPDATED' : 'WATCH LIST AGENT ADDED', session, '', { agentId: ref.id, agentName: payload.agentName })
    return sanitizeWatchListAgent(ref.id, payload)
  } catch (error) {
    throw friendlyFirebaseError(error)
  }
}

export async function setWatchListAgentStatus(session: AuthSession, agent: WatchListAgent, status: WatchListStatus): Promise<WatchListAgent> {
  try {
    assertWatchListAdmin(session)
    const now = new Date().toISOString()
    const actor = normalizeEmail(session.email)
    const patch: Record<string, string> = {
      watchStatus: status,
      updatedAt: now,
      updatedBy: actor,
      updatedByName: session.name || session.email,
    }
    if (status === 'Cleared' || status === 'Removed') {
      patch.clearedAt = now
      patch.clearedBy = actor
      patch.clearedByName = session.name || session.email
    } else {
      patch.clearedAt = ''
      patch.clearedBy = ''
      patch.clearedByName = ''
    }
    await firestore.collection('watchListAgents').doc(agent.id).update(patch)
    await addAudit(`WATCH LIST AGENT ${status.toUpperCase()}`, session, '', { agentId: agent.id, agentName: agent.agentName })
    return { ...agent, ...patch, watchStatus: status }
  } catch (error) {
    throw friendlyFirebaseError(error)
  }
}

