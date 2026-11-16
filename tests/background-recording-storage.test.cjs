const test=require('node:test'),assert=require('node:assert/strict');
async function fixture(){
 const {createBackgroundRecordingStore,BACKGROUND_RECORDING_PREFIX:prefix,BACKGROUND_RECORDING_TTL_MS:ttl}=await import('../src/background-recording-storage.js');
 let at=Date.UTC(2026,10,16,12),minimum=3,favorite={favorite:false,autoKeep:false};
 const records=new Map(),kept=[],effects={now:()=>at,get:(key,fallback)=>records.has(key)?records.get(key):fallback,
  set:(key,value)=>records.set(key,value),remove:key=>records.delete(key),list:()=>[...records.keys()],
  validateArchive:archive=>{if(!archive||archive.invalid)throw Error('Invalid archive');return JSON.parse(JSON.stringify(archive));},
  favorite:()=>({...favorite}),minimumMinutes:()=>minimum,keep:archive=>{kept.push(archive);return {added:kept.length===1,updated:kept.length>1,id:'library-entry'};}};
 const store=createBackgroundRecordingStore(effects);
 function payload(room='testroom',duration=180000){const start=at-duration,times=duration?[start,at]:[at],sessionId='background@'+start;
  const archive={room,session:{sessionStartedAt:start,history:{timestamps:times,breaks:times.map(()=>false),total:times.map(()=>10),anonymous:times.map(()=>5)}}};
  const source={version:1,id:'background-test:'+room+':'+sessionId,publisherId:'background-test',room,roomEpoch:'background',sessionId,sessionStartedAt:start,
   kind:'background',status:'tracking',lastSeenAt:at,sampleAt:at,sampleCount:times.length,revision:'1',recordKey:null,recordSavedAt:null};
  const state={room,active:true,status:'tracking',message:'Tracking',sampleCount:times.length,sampleAt:at,nextAt:at+60000};
  return {archive,source,state};}
 return {store,payload,records,effects,kept,prefix,ttl,reopen:()=>createBackgroundRecordingStore(effects),advance:ms=>at+=ms,minimum:n=>minimum=n,favorite:value=>favorite=value};
}

test('aggregate recovery persists three hours without keeping nonfavorite sessions',async()=>{
 const f=await fixture(),p=f.payload();p.source.users=['private-viewer'];p.state.extra='discard';
 assert.equal(f.store.save('testroom',p).saved,true);assert.equal(f.kept.length,0);
 const read=f.store.read('TESTROOM');assert.equal(read.room,'testroom');assert.equal(read.source.users,undefined);assert.equal(read.state.extra,undefined);
 assert(Object.isFrozen(read.archive.session.history.timestamps));
 f.advance(f.ttl);assert(f.store.read('testroom'),'exact recovery boundary remains readable');
 f.advance(1);assert.equal(f.store.read('testroom'),null);assert.equal(f.records.size,1,'ordinary reads preserve originals');
 assert.equal(f.store.cleanupExpired().cleared,1);assert.equal(f.records.size,0);
});

test('favorite automatic keeping respects consent and minimum covered samples, including gaps',async()=>{
 const f=await fixture();f.favorite({favorite:true,autoKeep:false});
 f.store.save('testroom',f.payload());assert.equal(f.kept.length,0,'a star alone is not auto-keep consent');
 f.favorite({favorite:true,autoKeep:true});let p=f.payload('testroom',60000);
 assert.equal(f.store.save('testroom',p).library.waiting,true);assert.equal(f.kept.length,0);
 f.advance(60000);p=f.payload('testroom',180000);p.archive.session.history.breaks[1]=true;
 assert.equal(f.store.save('testroom',p).library.waiting,true,'a recording gap does not qualify');
 p.archive.session.history.breaks[1]=false;
 assert.equal(f.store.save('testroom',p).library.saved,true);assert.equal(f.kept.length,1);
 assert.equal(f.store.save('testroom',p).library.saved,true);assert.equal(f.kept.length,1,'unchanged favorite checkpoint is not rewritten');
 f.minimum(5);assert.equal(f.store.save('testroom',p).library.waiting,true,'fresh saved duration setting controls every attempt');
 f.minimum(0);f.advance(60000);p=f.payload('otherroom',0);assert.equal(f.store.save('otherroom',p).library.saved,true);
});

