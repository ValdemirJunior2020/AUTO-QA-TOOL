import ExcelJS from 'exceljs'
import type { ReviewRecord } from '../types'

export interface ReviewExcelFilters {
  search: string
  result: string
  center: string
  qaType: string
  evaluator: string
  emailStatus: string
  dateFrom: string
  dateTo: string
}

interface ExportCriterion {
  number: number | string
  name: string
  maxPoints: number | string
  score: number | string
  status: string
  notes: string
}

const COLORS = {
  darkPurple: '24165F',
  purple: '4C3B87',
  lightPurple: 'EDE9FE',
  white: 'FFFFFF',
  black: '1F2937',
  gray: 'F3F4F6',
  border: 'C9C4D8',
  green: 'D9EAD3',
  red: 'F4CCCC',
  yellow: 'FFF2CC',
  blue: 'D9EAF7',
}

const CRITERIA_POINTS: Record<string, number> = {
  'Agent is ready / available to receive call': 2,
  Verification: 8,
  'Acknowledges Need / Empathy / Reiteration': 10,
  'Matrix Compliance (Process + Escalation + Tools)': 20,
  'Ownership & Solutioning': 10,
  'Efficiency & Expectations': 10,
  'Documentation Quality': 20,
  'Telephone Technique / Communication': 10,
  'Recap & Next Steps': 10,

  'Agent is ready to receive call': 4,
  'Correct Introduction': 6,
  'Acknowledges Guest Request / Reiterates Needs': 5,
  'Group Request Documentation Accuracy': 20,
  'Honest Representation of HotelPlanner / Partner': 20,
  'Ownership / Call Control / Guidance': 15,
  'Telephone Techniques': 15,
  'Following Process and Closing Call': 15,
}

const KNOWN_CRITERIA = Object.keys(CRITERIA_POINTS).sort(
  (a, b) => b.length - a.length,
)

