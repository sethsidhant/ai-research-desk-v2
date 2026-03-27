import { type ChartPoint } from '@/components/PortfolioChart'

export type HoldingForChart = {
  stock_id:  string
  avg_price: number
  quantity:  number
  added_at:  string  // ISO date string
}

type HistoryRow = {
  stock_id:      string
  date:          string
  closing_price: number
}

type IndexRow = {
  date:           string
  nifty50_close:  number
  nifty500_close: number
}

export function buildPortfolioChart(
  holdings:     HoldingForChart[],
  history:      HistoryRow[],
  indexHistory: IndexRow[],
): ChartPoint[] {
  if (!holdings.length || !history.length) return []

  const addedAtMap: Record<string, string> = {}
  for (const h of holdings) addedAtMap[h.stock_id] = h.added_at.slice(0, 10)

  const holdingMap: Record<string, HoldingForChart> = {}
  for (const h of holdings) holdingMap[h.stock_id] = h

  const indexByDate: Record<string, { n50: number; n500: number }> = {}
  const sortedIndexDates: string[] = []
  for (const row of indexHistory) {
    const d = row.date.slice(0, 10)
    indexByDate[d] = { n50: row.nifty50_close, n500: row.nifty500_close }
    sortedIndexDates.push(d)
  }
  sortedIndexDates.sort()

  function nearestIndex(targetDate: string) {
    let result: { n50: number; n500: number } | undefined
    for (const d of sortedIndexDates) {
      if (d <= targetDate) result = indexByDate[d]
      else break
    }
    return result
  }

  const byDate: Record<string, Record<string, number>> = {}
  for (const h of history) {
    const addedAt = addedAtMap[h.stock_id] ?? '2000-01-01'
    if (h.date < addedAt) continue
    if (!byDate[h.date]) byDate[h.date] = {}
    byDate[h.date][h.stock_id] = h.closing_price
  }

  const sortedDates = Object.keys(byDate).sort()
  if (!sortedDates.length) return []

  // Baseline Nifty at the very first index date (1 year ago), not the first portfolio date
  // This shows the full 1-year Nifty trend as context even if portfolio started later
  const firstIdx = sortedIndexDates.length > 0
    ? indexByDate[sortedIndexDates[0]]
    : nearestIndex(sortedDates[0])

  return sortedDates
    .map(date => {
      const prices = byDate[date]
      let currentVal = 0, investedOnDay = 0
      const idxNow = nearestIndex(date)

      for (const holding of holdings) {
        const addedAt = addedAtMap[holding.stock_id] ?? '2000-01-01'
        if (date < addedAt) continue
        const price = prices[holding.stock_id]
        if (!price) continue
        const investedWeight = holding.quantity * holding.avg_price
        currentVal    += price * holding.quantity
        investedOnDay += investedWeight
      }
      if (investedOnDay === 0) return null

      const returnPct   = ((currentVal - investedOnDay) / investedOnDay) * 100
      const nifty50Pct  = (firstIdx && idxNow)
        ? parseFloat(((idxNow.n50  / firstIdx.n50  - 1) * 100).toFixed(2))
        : undefined
      const nifty500Pct = (firstIdx && idxNow)
        ? parseFloat(((idxNow.n500 / firstIdx.n500 - 1) * 100).toFixed(2))
        : undefined

      const label = new Date(date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
      return { date: label, returnPct: parseFloat(returnPct.toFixed(2)), nifty50Pct, nifty500Pct }
    })
    .filter(Boolean) as ChartPoint[]
}
