import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import SignOutButton from '@/components/SignOutButton'
import WatchlistManager from '@/components/WatchlistManager'

export default async function WatchlistPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Only load the user's watchlisted stocks — search is handled via /api/search-stocks
  const { data: userStocks } = await supabase
    .from('user_stocks')
    .select('stock_id, rsi_oversold_threshold, rsi_overbought_threshold, dma_cross_alert, pct_from_high_threshold, new_filing_alert, stocks(id, ticker, stock_name, industry)')
    .eq('user_id', user.id)

  const stocks = (userStocks ?? []).map((ws: any) => {
    const s = Array.isArray(ws.stocks) ? ws.stocks[0] : ws.stocks
    return {
      id:          s.id,
      ticker:      s.ticker,
      stock_name:  s.stock_name,
      industry:    s.industry ?? null,
      inWatchlist: true,
      alerts: {
        rsi_oversold_threshold:   ws.rsi_oversold_threshold   ?? 30,
        rsi_overbought_threshold: ws.rsi_overbought_threshold ?? 70,
        dma_cross_alert:          ws.dma_cross_alert          ?? true,
        pct_from_high_threshold:  ws.pct_from_high_threshold  ?? -20,
        new_filing_alert:         ws.new_filing_alert         ?? true,
      },
    }
  })

  const watchlistCount = stocks.filter(s => s.inWatchlist).length

  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-gray-200 px-6 py-4 flex items-center justify-between bg-white">
        <div className="flex items-center gap-4">
          <Link href="/" className="text-gray-500 hover:text-gray-900 text-sm transition-colors">
            ← Dashboard
          </Link>
          <h1 className="text-xl font-bold text-gray-900">Manage Watchlist</h1>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-500">{user.email}</span>
          <SignOutButton />
        </div>
      </header>

      <main className="px-6 py-8 max-w-2xl mx-auto">
        <p className="text-gray-500 text-sm mb-6">
          {watchlistCount} stock{watchlistCount !== 1 ? 's' : ''} in your watchlist
        </p>
        <WatchlistManager stocks={stocks} />
      </main>
    </div>
  )
}
