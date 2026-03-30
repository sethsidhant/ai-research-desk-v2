'use client'

import { useState } from 'react'

type DbStats = {
  db_size: string
  db_size_bytes: number
  active_connections: number
  idle_connections: number
  total_connections: number
  top_tables: Array<{ table_name: string; size: string; size_bytes: number; row_count: number }> | null
} | null

type HeartbeatReport = {
  cron_jobs?: Array<{ label: string; ok: boolean; age_secs: number | null; last_run: string | null; skipped?: boolean }>
  railway?:   { ok: boolean; age_secs: number | null; last_heartbeat: string | null }
  supabase?:  { ok: boolean; latency_ms: number; error: string | null }
} | null

function ageLabel(secs: number | null) {
  if (secs == null) return 'Never'
  if (secs < 60)    return `${secs}s ago`
  if (secs < 3600)  return `${Math.floor(secs / 60)}m ago`
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`
  return `${Math.floor(secs / 86400)}d ago`
}

function fmt(n: number) {
  return n.toLocaleString('en-IN')
}

// Supabase free plan DB limit is 500 MB
const FREE_PLAN_DB_LIMIT_BYTES = 500 * 1024 * 1024

export default function InfraCard({
  latestReport,
  dbStats,
}: {
  latestReport: { status: string; summary: string; ran_at: string; report: any } | null
  dbStats: DbStats
}) {
  const [open, setOpen] = useState(false)

  const report: HeartbeatReport = latestReport?.report ?? null
  const cronJobs     = report?.cron_jobs ?? []
  const railway      = report?.railway ?? null
  const sbHealth     = report?.supabase ?? null

  const status = latestReport?.status ?? null
  const dotColor =
    status === 'ok'      ? 'bg-emerald-500' :
    status === 'warning' ? 'bg-amber-400' :
    status === 'error'   ? 'bg-red-500' :
    'bg-gray-300'
  const statusLabel =
    status === 'ok'      ? 'OK' :
    status === 'warning' ? 'Warning' :
    status === 'error'   ? 'Error' :
    'Never run'
  const statusColor =
    status === 'ok'      ? 'text-emerald-600' :
    status === 'warning' ? 'text-amber-600' :
    status === 'error'   ? 'text-red-600' :
    'text-gray-400'

  const lastRun = latestReport?.ran_at
    ? (() => {
        const secs = Math.floor((Date.now() - new Date(latestReport.ran_at).getTime()) / 1000)
        return ageLabel(secs)
      })()
    : null

  const dbPct = dbStats ? Math.min((dbStats.db_size_bytes / FREE_PLAN_DB_LIMIT_BYTES) * 100, 100) : null
  const maxTableBytes = Math.max(...(dbStats?.top_tables ?? []).map(t => t.size_bytes), 1)

  return (
    <>
      {/* ── Summary card (fits in agent team grid) ── */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm flex flex-col overflow-hidden">
        <div className="px-5 pt-5 pb-3 border-b border-gray-50">
          <div className="flex items-start justify-between gap-2 mb-2">
            <span className="text-2xl leading-none">🖥️</span>
            <span className={`flex items-center gap-1.5 text-xs font-semibold ${statusColor}`}>
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${dotColor}`} />
              {statusLabel}
            </span>
          </div>
          <div className="text-sm font-bold text-gray-900 leading-tight">Infrastructure Monitor</div>
          <div className="text-[11px] text-indigo-500 font-semibold mt-0.5 uppercase tracking-wide">System Health</div>
        </div>

        <div className="px-5 py-3 flex-1 space-y-2">
          {dbStats ? (
            <>
              <div className="flex justify-between text-xs">
                <span className="text-gray-400">DB Size</span>
                <span className="font-mono font-semibold text-gray-700">{dbStats.db_size}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-gray-400">Connections</span>
                <span className="font-mono text-gray-700">{dbStats.active_connections} active / {dbStats.total_connections} total</span>
              </div>
            </>
          ) : (
            <p className="text-xs text-gray-400">DB stats unavailable</p>
          )}
          {sbHealth && (
            <div className="flex justify-between text-xs">
              <span className="text-gray-400">Supabase latency</span>
              <span className={`font-mono font-semibold ${sbHealth.latency_ms < 500 ? 'text-emerald-600' : sbHealth.latency_ms < 2000 ? 'text-amber-600' : 'text-red-600'}`}>
                {sbHealth.latency_ms}ms
              </span>
            </div>
          )}
          {latestReport?.summary && (
            <p className="text-xs text-gray-500 bg-gray-50 rounded-lg px-2.5 py-1.5 border border-gray-100 leading-relaxed">
              {latestReport.summary.split(', ')[0]}
            </p>
          )}
        </div>

        <div className="px-5 py-3 border-t border-gray-50 flex items-center justify-between">
          <span className="text-[10px] text-gray-400 font-mono">Daily · 09:30 PM IST</span>
          <div className="flex items-center gap-3">
            <span className="text-[10px] text-gray-400">{lastRun ? `${lastRun}` : 'Not yet run'}</span>
            <button
              onClick={() => setOpen(true)}
              className="text-[10px] font-semibold text-blue-500 hover:text-blue-700 transition-colors"
            >
              Details →
            </button>
          </div>
        </div>
      </div>

      {/* ── Modal ── */}
      {open && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={() => setOpen(false)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[88vh] overflow-y-auto">

              {/* Modal header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white z-10">
                <div>
                  <h2 className="font-bold text-gray-900 text-base">Infrastructure Monitor</h2>
                  <p className="text-xs text-gray-400 mt-0.5">
                    AWS eu-west-1 · Supabase Free Plan
                    {lastRun && <span className="ml-2">· Last checked {lastRun}</span>}
                  </p>
                </div>
                <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-700 text-xl leading-none">✕</button>
              </div>

              <div className="px-6 py-5 space-y-7">

                {/* ── Supabase Database ── */}
                <section>
                  <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-4">
                    🗄 Supabase Database
                  </h3>
                  {dbStats ? (
                    <div className="space-y-4">
                      {/* Key metrics row */}
                      <div className="grid grid-cols-3 gap-3">
                        <div className="bg-gray-50 rounded-xl px-4 py-3 text-center">
                          <div className="text-lg font-bold text-gray-900">{dbStats.db_size}</div>
                          <div className="text-[10px] text-gray-400 mt-0.5">Database Size</div>
                        </div>
                        <div className="bg-gray-50 rounded-xl px-4 py-3 text-center">
                          <div className="text-lg font-bold text-emerald-600">{dbStats.active_connections}</div>
                          <div className="text-[10px] text-gray-400 mt-0.5">Active Connections</div>
                        </div>
                        <div className="bg-gray-50 rounded-xl px-4 py-3 text-center">
                          <div className="text-lg font-bold text-gray-700">{dbStats.total_connections}</div>
                          <div className="text-[10px] text-gray-400 mt-0.5">Total Connections</div>
                        </div>
                      </div>

                      {/* DB size bar vs free plan limit */}
                      {dbPct != null && (
                        <div>
                          <div className="flex justify-between text-xs text-gray-400 mb-1.5">
                            <span>Storage used</span>
                            <span className={dbPct > 80 ? 'text-red-600 font-semibold' : 'text-gray-500'}>
                              {dbPct.toFixed(1)}% of 500 MB free limit
                            </span>
                          </div>
                          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${dbPct > 80 ? 'bg-red-500' : dbPct > 60 ? 'bg-amber-400' : 'bg-emerald-500'}`}
                              style={{ width: `${dbPct}%` }}
                            />
                          </div>
                        </div>
                      )}

                      {/* Supabase latency */}
                      {sbHealth && (
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-gray-500">API Latency</span>
                          <span className={`font-mono font-semibold ${sbHealth.latency_ms < 500 ? 'text-emerald-600' : sbHealth.latency_ms < 2000 ? 'text-amber-600' : 'text-red-600'}`}>
                            {sbHealth.latency_ms}ms {sbHealth.latency_ms < 500 ? '✓ fast' : sbHealth.latency_ms < 2000 ? '⚠ slow' : '✗ degraded'}
                          </span>
                        </div>
                      )}

                      {/* Top tables */}
                      {dbStats.top_tables && dbStats.top_tables.length > 0 && (
                        <div>
                          <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Top Tables by Size</div>
                          <div className="space-y-2">
                            {dbStats.top_tables.map(t => {
                              const barPct = (t.size_bytes / maxTableBytes) * 100
                              return (
                                <div key={t.table_name}>
                                  <div className="flex items-center justify-between text-xs mb-1">
                                    <span className="font-mono text-gray-700">{t.table_name}</span>
                                    <div className="flex items-center gap-3 text-gray-400">
                                      <span>{fmt(t.row_count)} rows</span>
                                      <span className="font-semibold text-gray-600 w-16 text-right">{t.size}</span>
                                    </div>
                                  </div>
                                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                    <div
                                      className="h-full bg-blue-400 rounded-full"
                                      style={{ width: `${barPct}%` }}
                                    />
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-400">Run get_db_stats() function in Supabase to enable this section.</p>
                  )}
                </section>

                {/* ── Pipeline Heartbeats ── */}
                {cronJobs.length > 0 && (
                  <section>
                    <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">
                      📋 Pipeline Heartbeats
                    </h3>
                    <div className="space-y-2">
                      {cronJobs.map((j, i) => (
                        <div key={i} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                          <div className="flex items-center gap-2">
                            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${j.skipped ? 'bg-gray-300' : j.ok ? 'bg-emerald-500' : 'bg-red-500'}`} />
                            <span className="text-sm text-gray-700">{j.label}</span>
                          </div>
                          <span className={`text-xs font-mono ${j.skipped ? 'text-gray-400 italic' : j.ok ? 'text-gray-400' : 'text-red-600 font-semibold'}`}>
                            {j.skipped ? 'Weekend — skipped' : ageLabel(j.age_secs)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {/* ── Railway Listener ── */}
                {railway && (
                  <section>
                    <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">
                      🛤 Railway Listener
                    </h3>
                    <div className={`rounded-xl px-4 py-3 flex items-center gap-3 ${railway.ok ? 'bg-emerald-50 border border-emerald-100' : 'bg-red-50 border border-red-100'}`}>
                      <span className={`w-3 h-3 rounded-full flex-shrink-0 ${railway.ok ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
                      <div>
                        <div className={`text-sm font-semibold ${railway.ok ? 'text-emerald-700' : 'text-red-700'}`}>
                          {railway.ok ? 'Online' : 'Offline / Stale heartbeat'}
                        </div>
                        <div className="text-xs text-gray-400 mt-0.5">
                          Last heartbeat {ageLabel(railway.age_secs)} · onboarding · index · stock · filing watchers
                        </div>
                      </div>
                    </div>
                  </section>
                )}

              </div>
            </div>
          </div>
        </>
      )}
    </>
  )
}
