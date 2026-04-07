import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import AppShell from '@/components/AppShell'
import NriResearchClient from './NriResearchClient'

export default async function NriResearchPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const isAdmin = user.email === process.env.ADMIN_EMAIL

  return (
    <AppShell userEmail={user.email!} isAdmin={isAdmin}>
      <NriResearchClient />
    </AppShell>
  )
}
