import { inventory, locatorsFor } from './assistant.mjs';
import { assertPublic } from './api.mjs';
import { toLocator } from './locators.mjs';
export async function searchSelectors(browser, {siteUrl, pageUrl, description}) {
  const url = new URL(pageUrl || siteUrl, siteUrl);
  if (url.origin !== new URL(siteUrl).origin) throw new Error('Choose a page on the configured site.');
  await assertPublic(url);
  const context = await browser.newContext({serviceWorkers:'block'});
  try {
    await context.route('**/*', async route => {
      if (!['GET','HEAD'].includes(route.request().method())) return route.abort();
      try { await assertPublic(new URL(route.request().url())); } catch { return route.abort(); }
      return route.continue();
    });
    await context.routeWebSocket('**/*', socket => socket.close());
    const page = await context.newPage();
    await page.goto(url.href,{waitUntil:'domcontentloaded',timeout:30000});
    await page.waitForTimeout(1000);
    const words=description.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(w=>w.length>2 && !['the','with','button','field','element','use','instead','this','that','buton','camp','selector'].includes(w));
    const elements=await inventory(page);
    const matches=elements.map(e=>({e,score:words.filter(w=>`${e.name} ${e.label} ${e.placeholder} ${e.css}`.toLowerCase().includes(w)).length})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score);
    const options=[];
    for(const {e} of matches) for(const locator of locatorsFor(e)) {
      try { const target=toLocator(page,{...locator,exact:true}); if(await target.count()===1 && await target.isVisible()) options.push({...locator,exact:true,strict:true}); } catch {}
      if(options.length>=6)break;
    }
    const unique=[...new Map(options.map(l=>[JSON.stringify(l),l])).values()].slice(0,6);
    return {reply:unique.length ? 'Fresh page inspection found these unique targets. Review before applying.' : 'No unique matching target was visible on this page. If it appears only after login or a click, inspect that state manually; this search does not replay prior steps.',draft:unique.length?{name:'Live selector search',steps:unique.map(l=>({action:'expect_visible',locators:[l],value:null}))}:null,verified:false};
  } finally {await context.close()}
}
