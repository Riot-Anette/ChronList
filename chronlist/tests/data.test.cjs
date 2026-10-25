const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(__dirname+'/../public/js/data.js','utf8');
function setup({session=null,base='',fetcher=async()=>{throw Error('Unexpected request')}}={}) {
  const memory=new Map(), status={textContent:''};
  const window={CHRONLIST_CONFIG:{apiBaseUrl:base},ChronListAuth:{ready:Promise.resolve(),getSession:()=>session,expire(){session=null;window.ChronListData.lock()}}};
  const context={window,document:{querySelector:()=>status},localStorage:{getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,v)},URL,AbortSignal,fetch:fetcher};
  vm.runInNewContext(source,context);
  return {api:window.ChronListData,memory,status,window};
}
const account={user:{id:'alice'},accessToken:'secret'};
const task={id:'a',title:'Guest',date:'',time:'',reminder:false};
test('guest reads existing storage and reports local-only',async()=>{
  const x=setup(); x.memory.set('chronlist.tasks.v1',JSON.stringify([task]));
  assert.equal((await x.api.initialize())[0].title,'Guest'); assert.equal(x.api.mode,'guest');
  assert.match(x.status.textContent,/Guest/);
});
test('signed-in user never falls back to shared guest tasks',async()=>{
  const x=setup({session:account}); x.memory.set('chronlist.tasks.v1',JSON.stringify([task]));
  await assert.rejects(x.api.initialize(),/setup is incomplete/); assert.equal(x.api.mode,'cloud');
});
test('cloud calls carry bearer header and follow pagination',async()=>{
  const calls=[]; const x=setup({session:account,base:'https://api.example',fetcher:async(url,opt)=>{
    calls.push([url,opt]); return {ok:true,status:200,json:async()=>calls.length===1?{tasks:[task],nextCursor:'next'}:{tasks:[],nextCursor:null}};
  }});
  assert.equal((await x.api.initialize()).length,1); assert.equal(calls.length,2);
  assert.equal(calls[0][1].headers.Authorization,'Bearer secret'); assert.match(calls[1][0],/cursor=next/);
});
test('stale cloud write surfaces conflict without touching guest list',async()=>{
  let n=0; const x=setup({session:account,base:'https://api.example',fetcher:async()=>++n===1?{ok:true,status:200,json:async()=>({tasks:[]})}:{ok:false,status:409,json:async()=>({})}});
  await x.api.initialize(); await assert.rejects(x.api.put({...task,version:1},[]),/another device/);
  assert.equal(x.memory.has('chronlist.tasks.v1'),false);
});
test('401 clears identity and locks data access',async()=>{
  const x=setup({session:account,base:'https://api.example',fetcher:async()=>({ok:false,status:401})});
  await assert.rejects(x.api.initialize(),/session ended/); assert.equal(x.api.mode,'locked');
});
test('failed guest storage write rejects instead of reporting save',async()=>{
  const x=setup(); await x.api.initialize();
  // Feed a circular payload to simulate an unsuccessful storage operation.
  const circular={...task}; circular.self=circular;
  await assert.rejects(x.api.put(circular,[]));
});
test('cloud receipts are local and do not issue task writes',async()=>{
  let calls=0; const x=setup({session:account,base:'https://api.example',fetcher:async()=>{calls++;return{ok:true,status:200,json:async()=>({tasks:[task]})}}});
  await x.api.initialize(); x.api.recordReminder(task);
  assert.equal(calls,1); assert.equal((await x.api.list())[0].alarmed,true);
});
test('guest import is explicit and preserves browser originals',async()=>{
  const calls=[]; const x=setup({session:account,base:'https://api.example',fetcher:async(url,opt)=>{
    calls.push([url,opt]);return{ok:true,status:200,json:async()=>({tasks:[]})};
  }});
  x.memory.set('chronlist.tasks.v1',JSON.stringify([task])); await x.api.initialize();
  assert.equal(calls.length,1); const result=await x.api.importGuest();assert.equal(result.imported,1);
  assert.equal(JSON.parse(x.memory.get('chronlist.tasks.v1')).length,1);
  assert.equal(JSON.parse(calls[1][1].body).expectedVersion,0);
});
test('backup validation rejects impossible dates and oversized notes before writing',()=>{
  const x=setup(); const valid={...task,notes:'',priority:'normal',completed:false};
  const backup={format:'chronlist-backup-v1',tasks:[valid]};
  assert.equal(x.api.validateBackup(backup).length,1);
  assert.throws(()=>x.api.validateBackup({...backup,tasks:[{...valid,date:'2026-02-30'}]}),/invalid date/);
  assert.throws(()=>x.api.validateBackup({...backup,tasks:[{...valid,notes:'x'.repeat(4001)}]}),/invalid name or notes/);
  assert.throws(()=>x.api.validateBackup({tasks:[]}),/ChronList backup/);
});
