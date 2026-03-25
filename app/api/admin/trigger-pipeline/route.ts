import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const adminEmail = process.env.ADMIN_EMAIL
  if (adminEmail && user.email !== adminEmail) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const pat  = process.env.GITHUB_PAT
  const repo = process.env.GITHUB_REPO
  if (!pat || !repo) {
    return NextResponse.json({ error: 'GITHUB_PAT or GITHUB_REPO not set in env' }, { status: 500 })
  }

  const res = await fetch(
    `https://api.github.com/repos/${repo}/actions/workflows/daily-pipeline.yml/dispatches`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${pat}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ref: 'master' }),
    }
  )

  if (!res.ok) {
    const text = await res.text()
    return NextResponse.json({ error: `GitHub API ${res.status}: ${text}` }, { status: 502 })
  }

  return NextResponse.json({ ok: true })
}
