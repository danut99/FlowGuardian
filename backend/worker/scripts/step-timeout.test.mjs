import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { runSteps, stepTimeout } from '../src/runner.mjs';
test('timeout metadata preserves defaults and enforces bounds',()=>{
 assert.equal(stepTimeout({action:'goto'}),30000);
 assert.equal(stepTimeout({action:'expect_text',note:'Timeout v1|40000|note'}),40000);
 assert.equal(stepTimeout({action:'click',note:'Timeout v1|999999|'}),10000);
 assert.equal(stepTimeout({action:'goto',note:'Flow v1|date|Timeout v1|45000|goal'}),45000);
});
test('wait exits early on success and uses configured timeout on missing result',async()=>{
 const browser=await chromium.launch();try{
 const page=await browser.newPage();await page.setContent('<div id="result"></div><script>setTimeout(()=>document.querySelector("#result").textContent="Ready",250)</script>');
 const start=Date.now();await runSteps(page,[{position:1,action:'expect_text',locators:[],value:'Ready',note:'Timeout v1|5000|'}],'https://example.test/');assert.ok(Date.now()-start<3000);
 const missing=Date.now();await assert.rejects(runSteps(page,[{position:1,action:'expect_text',locators:[],value:'Missing',note:'Timeout v1|1000|'}],'https://example.test/'));assert.ok(Date.now()-missing<3000);
 }finally{await browser.close()}
});
