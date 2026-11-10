export type CheckStatus = 'pass' | 'warn' | 'fail'
export type CheckGroup = 'availability' | 'performance' | 'network' | 'content' | 'text' | 'seo' | 'security' | 'compliance'
export type Verdict = 'confirmed' | 'needs_validation' | 'rejected'
export type Severity = 'high' | 'medium' | 'low' | 'hardening'

export type Check = {
  group: CheckGroup
  id: string
  label: string
  status: CheckStatus
  detail: string
  // Absent on reports saved before schema v1
  verdict?: Verdict
  severity?: Severity
  evidence?: { url: string; observed_at: string; observation: string; reproduce: string; target?: string; expected?: string; fix?: string; limitation?: string; affected?: { url: string; note: string }[]; resources?: { url?: string; message?: string; status?: number }[] }
  // Pages a site-wide check is about (only on failing checks)
  pages?: { url: string; note: string }[]
}

export type SiteMapNode = {
  url: string
  path: string
  depth: number
  parent: number | null
  status: number | null
  load_ms: number | null
  error: boolean
}

export type SiteMapData = { nodes: SiteMapNode[]; edges: [number, number][] }

export type Architecture = {
  server: string | null
  powered_by: string | null
  cdn: string[]
  services: { name: string; category: string }[]
  third_parties: { host: string; requests: number }[]
  apis: { url: string; first_party: boolean }[]
  forms: { kind: string; method: string; action: string; fields: number; page: string; pages: number; insecure: boolean }[]
  cookies: { name: string; domain: string; first_party: boolean; secure: boolean; http_only: boolean; same_site: string; session: boolean }[]
}

export type NetworkResult = {
  runs?: number
  successful_runs?: number
  lcp_element?: { tag: string; id: string | null; resource: string | null } | null
  id: string
  label: string
  fcp_ms?: number | null
  lcp_ms?: number | null
  load_ms?: number | null
  bytes?: number
  error?: boolean
}

export type FlowCandidate = { kind: string; name: string; entry_url: string; target_url: string; target_name?: string; entry_action?: { role: string; name: string }; evidence: string; expected: string; state: 'possible'; control_kind?: string; suggested_steps?: string[]; discovery_strength?: 'control_observed' | 'link_only'; observed_controls?: { evidence: string; fields: { tag: string; type: string; name: string; label: string; required: boolean }[]; buttons?: string[] } | null; public_run?: { scope: string; limitation: string; steps: { action: string; target_label?: string; requested_url: string; url: string; title?: string; http_status?: number | null; duration_ms: number; observed_at: string; screenshot?: string; result: string; detail?: string; fields?: { tag: string; type: string; name: string; label: string; required: boolean }[]; buttons?: string[]; error?: string }[] } }

export type Overview = {
  flow_candidates?: FlowCandidate[]
  flow_discovery_at?: string
  discovery_only?: boolean
  audit_requested?: boolean
  stage?: 'initial'
  methodology?: string
  network?: NetworkResult[]
  blocked: boolean
  partial?: boolean
  status?: number
  title: string
  description?: string
  icon?: string | null
  final_url: string
  platforms: string[]
  type: string | null
  score: number | null
  pages_checked: number
  load_ms?: number | null
  checks: Check[]
  issues: {
    broken_links?: { url: string; status: number; pages: number }[]
    broken_images?: { url: string; status: number; pages: number }[]
    js_errors?: { message: string; pages: number }[]
    slow_pages?: { url: string; load_ms: number }[]
  }
  map?: SiteMapData | null
  architecture?: Architecture | null
}

export type JobStatus = 'pending' | 'scanning' | 'done' | 'error'
export type SuggestStatus = 'idle' | 'pending' | 'running' | 'done' | 'error'

export type Site = {
  id: string
  url: string
  name: string | null
  verify_token: string
  verified_at: string | null
  scan_status: JobStatus
  scan_error: string | null
  scanned_at: string | null
  overview: Overview | null
  suggest_status: SuggestStatus
  suggest_error: string | null
  suggest_url?: string | null
  pages_status?: 'idle' | 'pending' | 'running' | 'done' | 'error'
  created_at: string
}

export type PageMetrics = {
  load_ms: number | null
  ttfb: number | null
  lcp: number | null
  cls: number | null
  bytes: number
  requests: number
}

export type DeepVerdict = { ok: boolean | null; message?: string }

export type PageDeep = {
  network: NetworkResult[]
  mobile: DeepVerdict
  load: DeepVerdict
  shots: { desktop?: string; mobile?: string; mobile_issue?: string; load_issue?: string }
  analyzed_at: string
}

export type PageCheck = {
  id: string
  url: string
  http_status: number | null
  load_ms: number | null
  error: string | null
  status: 'pending' | 'done' | 'error'
  analysis_error: string | null
  score: number | null
  metrics: PageMetrics | null
  checks: Check[]
  deep_status: 'idle' | 'pending' | 'running' | 'done' | 'error'
  deep: PageDeep | null
  deep_error: string | null
}

export type TestKind = 'page_load' | 'click' | 'form' | 'health' | 'search' | 'interaction' | 'content'
export type TestStatus = 'proposed' | 'approved' | 'paused'

export type Locator = { type: string; role?: string; name?: string; value?: string }

export type TestStep = {
  position: number
  action: string
  locators: Locator[]
  value: string | null
  note?: string | null
}

export type Test = {
  id: string
  site_id: string
  name: string
  kind: TestKind
  status: TestStatus
  enabled: boolean
  frequency_minutes: number
  essential_key?: string | null
  page_url?: string | null
  steps: TestStep[]
}

export type RunStatus = 'queued' | 'running' | 'passed' | 'failed' | 'error'

export type Run = {
  id: string
  test_id: string
  status: RunStatus
  failure_kind: string | null
  error: string | null
  failed_step: number | null
  screenshot_path: string | null
  duration_ms: number | null
  created_at: string
  test: { name: string }
  debug?: RunDebug | null
}

export type RunDebug = {
  credential_protected?: boolean
  step_trace?: { position: number; action: string; target: string; value?: string | null; status: string; url: string; duration_ms: number; error?: string }[]
  outcome?: 'passed' | 'confirmed' | 'inconclusive' | 'blocked' | 'maintenance'
  attempts?: {
    number: number
    started_at: string
    finished_at: string
    kind: string | null
    failed_step: number | null
    error: string | null
    passed: boolean
    screenshot_path: string | null
    screenshot_available: boolean
    debug: RunDebug | null
  }[]
  url: string
  title: string | null
  viewport: { width: number; height: number } | null
  user_agent: string | null
  console: { level: string; text: string; source: string | null }[]
  page_errors: { message: string; stack: string | null }[]
  network: { method: string; url: string; status: number; type: string; error?: string | null }[]
  captured_at: string
}
