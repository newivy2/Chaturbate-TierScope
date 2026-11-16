const test=require('node:test'),assert=require('node:assert/strict');

async function world(options={}){
 const {createBackgroundTrackingPreferences}=await import('../src/background-tracking-preferences.js');
 const {createBackgroundTrackingLeases,createBackgroundTrackingLifecycle}=await import('../src/background-tracking-lifecycle.js');
 const {createBackgroundComparison}=await import('../src/background-comparison.js');
 const {parseGetChatUserListResponse}=await import('../src/user-list-data.js');
 const data=new Map(),shared=new Map(),records=new Map(),calls=[],clients=[],subscribers=new Set();let at=1000000,sequence=0,chain=Promise.resolve(),mode='present',saveError='',libraryError='',unreadableRoom='',cleanups=0,cleanupError=false,noticeDepth=0,maxNoticeDepth=0,lockHook=null;
 const notify=()=>{if(!options.notices)return;noticeDepth++;maxNoticeDepth=Math.max(maxNoticeDepth,noticeDepth);
  try{if(noticeDepth>10)throw Error('Nested storage-notice recursion');for(const changed of [...subscribers])changed();}finally{noticeDepth--;}};
 const prefs=createBackgroundTrackingPreferences({get:(key,fallback)=>data.has(key)?data.get(key):fallback,set:(key,value)=>data.set(key,value),
  remove:key=>data.delete(key),list:()=>[...data.keys()],now:()=>at,id:()=>String(++sequence),notice:notify});
 const lock=(name,fn)=>{const result=chain.then(async()=>{if(lockHook){const hook=lockHook;lockHook=null;await hook();}return fn();});chain=result.catch(()=>{});return result;};
 function client(owner){
  let ownership=()=>null,timer=0;const timers=new Map();
  const manager=createBackgroundComparison({now:()=>at,host:()=> 'https://chaturbate.com',id:()=>owner+'-'+(++sequence),ownership:room=>ownership(room),
   setTimeout:(fn,ms)=>{const id=++timer;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id),
   maxHistory:()=>100,schemaVersion:()=>2,archive:(room,session)=>({room,session}),
   permission:()=>({offline:false,blocked:false,until:0}),waitForSlot:async current=>current(),publish:()=>{},
   request:async room=>{calls.push({owner,room});const body=mode==='present'?'5,'+room+'|o|f|0,viewer|m|m|0':'5,viewer|m|m|0';
    const result=parseGetChatUserListResponse(body);return {...result,source:'API',roomTotal:result.totalUsers};}});
  const leases=createBackgroundTrackingLeases({owner,now:()=>at,id:()=>owner+'-'+(++sequence),get:key=>shared.get(key)??null,
   set:(key,value)=>shared.set(key,value),remove:key=>shared.delete(key),lock});
  const lifecycle=createBackgroundTrackingLifecycle({now:()=>at,leases,preferences:prefs,
   recordings:{read:room=>{if(room===unreadableRoom)throw Error('Corrupt checkpoint');return records.get(room)||null;},list:()=>[...records.values()],
    cleanup:()=>{cleanups++;if(cleanupError)throw Error('Maintenance blocked');},retryFavorite:()=>({saved:!libraryError,error:libraryError}),save:(room,input)=>{
    if(saveError)return {saved:false,error:saveError};records.set(room,{...structuredClone(input),room,savedAt:at});notify();return {saved:true,library:{error:libraryError}};}},
   manager:{start:manager.start,stop:manager.stop,restore:manager.restore,states:manager.states,sources:manager.readSources,archive:manager.readArchive,
    refresh:manager.refresh,subscribe:manager.subscribe,ownership:fn=>ownership=fn},
   setInterval:()=>++timer,clearInterval:()=>{},subscribe:changed=>{subscribers.add(changed);return ()=>subscribers.delete(changed);}});
  clients.push(lifecycle);return {lifecycle,manager,leases,timers};
 }
 return {client,prefs,data,records,shared,calls,advance:ms=>at+=ms,setMode:value=>mode=value,setSaveError:value=>saveError=value,
  setLibraryError:value=>libraryError=value,setUnreadableRoom:value=>unreadableRoom=value,
  cleanupCount:()=>cleanups,setCleanupError:value=>cleanupError=value,maxNoticeDepth:()=>maxNoticeDepth,
  holdNextLease:()=>{let entered,release;const waiting=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve);lockHook=()=>{entered();return gate;};return {waiting,release};},
  close:()=>clients.forEach(client=>client.shutdown())};
}

