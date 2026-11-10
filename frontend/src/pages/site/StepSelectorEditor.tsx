import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { Locator, Site } from '../../types'

export function StepSelectorEditor({site, action, current, onApply}: {site: Site; action: string; current?: Locator; onApply: (locator: Locator) => void}) {
  const [open, setOpen] = useState(false)
  const [description, setDescription] = useState('')
  const [notice, setNotice] = useState('')
  const [proposal, setProposal] = useState<Locator | null>(null)
  const [request, setRequest] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const options: Locator[] = []
  for (const c of site.overview?.flow_candidates ?? []) {
    if (!['fill', 'press'].includes(action)) {
      if (c.entry_action) options.push({type:'role',role:c.entry_action.role,name:c.entry_action.name})
      for (const name of c.observed_controls?.buttons ?? []) options.push({type:'role',role:'button',name})
    }
    for (const f of c.observed_controls?.fields ?? []) if (f.label) options.push({type:'label',value:f.label})
  }
  const unique = [...new Map(options.map(l => [JSON.stringify(l),l])).values()]
  const terms = description.toLowerCase().split(/\s+/).filter(t => t.length > 2)
  const suggested = [...unique].sort((a,b) => terms.filter(t => (b.name ?? b.value ?? '').toLowerCase().includes(t)).length - terms.filter(t => (a.name ?? a.value ?? '').toLowerCase().includes(t)).length).slice(0,8)
  useEffect(() => {
    if (!request) return
    let cancelled = false, checking = false
    const started = Date.now()
    const poll = async () => {
      if (checking) return
      checking = true
      try {
        const {data,error} = await supabase.from('ai_requests').select('status,reply,draft,error').eq('id',request).single()
        if (cancelled) return
        if (error || data.status === 'error') { setNotice(error?.message || data?.error || 'Suggestion unavailable.'); setRequest(null); return }
        if (data.status === 'done') { setRequest(null); setNotice(data.reply || 'Review the proposed selector.'); setProposal(data.draft?.steps?.[0]?.locators?.[0] ?? null) }
        else if (Date.now()-started > 180000) { setRequest(null); setNotice('The request is taking too long. No selector was changed.') }
      } catch { if (!cancelled) { setRequest(null); setNotice('Could not read the suggestion. No selector was changed.') } }
      finally {checking=false}
    }
    poll(); const timer=window.setInterval(poll,2500)
    return () => {cancelled=true;window.clearInterval(timer)}
  },[request])
  async function askAi() {
    if (!description.trim()) {setNotice('Describe the field or button you mean.');return}
    setSending(true);setProposal(null)
    try {
      const {data,error}=await supabase.rpc('ask_ai',{sid:site.id,purl:null,msg:'[SELECTOR_DRAFT]'+JSON.stringify({action,current,description:description.trim()})})
      if(error)setNotice(error.message);else {setRequest(data);setNotice('Preparing one selector suggestion. No steps are executed.')}
    } catch {setNotice('Could not request a suggestion.')}
    finally {setSending(false)}
  }
  return <div className="step-selector-helper"><button type="button" className="btn ghost sm" aria-expanded={open} onClick={()=>setOpen(!open)}>Edit selector</button>{open && <div className="step-selector-panel"><label>What is wrong with this target?<textarea rows={2} maxLength={700} value={description} onChange={e=>{setDescription(e.target.value);setProposal(null)}} placeholder='For example: use the Sign in button, not Continue playing.' /></label><p className="muted small">Choose a target recorded by Playwright. These suggestions are from discovery, not a fresh replay of this step.</p><div className="actions">{suggested.map(l=><button type="button" className="btn ghost sm" key={JSON.stringify(l)} onClick={()=>{setProposal(l);setNotice('Recorded target selected. Review it before applying.')}}>{l.name || l.value}</button>)}</div>{!suggested.length && <p className="muted small">No recorded targets are available. Discover the site again or edit the selector manually.</p>}<button type="button" className="btn ghost sm" disabled={sending || !!request} onClick={askAi}>{sending || request ? 'Preparing suggestion...' : 'Ask AI for this selector'}</button><p className="muted small">AI receives your description and detected controls, without test-account credentials.</p>{notice && <p role="status">{notice}</p>}{proposal && <div className="notice"><code>{proposal.type}: {proposal.role ? proposal.role + ' / ' : ''}{proposal.name || proposal.value}</code><p>Only this selector will change. The action, entered value and other steps stay as configured.</p><button type="button" className="btn sm" onClick={()=>{onApply(proposal);setProposal(null);setNotice('Selector updated in this draft. Save and verify to check it.')}}>Apply to this step</button></div>}</div>}</div>
}
