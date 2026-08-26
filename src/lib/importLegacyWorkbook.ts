import ExcelJS from 'exceljs'
import type { AppSettings, AuthSession, CriterionAnswer, QaUser, ReviewRecord } from '../types'
import { DEFAULT_SETTINGS } from '../data/defaults'
import { BARBARA_EMAIL, OWNER_EMAIL, firestore, normalizeEmail } from './firebase'

export interface MigrationResult {
  reviews: number
  users: number
  settings: boolean
  skippedRows: number
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object' && value && 'text' in (value as any)) return String((value as any).text || '').trim()
  if (typeof value === 'object' && value && 'result' in (value as any)) return String((value as any).result ?? '').trim()
  return String(value).replace(/\u00a0/g, ' ').trim()
}

function plainCell(value: unknown): unknown {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'object' && value && 'text' in (value as any)) return String((value as any).text || '')
  if (typeof value === 'object' && value && 'result' in (value as any)) return plainCell((value as any).result)
  return cellText(value)
}

function bool(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  const normalized = cellText(value).toLowerCase()
  return ['true', 'yes', '1', 'y', 'sent', 'checked'].includes(normalized)
}

function number(value: unknown, fallback = 0): number {
  const parsed = Number(cellText(value))
  return Number.isFinite(parsed) ? parsed : fallback
}

function excelDate(value: unknown): Date | null {
  if (!value) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (typeof value === 'number' && Number.isFinite(value)) {
    // QA workbook dates should be modern Excel serial dates. Reject stray call
    // durations or corrupted date-formatted numbers instead of turning them
    // into 1900-era or far-future dates. The raw value is still kept in
    // legacyColumns for the full legacy-style export.
    if (value < 20000 || value > 100000) return null
    const utcDays = Math.floor(value - 25569)
    const utcValue = utcDays * 86400
    const fractional = value - Math.floor(value)
    const seconds = Math.round(86400 * fractional)
    const date = new Date((utcValue + seconds) * 1000)
    return Number.isNaN(date.getTime()) ? null : date
  }
  const raw = cellText(value)
  if (!raw) return null
  const parsed = new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T12:00:00` : raw)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function iso(value: unknown): string {
  return excelDate(value)?.toISOString() || cellText(value)
}

function dateOnly(value: unknown): string {
  const date = excelDate(value)
  if (!date) return typeof value === 'number' ? '' : cellText(value).slice(0, 10)
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function rowObject(sheet: ExcelJS.Worksheet, rowNumber: number): Record<string, unknown> {
  const headers = sheet.getRow(1)
  const row = sheet.getRow(rowNumber)
  const result: Record<string, unknown> = {}
  for (let column = 1; column <= sheet.columnCount; column += 1) {
    const header = cellText(headers.getCell(column).value)
    if (header) result[header] = row.getCell(column).value
  }
  return result
}

function criterionFromRow(data: Record<string, unknown>, index: number): CriterionAnswer | null {
  const name = cellText(data[`Criteria ${index} Name`])
  const status = cellText(data[`Criteria ${index} Status`]) as CriterionAnswer['status']
  const customNote = cellText(data[`Custom Note ${index}`])
  if (!name && !status && !customNote) return null
  const points = number(data[`Criteria ${index} Max Points`], 0)
  return {
    number: number(data[`Criteria ${index} #`], index),
    name,
    points,
    status,
    partialPoints: number(data[`Criteria ${index} Partial Points`], status === 'Partial' ? points / 2 : 0),
    autoPoints: number(data[`Criteria ${index} Auto Points`], 0),
    notes: cellText(data[`Criteria ${index} Notes / Issue Found`]),
    customNote,
  }
}