test('an immediate start claims without waiting for the next heartbeat and concurrent tabs poll each room once',async()=>{
 const w=await world(),a=w.client('a'),b=w.client('b');
 a.lifecycle.initialize();b.lifecycle.initialize();
 await Promise.all([a.lifecycle.start('first_room'),b.lifecycle.start('first_room')]);
 await a.lifecycle.start('second_room');await b.lifecycle.reconcile();
 await Promise.all([a.lifecycle.refresh(),b.lifecycle.refresh()]);
 assert.equal(w.calls.filter(call=>call.room==='first_room').length,1);
 assert.equal(w.calls.filter(call=>call.room==='second_room').length,1);
 assert.equal(a.lifecycle.states().filter(state=>state.active).length,2);
 await b.lifecycle.reconcile();assert.equal(b.lifecycle.sources().sources.length,2,'followers read aggregate checkpoints without polling');
 const source=b.lifecycle.sources().sources.find(source=>source.room==='first_room');
 assert.equal(b.lifecycle.archive(source).session.history.timestamps.length,1);
 w.close();
});

test('shutdown keeps opted-in names and recovery, then a surviving tab resumes with a gap and the same session identity',async()=>{
 const w=await world(),a=w.client('a'),b=w.client('b');
 await a.lifecycle.start('target_room');await a.lifecycle.refresh();
 const before=a.lifecycle.sources().sources[0];a.lifecycle.shutdown();
 assert.equal(w.prefs.read('target_room').active,true);
 assert.equal(w.records.get('target_room').state.status,'stopped');
 w.advance(60000);await b.lifecycle.start('target_room');await b.lifecycle.refresh();
 const after=b.lifecycle.sources().sources[0],archive=b.lifecycle.archive(after);
 assert.equal(after.id,before.id);assert.equal(after.sampleCount,2);
 assert.deepEqual(archive.session.history.breaks,[false,true]);
 assert.equal(w.calls.length,2);w.close();
});

test('an expired lease fences an old owner before its next scan and transfers to another tab',async()=>{
 const w=await world(),a=w.client('a'),b=w.client('b');
 await a.lifecycle.start('target_room');await a.lifecycle.refresh();
 w.advance(90001);await b.lifecycle.start('target_room');await b.lifecycle.refresh();
 const before=w.calls.length;await a.manager.refresh('target_room');
 assert.equal(w.calls.length,before,'the previous owner cannot fetch with an expired/replaced claim');
 assert.equal(w.calls.at(-1).owner,'b');w.close();
});

test('stopping one room in another tab opts it out globally without stopping other rooms',async()=>{
 const w=await world(),a=w.client('a'),b=w.client('b');
 await a.lifecycle.start('first_room');await a.lifecycle.start('second_room');await a.lifecycle.refresh();await b.lifecycle.reconcile();
 b.lifecycle.stop('FIRST_ROOM');assert.equal(w.prefs.read('first_room').active,false);
 await a.lifecycle.reconcile();w.advance(60000);const before=w.calls.length;await a.lifecycle.refresh();
 assert.deepEqual(w.calls.slice(before).map(call=>call.room),['second_room']);
 assert.equal(a.lifecycle.states().find(state=>state.room==='first_room').status,'stopped');
 assert(w.records.get('first_room').archive.session.history.timestamps.length);w.close();
});

test('confirmed absence opts out globally and keeps its absence stop explanation in recovery',async()=>{
 const w=await world(),a=w.client('a'),b=w.client('b');
 await a.lifecycle.start('target_room');await a.lifecycle.refresh();w.setMode('absent');
 for(let i=0;i<17;i++){w.advance(60000);await a.lifecycle.reconcile();await a.lifecycle.refresh();}
 assert.equal(w.prefs.read('target_room').active,false);
 assert.equal(w.records.get('target_room').state.stoppedReason,'absence');
 await a.lifecycle.reconcile();await b.lifecycle.reconcile();
 assert.equal(w.records.get('target_room').state.stoppedReason,'absence','releasing the lease must not rewrite the reason to manual');
 const before=w.calls.length;await b.lifecycle.refresh();assert.equal(w.calls.length,before,'another tab cannot restart an absence-stopped room');
 w.close();
});

test('checkpoint and favorite-keeping failures remain visible while valid live samples survive',async()=>{
 const w=await world(),a=w.client('a');await a.lifecycle.start('target_room');w.setSaveError('Quota');await a.lifecycle.refresh();
 assert.match(a.lifecycle.states()[0].persistenceError,/Quota/);
 assert.equal(a.lifecycle.sources().sources[0].sampleCount,1);
 w.setSaveError('');w.setLibraryError('Library full');await a.lifecycle.reconcile();
 assert.match(a.lifecycle.states()[0].persistenceError,/Library full/);
 assert.equal(w.records.get('target_room').source.sampleCount,1);
 w.setLibraryError('');w.advance(60000);await a.lifecycle.refresh();
 assert.equal(a.lifecycle.states()[0].persistenceError,undefined);w.close();
});

