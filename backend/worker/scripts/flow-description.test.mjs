import test from 'node:test';
import assert from 'node:assert/strict';
import { draftFromDescription } from '../../../frontend/src/lib/flowDescription.ts';
const login = {kind:'access', target_url:'https://example.test/', entry_action:{role:'button',name:'Sign in'},observed_controls:{fields:[{type:'email',label:'Email'},{type:'password',label:'Password'}]}};
test('login draft uses detected entry, secret references and explicit success condition',()=>{
 const result=draftFromDescription('Sign in with the test account',[login],'My dinosaurs','');
 assert.deepEqual(result.steps.map(s=>s.action),['goto','click','fill','fill','click','expect_text']);
 assert.equal(result.steps[1].locators[0].name,'Sign in');
 assert.equal(result.steps[2].value,'{{test.username}}');
 assert.equal(result.steps[3].value,'{{test.password}}');
 assert.equal(result.steps.at(-1).value,'My dinosaurs');
});
test('incomplete and ambiguous descriptions produce questions rather than fabricated targets',()=>{
 for(const [description,candidates,expected] of [['Sign in',[login],''],['Sign in',[],'Dashboard'],['Sign in then search',[login],'Result'],['Pay for an order',[login],'Receipt']]) {
  const result=draftFromDescription(description,candidates,expected,'');assert.ok(result.question);assert.equal(result.steps,undefined);
 }
});
test('search needs a query and preserves actual input name',()=>{
 const c={control_kind:'search',target_url:'https://example.test/',observed_controls:{fields:[{type:'text',name:'query',label:'Find'}]}};
 assert.ok(draftFromDescription('Search products',[c],'Thailand','').question);
 const result=draftFromDescription('Search products',[c],'Thailand','thailand');
 assert.equal(result.steps[1].locators[0].value,'input[name="query"]');
 assert.equal(result.steps[1].value,'thailand');
 assert.equal(result.steps[2].value,'Enter');
});


test('checking a displayed login form does not sign in or require a signed-in result',()=>{
 const candidate={...login,observed_controls:{fields:[{type:'email',label:'Email',required:true},{type:'password',label:'Password',required:true}]}};
 const result=draftFromDescription('verify the login form is displayed and had required fields',[candidate],'','');
 assert.ok(result.steps);assert.equal(result.steps.filter(s=>s.action==='fill').length,0);
 assert.equal(result.steps.filter(s=>s.action==='click').length,1);
 assert.equal(result.steps.filter(s=>s.action==='expect_visible').length,4);
 assert.match(result.steps.at(-1).locators[0].value,/required/);
});
test('generic contact-form inspection needs no account or success text',()=>{
 const candidate={kind:'request',control_kind:'contact',target_url:'https://example.test/contact',observed_controls:{fields:[{type:'email',label:'Email'},{type:'',label:'Message'}],buttons:['Send']}};
 const result=draftFromDescription('Open contact and verify fields are visible',[candidate],'','');
 assert.deepEqual(result.steps.map(s=>s.action),['goto','expect_visible','expect_visible','expect_visible']);
});
