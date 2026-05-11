'use client'

import { useState, useMemo } from 'react'

type Industry = {
  industry:         string
  screener_url:     string | null
  company_count:    number | null
  total_mcap_cr:    number | null
  median_mcap_cr:   number | null
  median_pe:        number | null
  avg_sales_growth: number | null
  avg_opm:          number | null
  avg_roce:         number | null
  median_1y_return: number | null
  updated_at:       string | null
}

type SortKey = keyof Industry
type SortDir = 'asc' | 'desc'

function fmtCr(v: number | null) {
  if (v == null) return '—'
  if (v >= 1_00_000) return `₹${(v / 1_00_000).toFixed(1)}L Cr`
  if (v >= 1_000)    return `₹${(v / 1_000).toFixed(1)}K Cr`
  return `₹${v.toFixed(0)} Cr`
}
function fmtPct(v: number | null) { return v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(0)}%` }
function fmtPE(v: number | null)  { return v == null ? '—' : `${v.toFixed(0)}x` }

function ReturnCell({ v }: { v: number | null }) {
  if (v == null) return <span className="text-gray-400">—</span>
  const color = v >= 20 ? '#10b981' : v >= 0 ? '#6ee7b7' : v >= -10 ? '#fca5a5' : '#ef4444'
  const bg    = v >= 20 ? '#d1fae5' : v >= 0 ? '#f0fdf4'  : v >= -10 ? '#fff5f5'  : '#fee2e2'
  return (
    <span className="px-1.5 py-0.5 rounded text-xs font-semibold" style={{ color, backgroundColor: bg }}>
      {v > 0 ? '+' : ''}{v.toFixed(0)}%
    </span>
  )
}

const COLS: { key: SortKey; label: string; align: 'left' | 'right' }[] = [
  { key: 'industry',         label: 'Industry',        align: 'left'  },
  { key: 'company_count',    label: 'Cos',             align: 'right' },
  { key: 'total_mcap_cr',    label: 'Total MCap',      align: 'right' },
  { key: 'median_pe',        label: 'Median P/E',      align: 'right' },
  { key: 'avg_sales_growth', label: 'Sales Gr.',       align: 'right' },
  { key: 'avg_opm',          label: 'OPM',             align: 'right' },
  { key: 'avg_roce',         label: 'ROCE',            align: 'right' },
  { key: 'median_1y_return', label: '1Y Return',       align: 'right' },
]

export default function IndustriesGrid({
  data,
  userIndustries,
  updatedAt,
}: {
  data: Industry[]
  userIndustries: string[]
  updatedAt: string | null
}) {
  const [sortKey, setSortKey]   = useState<SortKey>('median_1y_return')
  const [sortDir, setSortDir]   = useState<SortDir>('desc')
  const [search, setSearch]     = useState('')
  const [watchOnly, setWatchOnly] = useState(false)

  const userSet = useMemo(() =>
    new Set(userIndustries.map(i => i.toLowerCase())),
    [userIndustries]
  )

  const sorted = useMemo(() => {
    let rows = [...data]
    if (search) rows = rows.filter(r => r.industry.toLowerCase().includes(search.toLowerCase()))
    if (watchOnly) rows = rows.filter(r => userSet.has(r.industry.toLowerCase()))
    rows.sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey]
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      const cmp = av < bv ? -1 : av > bv ? 1 : 0
      return sortDir === 'asc' ? cmp : -cmp
    })
    return rows
  }, [data, sortKey, sortDir, search, watchOnly, userSet])

  function handleSort(key: SortKey) {
    if (key === sortKey) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('desc') }
  }

  const sortIcon = (key: SortKey) => key !== sortKey ? '' : sortDir === 'desc' ? ' ↓' : ' ↑'

  // Summary stats
  const totalMcap   = data.reduce((s, r) => s + (r.total_mcap_cr ?? 0), 0)
  const advancers   = data.filter(r => (r.median_1y_return ?? 0) > 0).length
  const decliners   = data.filter(r => (r.median_1y_return ?? 0) < 0).length

  return (
    <div className="space-y-4">

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Industries Tracked', value: `${data.length}` },
          { label: 'Total Market Cap',   value: fmtCr(totalMcap) },
          { label: '1Y Advancers',       value: `${advancers}`, color: '#10b981' },
          { label: '1Y Decliners',       value: `${decliners}`, color: '#ef4444' },
        ].map(c => (
          <div key={c.label} className="artha-card p-4">
            <p className="text-xs font-medium" style={{ color: 'var(--artha-text-muted)' }}>{c.label}</p>
            <p className="text-xl font-bold font-display mt-1" style={{ color: c.color ?? 'var(--artha-text)', letterSpacing: '-0.02em' }}>
              {c.value}
            </p>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="artha-card p-5">
        <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
          <div>
            <h2 className="text-base font-semibold" style={{ color: 'var(--artha-text)' }}>Industries Overview</h2>
            <p className="text-xs mt-0.5" style={{ color: 'var(--artha-text-muted)' }}>
              Source: Screener.in{updatedAt ? ` · Updated ${new Date(updatedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : ''}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {userIndustries.length > 0 && (
              <button
                onClick={() => setWatchOnly(v => !v)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                  watchOnly ? 'bg-indigo-600 text-white border-indigo-600' : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                }`}
              >
                My industries
              </button>
            )}
            <input
              type="text"
              placeholder="Search industry…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-xs outline-none focus:border-indigo-400 w-44"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-100">
                {COLS.map(col => (
                  <th
                    key={col.key}
                    onClick={() => handleSort(col.key)}
                    className={`pb-2 pr-4 font-medium cursor-pointer select-none whitespace-nowrap hover:text-gray-700 ${col.align === 'right' ? 'text-right' : 'text-left'}`}
                    style={{ color: sortKey === col.key ? 'var(--artha-text)' : 'var(--artha-text-muted)' }}
                  >
                    {col.label}{sortIcon(col.key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map(row => {
                const isWatched = userSet.has(row.industry.toLowerCase())
                return (
                  <tr key={row.industry} className={`border-b border-gray-50 hover:bg-gray-50 ${isWatched ? 'bg-indigo-50/40' : ''}`}>
                    <td className="py-2 pr-4">
                      <div className="flex items-center gap-1.5">
                        {isWatched && <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 shrink-0" />}
                        {row.screener_url ? (
                          <a
                            href={`https://www.screener.in${row.screener_url}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-medium hover:text-indigo-600 hover:underline"
                            style={{ color: 'var(--artha-text)' }}
                          >
                            {row.industry}
                          </a>
                        ) : (
                          <span className="font-medium" style={{ color: 'var(--artha-text)' }}>{row.industry}</span>
                        )}
                      </div>
                    </td>
                    <td className="py-2 pr-4 text-right" style={{ color: 'var(--artha-text-muted)' }}>{row.company_count ?? '—'}</td>
                    <td className="py-2 pr-4 text-right font-medium" style={{ color: 'var(--artha-text)' }}>{fmtCr(row.total_mcap_cr)}</td>
                    <td className="py-2 pr-4 text-right" style={{ color: 'var(--artha-text-muted)' }}>{fmtPE(row.median_pe)}</td>
                    <td className={`py-2 pr-4 text-right font-medium ${row.avg_sales_growth == null ? '' : row.avg_sales_growth >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                      {fmtPct(row.avg_sales_growth)}
                    </td>
                    <td className="py-2 pr-4 text-right" style={{ color: 'var(--artha-text-muted)' }}>{fmtPct(row.avg_opm)}</td>
                    <td className="py-2 pr-4 text-right" style={{ color: 'var(--artha-text-muted)' }}>{fmtPct(row.avg_roce)}</td>
                    <td className="py-2 pr-4 text-right"><ReturnCell v={row.median_1y_return} /></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {sorted.length === 0 && (
            <p className="text-center py-8 text-sm" style={{ color: 'var(--artha-text-muted)' }}>No industries match your filter.</p>
          )}
        </div>
      </div>
    </div>
  )
}
