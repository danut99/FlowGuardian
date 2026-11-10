import test from 'node:test';
import assert from 'node:assert/strict';
import { draftFromDescription } from '../../../frontend/src/lib/flowDescription.ts';
const login = {kind:'access', target_url:'https://example.test/', entry_action:{role:'button',name:'Sign in'},observed_controls:{fields:[{type:'email',label:'Email'},{type:'password',label:'Password'}]}};
test('login draft uses detected entry, secret references and explicit success condition',()=>{
 const result=draftFromDescription('Sign in with the test account',[login],'My dinosaurs','');
 assert.deepEqual(result.steps.map(s=>s.action),['goto','expect_visible','click','fill','fill','click','expect_text']);
 assert.equal(result.steps[2].locators[0].name,'Sign in');
 assert.equal(result.steps[3].value,'{{test.username}}');
 assert.equal(result.steps[4].value,'{{test.password}}');
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
 assert.equal(result.steps.filter(s=>s.action==='expect_visible').length,5);
 assert.match(result.steps.at(-1).locators[0].value,/required/);
});
test('generic contact-form inspection needs no account or success text',()=>{
 const candidate={kind:'request',control_kind:'contact',target_url:'https://example.test/contact',observed_controls:{fields:[{type:'email',label:'Email'},{type:'',label:'Message'}],buttons:['Send']}};
 const result=draftFromDescription('Open contact and verify fields are visible',[candidate],'','');
 assert.deepEqual(result.steps.map(s=>s.action),['goto','expect_visible','expect_visible','expect_visible']);
});

test('requested homepage link and cross-domain redirect are preserved before checking fields',()=>{
 const c={kind:'access',entry_url:'https://maxesimo.com/',target_url:'https://maxesimo.com/account/login',target_name:'Sign In',destination_origin:'https://account.maxesimo.com',observed_controls:{fields:[{type:'email',label:'Email',required:true}]}};
 const r=draftFromDescription('On home page find the sign in button and click it, redirected form email is required',[c],'','');
 assert.deepEqual(r.steps.map(s=>s.action),['goto','expect_visible','click','expect_url','expect_visible','expect_visible']);
 assert.equal(r.steps[0].value,c.entry_url);assert.equal(r.steps[2].locators[0].role,'link');assert.equal(r.steps[3].value,c.destination_origin);
});
test('missing requested entry target asks a question instead of navigating directly',()=>{
 const c={kind:'request',entry_url:'https://example.test/',target_url:'https://example.test/contact',observed_controls:{fields:[{type:'email',label:'Email'}]}};
 const r=draftFromDescription('From homepage click contact and verify fields appear',[c],'','');assert.ok(r.question);assert.equal(r.steps,undefined);
});