function text(value: unknown): string {
  return String(value ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function lower(value: unknown): string {
  return text(value).toLowerCase()
}

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function safeFilename(value: string): string {
  return value
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function parseDate(value: unknown): Date | null {
  if (!value) return null

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value
  }

  const raw = text(value)

  if (!raw) return null

  /*
   * Do not accept values such as "16" as a date.
   * This prevents the incorrect Call Date = 16 issue.
   */
  if (/^\d{1,2}$/.test(raw)) {
    return null
  }

  const normalized =
    /^\d{4}-\d{2}-\d{2}$/.test(raw)
      ? `${raw}T12:00:00`
      : raw

  const parsed = new Date(normalized)

  return Number.isNaN(parsed.getTime())
    ? null
    : parsed
}

function dateKey(value: unknown): string {
  const date = parseDate(value)

  if (!date) return ''

  const year = date.getFullYear()
  const month = String(
    date.getMonth() + 1,
  ).padStart(2, '0')
  const day = String(
    date.getDate(),
  ).padStart(2, '0')

  return `${year}-${month}-${day}`
}

function displayDate(value: unknown): string {
  const date = parseDate(value)

  if (!date) return ''

  return date.toLocaleDateString('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
  })
}

function displayDateTime(value: unknown): string {
  const date = parseDate(value)

  if (!date) return ''

  return date.toLocaleString('en-US')
}

function normalizeCallLength(value: unknown): string {
  const raw = text(value)

  if (!raw) return ''

  /*
   * A plain number such as 16 was being returned by the old column mapping.
   * Do not print it as a valid call length.
   */
  if (/^\d{1,2}$/.test(raw)) {
    return ''
  }

  if (/^\d{1,3}:\d{2}$/.test(raw)) {
    return raw
  }

  if (/^\d{1,2}:\d{2}:\d{2}$/.test(raw)) {
    return raw
  }

  return raw
}

function getReviewDate(
  review: ReviewRecord,
): string {
  return dateKey(
    (review as any).reviewDate ||
      (review as any).savedTimestamp ||
      (review as any).savedAt,
  )
}

function getCallLength(
  review: ReviewRecord,
): string {
  const possibleValues = [
    (review as any).callLength,
    (review as any).lengthOfCall,
    (review as any).callDuration,
    (review as any).duration,
  ]

  for (const value of possibleValues) {
    const formatted =
      normalizeCallLength(value)

    if (formatted) return formatted
  }

  return ''
}

function getCallDate(
  review: ReviewRecord,
): string {
  const possibleValues = [
    (review as any).callDate,
    (review as any).dateOfCall,
    (review as any).actualCallDate,
  ]

  for (const value of possibleValues) {
    const formatted = displayDate(value)

    if (formatted) return formatted
  }

  return ''
}

function getItinerary(
  review: ReviewRecord,
): string {
  const legacyColumns = (review as any).legacyColumns as
    | Record<string, unknown>
    | undefined

  return text(
    (review as any).itineraryNumber ||
      (review as any).itinerary ||
      (review as any).confirmationNumber ||
      (review as any).bookingReference ||
      legacyColumns?.['IT# / Itinerary Number'] ||
      legacyColumns?.['Itinerary Number'] ||
      legacyColumns?.['Itinerary'] ||
      legacyColumns?.['IT#'] ||
      legacyColumns?.['Itinerary #'] ||
      legacyColumns?.['Confirmation Number'],
  )
}

function getCallId(
  review: ReviewRecord,
): string {
  return text(
    (review as any).callId ||
      (review as any).callID ||
      (review as any).callIdentifier,
  )
}

function scoreFromStatus(
  maxPoints: number,
  status: string,
  suppliedScore?: unknown,
): number | string {
  const numericScore =
    Number(suppliedScore)

  if (
    suppliedScore !== '' &&
    suppliedScore !== null &&
    suppliedScore !== undefined &&
    Number.isFinite(numericScore)
  ) {
    return numericScore
  }

  const normalized = lower(status)

  if (
    normalized.includes('followed') ||
    normalized === 'pass' ||
    normalized === 'passed'
  ) {
    return maxPoints
  }

  if (
    normalized.includes('markdown') ||
    normalized === 'fail' ||
    normalized === 'failed'
  ) {
    return 0
  }

  if (normalized.includes('n/a')) {
    return 'N/A'
  }

  if (normalized.includes('partial')) {
    return ''
  }

  return ''
}

function normalizeStatus(
  value: unknown,
): string {
  const status = text(value)

  if (!status) return ''

  if (/markdown/i.test(status)) {
    return '✕ Markdown'
  }

  if (/partial/i.test(status)) {
    return 'Partial'
  }

  if (/followed|passed|pass/i.test(status)) {
    return '✓ Followed'
  }

  if (/n\/a|not applicable/i.test(status)) {
    return 'N/A'
  }

  return status
}

function criteriaFromSavedArray(
  review: ReviewRecord,
): ExportCriterion[] {
  const rawCriteria = Array.isArray(
    (review as any).criteria,
  )
    ? (review as any).criteria
    : []

  return rawCriteria
    .map(
      (
        criterion: any,
        index: number,
      ): ExportCriterion => {
        const name = text(
          criterion.name ||
            criterion.criterion ||
            criterion.criteriaName,
        )

        const status = normalizeStatus(
          criterion.status ||
            criterion.selection ||
            criterion.result,
        )

        const maxPointsValue =
          criterion.points ??
          criterion.maxPoints ??
          criterion.max ??
          CRITERIA_POINTS[name] ??
          ''

        const numericMax =
          Number(maxPointsValue)

        const maxPoints =
          Number.isFinite(numericMax)
            ? numericMax
            : maxPointsValue

        const suppliedScore =
          criterion.autoPoints ??
          criterion.score ??
          criterion.pointsEarned ??
          criterion.earnedPoints

        const score =
          typeof maxPoints === 'number'
            ? scoreFromStatus(
                maxPoints,
                status,
                suppliedScore,
              )
            : text(suppliedScore)

        const customNote = text(
          criterion.customNote ||
            criterion.evidence ||
            criterion.agentNote ||
            criterion.reviewNote,
        )

        const matrixNote = text(
          criterion.notes ||
            criterion.description ||
            criterion.keyChecks,
        )

        return {
          number:
            criterion.number ||
            criterion.criteriaNumber ||
            index + 1,
          name,
          maxPoints,
          score,
          status,
          notes:
            customNote ||
            matrixNote,
        }
      },
    )
    .filter(
      (criterion: ExportCriterion) =>
        criterion.name ||
        criterion.status ||
        criterion.notes,
    )
}

function identifyCriterion(
  segment: string,
): string {
  const normalized =
    segment.toLowerCase()

  return (
    KNOWN_CRITERIA.find((criterion) =>
      normalized.startsWith(
        criterion.toLowerCase(),
      ),
    ) || ''
  )
}

function getStatusFromSegment(
  segment: string,
): string {
  if (/markdown/i.test(segment)) {
    return '✕ Markdown'
  }

  if (/partial/i.test(segment)) {
    return 'Partial'
  }

  if (/followed|passed/i.test(segment)) {
    return '✓ Followed'
  }

  if (/\bn\/a\b/i.test(segment)) {
    return 'N/A'
  }

  return ''
}

function removeMatrixDescription(
  value: string,
): string {
  const descriptions = [
    'Correct greeting/intro; professional tone; sets purpose.',
    'Confirms first name, last name, email, itinerary number, hotel name, and booking dates before taking action.',
    'Confirms first name, last name, email, itinerary or confirmation number, hotel name, and booking dates before taking action.',
    'Acknowledges request; restates need; uses empathetic language.',
    'Follows correct matrix process, tools, escalation path, and timelines.',
    'Owns the issue, explains options, asks probing questions, and guides the guest.',
    'Sets clear expectations/timeframes, manages hold, and provides updates.',
    'Notes are complete, accurate, and aligned with the action taken.',
    'Clear pace, confidence, active listening, call control, professional language, no language barrier, and no dead air.',
    'Summarizes outcome, confirms next step, and closes clearly.',
  ]

  let cleaned = value

  descriptions.forEach((description) => {
    cleaned = cleaned.replace(
      description,
      '',
    )
  })

  return cleaned
    .replace(/^[\s\-–—:|]+/, '')
    .replace(/[\s|]+$/, '')
    .trim()
}

function criteriaFromIssueSummary(
  review: ReviewRecord,
): {
  criteria: ExportCriterion[]
  generalNotes: string
} {
  const issueSummary = text(
    (review as any).issueSummary ||
      (review as any).issues ||
      (review as any).notes,
  )

  if (!issueSummary) {
    return {
      criteria: [],
      generalNotes: '',
    }
  }

  const segments = issueSummary
    .split('|')
    .map((segment) => text(segment))
    .filter(Boolean)

  const criteria: ExportCriterion[] = []
  const generalNotes: string[] = []

  segments.forEach((segment) => {
    const criterionName =
      identifyCriterion(segment)

    if (!criterionName) {
      generalNotes.push(segment)
      return
    }

    const status =
      getStatusFromSegment(segment)

    const maxPoints =
      CRITERIA_POINTS[criterionName] ?? ''

    let notes = segment

    notes = notes.replace(
      new RegExp(
        `^${criterionName.replace(
          /[.*+?^${}()|[\]\\]/g,
          '\\$&',
        )}\\s*[-–—:]?\\s*`,
        'i',
      ),
      '',
    )

    notes = notes.replace(
      /^(✓\s*)?Followed\s*[-–—:]?\s*/i,
      '',
    )

    notes = notes.replace(
      /^(✕\s*)?Markdown\s*[-–—:]?\s*/i,
      '',
    )

    notes = notes.replace(
      /^Partial\s*[-–—:]?\s*/i,
      '',
    )

    notes = notes.replace(
      /^N\/A\s*[-–—:]?\s*/i,
      '',
    )

    notes =
      removeMatrixDescription(notes)

    const score =
      typeof maxPoints === 'number'
        ? scoreFromStatus(
            maxPoints,
            status,
          )
        : ''

    criteria.push({
      number: criteria.length + 1,
      name: criterionName,
      maxPoints,
      score,
      status,
      notes,
    })
  })

  return {
    criteria,
    generalNotes: generalNotes.join(
      '\n',
    ),
  }
}

function getCriteriaAndNotes(
  review: ReviewRecord,
): {
  criteria: ExportCriterion[]
  generalNotes: string
} {
  const savedCriteria =
    criteriaFromSavedArray(review)

  const parsed =
    criteriaFromIssueSummary(review)

  if (savedCriteria.length) {
    /*
     * Add parsed custom notes to matching saved criteria
     * when the backend criteria objects lack those notes.
     */
    const combined =
      savedCriteria.map((criterion) => {
        const parsedMatch =
          parsed.criteria.find(
            (item) =>
              lower(item.name) ===
              lower(criterion.name),
          )

        return {
          ...criterion,
          notes:
            criterion.notes ||
            parsedMatch?.notes ||
            '',
        }
      })

    const additionalComments = text(
      (review as any).additionalComments,
    )

    return {
      criteria: combined,
      generalNotes: [
        parsed.generalNotes,
        additionalComments,
      ]
        .filter(Boolean)
        .join('\n'),
    }
  }

  const additionalComments = text(
    (review as any).additionalComments,
  )

  return {
    criteria: parsed.criteria,
    generalNotes: [
      parsed.generalNotes,
      additionalComments,
    ]
      .filter(Boolean)
      .join('\n'),
  }
}

function filterReviews(
  reviews: ReviewRecord[],
  filters: ReviewExcelFilters,
): ReviewRecord[] {
  const search =
    lower(filters.search)

  return reviews
    .filter((review) => {
      if (
        filters.result !== 'ALL' &&
        text((review as any).result) !==
          filters.result
      ) {
        return false
      }

      if (
        filters.center !== 'ALL' &&
        text((review as any).callCenter) !==
          filters.center
      ) {
        return false
      }

      if (
        filters.qaType !== 'ALL' &&
        text((review as any).qaType) !==
          filters.qaType
      ) {
        return false
      }

      if (
        filters.evaluator !== 'ALL' &&
        text((review as any).evaluator) !==
          filters.evaluator
      ) {
        return false
      }

      if (
        filters.emailStatus === 'SENT' &&
        !(review as any).emailSent
      ) {
        return false
      }

      if (
        filters.emailStatus ===
          'NOT_SENT' &&
        (review as any).emailSent
      ) {
        return false
      }

      const reviewDate =
        getReviewDate(review)

      if (
        filters.dateFrom &&
        reviewDate &&
        reviewDate < filters.dateFrom
      ) {
        return false
      }

      if (
        filters.dateTo &&
        reviewDate &&
        reviewDate > filters.dateTo
      ) {
        return false
      }

      if (search) {
        const searchable = [
          (review as any).agentName,
          (review as any).callCenter,
          getCallId(review),
          getItinerary(review),
          (review as any).evaluator,
          (review as any).qaType,
          (review as any).result,
          (review as any).issueSummary,
        ]
          .map(text)
          .join(' ')
          .toLowerCase()

        if (!searchable.includes(search)) {
          return false
        }
      }

      return true
    })
    .sort((a, b) =>
      String(
        (b as any).savedTimestamp ||
          (b as any).reviewDate ||
          '',
      ).localeCompare(
        String(
          (a as any).savedTimestamp ||
            (a as any).reviewDate ||
            '',
        ),
      ),
    )
}

function buildFilename(
  reviews: ReviewRecord[],
  filters: ReviewExcelFilters,
): string {
  const dates = reviews
    .map(getReviewDate)
    .filter(Boolean)
    .sort()

  const today = dateKey(new Date())

  const startDate =
    filters.dateFrom ||
    dates[0] ||
    today

  const endDate =
    filters.dateTo ||
    dates[dates.length - 1] ||
    startDate

  const reportName =
    filters.center !== 'ALL'
      ? `${titleCase(
          filters.center,
        )} Reviews`
      : 'Reviews'

  return safeFilename(
    `${reportName} ${startDate} to ${endDate}.xlsx`,
  )
}

function applyBorder(
  cell: ExcelJS.Cell,
): void {
  cell.border = {
    top: {
      style: 'thin',
      color: {
        argb: COLORS.border,
      },
    },
    bottom: {
      style: 'thin',
      color: {
        argb: COLORS.border,
      },
    },
    left: {
      style: 'thin',
      color: {
        argb: COLORS.border,
      },
    },
    right: {
      style: 'thin',
      color: {
        argb: COLORS.border,
      },
    },
  }
}

function applyBorders(
  worksheet: ExcelJS.Worksheet,
  startRow: number,
  endRow: number,
  startColumn: number,
  endColumn: number,
): void {
  for (
    let row = startRow;
    row <= endRow;
    row += 1
  ) {
    for (
      let column = startColumn;
      column <= endColumn;
      column += 1
    ) {
      applyBorder(
        worksheet.getCell(
          row,
          column,
        ),
      )
    }
  }
}

function statusColor(
  status: string,
): string {
  const normalized =
    lower(status)

  if (
    normalized.includes('markdown') ||
    normalized.includes('fail')
  ) {
    return COLORS.red
  }

  if (
    normalized.includes('partial')
  ) {
    return COLORS.yellow
  }

  if (
    normalized.includes('followed') ||
    normalized.includes('pass')
  ) {
    return COLORS.green
  }

  if (
    normalized.includes('n/a')
  ) {
    return COLORS.gray
  }

  return COLORS.white
}

function resultColor(
  result: string,
): string {
  return /pass/i.test(result)
    ? COLORS.green
    : COLORS.red
}

function saveWorkbook(
  buffer: ExcelJS.Buffer,
  filename: string,
): void {
  const blob = new Blob(
    [buffer as BlobPart],
    {
      type:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    },
  )

  const url =
    URL.createObjectURL(blob)

  const anchor =
    document.createElement('a')

  anchor.href = url
  anchor.download = filename
  anchor.style.display = 'none'

  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()

  window.setTimeout(() => {
    URL.revokeObjectURL(url)
  }, 1500)
}

export async function exportReviewsToExcel(
  allReviews: ReviewRecord[],
  filters: ReviewExcelFilters,
  onProgress?: (percent: number, label: string) => void,
): Promise<string> {
  onProgress?.(5, 'Filtering reviews')
  const reviews =
    filterReviews(
      allReviews,
      filters,
    )

  if (!reviews.length) {
    throw new Error(
      'No reviews match the selected filters.',
    )
  }

  const workbook =
    new ExcelJS.Workbook()

  workbook.creator =
    'QA Control Center'
  workbook.company =
    'HotelPlanner'
  workbook.created =
    new Date()
  workbook.modified =
    new Date()

  const worksheet =
    workbook.addWorksheet(
      'Reviews',
      {
        views: [
          {
            state: 'frozen',
            ySplit: 2,
            showGridLines: false,
          },
        ],
      },
    )

  worksheet.columns = [
    {
      key: 'number',
      width: 7,
    },
    {
      key: 'criterion',
      width: 42,
    },
    {
      key: 'max',
      width: 11,
    },
    {
      key: 'score',
      width: 11,
    },
    {
      key: 'status',
      width: 19,
    },
    {
      key: 'notes',
      width: 68,
    },
  ]

  const reportTitle =
    filters.center !== 'ALL'
      ? `${titleCase(
          filters.center,
        )} Reviews`
      : 'QA Reviews'

  worksheet.mergeCells('A1:F1')

  const titleCell =
    worksheet.getCell('A1')

  titleCell.value = reportTitle

  titleCell.font = {
    name: 'Arial',
    size: 17,
    bold: true,
    color: {
      argb: COLORS.white,
    },
  }

  titleCell.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: {
      argb: COLORS.darkPurple,
    },
  }

  titleCell.alignment = {
    horizontal: 'center',
    vertical: 'middle',
  }

  worksheet.getRow(1).height = 32

  worksheet.mergeCells('A2:F2')

  const generatedCell =
    worksheet.getCell('A2')

  generatedCell.value =
    `Date range: ${
      filters.dateFrom ||
      getReviewDate(
        reviews[reviews.length - 1],
      )
    } to ${
      filters.dateTo ||
      getReviewDate(reviews[0])
    } • ${reviews.length} review${
      reviews.length === 1
        ? ''
        : 's'
    } • Generated ${displayDateTime(
      new Date(),
    )}`

  generatedCell.font = {
    name: 'Arial',
    size: 10,
    italic: true,
    color: {
      argb: COLORS.black,
    },
  }

  generatedCell.alignment = {
    horizontal: 'center',
    vertical: 'middle',
    wrapText: true,
  }

  worksheet.getRow(2).height = 25

  let currentRow = 4

  reviews.forEach(
    (
      review,
      reviewIndex,
    ) => {
      onProgress?.(10 + Math.round((reviewIndex / Math.max(1, reviews.length)) * 75), `Building team report ${reviewIndex + 1} of ${reviews.length}`)
      const agentName =
        text(
          (review as any).agentName,
        ) || 'Unknown Agent'

      const callCenter = text(
        (review as any).callCenter,
      )

      const evaluator = text(
        (review as any).evaluator,
      )

      const reviewDate =
        displayDate(
          (review as any).reviewDate ||
            (review as any)
              .savedTimestamp,
        )

      const finalScore =
        text(
          (review as any).finalScore,
        )

      const kpiTarget =
        text(
          (review as any).kpiTarget,
        )

      const result = text(
        (review as any).result,
      )

      const qaType = text(
        (review as any).qaType,
      )

      const itinerary =
        getItinerary(review)

      const callId =
        getCallId(review)

      const callLength =
        getCallLength(review)

      const callDate =
        getCallDate(review)

      const {
        criteria,
        generalNotes,
      } = getCriteriaAndNotes(review)

      worksheet.mergeCells(
        currentRow,
        1,
        currentRow,
        6,
      )

      const reviewTitleCell =
        worksheet.getCell(
          currentRow,
          1,
        )

      reviewTitleCell.value =
        `Review ${reviewIndex + 1} — ${agentName}`

      reviewTitleCell.font = {
        name: 'Arial',
        size: 12,
        bold: true,
        color: {
          argb: COLORS.white,
        },
      }

      reviewTitleCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: {
          argb: COLORS.darkPurple,
        },
      }

      reviewTitleCell.alignment = {
        vertical: 'middle',
        horizontal: 'left',
      }

      worksheet.getRow(
        currentRow,
      ).height = 25

      currentRow += 1

      const metadataRows: Array<
        [
          string,
          string,
          string,
          string,
          string,
          string,
        ]
      > = [
        [
          'Call Center',
          callCenter,
          'Evaluator',
          evaluator,
          'Review Date',
          reviewDate,
        ],
        [
          'Final Score',
          finalScore
            ? `${finalScore}%`
            : '',
          'KPI Target',
          kpiTarget
            ? `${kpiTarget}%`
            : '',
          'Result',
          result,
        ],
        [
          'QA Type',
          qaType,
          'Call Length',
          callLength ||
            'Not available',
          'Call Date',
          callDate ||
            'Not available',
        ],
        [
          'Call ID',
          callId ||
            'Not available',
          'Email Sent',
          (review as any).emailSent
            ? 'Yes'
            : 'No',
          '',
          '',
        ],
      ]

      metadataRows.forEach(
        (metadataRow) => {
          const row =
            worksheet.getRow(
              currentRow,
            )

          row.values = metadataRow

          ;[1, 3, 5].forEach(
            (column) => {
              const cell =
                row.getCell(column)

              cell.font = {
                name: 'Arial',
                size: 10,
                bold: true,
                color: {
                  argb:
                    COLORS.black,
                },
              }

              cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: {
                  argb:
                    COLORS.lightPurple,
                },
              }
            },
          )

          for (
            let column = 1;
            column <= 6;
            column += 1
          ) {
            const cell =
              row.getCell(column)

            cell.font = {
              name: 'Arial',
              size: 10,
              bold:
                cell.font?.bold,
              color:
                cell.font?.color,
            }

            cell.alignment = {
              vertical: 'middle',
              horizontal:
                column % 2 === 1
                  ? 'center'
                  : 'left',
              wrapText: true,
            }

            applyBorder(cell)
          }

          currentRow += 1
        },
      )

      const resultCell =
        worksheet.getCell(
          currentRow - 3,
          6,
        )

      resultCell.font = {
        name: 'Arial',
        size: 10,
        bold: true,
        color: {
          argb: COLORS.black,
        },
      }

      resultCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: {
          argb:
            resultColor(result),
        },
      }

      /*
       * Barbara requested that the IT# be easy to see on every
       * downloaded review report. Give it its own full-width row.
       */
      worksheet.mergeCells(
        currentRow,
        2,
        currentRow,
        6,
      )

      const itineraryLabelCell =
        worksheet.getCell(
          currentRow,
          1,
        )

      itineraryLabelCell.value =
        'IT# / Itinerary Number'

      itineraryLabelCell.font = {
        name: 'Arial',
        size: 11,
        bold: true,
        color: {
          argb: COLORS.white,
        },
      }

      itineraryLabelCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: {
          argb: COLORS.purple,
        },
      }

      itineraryLabelCell.alignment = {
        vertical: 'middle',
        horizontal: 'center',
        wrapText: true,
      }

      const itineraryValueCell =
        worksheet.getCell(
          currentRow,
          2,
        )

      itineraryValueCell.value =
        itinerary ||
        'Not available'

      itineraryValueCell.font = {
        name: 'Arial',
        size: 12,
        bold: true,
        color: {
          argb: COLORS.black,
        },
      }

      itineraryValueCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: {
          argb: COLORS.yellow,
        },
      }

      itineraryValueCell.alignment = {
        vertical: 'middle',
        horizontal: 'left',
        wrapText: true,
      }

      applyBorders(
        worksheet,
        currentRow,
        currentRow,
        1,
        6,
      )

      worksheet.getRow(
        currentRow,
      ).height = 32

      currentRow += 2

      const criteriaHeader =
        worksheet.getRow(
          currentRow,
        )

      criteriaHeader.values = [
        '#',
        'Criterion',
        'Max',
        'Score',
        'Status',
        'Notes',
      ]

      for (
        let column = 1;
        column <= 6;
        column += 1
      ) {
        const cell =
          criteriaHeader.getCell(
            column,
          )

        cell.font = {
          name: 'Arial',
          size: 10,
          bold: true,
          color: {
            argb: COLORS.white,
          },
        }

        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: {
            argb: COLORS.purple,
          },
        }

        cell.alignment = {
          vertical: 'middle',
          horizontal: 'center',
          wrapText: true,
        }

        applyBorder(cell)
      }

      worksheet.getRow(
        currentRow,
      ).height = 24

      currentRow += 1

      if (criteria.length) {
        criteria.forEach(
          (
            criterion,
            criterionIndex,
          ) => {
            const row =
              worksheet.getRow(
                currentRow,
              )

            row.values = [
              criterion.number ||
                criterionIndex + 1,
              criterion.name,
              criterion.maxPoints,
              criterion.score,
              criterion.status,
              criterion.notes,
            ]

            for (
              let column = 1;
              column <= 6;
              column += 1
            ) {
              const cell =
                row.getCell(column)

              cell.font = {
                name: 'Arial',
                size: 10,
                color: {
                  argb:
                    COLORS.black,
                },
              }

              cell.alignment = {
                vertical: 'top',
                horizontal: [
                  1,
                  3,
                  4,
                  5,
                ].includes(column)
                  ? 'center'
                  : 'left',
                wrapText: true,
              }

              applyBorder(cell)
            }

            const statusCell =
              row.getCell(5)

            statusCell.font = {
              name: 'Arial',
              size: 10,
              bold: true,
              color: {
                argb:
                  COLORS.black,
              },
            }

            statusCell.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: {
                argb: statusColor(
                  criterion.status,
                ),
              },
            }

            const notesLength =
              criterion.notes.length

            row.height =
              notesLength > 180
                ? 75
                : notesLength > 90
                  ? 55
                  : notesLength > 40
                    ? 38
                    : 25

            currentRow += 1
          },
        )
      } else {
        worksheet.mergeCells(
          currentRow,
          1,
          currentRow,
          6,
        )

        const missingCell =
          worksheet.getCell(
            currentRow,
            1,
          )

        missingCell.value =
          'No criteria were saved for this review.'

        missingCell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: {
            argb: COLORS.gray,
          },
        }

        missingCell.alignment = {
          horizontal: 'center',
          vertical: 'middle',
          wrapText: true,
        }

        applyBorders(
          worksheet,
          currentRow,
          currentRow,
          1,
          6,
        )

        currentRow += 1
      }

      const notesRow =
        currentRow

      worksheet.getCell(
        notesRow,
        1,
      ).value = 'General Notes'

      worksheet.getCell(
        notesRow,
        1,
      ).font = {
        name: 'Arial',
        size: 10,
        bold: true,
        color: {
          argb: COLORS.black,
        },
      }

      worksheet.getCell(
        notesRow,
        1,
      ).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: {
          argb: COLORS.blue,
        },
      }

      worksheet.getCell(
        notesRow,
        1,
      ).alignment = {
        vertical: 'top',
        horizontal: 'center',
        wrapText: true,
      }

      worksheet.mergeCells(
        notesRow,
        2,
        notesRow,
        6,
      )

      const notesCell =
        worksheet.getCell(
          notesRow,
          2,
        )

      notesCell.value =
        generalNotes ||
        'No additional notes.'

      notesCell.font = {
        name: 'Arial',
        size: 10,
        color: {
          argb: COLORS.black,
        },
      }

      notesCell.alignment = {
        vertical: 'top',
        horizontal: 'left',
        wrapText: true,
      }

      applyBorders(
        worksheet,
        notesRow,
        notesRow,
        1,
        6,
      )

      const noteLength =
        generalNotes.length

      worksheet.getRow(
        notesRow,
      ).height =
        noteLength > 300
          ? 100
          : noteLength > 160
            ? 75
            : noteLength > 70
              ? 55
              : 35

      currentRow += 2
    },
  )

  worksheet.pageSetup = {
    orientation: 'landscape',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    paperSize: 9,
    margins: {
      left: 0.25,
      right: 0.25,
      top: 0.5,
      bottom: 0.5,
      header: 0.2,
      footer: 0.2,
    },
  }

  worksheet.headerFooter = {
    oddHeader:
      `&L${reportTitle}&RPage &P of &N`,
    oddFooter:
      '&CQA Control Center',
  }

  const filename =
    buildFilename(
      reviews,
      filters,
    )

  onProgress?.(90, 'Creating Excel file')
  const buffer =
    await workbook.xlsx.writeBuffer()

  saveWorkbook(
    buffer,
    filename,
  )
  onProgress?.(100, 'Excel download ready')

  return filename
}
const GOOGLE_SHEET_HEADERS = [
  'Saved Timestamp', 'Agent Start Date', "Today's Date", 'Evaluator', 'Agent Name', 'Call Center', 'IT# / Itinerary Number', 'Call ID', 'Email Sent?', 'QA Type', 'Final Score', 'KPI Target', 'Result', 'Markdowns',
  ...Array.from({ length: 9 }, (_, index) => {
    const n = index + 1
    return [`Criteria ${n} #`, `Criteria ${n} Name`, `Criteria ${n} Max Points`, `Criteria ${n} Status`, `Criteria ${n} Partial Points`, `Criteria ${n} Auto Points`, `Criteria ${n} Notes / Issue Found`]
  }).flat(),
  ...Array.from({ length: 9 }, (_, index) => `Custom Note ${index + 1}`),
  'Length of Call', 'Date of Call', 'Request ID',
]