function reviewFromRow(data: Record<string, unknown>, rowNumber: number): ReviewRecord | null {
  const agentName = cellText(data['Agent Name'])
  const evaluator = cellText(data['Evaluator'])
  const callId = cellText(data['Call ID'])
  const savedTimestamp = iso(data['Saved Timestamp'])
  if (!agentName && !evaluator && !callId && !savedTimestamp) return null

  const criteria = Array.from({ length: 9 }, (_, i) => criterionFromRow(data, i + 1)).filter(Boolean) as CriterionAnswer[]
  const customIssues = criteria.filter((item) => item.customNote).map((item) => `${item.name} - ${item.status} - ${item.customNote}`).join(' | ')
  const requestId = cellText(data['Request ID'])
  const id = requestId || `legacy-row-${rowNumber}`
  const resultText = cellText(data['Result']).toUpperCase()
  const legacyColumns = Object.fromEntries(Object.entries(data).map(([key, value]) => [key, plainCell(value)]))

  const record: ReviewRecord = {
    id,
    rowNumber,
    savedTimestamp: savedTimestamp || new Date().toISOString(),
    agentStartDate: dateOnly(data['Agent Start Date']),
    reviewDate: dateOnly(data["Today's Date"] || data['Saved Timestamp']),
    evaluator,
    agentName,
    callCenter: cellText(data['Call Center']),
    callId,
    itineraryNumber: cellText(data['Itinerary Number']),
    emailSent: bool(data['Email Sent?']),
    qaType: cellText(data['QA Type']) === 'Groups' ? 'Groups' : cellText(data['QA Type']) === 'Sales' ? 'Sales' : 'CS',
    finalScore: number(data['Final Score']),
    kpiTarget: number(data['KPI Target'], cellText(data['QA Type']) === 'Groups' ? 85 : 90),
    result: resultText === 'PASS' ? 'PASS' : 'FAIL',
    markdowns: number(data['Markdowns']),
    issueSummary: customIssues,
    callLength: cellText(data['Length of Call']),
    callDate: dateOnly(data['Date of Call']),
    criteria,
  }
  ;(record as any).legacyColumns = legacyColumns
  return record
}

function userFromRow(data: Record<string, unknown>): QaUser | null {
  const email = normalizeEmail(data['Email'])
  if (!email) return null
  // The old HotelPlanner Barbara address was intentionally retired in the app.
  if (email === 'barbara.kalchik@hotelplanner.com') return null
  const isAdmin = email === OWNER_EMAIL || email === BARBARA_EMAIL
  const role = isAdmin ? 'admin' : cellText(data['Role']) === 'viewer' ? 'viewer' : 'evaluator'
  return {
    email,
    displayName: cellText(data['Display Name']) || email,
    role,
    active: isAdmin ? true : bool(data['Active']),
    guidedMode: isAdmin ? false : bool(data['Guided Mode']),
    notes: cellText(data['Notes']),
    permissions: isAdmin ? {
      canSubmitReviews: true, canViewHistory: true, canEditAgentDetails: true, canEditCriteriaSelections: true, canEditCustomNotes: true,
    } : {
      canSubmitReviews: role === 'viewer' ? false : bool(data['Can Submit Reviews']),
      canViewHistory: bool(data['Can View History']),
      canEditAgentDetails: role === 'viewer' ? false : bool(data['Can Edit Agent Details']),
      canEditCriteriaSelections: role === 'viewer' ? false : bool(data['Can Edit Criteria Selections']),
      canEditCustomNotes: role === 'viewer' ? false : bool(data['Can Edit Custom Notes']),
    },
    createdAt: iso(data['Created At']),
    updatedAt: iso(data['Updated At']),
    updatedBy: cellText(data['Updated By']),
  }
}

function settingsFromSheet(sheet?: ExcelJS.Worksheet): AppSettings {
  if (!sheet) return DEFAULT_SETTINGS
  const values: Record<string, any> = {}
  for (let row = 2; row <= sheet.rowCount; row += 1) {
    const key = cellText(sheet.getCell(row, 1).value)
    const raw = cellText(sheet.getCell(row, 2).value)
    if (!key || !raw) continue
    try { values[key] = JSON.parse(raw) } catch { values[key] = raw }
  }
  return {
    criteria: values.criteria || DEFAULT_SETTINGS.criteria,
    callCenters: values.callCenters || DEFAULT_SETTINGS.callCenters,
    statusOptions: values.statusOptions || DEFAULT_SETTINGS.statusOptions,
    rules: { ...DEFAULT_SETTINGS.rules, ...(values.rules || {}) },
  }
}

