import { INDUSTRY_TO_FII_SECTOR } from '@/lib/fiiSectorMap'

type HoldingForSector = {
  industry:  string | null
  quantity:  number
  avg_price: number
}

function fmt(n: number) {
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(1)}Cr`
  if (n >= 100000)   return `₹${(n / 100000).toFixed(1)}L`
  if (n >= 1000)     return `₹${(n / 1000).toFixed(1)}k`
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
}

export default function SectorAllocation({ holdings }: { holdings: HoldingForSector[] }) {
  // Group by FII sector name
  const sectorMap: Record<string, { invested: number }> = {}
  let totalInvested = 0

  for (const h of holdings) {
    const industry = h.industry
    const sector   = industry ? (INDUSTRY_TO_FII_SECTOR[industry] ?? industry) : 'Other'
    const invested = h.quantity * h.avg_price
    if (!sectorMap[sector]) sectorMap[sector] = { invested: 0 }
    sectorMap[sector].invested += invested
    totalInvested              += invested
  }

  const sectors = Object.entries(sectorMap)
    .map(([name, { invested }]) => ({
      name,
      invested,
      pct: totalInvested > 0 ? (invested / totalInvested) * 100 : 0,
    }))
    .sort((a, b) => b.invested - a.invested)

  if (!sectors.length) return null

  return (
    <div className="bg-white border border-gray-200 rounded-xl px-4 py-4 shadow-sm">
      <div className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">Sector Allocation</div>
      <div className="space-y-2.5">
        {sectors.map(s => (
          <div key={s.name}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-gray-700 truncate max-w-[140px]">{s.name}</span>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-xs text-gray-400">{fmt(s.invested)}</span>
                <span className="text-xs font-semibold text-gray-700 w-10 text-right">{s.pct.toFixed(1)}%</span>
              </div>
            </div>
            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded-full transition-all duration-500"
                style={{ width: `${Math.min(s.pct, 100)}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
