const test=require('node:test'),assert=require('node:assert/strict');
async function fixture(){
 const {createBackgroundComparison}=await import('../src/background-comparison.js');
 const {parseGetChatUserListResponse}=await import('../src/user-list-data.js');
 let owner='lease-a';
 let at=1000000,host='https://chaturbate.com/host_room/',nextTimer=0,nextId=0;
 const timers=new Map(),calls=[],published=[],responses=[],permission={offline:false,blocked:false,until:0};
 const sample=(room='target_room',anonymous=5,viewers=1)=>{
  const body=anonymous+','+room+'|o|f|0'+Array.from({length:viewers},(_,i)=>',viewer_'+i+'|m|m|0').join('');
  const parsed=parseGetChatUserListResponse(body);return {...parsed,roomTotal:parsed.totalUsers,source:'API'};
 };
 const manager=createBackgroundComparison({now:()=>at,host:()=>host,id:()=>String(++nextId),ownership:()=>owner,
  setTimeout:(fn,ms)=>{const id=++nextTimer;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id),
  maxHistory:()=>3,schemaVersion:()=>2,archive:(room,session)=>({room,session}),permission:()=>({...permission}),
  waitForSlot:async current=>current(),publish:until=>{published.push(until);permission.until=until;},
  request:async(room,signal)=>{calls.push({room,signal});const next=responses.length?responses.shift():sample(room);
   if(next instanceof Error)throw next;return typeof next==='function'?next():next;}});
 return {manager,sample,calls,published,responses,permission,timers,setOwner:value=>owner=value,advance:ms=>at+=ms,navigate:()=>host='https://chaturbate.com/another_room/'};
}
function archive(f){return f.manager.readArchive(f.manager.readSources().sources[0]);}

test('background comparison has stable identity, independent tier aggregates and immutable histories',async()=>{
 const f=await fixture(),m=f.manager;m.start('  TARGET_ROOM  ');
 const waiting=m.readSources().sources[0];assert.equal(waiting.sampleCount,0);assert.equal(waiting.kind,'background');
 assert.throws(()=>m.readArchive(waiting),/no accepted samples/);
 await m.refresh();const first=m.readSources().sources[0],a=archive(f);
 assert.equal(first.id,waiting.id);assert.equal(m.state().status,'tracking');
 assert.deepEqual(a.session.history.total,[2]);assert.deepEqual(a.session.history.anonymous,[5]);
 assert.deepEqual(a.session.history.withTokens,[1]);assert.deepEqual(a.session.history['female-trans'],[1]);
 assert.equal(a.session.roomTotalHigh,7);assert(Object.isFrozen(a.session.history.total));
 f.advance(60000);f.responses.push(f.sample('target_room',10,2));await m.refresh();
 const b=archive(f);assert.equal(a.session.history.timestamps.length,1);assert.equal(b.session.history.timestamps.length,2);
 assert.equal(b.session.pausedElapsedTime,60000);assert.equal(b.session.roomTotalHigh,13);
 assert.equal(m.readSources().sources[0].revision,'2');assert.throws(()=>m.readArchive(first),/changed/);
 assert.equal(f.calls[0].room,'target_room');assert.equal(f.calls[0].signal.aborted,false);
});

test('invalid room input does not replace the active comparison; subscribers are disposable',async()=>{
 const f=await fixture(),m=f.manager;let notices=0;const unsubscribe=m.subscribe(()=>notices++);
 m.start('target_room');await m.refresh();const previous=m.readSources().sources[0];
 for(const name of ['https://chaturbate.com/room/','followed-cams','tags','room name','../test',''])assert.throws(()=>m.start(name),/username/);
 assert.equal(m.readSources().sources[0].id,previous.id);assert(notices>0);
 unsubscribe();const count=notices;m.stop();assert.equal(notices,count);
 assert.equal(m.state().status,'stopped');assert.equal(archive(f).session.history.timestamps.length,1);
});