test('a fuller favorite recording updates through the Library writer and remains kept after recovery expiry',async()=>{
 const f=await fixture();f.favorite({favorite:true,autoKeep:true});const p=f.payload();
 const first=f.store.save('testroom',p);assert.equal(first.library.id,'library-entry');
 f.advance(60000);p.archive.session.history.timestamps.push(p.source.sampleAt+60000);
 p.archive.session.history.breaks.push(false);p.archive.session.history.total.push(12);p.archive.session.history.anonymous.push(6);
 p.source.sampleAt+=60000;p.source.lastSeenAt=p.source.sampleAt;p.source.sampleCount++;p.source.revision='2';
 p.state.sampleAt=p.source.sampleAt;p.state.sampleCount=p.source.sampleCount;p.state.nextAt=p.source.sampleAt+60000;
 const updated=f.store.save('testroom',p);assert.equal(updated.library.id,first.library.id);assert.equal(updated.library.updated,true);
 assert.equal(f.kept.length,2);assert.equal(f.kept[0].session.sessionStartedAt,f.kept[1].session.sessionStartedAt);
 f.advance(f.ttl+1);assert.equal(f.store.cleanupExpired().cleared,1);assert.equal(f.kept.length,2,'recovery cleanup never removes kept Library recordings');
});

test('recovery and favorite Library writes fail independently and never remove accepted data',async()=>{
 const f=await fixture(),p=f.payload();f.favorite({favorite:true,autoKeep:true});
 f.effects.set=()=>{throw Error('Recovery quota');};
 const recoveryFailed=f.store.save('testroom',p);assert.equal(recoveryFailed.saved,false);assert.match(recoveryFailed.error,/quota/);
 assert.equal(recoveryFailed.library.saved,true);assert.equal(f.kept.length,1);
 f.effects.set=(key,value)=>f.records.set(key,value);f.effects.keep=()=>{throw Error('Library full');};
 f.advance(60000);const next=f.payload();next.source.revision='2';
 const libraryFailed=f.store.save('testroom',next);assert.equal(libraryFailed.saved,true);assert.equal(libraryFailed.library.saved,false);
 assert.match(libraryFailed.library.error,/Library full/);assert.equal(f.store.read('testroom').source.revision,'2');
 assert.equal(p.archive.session.history.timestamps.length,2,'input live arrays stay intact');
});

test('favorite keep retries after a stopped recording or reload without extending recovery lifetime',async()=>{
 const f=await fixture();f.favorite({favorite:true,autoKeep:true});const p=f.payload();p.state.active=false;p.state.status='stopped';
 p.state.stoppedReason='manual';p.state.nextAt=null;p.source.status='stopped';
 const writer=f.effects.keep;f.effects.keep=()=>{throw Error('Library full');};
 const saved=f.store.save('testroom',p);assert.equal(saved.saved,true);assert.match(saved.library.error,/Library full/);
 const raw=f.records.get(f.prefix+'testroom'),savedAt=f.store.read('testroom').savedAt;
 f.advance(60000);assert.match(f.store.retryFavorite('testroom').error,/Library full/);
 assert.equal(f.records.get(f.prefix+'testroom'),raw);
 f.effects.keep=writer;const reopened=f.reopen(),retry=reopened.retryFavorite('testroom');
 assert.equal(retry.saved,true);assert.equal(f.kept.length,1);assert.equal(reopened.read('testroom').savedAt,savedAt);
 assert.equal(reopened.retryFavorite('testroom').saved,true);assert.equal(f.kept.length,1,'successful unchanged retries are cached');
 f.advance(f.ttl);assert.equal(reopened.read('testroom'),null);
 assert.match(reopened.retryFavorite('testroom').error,/No recent/);assert.equal(f.records.get(f.prefix+'testroom'),raw);
 assert.equal(f.kept.length,1,'expiry of recovery does not remove the kept favorite');
});

