export type ApiMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD'
export type ApiRuleOp = 'exists' | 'not_exists' | '==' | '!=' | '>' | '>=' | '<' | '<=' | 'contains' | 'text_contains'
export type ApiRule = { path: string; op: ApiRuleOp; value: string }
export type ApiHeader = { name: string; value: string }
export type ApiStatus = 'passed' | 'failed' | 'error'

export type ApiMonitor = {
  id: string
  name: string
  url: string
  method: ApiMethod
  headers: ApiHeader[]
  body: string | null
  expected_status: number
  max_ms: number
  rules: ApiRule[]
  frequency_minutes: number
  enabled: boolean
  run_requested: boolean
  last_status: ApiStatus | null
  last_checked_at: string | null
  created_at: string
}

export type ApiCheck = {
  id: string
  monitor_id: string
  status: ApiStatus
  http_status: number | null
  duration_ms: number | null
  error: string | null
  failures: { kind: string; message: string; rule?: ApiRule }[]
  response_sample: string | null
  created_at: string
}
