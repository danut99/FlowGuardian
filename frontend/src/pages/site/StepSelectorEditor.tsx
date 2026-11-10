import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { Locator, Site } from '../../types'

export function StepSelectorEditor({site, pageUrl, action, current, onApply}: {site: Site; pageUrl?: string; action: string; current?: Locator; onApply: (locator: Locator) => void}) {
  const [open, setOpen] = useState(false)
  const [description, setDescription] = useState('')
  const [notice, setNotice] = useState('')
  const [proposal, setProposal] = useState<Locator | null>(null)
  const [request, setRequest] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [suggestions, setSuggestions] = useState<Locator[]>([])
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
        if (data.status === 'done') { setRequest(null); setNotice(data.reply || 'Review the proposed selector.'); setSuggestions(data.draft?.steps?.map((s: {locators: Locator[]}) => s.locators[0]).filter(Boolean) ?? []) }
        else if (Date.now()-started > 180000) { setRequest(null); setNotice('The request is taking too long. No selector was changed.') }
      } catch { if (!cancelled) { setRequest(null); setNotice('Could not read the suggestion. No selector was changed.') } }
      finally {checking=false}
    }
    poll(); const timer=window.setInterval(poll,2500)
    return () => {cancelled=true;window.clearInterval(timer)}
  },[request])
  async function requestSuggestion(ai = false) {
    if (!description.trim()) {setNotice('Describe the field or button you mean.');return}
    setSending(true);setProposal(null);setSuggestions([])
    try {
      const {data,error}=await supabase.rpc('ask_ai',{sid:site.id,purl:pageUrl || site.url,msg:ai ? '[SELECTOR_DRAFT]'+JSON.stringify({action,current,description:description.trim()}) : '[SELECTOR_SEARCH]'+JSON.stringify({pageUrl:new URL(pageUrl || site.url,site.url).href,description:description.trim()})})
      if(error)setNotice(error.message);else {setRequest(data);setNotice('Preparing one selector suggestion. No steps are executed.')}
    } catch {setNotice('Could not request a suggestion.')}
    finally {setSending(false)}
  }
  return <div className="step-selector-helper"><button type="button" className="btn ghost sm" aria-expanded={open} onClick={()=>setOpen(!open)}>Edit selector</button>{open && <div className="step-selector-panel"><label>What is wrong with this target?<textarea rows={2} maxLength={700} value={description} onChange={e=>{setDescription(e.target.value);setProposal(null);setSuggestions([])}} placeholder='For example: use the Sign in button, not Continue playing.' /></label><p className="muted small">Search opens the configured page and inspects its current document. It does not replay earlier steps or sign in.</p><div className="actions"><button type="button" className="btn sm" disabled={sending || !!request} onClick={()=>requestSuggestion(false)}>Find element</button><button type="button" className="btn ghost sm" disabled={sending || !!request} onClick={()=>requestSuggestion(true)}>Ask AI for this selector</button></div><div className="actions">{suggestions.map(l=><button type="button" className="btn ghost sm" key={JSON.stringify(l)} onClick={()=>setProposal(l)}>{l.type}: {l.name || l.value}</button>)}</div><p className="muted small">AI receives your description and detected controls, without test-account credentials.</p>{notice && <p role="status">{notice}</p>}{proposal && <div className="notice"><code>{proposal.type}: {proposal.role ? proposal.role + ' / ' : ''}{proposal.name || proposal.value}</code><p>Only this selector will change. The action, entered value and other steps stay as configured.</p><button type="button" className="btn sm" onClick={()=>{onApply(proposal);setProposal(null);setNotice('Selector updated in this draft. Save and verify to check it.')}}>Apply to this step</button></div>}</div>}</div>
}