test('favorite-only retries reread consent and minimum coverage without any recovery write',async()=>{
 const f=await fixture(),p=f.payload();assert(f.store.save('testroom',p).saved);
 const raw=f.records.get(f.prefix+'testroom');f.favorite({favorite:true,autoKeep:false});
 assert.equal(f.store.retryFavorite('testroom').saved,false);assert.equal(f.kept.length,0);
 f.favorite({favorite:true,autoKeep:true});f.minimum(5);
 assert.equal(f.store.retryFavorite('testroom').waiting,true);assert.equal(f.kept.length,0);
 f.minimum(3);assert.equal(f.store.retryFavorite('testroom').saved,true);assert.equal(f.kept.length,1);
 assert.equal(f.records.get(f.prefix+'testroom'),raw);
});

test('corrupt or newer recovery records are not overwritten; malformed identity cannot be stored',async()=>{
 const f=await fixture(),key=f.prefix+'testroom',p=f.payload();f.records.set(key,'corrupt');
 assert.throws(()=>f.store.read('testroom'));assert.equal(f.store.save('testroom',p).saved,false);assert.equal(f.records.get(key),'corrupt');
 f.records.delete(key);assert.equal(f.store.save('testroom',p).saved,true);const before=f.records.get(key);
 const invalid=JSON.parse(JSON.stringify(p));invalid.source.room='otherroom';
 assert.equal(f.store.save('testroom',invalid).saved,false);assert.equal(f.records.get(key),before);
 const old=JSON.parse(JSON.stringify(p));old.archive.session.sessionStartedAt-=60000;
 old.source.sessionStartedAt=old.archive.session.sessionStartedAt;old.source.sessionId='background@'+old.source.sessionStartedAt;
 old.source.id=old.source.publisherId+':testroom:'+old.source.sessionId;
 const result=f.store.save('testroom',old);assert.equal(result.saved,false);assert.match(result.error,/newer/);assert.equal(f.records.get(key),before);
});

test('verification failures retain another writer and do not roll back a read that never wrote',async()=>{
 const f=await fixture(),key=f.prefix+'testroom',p=f.payload();f.effects.set=(key,value)=>f.records.set(key,'another-writer');
 assert.equal(f.store.save('testroom',p).saved,false);assert.equal(f.records.get(key),'another-writer');
 f.records.delete(key);f.effects.set=()=>{};assert.equal(f.store.save('testroom',p).saved,false);assert.equal(f.records.size,0);
 f.effects.set=(key,value)=>f.records.set(key,value);assert.equal(f.store.save('testroom',p).saved,true);const before=f.records.get(key);
 let reads=0;f.effects.get=(key,fallback)=>{if(++reads===1)throw Error('Read failed');return f.records.has(key)?f.records.get(key):fallback;};
 assert.equal(f.store.save('testroom',p).saved,false);assert.equal(f.records.get(key),before);
});

test('discovery skips bad records and cleanup rechecks concurrent changes',async()=>{
 const f=await fixture();assert(f.store.save('testroom',f.payload()).saved);assert(f.store.save('otherroom',f.payload('otherroom')).saved);
 f.records.set(f.prefix+'badroom','broken');assert.equal(f.store.readAll().length,2);
 f.advance(f.ttl+1);let reads=0;const get=f.effects.get;
 f.effects.get=(key,fallback)=>{const value=get(key,fallback);if(key===f.prefix+'testroom'&&++reads===2){f.records.set(key,'concurrent-change');return 'concurrent-change';}return value;};
 const result=f.store.cleanupExpired();assert.equal(result.changed,1);assert.equal(result.cleared,1);assert.equal(result.damaged,1);
 assert.equal(f.records.get(f.prefix+'testroom'),'concurrent-change');assert.equal(f.records.get(f.prefix+'badroom'),'broken');
});