function sheetStyleRow(review: ReviewRecord): unknown[] {
  const legacyColumns = (review as any).legacyColumns as Record<string, unknown> | undefined
  if (legacyColumns && Object.keys(legacyColumns).length) {
    return GOOGLE_SHEET_HEADERS.map((header) => {
      if (header === 'Email Sent?') return Boolean(review.emailSent)
      if (header === 'Request ID') return review.id || legacyColumns[header] || ''
      if (header === 'IT# / Itinerary Number') {
        return (
          getItinerary(review) ||
          ''
        )
      }
      return legacyColumns[header] ?? ''
    })
  }

  const criteria = Array.isArray(review.criteria) ? review.criteria : []
  const row: unknown[] = [
    review.savedTimestamp || '',
    review.agentStartDate || '',
    review.reviewDate || '',
    review.evaluator || '',
    review.agentName || '',
    review.callCenter || '',
    getItinerary(review),
    getCallId(review),
    Boolean(review.emailSent),
    review.qaType || '',
    Number(review.finalScore || 0),
    Number(review.kpiTarget || 0),
    review.result || '',
    Number(review.markdowns || 0),
  ]

  for (let index = 0; index < 9; index += 1) {
    const criterion: any = criteria[index] || {}
    row.push(
      criterion.number ?? '',
      criterion.name ?? '',
      criterion.points ?? '',
      criterion.status ?? '',
      criterion.status === 'Partial' ? (criterion.partialPoints ?? (Number.isFinite(Number(criterion.points)) ? Number(criterion.points) / 2 : '')) : (criterion.partialPoints ?? ''),
      criterion.autoPoints ?? '',
      criterion.notes ?? '',
    )
  }

  for (let index = 0; index < 9; index += 1) {
    row.push((criteria[index] as any)?.customNote ?? '')
  }

  row.push(
    review.callLength || '',
    review.callDate || '',
    review.id || '',
  )
  return row
}

