import type { AppSettings, CriteriaSettings, CriterionAnswer, QaType, ReviewDraft } from '../types'

export const DEFAULT_CRITERIA: CriteriaSettings = {
  CS: [
    {
      number: 1,
      name: 'Agent is ready / available to receive call',
      points: 2,
      notes: 'Correct greeting/intro; professional tone; sets purpose.',
    },
    {
      number: 2,
      name: 'Verification',
      points: 8,
      notes: 'Confirms first name, last name, email, itinerary or confirmation number, hotel name, and booking dates before taking action.',
    },
    {
      number: 3,
      name: 'Acknowledges Need / Empathy / Reiteration',
      points: 10,
      notes: 'Acknowledges request; restates need; uses empathetic language.',
    },
    {
      number: 4,
      name: 'Matrix Compliance (Process + Escalation + Tools)',
      points: 20,
      notes: 'Follows correct matrix process, tools, escalation path, and timelines.',
    },
    {
      number: 5,
      name: 'Ownership & Solutioning',
      points: 10,
      notes: 'Owns the issue, explains options, asks probing questions, and guides the guest.',
    },
    {
      number: 6,
      name: 'Efficiency & Expectations',
      points: 10,
      notes: 'Sets clear expectations/timeframes, manages hold, and provides updates.',
    },
    {
      number: 7,
      name: 'Documentation Quality',
      points: 20,
      notes: 'Notes are complete, accurate, and aligned with the action taken.',
    },
    {
      number: 8,
      name: 'Telephone Technique / Communication',
      points: 10,
      notes: 'Clear pace, confidence, active listening, call control, professional language, no language barrier, and no dead air.',
    },
    {
      number: 9,
      name: 'Recap & Next Steps',
      points: 10,
      notes: 'Summarizes outcome, confirms next step, and closes clearly.',
    },
  ],
  Sales: [],
  Groups: [
    {
      number: 1,
      name: 'Agent is ready to receive call',
      points: 4,
      notes: 'Agent begins speaking within 3–5 seconds of being connected to the call.',
    },
    {
      number: 2,
      name: 'Correct Introduction',
      points: 6,
      notes: 'Agent answers using the required Hotel Reservations introduction.',
    },
    {
      number: 3,
      name: 'Acknowledges Guest Request / Reiterates Needs',
      points: 5,
      notes: 'Agent shows understanding of the guest’s reason for calling and restates the request.',
    },
    {
      number: 4,
      name: 'Group Request Documentation Accuracy',
      points: 20,
      notes: 'Agent captures all required information in the correct location, including Travel Agent information when applicable, and verifies email with phonetics.',
    },
    {
      number: 5,
      name: 'Honest Representation of HotelPlanner / Partner',
      points: 20,
      notes: 'Agent answers honestly about the company and does not misrepresent the hotel or service.',
    },
    {
      number: 6,
      name: 'Ownership / Call Control / Guidance',
      points: 15,
      notes: 'Agent asks leading questions, guides the guest, and completes the RFP.',
    },
    {
      number: 7,
      name: 'Telephone Techniques',
      points: 15,
      notes: 'Agent is professional, actively listens, avoids speaking over the guest, avoids slang, uses a clear pace, and avoids dead air.',
    },
    {
      number: 8,
      name: 'Following Process and Closing Call',
      points: 15,
      notes: 'Agent recaps details, gives the email and hotel response expectations, provides request credentials, offers more help, thanks the guest, and lets the guest disconnect first.',
    },
  ],
}

export const DEFAULT_SETTINGS: AppSettings = {
  criteria: DEFAULT_CRITERIA,
  callCenters: ['WNS', 'Concentrix', 'Buwelo-G', 'Buwelo-C', 'Telus', 'AI agents'],
  statusOptions: ['✓ Followed', '✕ Markdown', 'N/A', 'Partial'],
  rules: {
    confirmationRequired: true,
    callIdRequired: true,
    guidedCallIdPattern: '^CA[0-9A-Fa-f]{32}$',
    noteRequiredForMarkdownOrPartial: true,
    csKpi: 90,
    groupsKpi: 85,
    salesKpi: 90,
  },
}

export function localDateInput(date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function createCriterionAnswers(settings: AppSettings, qaType: QaType): CriterionAnswer[] {
  return settings.criteria[qaType].map((criterion) => ({
    ...criterion,
    status: '',
    partialPoints: criterion.points / 2,
    autoPoints: 0,
    customNote: '',
    criticalReason: '',
  }))
}

export function createReviewDraft(settings: AppSettings, evaluator: string, qaType: QaType = 'CS'): ReviewDraft {
  return {
    requestId: typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `review-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    agentStartDate: '',
    todayDate: localDateInput(),
    evaluator,
    agentName: '',
    callCenter: '',
    callId: '',
    qaType,
    confirmationNumber: '',
    callLength: '',
    callDate: '',
    criteria: createCriterionAnswers(settings, qaType),
    additionalComments: '',
    criticalErrors: { noNotes: false, voucherReference: false },
  }
}

export function pointsForStatus(points: number, status: CriterionAnswer['status']): number {
  if (status === '✓ Followed' || status === 'N/A') return points
  if (status === 'Partial') return points / 2
  return 0
}