test('room preferences verify writes and reject stale automatic stops without changing a newer choice',async()=>{
 const {createBackgroundTrackingPreferences}=await import('../src/background-tracking-preferences.js');
 const data=new Map();let id=0,drop=false;
 const p=createBackgroundTrackingPreferences({get:(key,fallback)=>data.has(key)?data.get(key):fallback,
  set:(key,value)=>{if(!drop)data.set(key,value);},remove:key=>data.delete(key),list:()=>[...data.keys()],
  id:()=>String(++id),now:()=>1000000,notice:()=>{}});
 const first=p.set('room_a',true).choice;p.set('room_a',false);const newest=p.set('room_a',true).choice;
 assert.equal(p.set('room_a',false,first.revision).changed,false);
 assert.equal(p.read('room_a').revision,newest.revision);assert.equal(p.read('room_a').active,true);
 drop=true;assert.throws(()=>p.set('room_a',false),/verified/);assert.equal(p.read('room_a').active,true);
 assert.throws(()=>p.set('https://chaturbate.com/room_a/',true),/username/);
});

test('one unreadable recovery checkpoint cannot prevent other rooms from continuing',async()=>{
 const w=await world(),a=w.client('a');w.setUnreadableRoom('damaged_room');
 await a.lifecycle.start('damaged_room');await a.lifecycle.start('healthy_room');
 assert.match(a.lifecycle.states().find(state=>state.room==='damaged_room').persistenceError,/Corrupt checkpoint/);
 await a.lifecycle.refresh();
 assert.deepEqual(w.calls.map(call=>call.room).sort(),['damaged_room','healthy_room']);
 assert.equal(a.lifecycle.states().find(state=>state.room==='healthy_room').sampleCount,1);
 w.close();
});

test('a stopped favorite retries its pending Library keep without extending recovery retention',async()=>{
 const w=await world(),a=w.client('a');w.setLibraryError('Library full');
 await a.lifecycle.start('favorite_room');await a.lifecycle.refresh();a.lifecycle.stop('favorite_room');
 assert.match(a.lifecycle.states()[0].persistenceError,/Library full/);
 const savedAt=w.records.get('favorite_room').savedAt;
 w.advance(60000);w.setLibraryError('');await a.lifecycle.reconcile();
 assert.equal(a.lifecycle.states()[0].persistenceError,undefined);
 assert.equal(w.records.get('favorite_room').savedAt,savedAt,'a Library retry does not extend the three-hour recovery period');
 assert.equal(w.prefs.read('favorite_room').active,false);w.close();
});

test('expired recovery cleanup runs at initialization and at most every five minutes without blocking tracking on failure',async()=>{
 const w=await world(),a=w.client('a');await a.lifecycle.start('target_room');assert.equal(w.cleanupCount(),1);
 for(let i=0;i<3;i++)await a.lifecycle.reconcile();assert.equal(w.cleanupCount(),1);
 w.advance(299999);await a.lifecycle.reconcile();assert.equal(w.cleanupCount(),1);
 w.advance(1);await a.lifecycle.reconcile();assert.equal(w.cleanupCount(),2);
 w.setCleanupError(true);w.advance(300000);await a.lifecycle.reconcile();assert.equal(w.cleanupCount(),3);
 await a.lifecycle.refresh();assert.equal(a.lifecycle.states()[0].sampleCount,1);
 assert.equal(a.lifecycle.states()[0].active,true);w.close();
});

test('synchronous cross-tab preference and checkpoint notifications cannot recursively stop/checkpoint a room',async()=>{
 const w=await world({notices:true}),a=w.client('a'),b=w.client('b');
 await a.lifecycle.start('target_room');await a.lifecycle.refresh();b.lifecycle.initialize();await b.lifecycle.reconcile();
 b.lifecycle.stop('target_room');await Promise.all([a.lifecycle.reconcile(),b.lifecycle.reconcile()]);
 assert.equal(w.maxNoticeDepth(),1,'storage notification callbacks schedule reconciliation instead of recursively executing it');
 assert.equal(w.prefs.read('target_room').active,false);
 assert.equal(a.lifecycle.states()[0].status,'stopped');assert.equal(b.lifecycle.states()[0].status,'stopped');
 assert.equal(a.lifecycle.states()[0].persistenceError,undefined);assert.equal(b.lifecycle.states()[0].persistenceError,undefined);
 w.close();
});

test('absence confirmed while reconciliation awaits a lease still saves the global automatic stop',async()=>{
 const w=await world(),a=w.client('a');await a.lifecycle.start('target_room');await a.lifecycle.refresh();w.setMode('absent');
 for(let i=0;i<16;i++){w.advance(60000);await a.lifecycle.reconcile();await a.lifecycle.refresh();}
 assert.equal(a.manager.state('target_room').absenceMs,15*60000);assert.equal(a.manager.state('target_room').active,true);
 w.advance(60000);const gate=w.holdNextLease(),pulse=a.lifecycle.reconcile();await gate.waiting;
 await a.manager.refresh('target_room');assert.equal(a.manager.state('target_room').stoppedReason,'absence');
 gate.release();await pulse;
 assert.equal(w.prefs.read('target_room').active,false,'a simultaneous maintenance pulse must not swallow the absence opt-out');
 assert.equal(w.records.get('target_room').state.stoppedReason,'absence');w.close();
});
