'use client'

import { useState } from 'react'
import FiiFlowChart from './FiiFlowChart'
import DailyFlowChart from './DailyFlowChart'
import MFFlowChart from './MFFlowChart'
import SectorGrid from './SectorGrid'
import ForexChart from './ForexChart'
import IndustriesGrid from './IndustriesGrid'

const TABS = [
  { id: 'flows',      label: 'FII · DII · MF Flows' },
  { id: 'forex',      label: 'Forex Reserves' },
  { id: 'industries', label: 'Industry Overview' },
]

type Props = {
  fiiFlow:       any[]
  fiiDii:        any[]
  sectors:       any[]
  mfData:        any[]
  forexData:     any[]
  industries:    any[]
  userStocks:    any[]
  lastUpdated:   string | null
}

export default function MarketPulseTabs({
  fiiFlow, fiiDii, sectors, mfData, forexData, industries, userStocks, lastUpdated,
}: Props) {
  const [activeTab, setActiveTab] = useState('flows')

  const userIndustries = [...new Set(userStocks.map((s: any) => s.industry).filter(Boolean))]
  const industriesUpdatedAt = industries[0]?.updated_at ?? null

  return (
    <>
      {/* Tab bar */}
      <div className="flex gap-1 mb-5 border-b border-gray-100">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
              activeTab === tab.id
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* FII / DII / MF */}
      {activeTab === 'flows' && (
        <div className="space-y-5">
          {fiiFlow.length === 0 ? (
            <div className="artha-card p-8 text-center text-sm" style={{ color: 'var(--artha-text-muted)' }}>
              No FII flow data yet — run <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs">node seedFiiHistory.js</code> to backfill.
            </div>
          ) : (
            <FiiFlowChart data={fiiFlow} dailyNet={fiiDii} />
          )}
          {fiiDii.length > 0 && <DailyFlowChart data={fiiDii} />}
          {mfData.length > 0 && <MFFlowChart data={mfData} />}
          {sectors.length > 0 ? (
            <SectorGrid sectors={sectors} userStocks={userStocks} />
          ) : (
            <div className="artha-card p-8 text-center text-sm" style={{ color: 'var(--artha-text-muted)' }}>
              No sector data yet — will populate after first FII Data Refresh run.
            </div>
          )}
        </div>
      )}

      {/* Forex Reserves */}
      {activeTab === 'forex' && (
        forexData.length === 0 ? (
          <div className="artha-card p-8 text-center text-sm" style={{ color: 'var(--artha-text-muted)' }}>
            No forex reserve data yet — run <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs">node forexAgent.js backfill</code> to populate.
          </div>
        ) : (
          <ForexChart data={forexData} fiiDii={fiiDii} />
        )
      )}

      {/* Industry Overview */}
      {activeTab === 'industries' && (
        industries.length === 0 ? (
          <div className="artha-card p-8 text-center text-sm" style={{ color: 'var(--artha-text-muted)' }}>
            No industry data yet — run <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs">node screenerMarketAgent.js</code> to populate.
          </div>
        ) : (
          <IndustriesGrid data={industries} userIndustries={userIndustries} updatedAt={industriesUpdatedAt} />
        )
      )}
    </>
  )
}
