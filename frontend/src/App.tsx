import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { useSession } from './lib/useSession'
import { Layout } from './components/Layout'
import { Login } from './pages/Login'
import { Sites } from './pages/Sites'
import { SiteDetail } from './pages/SiteDetail'
import { ComingSoon } from './pages/ComingSoon'
import { ApiGuardian } from './pages/ApiGuardian'

export default function App() {
  const session = useSession()

  if (session === undefined) return null
  if (!session) return <Login />

  return (
    <BrowserRouter>
      <Layout email={session.user.email}>
        <Routes>
          <Route path="/" element={<Sites />} />
          <Route path="/sites/:id" element={<SiteDetail />} />
          <Route path="/api" element={<ApiGuardian />} />
          <Route path="/flowfix" element={<ComingSoon module="flowfix" />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  )
}
