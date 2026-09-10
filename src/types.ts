export type UserRole = 'admin' | 'evaluator' | 'viewer'
export type QaType = 'CS' | 'Groups' | 'Sales'
export type CriterionStatus = '✓ Followed' | '✕ Markdown' | 'N/A' | 'Partial' | 'Critical' | ''

export interface UserPermissions {
  canSubmitReviews: boolean
  canViewHistory: boolean
  canEditAgentDetails: boolean
  canEditCriteriaSelections: boolean
  canEditCustomNotes: boolean
}

export interface QaUser {
  email: string
  displayName: string
  role: UserRole
  active: boolean
  guidedMode: boolean
  notes: string
  permissions: UserPermissions
  createdAt?: string
  updatedAt?: string
  updatedBy?: string
}

export interface CriterionDefinition {
  number: number
  name: string
  points: number
  notes: string
}

export interface CriteriaSettings {
  CS: CriterionDefinition[]
  Groups: CriterionDefinition[]
  Sales: CriterionDefinition[]
}

export interface AppRules {
  confirmationRequired: boolean
  callIdRequired: boolean
  guidedCallIdPattern: string
  noteRequiredForMarkdownOrPartial: boolean
  csKpi: number
  groupsKpi: number
  salesKpi: number
}

export interface AutoQaSettings {
  enabled: boolean
  serviceUrl: string
  ollamaUrl: string
  ollamaModel: string
  matrixText: string
  matrixFileName: string
  matrixUpdatedAt: string
  salesQaFormText: string
  salesQaFormFileName: string
  salesQaFormUpdatedAt: string
}

export interface AppSettings {
  criteria: CriteriaSettings
  callCenters: string[]
  statusOptions: Exclude<CriterionStatus, ''>[]
  rules: AppRules
  autoQa: AutoQaSettings
}

export interface CriterionAnswer extends CriterionDefinition {
  status: CriterionStatus
  partialPoints: number
  autoPoints: number
  customNote: string
  criticalReason?: string
}

export interface ReviewDraft {
  requestId: string
  agentStartDate: string
  todayDate: string
  evaluator: string
  agentName: string
  callCenter: string
  callId: string
  qaType: QaType
  confirmationNumber: string
  callLength: string
  callDate: string
  criteria: CriterionAnswer[]
  additionalComments: string
  criticalErrors?: { noNotes: boolean; voucherReference: boolean }
}

export interface ReviewRecord {
  id: string
  rowNumber: number
  savedTimestamp: string
  agentStartDate: string
  reviewDate: string
  evaluator: string
  agentName: string
  callCenter: string
  callId: string
  itineraryNumber: string
  emailSent: boolean
  emailSentAt?: string
  emailSentBy?: string
  qaType: QaType
  finalScore: number
  kpiTarget: number
  result: 'PASS' | 'FAIL'
  markdowns: number
  issueSummary: string
  callLength?: string
  callDate?: string
  criteria?: CriterionAnswer[]
  additionalComments?: string
  criticalErrors?: { noNotes: boolean; voucherReference: boolean }
}

export interface AuthSession {
  idToken: string
  email: string
  name: string
  picture?: string
  isDev?: boolean
  uid?: string
}

export interface BootstrapResponse {
  success: boolean
  user: QaUser
  users: QaUser[]
  settings: AppSettings
  message?: string
}

export interface ApiResponse<T = unknown> {
  success: boolean
  message?: string
  data?: T
  review?: ReviewRecord
  user?: QaUser
  users?: QaUser[]
  settings?: AppSettings
  reviews?: ReviewRecord[]
}

export type WatchListStatus = 'Active' | 'Cleared' | 'Removed'

export interface WatchListAgentInput {
  callCenter: string
  lob: string
  agentName: string
  trainer: string
  wave: string
  startDate: string
  endDate: string
  employeeStatus: string
  reason: string
  /** Optional admin override for the Watch List display only. Null/undefined = use automatic Firebase QA average. */
  manualQaScore?: number | null
  /** Optional admin override for the Watch List review count only. Null/undefined = use matched Firebase review count. */
  manualReviewCount?: number | null
  /** Optional when editing. New agents default to Active. */
  watchStatus?: WatchListStatus
}

export interface WatchListAgent extends WatchListAgentInput {
  id: string
  watchStatus: WatchListStatus
  createdAt: string
  createdBy: string
  createdByName: string
  updatedAt?: string
  updatedBy?: string
  updatedByName?: string
  clearedAt?: string
  clearedBy?: string
  clearedByName?: string
}
