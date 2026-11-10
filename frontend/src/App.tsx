import { useEffect, useRef } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import { useSession } from './lib/useSession'
import { supabase } from './lib/supabase'
import { pendingSite, planChanged } from './lib/plan'
import { Layout } from './components/Layout'
import { Landing } from './pages/Landing'
import { PublicReport } from './pages/PublicReport'
import { Login } from './pages/Login'
import { Sites } from './pages/Sites'
import { SiteDetail } from './pages/SiteDetail'
import { ComingSoon } from './pages/ComingSoon'

export default function App() {
  const session = useSession()

  if (session === undefined) return null

  if (!session) {
    return (
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/check/:token" element={<PublicReport />} />
          <Route path="/login" element={<Login mode="signin" />} />
          <Route path="/signup" element={<Login mode="signup" />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    )
  }

  return (
    <BrowserRouter>
      <AddPendingSite />
      <Layout email={session.user.email}>
        <Routes>
          <Route path="/" element={<Sites />} />
          <Route path="/sites/:id" element={<SiteDetail />} />
          <Route path="/api" element={<ComingSoon module="api" />} />
          <Route path="/flowfix" element={<ComingSoon module="flowfix" />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  )
}

// The site typed on the landing page is added right after sign-up / sign-in
function AddPendingSite() {
  const navigate = useNavigate()
  const done = useRef(false)
  useEffect(() => {
    const url = pendingSite.get()
    if (!url || done.current) return
    done.current = true
    pendingSite.clear()
    supabase.from('sites').insert({ url, name: new URL(url).host }).select('id').single().then(({ data }) => {
      planChanged()
      // Over the plan limit: just land on the sites list, which explains the limit
      if (data) navigate(`/sites/${data.id}`)
    })
  }, [navigate])
  return null
}
