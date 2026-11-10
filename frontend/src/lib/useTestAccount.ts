import { useEffect, useState } from 'react'
import { supabase } from './supabase'

export function useTestAccount(testId?: string) {
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(Boolean(testId))
  const [unavailable, setUnavailable] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [remove, setRemove] = useState(false)
  useEffect(() => {
    if (!testId) return
    let cancelled = false
    supabase.rpc('test_credentials_status', { tid: testId }).then(({ data, error }) => {
      if (cancelled) return
      setSaved(data === true); setUnavailable(Boolean(error)); setLoading(false)
    })
    return () => { cancelled = true }
  }, [testId])
  return {
    saved, loading, unavailable, username, setUsername, password, setPassword, remove, setRemove,
    ready: !remove && (Boolean(username && password) || saved),
    async persist(id: string) {
      if (!remove && !username && !password) return
      const { error } = await supabase.rpc('set_test_credentials', {
        tid: id, test_username: remove ? null : username, test_password: remove ? null : password,
      })
      if (error) throw new Error('The test account could not be saved. The flow remains paused. Check that no run is queued or running.')
      setUsername(''); setPassword(''); setSaved(!remove); setRemove(false)
    },
  }
}

