import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

const PORT = Number(process.env.AUTO_QA_PORT || 8788)
const HOST = '127.0.0.1'
const PYTHON = process.env.AUTO_QA_PYTHON || path.resolve('.venv-autoqa', 'Scripts', 'python.exe')
const WHISPER_MODEL = process.env.AUTO_QA_WHISPER_MODEL || 'small.en'

function send(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  })
  res.end(JSON.stringify(body))
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, ...options })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (data) => { stdout += String(data) })
    child.stderr?.on('data', (data) => { stderr += String(data) })
    child.on('error', reject)
    child.on('close', (code) => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(stderr || stdout || `${command} exited with ${code}`)))
  })
}

async function transcribeAudio(audioBase64, fileName) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-auto-'))
  try {
    const ext = path.extname(fileName || '') || '.audio'
    const source = path.join(tempDir, `source${ext}`)
    const wav = path.join(tempDir, 'normalized.wav')
    fs.writeFileSync(source, Buffer.from(audioBase64, 'base64'))
    await run('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', source, '-ac', '1', '-ar', '16000', '-vn', wav])
    const result = await run(PYTHON, [path.resolve('autoqa', 'transcribe.py'), wav, WHISPER_MODEL])
    const line = result.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1)
    if (!line) throw new Error('Whisper returned an empty transcript.')
    return JSON.parse(line)
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
}

function matrixKeywords(value) {
  const stop = new Set(['the','and','for','that','with','from','this','have','will','was','are','but','not','you','your','guest','agent','call','hotel','reservation','booking','please','into','when','then','they','their','them','our','has','had','can','could','would','should','about','only','need','needs'])
  return new Set(String(value || '').toLowerCase().match(/[a-z0-9]{3,}/g)?.filter((word) => !stop.has(word)) || [])
}

function selectRelevantMatrix(matrixText, evidenceText) {
  const lines = String(matrixText || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  if (!lines.length) return ''
  const evidence = matrixKeywords(evidenceText)
  const itemsStart = lines.findIndex((line) => /^##\s+items to note/i.test(line))
  const always = itemsStart >= 0 ? lines.slice(itemsStart, Math.min(lines.length, itemsStart + 20)) : []
  const scored = lines.map((line, index) => {
    if (line.startsWith('## ')) return { line, index, score: 0 }
    const words = matrixKeywords(line)
    let score = 0
    for (const word of words) if (evidence.has(word)) score += word.length >= 8 ? 3 : 1
    if (/refund|voucher|foc|slack|ticket|supplier|payment|cancel|receipt|confirmation|rebook|supervisor|group/i.test(line)) score += 0.25
    return { line, index, score }
  }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score)

  const selected = new Set(always)
  for (const item of scored.slice(0, 28)) {
    selected.add(item.line)
    if (item.index > 0 && lines[item.index - 1]?.startsWith('## ')) selected.add(lines[item.index - 1])
  }
  return [...selected].join('\n').slice(0, 24000)
}

function cleanItinerary(value) {
  const match = String(value || '').match(/\bH\s*[0-9][0-9\s-]{5,20}\b/i)
  return match ? match[0].replace(/[\s-]+/g, '').toUpperCase() : ''
}

function spokenDigitsToNumber(value) {
  const map = {
    zero: '0', oh: '0', o: '0', one: '1', two: '2', three: '3', four: '4',
    five: '5', six: '6', seven: '7', eight: '8', nine: '9',
  }
  return String(value || '').toLowerCase().replace(/\b(zero|oh|o|one|two|three|four|five|six|seven|eight|nine)\b/g, (word) => map[word] || word)
}

function fallbackPhone(text) {
  const normalized = spokenDigitsToNumber(text)
  const matches = normalized.match(/(?:\+?1[\s().-]*)?(?:\d[\s().-]*){10,11}/g) || []
  for (const raw of matches) {
    let digits = raw.replace(/\D/g, '')
    if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1)
    if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  }
  return ''
}

function fallbackEmail(text) {
  const source = String(text || '')
  const direct = source.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i)
  if (direct) return direct[0].toLowerCase()

  const spoken = source
    .toLowerCase()
    .replace(/\s+(?:at sign|at)\s+/g, '@')
    .replace(/\s+(?:dot|period)\s+/g, '.')
    .replace(/\s+(?:underscore)\s+/g, '_')
    .replace(/\s+(?:dash|hyphen)\s+/g, '-')
    .replace(/\s*@\s*/g, '@')
    .replace(/\s*\.\s*/g, '.')
  const spokenMatch = spoken.match(/\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/i)
  return spokenMatch ? spokenMatch[0] : ''
}

function applyFallbackDetections(result, transcript, documentation) {
  const evidence = `${transcript || ''}\n${documentation || ''}`
  result.detectedItinerary = cleanItinerary(result.detectedItinerary) || cleanItinerary(evidence)
  result.detectedEmail = fallbackEmail(result.detectedEmail) || fallbackEmail(evidence)
  result.detectedPhone = fallbackPhone(result.detectedPhone) || fallbackPhone(evidence)
  return result
}

