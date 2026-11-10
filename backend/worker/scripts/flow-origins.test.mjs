import test from 'node:test';
import assert from 'node:assert/strict';
import { approvedOrigins } from '../src/flow-origins.mjs';
import { chromium } from 'playwright';
import { runSteps } from '../src/runner.mjs';
test('credential destinations require explicit exact HTTPS approval',()=>{
 assert.deepEqual([...approvedOrigins([{action:'goto',locators:[{type:'flow_config',allowed_origins:['https://account.example.com']}]}],'https://example.com/')],['https://example.com','https://account.example.com']);
 assert.throws(()=>approvedOrigins([{action:'goto',locators:[{type:'flow_config',allowed_origins:['http://evil.test']}]}],'https://example.com/'));
});
test('credentials never fill on an unapproved origin',async()=>{
 const b=await chromium.launch();try{const p=await b.newPage();await p.setContent('<label>Email<input></label>');await assert.rejects(runSteps(p,[{position:1,action:'fill',credential:true,locators:[{type:'label',value:'Email'}],value:'secret'}],'https://example.com/'),/configured site origin/);assert.equal(await p.locator('input').inputValue(),'');}finally{await b.close()}
});
