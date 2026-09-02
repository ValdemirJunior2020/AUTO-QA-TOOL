import ExcelJS from 'exceljs'
import type { ReviewRecord, WatchListAgent } from '../types'
import { getWatchListMetrics } from './watchList'

export async function exportWatchListExcel(agents: WatchListAgent[], reviews: ReviewRecord[]): Promise<void> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'QA Control Center'
  workbook.created = new Date()
  const sheet = workbook.addWorksheet('Watch List Agents', { views: [{ state: 'frozen', ySplit: 1 }] })

  sheet.columns = [
    { header: 'Call Center', key: 'callCenter', width: 18 },
    { header: 'LOB', key: 'lob', width: 12 },
    { header: 'Agent Name', key: 'agentName', width: 34 },
    { header: 'Trainer', key: 'trainer', width: 24 },
    { header: 'Wave', key: 'wave', width: 14 },
    { header: 'Date Added to Watch List', key: 'dateAdded', width: 22 },
    { header: 'QA Review Dates Since Added', key: 'reviewDatesSinceAdded', width: 42 },
    { header: 'Start Date', key: 'startDate', width: 14 },
    { header: 'End Date', key: 'endDate', width: 14 },
    { header: 'Employee Status', key: 'employeeStatus', width: 16 },
    { header: 'Watch Status', key: 'watchStatus', width: 16 },
    { header: 'Reason for Watch', key: 'reason', width: 36 },
    { header: 'QA Average', key: 'qaAverage', width: 14 },
    { header: 'Reviews', key: 'reviewCount', width: 10 },
    { header: 'KPI Status', key: 'kpiStatus', width: 18 },
    { header: 'QA Score Source', key: 'qaSource', width: 18 },
    { header: 'Review Count Source', key: 'reviewSource', width: 20 },
    { header: 'Added By', key: 'createdByName', width: 20 },
    { header: 'Added Date', key: 'createdAt', width: 22 },
    { header: 'Last Updated By', key: 'updatedByName', width: 20 },
    { header: 'Last Updated Date', key: 'updatedAt', width: 22 },
    { header: 'Cleared/Removed By', key: 'clearedByName', width: 22 },
    { header: 'Cleared/Removed Date', key: 'clearedAt', width: 22 },
  ]

  const header = sheet.getRow(1)
  header.height = 24
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF24165F' } }
  header.alignment = { vertical: 'middle', horizontal: 'center' }

  agents.forEach((agent) => {
    const metrics = getWatchListMetrics(agent, reviews, agents)
    const addedDate = agent.createdAt ? new Date(agent.createdAt) : null
    const addedDay = addedDate && !Number.isNaN(addedDate.getTime())
      ? new Date(addedDate.getFullYear(), addedDate.getMonth(), addedDate.getDate()).getTime()
      : Number.NaN
    const reviewsSinceAdded = [...metrics.matchedReviews]
      .filter((review) => {
        if (Number.isNaN(addedDay)) return true
        const reviewDate = new Date(review.reviewDate || review.savedTimestamp)
        if (Number.isNaN(reviewDate.getTime())) return true
        const reviewDay = new Date(reviewDate.getFullYear(), reviewDate.getMonth(), reviewDate.getDate()).getTime()
        return reviewDay >= addedDay
      })
      .sort((a, b) => new Date(a.reviewDate || a.savedTimestamp).getTime() - new Date(b.reviewDate || b.savedTimestamp).getTime())
    const row = sheet.addRow({
      ...agent,
      dateAdded: agent.createdAt,
      reviewDatesSinceAdded: reviewsSinceAdded.map((review) => `${review.reviewDate || review.savedTimestamp} | ${review.evaluator || 'QA'} | ${Number(review.finalScore || 0).toFixed(1)}%`).join('\n'),
      qaAverage: metrics.averageScore === null ? '' : metrics.averageScore / 100,
      reviewCount: metrics.reviewCount,
      kpiStatus: metrics.kpiLabel,
      qaSource: metrics.hasManualScore ? 'Manual Override' : 'Automatic',
      reviewSource: metrics.hasManualReviewCount ? 'Manual Override' : 'Automatic',
    })
    const fill = metrics.averageScore === null
      ? 'FFE5E7EB'
      : metrics.averageScore < 90
        ? 'FFFECACA'
        : metrics.averageScore < 95
          ? 'FFFEF3C7'
          : 'FFDCFCE7'
    row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } }
    row.alignment = { vertical: 'top', wrapText: true }
    if (metrics.averageScore !== null) row.getCell('qaAverage').numFmt = '0.0%'
  })

  sheet.autoFilter = { from: 'A1', to: 'W1' }
  sheet.eachRow((row) => {
    row.eachCell((cell) => {
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        right: { style: 'thin', color: { argb: 'FFE5E7EB' } },
      }
    })
  })

  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `QA-Watch-List-${new Date().toISOString().slice(0, 10)}.xlsx`
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
