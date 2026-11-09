import { useEffect, useState } from 'react'
import { supabase } from './supabase'

// Buckets are private; a signed URL is scoped to one object and expires
export function useSignedUrl(bucket: string, path: string | null | undefined) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!path) return
    let alive = true
    supabase.storage.from(bucket).createSignedUrl(path, 3600).then(({ data }) => {
      if (alive) setUrl(data?.signedUrl ?? null)
    })
    return () => { alive = false }
  }, [bucket, path])
  return path ? url : null
}
