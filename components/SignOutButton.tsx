'use client'

import { signOut } from '@/app/actions'

export default function SignOutButton() {
  return (
    <form action={signOut}>
      <button
        type="submit"
        className="text-sm text-gray-500 hover:text-gray-900 transition-colors px-3 py-1.5 rounded-lg hover:bg-gray-100"
      >
        Sign out
      </button>
    </form>
  )
}
