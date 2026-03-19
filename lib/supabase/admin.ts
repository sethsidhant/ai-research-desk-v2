import { createClient } from '@supabase/supabase-js'

// Service role client — only for Node.js agents (server-side only, never expose to browser)
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}
