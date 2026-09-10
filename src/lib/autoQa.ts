import ExcelJS from 'exceljs'
import type { AppSettings, CriterionStatus, QaType } from '../types'

export interface AutoQaCriterionResult {
  number: number
  status: CriterionStatus
  note: string
  confidence: number
  transcriptEvidence: string
  documentationEvidence: string
  matrixEvidence: string
  criticalReason?: string
}

export interface AutoQaResult {
  transcript: string
  detectedItinerary: string
  detectedCallLength: string
  detectedCallDate: string
  overallConfidence: number
  summary: string
  criteria: AutoQaCriterionResult[]
}

export interface ImportedWorkbookText {
  fileName: string
  text: string
  sheets: string[]
}

export async function workbookToQaText(file: File): Promise<ImportedWorkbookText> {
  const bytes = await file.arrayBuffer()
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(bytes as any)
  const chunks: string[] = []
  const sheets: string[] = []

  workbook.eachSheet((sheet) => {
    sheets.push(sheet.name)
    chunks.push(`## ${sheet.name}`)
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const values = row.values as unknown[]
      const clean = values
        .slice(1)
        .map((value) => {
          if (value == null) return ''
          if (typeof value === 'object') {
            const rich = value as any
            if (Array.isArray(rich.richText)) return rich.richText.map((part: any) => String(part.text || '')).join('')
            if (rich.text) return String(rich.text)
            if (rich.result != null) return String(rich.result)
          }
          return String(value).replace(/\s+/g, ' ').trim()
        })
      if (clean.some(Boolean)) chunks.push(clean.join(' | '))
    })
    chunks.push('')
  })

  return { fileName: file.name, text: chunks.join('\n').trim(), sheets }
}

export function tryExtractSalesCriteria(text: string) {
  const rows = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const parsed: Array<{ number: number; name: string; points: number; notes: string }> = []

  for (const row of rows) {
    if (row.startsWith('## ')) continue
    const cols = row.split('|').map((part) => part.trim()).filter((part, index, arr) => part || index < arr.length - 1)
    if (cols.length < 2) continue
    const number = Number(cols[0])
    const pointCandidates = cols.map((value) => Number(String(value).replace('%', '').trim()))
    const pointIndex = pointCandidates.findIndex((value, index) => index > 0 && Number.isFinite(value) && value >= 0 && value <= 100)
    if (!Number.isFinite(number) || number < 1 || pointIndex < 0) continue
    const name = cols[1] || ''
    const points = pointCandidates[pointIndex]
    if (!name || !Number.isFinite(points)) continue
    const notes = cols.slice(pointIndex + 1).join(' | ')
    parsed.push({ number, name, points, notes })
  }

  const unique = parsed
    .filter((item, index, items) => items.findIndex((other) => other.number === item.number) === index)
    .sort((a, b) => a.number - b.number)
  const total = unique.reduce((sum, item) => sum + item.points, 0)
  return unique.length >= 3 && total > 0 ? unique : []
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error || new Error('Could not read the audio file.'))
    reader.onload = () => {
      const value = String(reader.result || '')
      resolve(value.includes(',') ? value.slice(value.indexOf(',') + 1) : value)
    }
    reader.readAsDataURL(file)
  })
}

export async function runAutoQa(options: {
  audioFile?: File
  transcript?: string
  documentation: string
  qaType: QaType
  settings: AppSettings
}): Promise<AutoQaResult> {
  const endpoint = options.settings.autoQa?.serviceUrl || 'http://127.0.0.1:8788'
  const audioBase64 = options.audioFile ? await fileToBase64(options.audioFile) : undefined
  const criteria = options.settings.criteria[options.qaType]
  const response = await fetch(`${endpoint.replace(/\/$/, '')}/api/auto-qa`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      audioBase64,
      audioFileName: options.audioFile?.name || '',
      transcript: options.transcript || '',
      documentation: options.documentation,
      qaType: options.qaType,
      criteria,
      matrixText: options.settings.autoQa?.matrixText || '',
      salesQaFormText: options.settings.autoQa?.salesQaFormText || '',
      ollamaUrl: options.settings.autoQa?.ollamaUrl || 'http://127.0.0.1:11434',
      ollamaModel: options.settings.autoQa?.ollamaModel || 'qwen3:8b',
    }),
  })

  const payload = await response.json().catch(() => ({}))
  if (!response.ok || !payload?.success) throw new Error(payload?.message || 'Auto QA failed.')
  return payload.data as AutoQaResult
}

export async function checkAutoQaService(settings: AppSettings): Promise<{ ok: boolean; message: string }> {
  try {
    const endpoint = settings.autoQa?.serviceUrl || 'http://127.0.0.1:8788'
    const response = await fetch(`${endpoint.replace(/\/$/, '')}/health`)
    const payload = await response.json().catch(() => ({}))
    return { ok: response.ok && payload?.ok === true, message: payload?.message || (response.ok ? 'Auto QA service is online.' : 'Auto QA service is offline.') }
  } catch {
    return { ok: false, message: 'Auto QA service is offline. Start START-AUTO-QA.bat on this computer.' }
  }
}
