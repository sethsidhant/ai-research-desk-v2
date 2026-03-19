// Classification badge — matches V1 valuation labels
const BADGE_STYLES: Record<string, string> = {
  'Undervalued':   'bg-green-50 text-green-700 border border-green-200',
  'Fairly Valued': 'bg-gray-100 text-gray-600 border border-gray-200',
  'Overvalued':    'bg-red-50 text-red-600 border border-red-200',
  'High Quality':  'bg-blue-50 text-blue-700 border border-blue-200',
  'Speculative':   'bg-amber-50 text-amber-700 border border-amber-200',
}

export default function ClassificationBadge({ value }: { value: string | null }) {
  if (!value) return <span className="text-gray-400">—</span>
  const style = BADGE_STYLES[value] ?? 'bg-gray-100 text-gray-500 border border-gray-200'
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${style}`}>
      {value}
    </span>
  )
}

// Valuation band derived from PE deviation % — matches V1 logic
export function getValuationBand(peDeviation: number | null): { label: string; style: string } | null {
  if (peDeviation == null) return null
  if (peDeviation < -30) return { label: 'Cheap',     style: 'bg-green-50 text-green-700 border border-green-200' }
  if (peDeviation < -10) return { label: 'Discount',  style: 'bg-emerald-50 text-emerald-700 border border-emerald-200' }
  if (peDeviation <= 10) return { label: 'Fair',      style: 'bg-gray-100 text-gray-600 border border-gray-200' }
  if (peDeviation <= 30) return { label: 'Premium',   style: 'bg-amber-50 text-amber-700 border border-amber-200' }
  return                         { label: 'Expensive', style: 'bg-red-50 text-red-600 border border-red-200' }
}

// Stock name color based on PE deviation — matches V1 stockNameColor()
export function peDeviationColor(peDeviation: number | null): string {
  if (peDeviation == null) return 'text-blue-600'
  if (peDeviation <= -50) return 'text-green-800'
  if (peDeviation <= -20) return 'text-green-600'
  if (peDeviation <    0) return 'text-green-500'
  if (peDeviation <=  20) return 'text-pink-500'
  if (peDeviation <=  50) return 'text-red-500'
  return 'text-red-700'
}
