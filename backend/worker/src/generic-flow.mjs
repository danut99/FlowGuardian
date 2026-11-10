import { inventory, locatorsFor } from './assistant.mjs';
import { toLocator } from './locators.mjs';
import { assertPublic } from './api.mjs';
const normalize = text => String(text ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
export function matchElement(elements, clause) {
  const text = normalize(clause);
  const quoted = [...clause.matchAll(/["“]([^"”]+)["”]/g)].map(m=>normalize(m[1]));
  const matches = elements.filter(e => e.role !== 'group' && [e.name,e.label,e.placeholder].some(value=>{
    const name=normalize(value);return name && (quoted.length ? quoted.includes(name) : new RegExp('(?:^| )'+name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?: |$)').test(text));
  }));
  const unique=[...new Map(matches.map(e=>[JSON.stringify(locatorsFor(e)[0]),e])).values()];
  const longest=Math.max(0,...unique.map(e=>normalize(e.name || e.label || e.placeholder).length));
  return unique.filter(e=>normalize(e.name || e.label || e.placeholder).length===longest);
}
export async function proposeGenericFlow(browser,{siteUrl,prompt,expected='',query=''}, {validateUrl=assertPublic}={}) {
  const context=await browser.newContext({serviceWorkers:'block'});
  const steps=[];
  const question=reply=>({reply,draft:null,verified:false});
  try {
    await context.routeWebSocket('**/*',socket=>socket.close());
    await context.route('**/*',async route=>{
      if(!['GET','HEAD'].includes(route.request().method()))return route.abort();
      try{await validateUrl(new URL(route.request().url()))}catch{return route.abort()}
      return route.continue();
    });
    const page=await context.newPage();await validateUrl(new URL(siteUrl));
    await page.goto(siteUrl,{waitUntil:'domcontentloaded',timeout:30000});await page.waitForTimeout(800);
    await page.addInitScript(()=>document.addEventListener('submit',e=>{e.preventDefault();e.stopImmediatePropagation()},true));
    await page.evaluate(()=>document.addEventListener('submit',e=>{e.preventDefault();e.stopImmediatePropagation()},true));
    steps.push({action:'goto',locators:[],value:siteUrl});
    const clauses=prompt.split(/(?:\n|[.;]|\bthen\b|\band\b|\bapoi\b|\bsi\b|\bși\b)/i).map(s=>s.trim()).filter(Boolean);
    let previous=null;
    for(const clause of clauses) {
      const text=normalize(clause);
      if(/^(on |open |start |porneste |deschide )?(the )?(home page|homepage|main page|pagina principala)$/.test(text))continue;
      const click=/\b(click|press|apas|apasa|follow)\b/.test(text);
      const fill=/\b(type|enter|fill|scrie|completeaza)\b/.test(text);
      const check=/\b(check|verify|visible|display|displayed|appear|required|verifica|vizibil|obligatoriu)\b/.test(text);
      const locate=/\b(find|locate|cauta|gaseste)\b/.test(text);
      if(!click&&!fill&&!check&&!locate) return question(`Clarify this part: "${clause}". Specify an action and the exact visible element name, or use AI assistance.`);
      let matches=matchElement(await inventory(page),clause);
      if(!matches.length && /\b(it|him|that|acesta)\b/.test(text) && previous)matches=[previous];
      if(matches.length!==1)return question(`${matches.length ? 'More than one target matches' : 'No visible target matches'} "${clause}". Use its exact label in quotes. No partial flow was saved.`);
      const element=matches[0];const locator=locatorsFor(element)[0];
      if(!locator)return question(`No reliable selector for "${element.name}".`);
      const target=toLocator(page,{...locator,exact:true});
      if(await target.count()!==1 || !await target.isVisible())return question(`"${element.name}" is not unique in this page state. Specify a more precise target.`);
      if(fill) {
        const values=[...clause.matchAll(/["“]([^"”]+)["”]/g)].map(m=>m[1]).filter(v=>normalize(v)!==normalize(element.name));
        const value=element.password?'{{test.password}}':/test (account|username)|cont.*test/i.test(clause)?'{{test.username}}':values[0]||query;
        if(!value)return question(`What test value should be entered in "${element.name}"? Keep credentials in Test account.`);
        steps.push({action:'fill',locators:[locator],value});
        if(value.startsWith('{{test.'))return question('Credential entry requires a reviewed login draft. Use AI assistance or the manual editor; this discovery does not enter saved credentials.');
        await target.fill(value);await page.waitForTimeout(500);
      } else if(click) {
        if(element.submits || /buy|pay|delete|remove|subscribe|logout|sign out|send|register/i.test(element.name))return question(`"${element.name}" may submit or change data. Add this action in the manual editor and review it before verification.`);
        steps.push({action:'click',locators:[locator],value:null});
        const before=page.url();await target.click({timeout:7000});await page.waitForTimeout(900);
        if(page.url()!==before){const u=new URL(page.url());steps.push({action:'expect_url',locators:[],value:u.origin+u.pathname});}
      } else {
        steps.push({action:'expect_visible',locators:[locator],value:null});
        if(/required|obligator/.test(text)) {
          const css=await target.evaluate(el=>el.id?'#'+CSS.escape(el.id):el.getAttribute('name')?'[name='+JSON.stringify(el.getAttribute('name'))+']':el.tagName==='INPUT'?'input[type='+JSON.stringify(el.type)+']':null);
          if(!css)return question(`Specify a selector for checking the required state of "${element.name}".`);
          steps.push({action:'expect_visible',locators:[{type:'css',value:css+':is([required],[aria-required="true"])'}],value:null,note:'Checks required marking, not actual submission blocking.'});
        }
      }
      previous=element;
    }
    if(expected.trim())steps.push({action:'expect_text',locators:[],value:expected.trim()});
    if(steps.length<2 || !steps.at(-1).action.startsWith('expect_'))return question('What should appear after the final action? Specify its exact visible name or expected text.');
    if(steps.length>30)return question('Split this journey into fewer than 30 steps.');
    return {reply:'Draft prepared from live page elements in the requested order. Read-only exploration is not full verification; review and verify the saved flow.',draft:{name:prompt.slice(0,70),steps},verified:false};
  }finally{await context.close()}
}