test('empty or mismatched rooms retain the last sample and create a real gap on recovery',async()=>{
 const f=await fixture(),m=f.manager;m.start('target_room');await m.refresh();
 const a=archive(f);for(const response of [{...f.sample(),users:[],registeredCount:0,totalUsers:5,roomTotal:5},f.sample('wrong_room')]){
  f.advance(60000);f.responses.push(response);await m.refresh();
  assert.equal(m.state().sampleCount,1);assert.equal(m.state().status,response.users.length?'unavailable':'waiting');assert.equal(archive(f),a);
 }
 f.advance(60000);await m.refresh();const b=archive(f);
 assert.deepEqual(b.session.history.breaks,[false,true]);assert.equal(b.session.pausedElapsedTime,0);
 assert.equal(m.state().status,'tracking');
});

test('403 keeps a background room queued; server waits are shared and cannot be bypassed by adding another room',async()=>{
 const f=await fixture(),m=f.manager;m.start('target_room');await m.refresh();
 const a=archive(f);f.responses.push(Object.assign(Error('Access denied'),{status:403}));f.advance(60000);await m.refresh();
 assert.equal(m.state().status,'unavailable');assert.equal(m.state().active,true);assert.equal(archive(f),a);
 assert.equal(f.permission.blocked,false);assert.equal(f.published.length,0);
 m.start('target_room');f.responses.push(Object.assign(Error('Rate limited'),{status:429,retryAt:1500000}));await m.refresh();
 assert.deepEqual(f.published,[1500000]);const calls=f.calls.length;
 m.start('second_room');await m.refresh();assert.equal(f.calls.length,calls);assert.equal(m.state().status,'retry');
 f.advance(500001);await m.refresh('second_room');assert.equal(f.calls.at(-1).room,'second_room');assert.equal(m.state().sampleCount,1);
});

test('offline and foreground access restrictions defer requests without adding samples',async()=>{
 const f=await fixture(),m=f.manager;m.start('target_room');f.permission.offline=true;await m.refresh();
 assert.equal(f.calls.length,0);assert.equal(m.state().status,'offline');
 f.permission.offline=false;f.permission.blocked=true;await m.refresh();assert.equal(f.calls.length,0);assert.equal(m.state().status,'retry');
 f.permission.blocked=false;await m.refresh();assert.equal(m.state().sampleCount,1);
});

test('cancel/replacement and navigation prevent delayed responses from entering any recording',async()=>{
 const f=await fixture(),m=f.manager;let resolve;
 m.start('target_room');f.responses.push(()=>new Promise(r=>resolve=r));const pending=m.refresh();
 await Promise.resolve();await Promise.resolve();assert.equal(f.calls.length,1);m.stop({clear:true});assert(f.calls[0].signal.aborted);
 m.start('second_room');await m.refresh();resolve(f.sample('target_room'));await pending;
 assert.equal(m.state().room,'second_room');assert.equal(m.state().sampleCount,1);assert.equal(archive(f).room,'second_room');
 f.navigate();await m.refresh();assert.equal(m.state().room,null);assert.equal(m.readSources().sources.length,0);assert.equal(f.timers.size,0);
});

test('retention bounds every series and a suspended browser interval is marked as a gap',async()=>{
 const f=await fixture(),m=f.manager;m.start('target_room');await m.refresh();
 for(let i=0;i<4;i++){f.advance(60000);await m.refresh();}
 let a=archive(f);for(const values of Object.values(a.session.history))assert.equal(values.length,3);
 f.advance(5*60000);await m.refresh();a=archive(f);assert.equal(a.session.history.breaks.at(-1),true);
 m.stop({clear:true});assert.equal(f.timers.size,0);assert.equal(m.state().sampleCount,0);
});

