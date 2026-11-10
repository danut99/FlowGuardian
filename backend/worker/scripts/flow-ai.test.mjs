import test from 'node:test';
import assert from 'node:assert/strict';
import { validateFlowDraft } from '../src/flow-ai.mjs';
const draft=steps=>({draft:{name:'Flow',steps}});
const open={action:'goto',value:'/'};
const end={action:'expect_text',value:'Done'};
test('general browser actions form an unverified draft',()=>{
 const r=validateFlowDraft(draft([open,{action:'click',locators:[{type:'role',role:'button',name:'Filters'}]},end]),'https://example.test/');
 assert.equal(r.verified,false);assert.equal(r.draft.steps[1].locators[0].strict,true);
});
test('rejects external navigation, raw password and missing final assertion',()=>{
 assert.throws(()=>validateFlowDraft(draft([{action:'goto',value:'https://elsewhere.test/'},end]),'https://example.test/'));
 assert.throws(()=>validateFlowDraft(draft([open,{action:'fill',locators:[{type:'label',value:'Password'}],value:'secret'},end]),'https://example.test/'));
 assert.throws(()=>validateFlowDraft(draft([open,{action:'click',locators:[{type:'text',value:'Next'}]}]),'https://example.test/'));
});
test('clarifications contain no executable draft',()=>{assert.equal(validateFlowDraft({reply:'Which result?',draft:null},'https://example.test/').draft,null)});

test('compact context excludes evidence and limits fields and buttons',async()=>{
 const {compactFlowContext}=await import('../src/flow-ai.mjs');
 const context=compactFlowContext([{kind:'access',target_url:'https://example.test/',evidence:'unneeded long evidence',public_run:{steps:['screenshots']},observed_controls:{fields:Array(50).fill({type:'email',label:'Email'}),buttons:Array(50).fill('Continue')}}]);
 assert.equal(context[0].fields.length,8);assert.equal(context[0].buttons.length,8);assert.equal(context[0].public_run,undefined);assert.equal(context[0].evidence,undefined);
});
test('identical drafts share a model call but changed context and scope do not',async()=>{
 const {generateFlowDraft}=await import('../src/flow-ai.mjs');let calls=0;
 const model=async(_payload,options)=>{calls++;assert.equal(options.maxTokens,2000);return draft([open,end]);};
 const request={siteUrl:'https://cache.test/',cacheScope:'site-a',prompt:'Check page',candidates:[]};
 await Promise.all([generateFlowDraft(request,{model}),generateFlowDraft(request,{model})]);assert.equal(calls,1);
 await generateFlowDraft({...request,cacheScope:'site-b'},{model});assert.equal(calls,2);
 await generateFlowDraft({...request,candidates:[{kind:'request',target_url:'/contact'}]},{model});assert.equal(calls,3);
});

test('normalizes label name to value without changing the target',()=>{
 const r=validateFlowDraft(draft([open,{action:'fill',locators:[{type:'label',name:'Email'}],value:'{{test.username}}'},end]),'https://example.test/');
 assert.equal(r.draft.steps[1].locators[0].value,'Email');
});
test('missing AI target becomes a clarification with no additional model call',async()=>{
 const {generateFlowDraft}=await import('../src/flow-ai.mjs');let calls=0;
 const r=await generateFlowDraft({siteUrl:'https://missing.test/',prompt:'Check world',candidates:[]},{model:async()=>{calls++;return draft([open,{action:'expect_visible',locators:[{type:'label'}]}]);}});
 assert.equal(calls,1);assert.equal(r.draft,null);assert.match(r.reply,/exact field/);
});

test('selector assistance returns one selector and preserves the requested action',async()=>{
 const {generateSelectorDraft}=await import('../src/flow-ai.mjs');
 const r=await generateSelectorDraft({siteUrl:'https://example.test/',prompt:JSON.stringify({action:'fill',description:'Use the Email field'}),candidates:[]},{model:async()=>({reply:'Use Email',locator:{type:'label',name:'Email'}})});
 assert.equal(r.draft.steps.length,1);assert.equal(r.draft.steps[0].action,'fill');assert.equal(r.draft.steps[0].locators[0].value,'Email');assert.equal(r.draft.steps[0].value,null);assert.equal(r.verified,false);
});