function buildPrompt(input, transcript) {
  const criteria = (input.criteria || []).map((c) => `${c.number}. ${c.name} (${c.points} points)\nDefinition: ${c.notes || ''}`).join('\n\n')
  const docs = String(input.documentation || '').slice(0, 70000)
  const matrix = selectRelevantMatrix(input.matrixText, `${transcript}\n${docs}`)
  const sales = input.qaType === 'Sales' ? String(input.salesQaFormText || '').slice(0, 24000) : ''
  return `You are a strict HotelPlanner Quality Assurance evaluator. Grade only from the evidence provided. Never invent facts. Use the active QA criteria and active Service Matrix as the source of truth. Documentation must be evaluated together with what happened on the call. If documentation has not been pasted yet, do a preliminary call-only review and do not invent documentation evidence. If evidence is missing, lower confidence and choose the most defensible status.\n\nGUEST DETAIL EXTRACTION:\n- Find the HotelPlanner itinerary / confirmation number, especially values beginning with H.\n- Find the guest email even when spoken as words such as "john dot smith at gmail dot com".\n- Find the guest phone even when digits are spoken one-by-one.\n- Return an empty string when a value cannot be found. Never invent guest details.\n\nSTATUS RULES:\n- ✓ Followed = criterion was met.\n- ✕ Markdown = criterion was not met.\n- Partial = criterion was partly met.\n- N/A = criterion truly does not apply.\n- Critical may ONLY be used for Matrix Compliance or Documentation Quality when the evidence supports a critical failure.\n- A Matrix Compliance markdown that reflects a required Matrix process not followed should be Critical.\n- Do not mark a criterion down for information that cannot reasonably be observed in the call/documentation.\n- Notes must be short, specific, professional, and editable by a human reviewer.\n- Evidence excerpts must be concise and copied/paraphrased from the supplied material only.\n\nQA TYPE: ${input.qaType}\n\nQA CRITERIA:\n${criteria}\n\nACTIVE SERVICE MATRIX:\n${matrix || '[No matrix loaded]'}\n\n${sales ? `ACTIVE GROUP SALES QA FORM:\n${sales}\n\n` : ''}CALL TRANSCRIPT:\n${String(transcript || '').slice(0, 70000)}\n\nDOCUMENTATION / ITINERARY NOTES:\n${docs || '[No documentation pasted yet]'}\n\nReturn one result for every QA criterion. Detect call date only if stated with confidence. Calculate confidence from 0-100. Do not mention AI, Ollama, automation, or model names in QA notes.`
}

const resultSchema = {
  type: 'object',
  properties: {
    detectedItinerary: { type: 'string' },
    detectedEmail: { type: 'string' },
    detectedPhone: { type: 'string' },
    detectedCallLength: { type: 'string' },
    detectedCallDate: { type: 'string' },
    overallConfidence: { type: 'number' },
    summary: { type: 'string' },
    criteria: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          number: { type: 'number' },
          status: { type: 'string', enum: ['✓ Followed', '✕ Markdown', 'N/A', 'Partial', 'Critical'] },
          note: { type: 'string' },
          confidence: { type: 'number' },
          transcriptEvidence: { type: 'string' },
          documentationEvidence: { type: 'string' },
          matrixEvidence: { type: 'string' },
          criticalReason: { type: 'string' },
        },
        required: ['number','status','note','confidence','transcriptEvidence','documentationEvidence','matrixEvidence','criticalReason'],
      },
    },
  },
  required: ['detectedItinerary','detectedEmail','detectedPhone','detectedCallLength','detectedCallDate','overallConfidence','summary','criteria'],
}

async function callOllama(input, transcript) {
  const base = String(input.ollamaUrl || 'http://127.0.0.1:11434').replace(/\/$/, '')
  const response = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: input.ollamaModel || 'qwen3:8b',
      stream: false,
      format: resultSchema,
      options: { temperature: 0.05, num_ctx: 32768 },
      messages: [
        { role: 'system', content: 'You are a precise QA auditor and guest-detail extractor. Follow the supplied policy, criteria, evidence, and JSON schema exactly.' },
        { role: 'user', content: buildPrompt(input, transcript) },
      ],
    }),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload?.error || `Ollama returned HTTP ${response.status}`)
  const content = payload?.message?.content
  if (!content) throw new Error('Ollama returned no QA result.')
  return typeof content === 'string' ? JSON.parse(content) : content
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {})
  if (req.method === 'GET' && req.url === '/health') return send(res, 200, { ok: true, message: 'Local Auto QA service is online.' })
  if (req.method !== 'POST' || req.url !== '/api/auto-qa') return send(res, 404, { success: false, message: 'Not found.' })

  try {
    const chunks = []
    let size = 0
    for await (const chunk of req) {
      size += chunk.length
      if (size > 300 * 1024 * 1024) throw new Error('Audio upload is too large. Maximum request size is 300 MB.')
      chunks.push(chunk)
    }
    const input = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    let transcript = String(input.transcript || '').trim()
    if (!transcript) {
      if (!input.audioBase64) throw new Error('Choose an audio file first.')
      const transcription = await transcribeAudio(input.audioBase64, input.audioFileName)
      transcript = String(transcription.text || '').trim()
      input.transcribedDurationSeconds = Array.isArray(transcription.segments) && transcription.segments.length ? Number(transcription.segments.at(-1)?.end || 0) : 0
    }
    if (!transcript) throw new Error('No speech was detected in the audio.')

    const result = applyFallbackDetections(await callOllama(input, transcript), transcript, input.documentation)
    if (!result.detectedCallLength && input.transcribedDurationSeconds) {
      const seconds = Math.max(0, Math.round(Number(input.transcribedDurationSeconds)))
      result.detectedCallLength = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
    }
    send(res, 200, { success: true, data: { ...result, transcript } })
  } catch (error) {
    send(res, 500, { success: false, message: error instanceof Error ? error.message : 'Auto QA failed.' })
  }
})

server.listen(PORT, HOST, () => {
  console.log(`Auto QA service running on http://${HOST}:${PORT}`)
  console.log(`Whisper model: ${WHISPER_MODEL}`)
})