test('failed foreground policy writes and cooldown publication cannot admit a background request',async()=>{
 const {createBackgroundPermissionReader,createBackgroundComparison}=await import('../src/background-comparison.js');
 let stored=null,foreground={blocked:403,until:1000000,serverUntil:0},foregroundDeadline=0;
 let requests=0;const copy=JSON.stringify(foreground);
 const permission=createBackgroundPermissionReader({now:()=>1000000,offline:()=>false,read:()=>stored,
  foregroundPolicy:()=>foreground,deadline:()=>Math.max(0,foregroundDeadline)});
 const manager=createBackgroundComparison({now:()=>1000000,host:()=>'/host/',id:()=> 'test',
  setTimeout:()=>1,clearTimeout:()=>{},maxHistory:()=>10,schemaVersion:()=>2,archive:()=>{},permission,
  waitForSlot:async current=>current(),publish:()=>{},request:async()=>{requests++;throw Error('Unexpected request');}});
 // GM_setValue failed, but GM_getValue still succeeds and returns its old value.
 manager.start('target_room');await manager.refresh();assert.equal(requests,0);assert.equal(permission().blocked,true);
 assert.equal(JSON.stringify(foreground),copy,'reading must not reconcile or mutate the foreground owner');
 // An old stored restriction cannot erase a newer in-memory server wait.
 stored=JSON.stringify({blocked:0,until:0,serverUntil:0});foreground={blocked:0,until:1200000,serverUntil:1400000};
 assert.equal(permission().until,1400000);await manager.refresh();assert.equal(requests,0);
 // Even if both storage representations are clear, failed localStorage cooldown
 // publication leaves the originating foreground coordinator's local deadline.
 foreground={blocked:0,until:0,serverUntil:0};foregroundDeadline=1600000;
 assert.equal(permission().until,1600000);await manager.refresh();assert.equal(requests,0);
 foregroundDeadline=0;await manager.refresh();assert.equal(requests,1,'only clearing every restriction permits a request');
 manager.stop({clear:true});
});


test('adding rooms preserves independent sessions; repeat adds are idempotent and Stop affects one room',async()=>{
 const f=await fixture(),m=f.manager;m.start('first_room');await m.refresh('first_room');
 const first=m.readSources().sources[0],firstArchive=archive(f);
 m.start('second_room');await m.refresh('second_room');
 assert.equal(m.states().length,2);assert(Object.isFrozen(m.states()));
 assert.equal(m.state('first_room').sampleCount,1);assert.equal(m.state('second_room').sampleCount,1);
 assert.equal(m.readSources().sources.find(s=>s.room==='first_room').id,first.id);
 assert.equal(m.readArchive(first),firstArchive);
 m.start(' FIRST_ROOM ');assert.equal(m.readSources().sources.find(s=>s.room==='first_room').id,first.id);
 assert.equal(m.state('first_room').sampleCount,1,'adding an already tracked room never resets its history');
 m.stop('first_room');assert.equal(m.state('first_room').active,false);assert.equal(m.state('first_room').stoppedReason,'manual');
 assert.equal(m.state('second_room').active,true);f.advance(60000);await m.refresh();
 assert.equal(m.state('first_room').sampleCount,1);assert.equal(m.state('second_room').sampleCount,2);
 m.stop('first_room',{clear:true});assert.equal(m.states().length,1);assert.equal(m.states()[0].room,'second_room');
});

test('background rooms use one serial request lane and canceling a held room releases the next room',async()=>{
 const f=await fixture(),m=f.manager;let release;
 m.start('first_room');m.start('second_room');f.responses.push(()=>new Promise(resolve=>release=resolve));
 const all=m.refresh();await Promise.resolve();await Promise.resolve();assert.deepEqual(f.calls.map(c=>c.room),['first_room']);
 m.stop('first_room');await all;
 assert.deepEqual(f.calls.map(c=>c.room),['first_room','second_room']);assert.equal(m.state('second_room').sampleCount,1);
 release(f.sample('first_room'));await Promise.resolve();assert.equal(m.state('first_room').sampleCount,0);
 assert(f.calls[0].signal.aborted);assert.equal(m.state('second_room').active,true);
});

async function absentSample(f,room='target_room') {
 f.advance(60000);f.responses.push({...f.sample(room),users:[],registeredCount:0,totalUsers:5,roomTotal:5});
 await f.manager.refresh(room);
}

test('only fresh consecutive absence observations spanning more than fifteen minutes stop their room',async()=>{
 const f=await fixture(),m=f.manager;m.start('target_room');await m.refresh('target_room');m.start('other_room');await m.refresh('other_room');
 const before=m.readArchive(m.readSources().sources.find(s=>s.room==='target_room'));
 await absentSample(f);const first=m.state('target_room').absentSince;
 for(let i=0;i<15;i++)await absentSample(f);
 assert.equal(m.state('target_room').active,true,'exactly fifteen minutes is not more than fifteen minutes');
 assert.equal(m.state('target_room').absenceMs,900000);assert.equal(m.state('target_room').absentSince,first);
 await absentSample(f);const stopped=m.state('target_room');
 assert.equal(stopped.active,false);assert.equal(stopped.status,'stopped');assert.equal(stopped.stoppedReason,'absence');
 assert.equal(stopped.absenceMs,960000);assert.equal(stopped.sampleCount,1,'absence never fabricates zero audience points');
 assert.equal(m.state('other_room').active,true);
 assert.equal(m.readArchive(m.readSources().sources.find(s=>s.room==='target_room')),before);
});

