import type { useTestAccount } from '../../lib/useTestAccount'

export function TestAccount({ account }: { account: ReturnType<typeof useTestAccount> }) {
  return <details className="test-account-settings">
    <summary>Dedicated test account {account.saved ? '/ saved' : '/ optional'}</summary>
    <p className="muted small">Use a dedicated account for this website. Credentials are stored separately in an encrypted vault and are never loaded back into this editor. Replacing them pauses monitoring and requires fresh verification.</p>
    {account.loading ? <p className="muted small">Checking saved account...</p> : <>
      {account.unavailable && <p className="notice error">Test-account storage is currently unavailable.</p>}
      <div className="editor-grid">
        <label>Test email or username<input autoComplete="off" maxLength={500} value={account.username} disabled={account.remove} onChange={event => account.setUsername(event.target.value)} placeholder={account.saved ? 'Leave blank to keep the saved account' : 'monitor@example.com'} /></label>
        <label>Test password<input type="password" autoComplete="new-password" maxLength={4096} value={account.password} disabled={account.remove} onChange={event => account.setPassword(event.target.value)} placeholder={account.saved ? 'Leave blank to keep the saved password' : 'Dedicated test password'} /></label>
      </div>
      {account.saved && <label className="flow-permission"><input type="checkbox" checked={account.remove} onChange={event => account.setRemove(event.target.checked)} />Remove the saved test account when saving</label>}
      <p className="muted small">Choose “Test username” and “Test password” as the value source in the corresponding fill steps. HTTPS and the same website origin are required. For these runs, raw diagnostics and screenshots are disabled; step outcomes remain visible.</p>
    </>}
  </details>
}
