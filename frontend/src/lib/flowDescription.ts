import type { FlowCandidate, Locator } from '../types'

export type GeneratedStep = { action: string; locators: Locator[]; value: string | null; note?: string }
export function draftFromDescription(description: string, candidates: FlowCandidate[], expected: string, query: string): { steps?: GeneratedStep[]; question?: string } {
  const login = /\blog\s?in\b|sign\s?in|autentific|conect|contul de test/i.test(description)
  const search = /search|caut|căut/i.test(description)
  const inspectOnly = /display|visible|shown|appear|fields?|required|formular|camp|c?mp|afis|afi?/i.test(description) && !/with (the )?test account|authenticate|submit|enter credentials|completeaza|completeaz?|autentific?-te/i.test(description)
  const quote = (value: string) => '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\n\r]/g, ' ') + '"'
  if (!description.trim()) return { question: 'Describe the journey you want to check.' }
  if (login && search) return { question: 'Start with one journey: login or search. You can extend the generated steps afterward.' }

  if (!expected.trim() && !inspectOnly) return { question: login ? 'What text appears only after successful login?' : 'What exact text should appear when this journey succeeds?' }
  const matched = candidates.filter(c => [c.name, c.target_name, ...(c.observed_controls?.fields.map(f => f.label) ?? []), ...(c.observed_controls?.buttons ?? [])].some(label => label && description.toLowerCase().includes(label.toLowerCase())))
  const c = login ? candidates.find(c => c.kind === 'access' && c.observed_controls?.fields.length) ?? candidates.find(c => c.observed_controls?.fields.some(f => f.type === 'password')) : search ? candidates.find(c => c.control_kind === 'search') : matched.length === 1 ? matched[0] : candidates.find(c => c.target_name && description.toLowerCase().includes(c.target_name.toLowerCase())) ?? candidates.find(c => /contact/i.test(description) ? c.kind === 'request' : /pricing/i.test(description) ? c.kind === 'navigation' : false)
  if (!c) {
    const entry = login ? candidates.find(candidate => candidate.kind === 'access') : null
    if (entry) return {question: `Found the sign-in link: ${entry.target_url}. Its account fields were not observed on the monitored origin. Login may redirect to an account subdomain or external provider. Configure that destination as a separate site to inspect its form; do not assume the link is broken.`}
    return {question:'No matching interaction was observed. Specify the visible link or field label, or use AI assistance.'}
  }
  const wantsEntry = /home\s?page|main page|pagina principala|pagina principal?|click|apas|follow|redirect/i.test(description)
  const steps: GeneratedStep[] = [{action:'goto',locators:[],value:wantsEntry || c.entry_action ? c.entry_url : c.target_url,note:'Open the requested starting page.'}]
  if (wantsEntry || c.entry_action) {
    const entry = c.entry_action ?? (c.target_name && c.target_url !== c.entry_url ? {role:'link',name:c.target_name} : null)
    if (entry) {
      steps.push({action:'expect_visible',locators:[{type:'role',role:entry.role,name:entry.name}],value:null,note:'Locate the exact observed entry control.'})
      steps.push({action:'click',locators:[{type:'role',role:entry.role,name:entry.name}],value:null,note:'Follow the requested entry control; do not bypass it with direct navigation.'})
      if (entry.role === 'link') steps.push({action:'expect_url',locators:[],value:c.destination_origin || new URL(c.target_url).pathname,note:'Wait for the observed destination or redirect.'})
    } else if (c.target_url !== c.entry_url) return {question:'The entry control for this destination was not identified. Specify its exact visible name; we will not skip the requested click.'}
  }
  if (inspectOnly) {
    const fields = c.observed_controls?.fields ?? []
    for (const field of fields) if (field.label) steps.push({ action: 'expect_visible', locators: [{type:'label',value:field.label}], value:null })
    for (const name of c.observed_controls?.buttons ?? []) steps.push({action:'expect_visible',locators:[{type:'role',role:'button',name}],value:null})
    if (/required|obligator/i.test(description)) {
      const required = fields.filter(f => f.required)
      if (!required.length) return {question:'Discovery did not record required fields for this interaction. Specify the fields you expect to be required, or refresh discovery.'}
      for (const field of required) {
        const selector = field.name ? `[name=${quote(field.name)}]` : ['email','password','search'].includes(field.type) ? `input[type=${quote(field.type)}]` : null
        if (!selector) return {question:`Specify a selector for the required field "${field.label}" in the manual editor.`}
        steps.push({action:'expect_visible',locators:[{type:'css',value:`${selector}:is([required], [aria-required="true"])`}],value:null,note:'Checks that the field is marked required. This does not verify form validation or submission.'})
      }
    }
    if (expected.trim()) steps.push({action:'expect_text',locators:[],value:expected.trim()})
    if (steps.at(-1)?.action === 'goto' || steps.at(-1)?.action === 'click') return {question:'Which field, button or text should be visible? No matching controls were recorded.'}
    return {steps}
  }
  if (login) {
    const fields = c.observed_controls?.fields ?? []
    const user = fields.find(f => f.type === 'email') ?? fields.find(f => /user|login/i.test(f.name))
    const password = fields.find(f => f.type === 'password')
    if (!user?.label || !password?.label) return { question: 'The detected account fields need explicit labels. Configure them in the step editor.' }
    steps.push({ action: 'fill', locators: [{ type: 'label', value: user.label }], value: '{{test.username}}' }, { action: 'fill', locators: [{ type: 'label', value: password.label }], value: '{{test.password}}' }, { action: 'click', locators: [{ type: 'css', value: 'form:has(input[type="password"]) button:not([type="button"]):not([type="reset"]), form:has(input[type="password"]) input[type="submit"]' }], value: null, note: 'Submit the password form. Verification must find exactly one submit control.' })
  } else if (search) {
    if (!query.trim()) return { question: 'Which search term should we enter?' }
    const field = c.observed_controls?.fields[0]
    if (!field?.label) return { question: 'The search field has no detected label. Configure its exact target in the step editor.' }
    if (field.type !== 'search' && !field.name) return { question: 'This search input needs an explicit target. Choose its label or placeholder in the step editor.' }
    const locator: Locator = { type: 'css', value: field.type === 'search' ? 'input[type="search"]' : `input[name=${quote(field.name)}]` }
    steps.push({ action: 'fill', locators: [locator], value: query.trim() }, { action: 'press', locators: [locator], value: 'Enter', note: 'Review whether this site uses Enter to launch its search.' })
  }
  steps.push({ action: 'expect_text', locators: [], value: expected.trim(), note: 'User-selected expected text; not yet verified by execution.' })
  return { steps }
}