export async function exportReviewsGoogleSheetStyle(
  allReviews: ReviewRecord[],
  filters: ReviewExcelFilters,
  onProgress?: (percent: number, label: string) => void,
): Promise<string> {
  onProgress?.(5, 'Filtering Firebase reviews')
  const reviews = filterReviews(allReviews, filters).slice().sort((a, b) => Number(a.rowNumber || 0) - Number(b.rowNumber || 0))
  if (!reviews.length) throw new Error('No reviews match the selected filters.')

  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'QA Control Center - Firebase'
  workbook.company = 'HotelPlanner'
  const sheet = workbook.addWorksheet('Agents Reviewed', {
    views: [{ state: 'frozen', ySplit: 1, xSplit: 0, showGridLines: true }],
  })

  const header = sheet.addRow(GOOGLE_SHEET_HEADERS)
  header.height = 34
  header.eachCell((cell) => {
    cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF24165F' } }
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFD1D5DB' } },
      bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } },
      left: { style: 'thin', color: { argb: 'FFD1D5DB' } },
      right: { style: 'thin', color: { argb: 'FFD1D5DB' } },
    }
  })
  sheet.autoFilter = { from: 'A1', to: 'CK1' }

  const dateHeaders = new Set(['Saved Timestamp', 'Agent Start Date', "Today's Date", 'Date of Call'])
  const dateColumnIndexes = GOOGLE_SHEET_HEADERS
    .map((headerName, index) => dateHeaders.has(headerName) ? index + 1 : 0)
    .filter(Boolean)

  reviews.forEach((review, index) => {
    const row = sheet.addRow(sheetStyleRow(review))
    row.alignment = { vertical: 'top', wrapText: true }
    dateColumnIndexes.forEach((columnIndex) => {
      const cell = row.getCell(columnIndex)
      if (typeof cell.value === 'number' || cell.value instanceof Date) {
        cell.numFmt = columnIndex === 1 ? 'mm/dd/yyyy hh:mm:ss' : 'mm/dd/yyyy'
      }
    })
    if (index % 2 === 1) {
      row.eachCell((cell) => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8F7FC' } } })
    }
    onProgress?.(10 + Math.round(((index + 1) / reviews.length) * 72), `Building sheet row ${index + 1} of ${reviews.length}`)
  })

  // Match the useful Google Sheet proportions without making all 89 columns huge.
  sheet.columns.forEach((column, index) => {
    const headerName = GOOGLE_SHEET_HEADERS[index] || ''
    if (/Name|Notes|Custom Note|Issue Found/.test(headerName)) column.width = /Notes|Custom/.test(headerName) ? 34 : 28
    else if (/Timestamp|Date/.test(headerName)) column.width = 18
    else if (/Call ID|IT#|Itinerary|Request ID/.test(headerName)) column.width = 26
    else column.width = 14
  })

  onProgress?.(88, 'Creating Google-Sheet style workbook')
  const buffer = await workbook.xlsx.writeBuffer()
  const filename = `Agents Reviewed - Firebase - ${dateKey(new Date())}.xlsx`
  saveWorkbook(buffer, filename)
  onProgress?.(100, 'Full Excel backup ready')
  return filename
}
