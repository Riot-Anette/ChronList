const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const {webcrypto}=require('node:crypto');
const source=fs.readFileSync(__dirname+'/../public/js/auth.js','utf8');
function setup({query='',flow=null,fetcher=async()=>{throw Error('Unexpected network request')}}={}) {
  const memory=new Map(),status={},button={setAttribute(){},addEventListener(){}};
  if(flow) memory.set('chronlist.auth.flow.v2',JSON.stringify(flow));
  const assigned=[],events=[],timers=[];
  const location={origin:'https://example.netlify.app',pathname:'/',search:query,assign:u=>assigned.push(u.toString())};
  const config={domain:'https://auth.example',clientId:'client',redirectUri:'https://example.netlify.app/',logoutUri:'https://example.netlify.app/',scopes:'openid email profile'};
  const window={CHRONLIST_CONFIG:config,location,dispatchEvent:event=>events.push(event.type)};
  const context={window,location,history:{replaceState(){location.search=''}},document:{querySelector:s=>s==='.avatar'?button:status},sessionStorage:{getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,v),removeItem:k=>memory.delete(k)},setTimeout:(fn,delay)=>{timers.push(fn);return timers.length},clearTimeout(){},crypto:webcrypto,Uint8Array,TextEncoder,URL,URLSearchParams,AbortSignal,Event,btoa:s=>Buffer.from(s,'binary').toString('base64'),fetch:fetcher};
  vm.runInNewContext(source,context);
  return {auth:window.ChronListAuth,memory,status,button,assigned,events,timers,location};
}
test('sign-in sends PKCE S256 and a matching random state',async()=>{
  const x=setup(); await x.auth.ready; await x.auth.signIn();
  const url=new URL(x.assigned[0]);const flow=JSON.parse(x.memory.get('chronlist.auth.flow.v2'));
  assert.equal(url.searchParams.get('state'),flow.state);
  assert.equal(url.searchParams.get('code_challenge_method'),'S256');
  assert.equal(url.searchParams.get('response_type'),'code');
  assert.equal(url.searchParams.has('code_verifier'),false);
  assert.ok(flow.verifier.length>=43);
});
test('state mismatch rejects callback before token exchange and cleans URL',async()=>{
  let calls=0; const x=setup({query:'?code=private&state=bad',flow:{state:'good',verifier:'v',createdAt:Date.now()},fetcher:async()=>{calls++}});
  await x.auth.ready; assert.equal(calls,0);assert.equal(x.location.search,'');assert.equal(x.auth.getSession(),null);assert.match(x.status.textContent,/expired/);
});
test('expired PKCE transaction is rejected',async()=>{
  const x=setup({query:'?code=x&state=s',flow:{state:'s',verifier:'v',createdAt:Date.now()-700000}});
  await x.auth.ready;assert.equal(x.auth.getSession(),null);assert.match(x.status.textContent,/expired/);
});
test('valid callback stores access token only and clears tasks on expiry',async()=>{
  let count=0;
  const x=setup({query:'?code=x&state=s',flow:{state:'s',verifier:'v',createdAt:Date.now()},fetcher:async()=>({ok:true,json:async()=>++count===1?{access_token:'access',id_token:'discard-id',refresh_token:'discard-refresh',expires_in:3600}:{sub:'alice',email:'test@example.com',email_verified:true}})});
  await x.auth.ready;assert.equal(x.auth.getSession().user.id,'alice');
  const saved=x.memory.get('chronlist.auth.session.v2');assert.ok(!saved.includes('discard'));assert.equal(x.memory.has('chronlist.auth.flow.v2'),false);
  x.timers[0]();assert.equal(x.auth.getSession(),null);assert.ok(x.events.includes('chronlist:session-ended'));
});
test('unverified email rejects the authenticated session',async()=>{
  let count=0;const x=setup({query:'?code=x&state=s',flow:{state:'s',verifier:'v',createdAt:Date.now()},fetcher:async()=>({ok:true,json:async()=>++count===1?{access_token:'access',expires_in:3600}:{sub:'alice',email_verified:false}})});
  await x.auth.ready;assert.equal(x.auth.getSession(),null);
});
test('sign-out clears local session before Cognito redirect',async()=>{
  const x=setup();await x.auth.ready;x.auth.signOut();assert.equal(x.auth.getSession(),null);
  const url=new URL(x.assigned[0]);assert.equal(url.pathname,'/logout');assert.equal(url.searchParams.get('logout_uri'),'https://example.netlify.app/');
});
