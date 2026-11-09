import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'

export type Plan = {
  id: string
  label: string
  max_sites: number
  sites: number
  max_ai_tests: number
  ai_tests: number
  api_guardian: boolean
}

const EVENT = 'fg-plan-changed'
// The owner plan uses huge caps instead of NULL so limits stay simple comparisons
export const unlimited = (max: number) => max >= 100_000
// Call after adding/removing a site or saving an AI test so every badge updates
export const planChanged = () => window.dispatchEvent(new Event(EVENT))

export function usePlan() {
  const [plan, setPlan] = useState<Plan | null>(null)
  const load = useCallback(async () => {
    const { data } = await supabase.rpc('my_plan')
    if (data) setPlan(data as Plan)
  }, [])
  useEffect(() => {
    load()
    window.addEventListener(EVENT, load)
    return () => window.removeEventListener(EVENT, load)
  }, [load])
  return plan
}

// The landing page form remembers the site until the visitor has an account
const PENDING_KEY = 'fg_pending_site'
export const pendingSite = {
  get: () => localStorage.getItem(PENDING_KEY),
  set: (url: string) => localStorage.setItem(PENDING_KEY, url),
  clear: () => localStorage.removeItem(PENDING_KEY),
}

export function normalizeUrl(input: string): URL | null {
  const trimmed = input.trim()
  try {
    const u = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`)
    return u.hostname.includes('.') ? u : null
  } catch {
    return null
  }
}