function applyEmailAudit(workbook: ExcelJS.Workbook, reviews: ReviewRecord[]) {
  const sheet = workbook.getWorksheet('emails sent details')
  if (!sheet) return
  const byRow = new Map<number, { sent: boolean; at: string; by: string }>()
  for (let row = 2; row <= sheet.rowCount; row += 1) {
    const reviewRow = number(sheet.getCell(row, 3).value, 0)
    if (!reviewRow) continue
    const action = cellText(sheet.getCell(row, 2).value).toUpperCase()
    byRow.set(reviewRow, {
      sent: action === 'EMAIL SENT' || bool(sheet.getCell(row, 12).value),
      at: iso(sheet.getCell(row, 1).value),
      by: cellText(sheet.getCell(row, 4).value),
    })
  }
  reviews.forEach((review) => {
    const audit = byRow.get(Number(review.rowNumber))
    if (!audit) return
    review.emailSent = audit.sent
    review.emailSentAt = audit.sent ? audit.at : ''
    review.emailSentBy = audit.sent ? audit.by : ''
    const legacy = (review as any).legacyColumns
    if (legacy) legacy['Email Sent?'] = audit.sent
  })
}

export async function importLegacyWorkbookToFirebase(
  file: File,
  session: AuthSession,
  onProgress?: (percent: number, label: string) => void,
): Promise<MigrationResult> {
  if (normalizeEmail(session.email) !== OWNER_EMAIL) throw new Error('Only Junior can run the full legacy workbook migration.')
  onProgress?.(2, 'Reading Excel workbook')
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(await file.arrayBuffer())

  const reviewSheet = workbook.getWorksheet('Agents Reviewed')
  if (!reviewSheet) throw new Error('Agents Reviewed was not found in this workbook.')

  onProgress?.(8, 'Preparing legacy reviews')
  const reviews: ReviewRecord[] = []
  let skippedRows = 0
  for (let row = 2; row <= reviewSheet.rowCount; row += 1) {
    const review = reviewFromRow(rowObject(reviewSheet, row), row)
    if (review) reviews.push(review)
    else skippedRows += 1
  }

  applyEmailAudit(workbook, reviews)

  const userSheet = workbook.getWorksheet('QA App Users')
  const users: QaUser[] = []
  if (userSheet) {
    for (let row = 2; row <= userSheet.rowCount; row += 1) {
      const user = userFromRow(rowObject(userSheet, row))
      if (user) users.push(user)
    }
  }

  const settings = settingsFromSheet(workbook.getWorksheet('QA App Settings'))
  const totalWrites = Math.max(1, reviews.length + users.length + 2)
  let completed = 0
  const report = (label: string) => onProgress?.(10 + Math.round((completed / totalWrites) * 88), label)

  // Users and settings first so permissions exist before normal use begins.
  for (const user of users) {
    await firestore.collection('users').doc(user.email).set(user, { merge: true })
    completed += 1
    report('Importing evaluator access')
  }
  await firestore.collection('settings').doc('main').set({ ...settings, migratedAt: new Date().toISOString(), migratedBy: session.email })
  completed += 1

  // Firestore batches have a 500-write limit. 400 leaves room for future batch metadata.
  for (let start = 0; start < reviews.length; start += 400) {
    const chunk = reviews.slice(start, start + 400)
    const batch = firestore.batch()
    chunk.forEach((review) => {
      batch.set(firestore.collection('reviews').doc(review.id), { ...review, legacyImported: true, legacyRowNumber: review.rowNumber }, { merge: true })
    })
    await batch.commit()
    completed += chunk.length
    report(`Importing reviews ${Math.min(start + chunk.length, reviews.length)} of ${reviews.length}`)
  }

  const nextRowNumber = Math.max(2, ...reviews.map((review) => Number(review.rowNumber || 0) + 1))
  await firestore.collection('meta').doc('reviews').set({ nextRowNumber, legacyRowsImported: reviews.length, migratedAt: new Date().toISOString() }, { merge: true })
  completed += 1
  onProgress?.(100, 'Firebase migration complete')

  return { reviews: reviews.length, users: users.length, settings: true, skippedRows }
}
