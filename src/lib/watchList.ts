import type { ReviewRecord, WatchListAgent } from '../types'

export function normalizeAgentName(value: string): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .replace(/\s+/g, ' ')
}

function agentNameTokens(value: string): string[] {
  return normalizeAgentName(value)
    .split(' ')
    .map((token) => token.replace(/^[-']+|[-']+$/g, ''))
    .filter(Boolean)
}

/**
 * Used only by Watch List QA scoring. The first two names are the identity
 * key, so "Alexandra Paul" matches "Alexandra Paul Sabugo Mogro".
 */
export function watchListFirstTwoNamesMatch(left: string, right: string): boolean {
  const leftTokens = agentNameTokens(left)
  const rightTokens = agentNameTokens(right)
  if (leftTokens.length < 2 || rightTokens.length < 2) return false
  return leftTokens[0] === rightTokens[0] && leftTokens[1] === rightTokens[1]
}

/**
 * Existing safer matcher used outside the Watch List scoring calculation.
 * Keep first + last-name behavior so the new first-two-name rule does not
 * change matching elsewhere in the QA tool.
 */
export function agentNamesMatch(left: string, right: string): boolean {
  const normalizedLeft = normalizeAgentName(left)
  const normalizedRight = normalizeAgentName(right)
  if (!normalizedLeft || !normalizedRight) return false
  if (normalizedLeft === normalizedRight) return true

  const leftTokens = agentNameTokens(left)
  const rightTokens = agentNameTokens(right)
  if (leftTokens.length < 2 || rightTokens.length < 2) return false

  const sameFirst = leftTokens[0] === rightTokens[0]
  const sameLast = leftTokens[leftTokens.length - 1] === rightTokens[rightTokens.length - 1]
  if (!sameFirst || !sameLast) return false

  const leftSet = new Set(leftTokens)
  const rightSet = new Set(rightTokens)
  const shorter = leftTokens.length <= rightTokens.length ? leftTokens : rightTokens
  const longerSet = leftTokens.length <= rightTokens.length ? rightSet : leftSet
  const shorterContained = shorter.every((token) => longerSet.has(token))
  if (shorterContained) return true

  const shared = [...leftSet].filter((token) => rightSet.has(token)).length
  const union = new Set([...leftSet, ...rightSet]).size
  return union > 0 && shared / union >= 0.75
}

export function normalizeCallCenter(value: string): string {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')

  const aliases: Record<string, string> = {
    cnx: 'concentrix',
    concentrix: 'concentrix',
    telus: 'telus',
    wns: 'wns',
    buweloc: 'buweloc',
    buwelocss: 'buweloc',
    buwelog: 'buwelog',
    buwelogroups: 'buwelog',
  }

  return aliases[normalized] || normalized
}

function hasAmbiguousFirstTwoName(agent: WatchListAgent, allAgents: WatchListAgent[]): boolean {
  const center = normalizeCallCenter(agent.callCenter)
  return allAgents.some((other) => {
    if (other.id === agent.id || other.watchStatus !== 'Active') return false
    const otherCenter = normalizeCallCenter(other.callCenter)
    const sameCenter = !center || !otherCenter || center === otherCenter
    return sameCenter && watchListFirstTwoNamesMatch(agent.agentName, other.agentName)
  })
}

export function getWatchListMetrics(agent: WatchListAgent, reviews: ReviewRecord[], allAgents: WatchListAgent[] = []) {
  const normalizedCenter = normalizeCallCenter(agent.callCenter)
  const ambiguousFirstTwo = allAgents.length > 0 && hasAmbiguousFirstTwoName(agent, allAgents)
  const matchedReviews = reviews.filter((review) => {
    // Normal Watch List behavior: match the first two names only. If two active
    // Watch List agents in the same center ever share those first two names,
    // require the full name so their QA scores cannot be mixed together.
    const sameAgent = ambiguousFirstTwo
      ? normalizeAgentName(review.agentName || '') === normalizeAgentName(agent.agentName)
      : watchListFirstTwoNamesMatch(review.agentName || '', agent.agentName)
    const reviewCenter = normalizeCallCenter(review.callCenter || '')
    const sameCenter = !normalizedCenter || !reviewCenter || reviewCenter === normalizedCenter
    return sameAgent && sameCenter
  })
  const automaticAverageScore = matchedReviews.length
    ? matchedReviews.reduce((sum, review) => sum + Number(review.finalScore || 0), 0) / matchedReviews.length
    : null

  const hasManualScore = agent.manualQaScore !== null && agent.manualQaScore !== undefined && !Number.isNaN(Number(agent.manualQaScore))
  const hasManualReviewCount = agent.manualReviewCount !== null && agent.manualReviewCount !== undefined && !Number.isNaN(Number(agent.manualReviewCount))
  const averageScore = hasManualScore ? Number(agent.manualQaScore) : automaticAverageScore
  const reviewCount = hasManualReviewCount ? Math.max(0, Math.trunc(Number(agent.manualReviewCount))) : matchedReviews.length

  const kpiBand = averageScore === null
    ? 'none'
    : averageScore < 90
      ? 'danger'
      : averageScore < 95
        ? 'warning'
        : 'success'

  const kpiLabel = averageScore === null
    ? 'No QA Yet'
    : averageScore < 90
      ? 'Under KPI'
      : averageScore < 95
        ? 'Passing · Watch'
        : 'Strong'

  return { matchedReviews, reviewCount, averageScore, automaticAverageScore, hasManualScore, hasManualReviewCount, kpiBand, kpiLabel, ambiguousFirstTwo }
}

export function findActiveWatchAgent(agentName: string, agents: WatchListAgent[], callCenter = ''): WatchListAgent | null {
  const normalizedCenter = normalizeCallCenter(callCenter)
  if (!normalizeAgentName(agentName)) return null

  const matches = agents.filter((agent) => {
    const sameAgent = agentNamesMatch(agent.agentName, agentName)
    const agentCenter = normalizeCallCenter(agent.callCenter)
    const sameCenter = !normalizedCenter || !agentCenter || agentCenter === normalizedCenter
    return agent.watchStatus === 'Active' && sameAgent && sameCenter
  })

  if (matches.length <= 1) return matches[0] || null

  // Prefer an exact normalized name if multiple Watch List records have the
  // same first/last name. Otherwise return the first center-matched record.
  const exact = matches.find((agent) => normalizeAgentName(agent.agentName) === normalizeAgentName(agentName))
  return exact || matches[0] || null
}
