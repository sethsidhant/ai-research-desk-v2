'use client'

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { INDUSTRY_TO_FII_SECTOR } from '@/lib/fiiSectorMap'

type HoldingForSector = {
  industry:  string | null
  quantity:  number
  avg_price: number
}

function fmtCurrency(n: number): string {
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(1)}Cr`
  if (n >= 100000)   return `₹${(n / 100000).toFixed(1)}L`
  if (n >= 1000)     return `₹${(n / 1000).toFixed(1)}k`
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
}

function CustomTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null
  const { name, pct, invested } = payload[0].payload
  return (
    <div className="bg-white border border-gray-200 rounded-lg px-3 py-2 shadow-lg text-xs space-y-1">
      <div className="font-semibold text-gray-700">{name}</div>
      <div className="text-gray-500">{fmtCurrency(invested)}</div>
      <div className="font-bold text-blue-600">{pct.toFixed(1)}%</div>
    </div>
  )
}

const BAR_COLORS = [
  '#3b82f6', '#6366f1', '#8b5cf6', '#a855f7',
  '#ec4899', '#f43f5e', '#f97316', '#eab308',
  '#22c55e', '#14b8a6', '#06b6d4', '#64748b',
]

export default function SectorAllocation({ holdings }: { holdings: HoldingForSector[] }) {
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

  const chartHeight = Math.max(160, sectors.length * 32 + 20)

  return (
    <div className="bg-white border border-gray-200 rounded-xl px-4 py-4 shadow-sm">
      <div className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">Sector Allocation</div>
      <ResponsiveContainer width="100%" height={chartHeight}>
        <BarChart
          data={sectors}
          layout="vertical"
          margin={{ top: 0, right: 40, bottom: 0, left: 0 }}
        >
          <XAxis
            type="number"
            domain={[0, 'auto']}
            tick={{ fontSize: 10, fill: '#9ca3af' }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => `${v.toFixed(0)}%`}
          />
          <YAxis
            type="category"
            dataKey="name"
            tick={{ fontSize: 10, fill: '#6b7280' }}
            tickLine={false}
            axisLine={false}
            width={120}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: '#f3f4f6' }} />
          <Bar dataKey="pct" radius={[0, 4, 4, 0]} barSize={16}>
            {sectors.map((_, idx) => (
              <Cell key={idx} fill={BAR_COLORS[idx % BAR_COLORS.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