test('API failures, wrong owners, offline periods and long observation gaps never confirm continued absence',async()=>{
 for(const interruption of ['error','wrong-room','offline','suspended']) {
  const f=await fixture(),m=f.manager;m.start('target_room');await m.refresh('target_room');
  await absentSample(f);for(let i=0;i<14;i++)await absentSample(f);
  assert.equal(m.state().absenceMs,840000);
  if(interruption==='suspended') {f.advance(16*60000);}
  else {
   f.advance(60000);
   if(interruption==='error')f.responses.push(Error('Network failed'));
   if(interruption==='wrong-room')f.responses.push(f.sample('another_room'));
   if(interruption==='offline')f.permission.offline=true;
   await m.refresh('target_room');f.permission.offline=false;
   assert.equal(m.state().absentSince,null,interruption+' interrupts trustworthy absence evidence');
  }
  await absentSample(f);assert.equal(m.state().active,true,interruption+' must not cause an absence stop');
  assert.equal(m.state().absenceMs,0,interruption+' starts a new confirmation window');
 }
});

test('a confirmed broadcaster return clears absence proof and resumes the same recording with a gap',async()=>{
 const f=await fixture(),m=f.manager;m.start('target_room');await m.refresh();const id=m.readSources().sources[0].id;
 await absentSample(f);for(let i=0;i<8;i++)await absentSample(f);
 f.advance(60000);await m.refresh();assert.equal(m.state().absentSince,null);assert.equal(m.state().status,'tracking');
 assert.equal(m.readSources().sources[0].id,id);assert.deepEqual(archive(f).session.history.breaks,[false,true]);
 await absentSample(f);assert.equal(m.state().absenceMs,0);assert.equal(m.state().active,true);
});

test('restoring a saved aggregate retains source identity and samples but starts fresh absence evidence with a gap',async()=>{
 const f=await fixture(),m=f.manager;m.start('target_room');await m.refresh();f.advance(60000);await m.refresh();
 await absentSample(f);const checkpoint={source:m.readSources().sources[0],archive:archive(f),state:m.state()};
 const firstId=checkpoint.source.id,firstTimes=checkpoint.archive.session.history.timestamps.slice();
 m.stop('target_room',{clear:true});f.advance(2*3600000);m.restore('target_room',checkpoint);
 assert.equal(m.state().sampleCount,2);assert.equal(m.state().active,true);assert.equal(m.state().absentSince,null);
 assert.equal(m.readSources().sources[0].id,firstId);assert.deepEqual(archive(f).session.history.timestamps,firstTimes);
 await m.refresh();assert.equal(m.state().sampleCount,3);assert.equal(archive(f).session.history.breaks.at(-1),true);
 assert.equal(archive(f).session.pausedElapsedTime,60000,'the recovery gap adds no recorded coverage');
 m.stop('target_room',{clear:true});assert.throws(()=>m.restore('target_room',{...checkpoint,archive:{...checkpoint.archive,room:'wrong_room'}}),/Invalid saved/);
});

test('a changed or lost ownership token rejects late responses and prevents queued requests',async()=>{
 const f=await fixture(),m=f.manager;let release;
 m.start('target_room');f.responses.push(()=>new Promise(resolve=>release=resolve));const pending=m.refresh('target_room');
 await Promise.resolve();await Promise.resolve();assert.equal(f.calls.length,1);
 f.setOwner('lease-b');release(f.sample());await pending;assert.equal(m.state().sampleCount,0);
 await m.refresh('target_room');assert.equal(f.calls.length,1,'an old generation cannot scan after a new lease is issued');
 assert([...f.timers.values()].every(timer=>timer.ms>0),'lost ownership does not create a zero-delay retry loop');
 m.stop('target_room',{clear:true});m.start('target_room');await m.refresh();assert.equal(m.state().sampleCount,1);
});
