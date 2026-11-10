import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {chromium} from 'playwright';
import {proposeGenericFlow,matchElement} from '../src/generic-flow.mjs';
test('arbitrary button opens a new state and target is found from the new document',async()=>{
 const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end('<button onclick="document.querySelector(\'section\').hidden=false">Explore nebula</button><section hidden><label>Planet code<input name="planet" required></label></section>')});await new Promise(r=>server.listen(0,'127.0.0.1',r));const b=await chromium.launch();try{
 const r=await proposeGenericFlow(b,{siteUrl:`http://127.0.0.1:${server.address().port}/`,prompt:'Click "Explore nebula" then verify "Planet code" is required'},{validateUrl:async()=>{}});
 assert.ok(r.draft,r.reply);assert.deepEqual(r.draft.steps.map(s=>s.action),['goto','click','expect_visible','expect_visible']);assert.equal(r.draft.steps[1].locators[0].name,'Explore nebula');
 }finally{await b.close();await new Promise(r=>server.close(r))}
});
test('ambiguous elements are not silently selected',()=>{assert.equal(matchElement([{role:'button',name:'Open'},{role:'link',name:'Open'}],'Click "Open"').length,2)});
