const test=require('node:test'),assert=require('node:assert/strict');

async function fixture(store=new Map()){
 const {createComparisonDismissals,COMPARISON_DISMISSAL_PREFIX:prefix}=await import('../src/comparison-dismissals.js');
 let now=1000000,notices=0,lists=0,reads=0,remote=null,subscriptions=0;
 const effects={get:(key,fallback)=>{reads++;return store.has(key)?store.get(key):fallback;},
  set:(key,value)=>store.set(key,value),remove:key=>store.delete(key),list:()=>{lists++;return [...store.keys()];},now:()=>now,
  notice:()=>notices++,subscribe:changed=>{subscriptions++;remote=changed;return()=>{subscriptions--;remote=null;};}};
 const api=createComparisonDismissals(effects);
 return {api,effects,store,prefix,key:id=>prefix+id,advance:ms=>now+=ms,
  remote:()=>remote&&remote(),notices:()=>notices,lists:()=>lists,reads:()=>reads,subscriptions:()=>subscriptions,
  reopen:()=>createComparisonDismissals(effects)};
}
function source(room='alice',patch={}){return {id:'publisher:'+room+':legacy@100',room,sessionStartedAt:100,sampleAt:900000,sampleCount:3,...patch};}

test('cleanup remains hidden across reopen, heartbeat changes and long waits; accepted data or a new session returns',async()=>{
 const f=await fixture(),a=source();assert.equal(f.api.isHidden(a),false);assert.equal(f.api.dismiss([a]),1);
 assert.equal(f.api.isHidden(a),true);assert.equal(f.reopen().isHidden(a),true);
 assert.equal(f.api.isHidden({...a,status:'tracking',lastSeenAt:1000000,revision:'new heartbeat'}),true);
 f.advance(365*86400000);assert.equal(f.api.isHidden(a),true,'unchanged stopped sources do not return on a timer');
 assert.equal(f.api.isHidden({...a,sampleAt:a.sampleAt+1}),false);
 assert.equal(f.api.isHidden({...a,sampleCount:4}),false);
 assert.equal(f.api.isHidden({...a,id:a.id+'-another-tab'}),false);
 assert.equal(f.api.isHidden({...a,sessionStartedAt:101}),false);
 assert.equal(f.api.isHidden({...a,room:'another_model'}),false);
 assert.equal(f.lists(),0,'ordinary render checks never scan all GM keys');
});

test('room restart only clears that room’s dismissal markers without touching tracking, Library or recovery',async()=>{
 const f=await fixture(),a=source(),second=source('alice',{id:'other:alice:legacy@100'}),b=source('bob');
 f.store.set('tierscope:library:v1:example','recording');f.store.set('tierscope:background-recording:v1:alice','recovery');
 f.store.set('tierscope:background-tracking:v1:alice','tracking choice');
 f.api.dismiss([a,second,b]);assert.equal(f.api.clearRoom('ALICE'),2);
 assert.equal(f.api.isHidden(a),false);assert.equal(f.api.isHidden(second),false);assert.equal(f.api.isHidden(b),true);
 assert.equal(f.store.get('tierscope:library:v1:example'),'recording');
 assert.equal(f.store.get('tierscope:background-recording:v1:alice'),'recovery');
 assert.equal(f.store.get('tierscope:background-tracking:v1:alice'),'tracking choice');
 assert.equal(f.api.clearRoom('unknown_room'),0);
});

test('zero-sample sources can be dismissed and their first accepted sample returns',async()=>{
 const f=await fixture(),waiting=source('alice',{sessionStartedAt:null,sampleAt:null,sampleCount:0});
 f.api.dismiss([waiting]);assert.equal(f.api.isHidden(waiting),true);
 assert.equal(f.api.isHidden({...waiting,sampleAt:950000,sampleCount:1}),false);
});

test('partially failed room restart reports the failure and refreshes already removed markers',async()=>{
 const f=await fixture(),a=source(),second=source('alice',{id:'other:alice:legacy@100'});
 f.api.dismiss([a,second]);assert.equal(f.api.isHidden(a),true);
 const remove=f.effects.remove;
 f.effects.remove=key=>{if(key===f.key(second.id))throw Error('delete blocked');return remove(key);};
 assert.throws(()=>f.api.clearRoom('alice'),/delete blocked/);
 assert.equal(f.api.isHidden(a),false);assert.equal(f.api.isHidden(second),true);
});

test('dropped or failed writes report failure and leave existing preferences intact',async()=>{
 const f=await fixture(),a=source();f.api.dismiss([a]);const before=f.store.get(f.key(a.id));
 f.effects.set=()=>{};assert.throws(()=>f.api.dismiss([{...a,sampleCount:4}]),/verified/);
 assert.equal(f.store.get(f.key(a.id)),before);
 f.effects.set=()=>{throw Error('quota');};assert.throws(()=>f.api.dismiss([{...a,sampleCount:5}]),/quota/);
 assert.equal(f.store.get(f.key(a.id)),before);assert.equal(f.api.isHidden({...a,sampleCount:4}),false);
 const fresh=source('bob');assert.throws(()=>f.api.dismiss([fresh]),/quota/);assert.equal(f.api.isHidden(fresh),false);
});

test('failed verification rolls back its own write and preserves a concurrent replacement',async()=>{
 const f=await fixture(),a=source();f.api.dismiss([a]);const key=f.key(a.id),before=f.store.get(key),get=f.effects.get;
 let throwOnce=false;f.effects.set=(k,v)=>{f.store.set(k,v);throwOnce=true;};
 f.effects.get=(k,d)=>{if(throwOnce&&k===key){throwOnce=false;throw Error('read failure');}return get(k,d);};
 assert.throws(()=>f.api.dismiss([{...a,sampleCount:4}]),/read failure/);assert.equal(f.store.get(key),before);
 f.effects.get=get;throwOnce=false;
 const other=JSON.stringify({...JSON.parse(before),sampleCount:20});
 f.effects.set=(k,v)=>f.store.set(k,other);
 assert.throws(()=>f.api.dismiss([{...a,sampleCount:5}]),/verified/);
 assert.equal(f.store.get(key),other,'rollback never overwrites a concurrent dismissal');
});

test('batch failures expose partial cleanup rather than claim an atomic save',async()=>{
 const f=await fixture(),a=source(),b=source('bob'),set=f.effects.set;
 f.effects.set=(key,value)=>{if(key===f.key(b.id))throw Error('blocked');return set(key,value);};
 assert.throws(()=>f.api.dismiss([a,b]),/blocked/);
 assert.equal(f.api.isHidden(a),true);assert.equal(f.api.isHidden(b),false);assert.equal(f.notices(),1);
});

test('invalid records are preserved and unreadable preferences fail open',async()=>{
 const f=await fixture(),a=source(),key=f.key(a.id);
 for(const raw of ['broken',JSON.stringify({schemaVersion:2,...a,dismissedAt:1000000}),JSON.stringify({schemaVersion:1,...a,sampleCount:-1,dismissedAt:1000000})]){
  f.store.set(key,raw);f.advance(1000);assert.equal(f.api.isHidden(a),false);
  assert.throws(()=>f.api.dismiss([a]));assert.equal(f.store.get(key),raw);
  assert.equal(f.api.clearRoom('alice'),0);assert.equal(f.store.get(key),raw);
 }
 f.effects.get=()=>{throw Error('storage unavailable');};f.advance(1000);assert.equal(f.api.isHidden(a),false);
 for(const invalid of [{...a,id:'bad\nidentity'},{...a,sampleAt:null},{...a,room:'bad/room'},{...a,sessionStartedAt:NaN}]){
  assert.throws(()=>f.api.dismiss([invalid]),/Invalid/);assert.equal(f.api.isHidden(invalid),false);
 }
});

test('remote cleanup invalidates lazy reads and subscriptions share one storage listener',async()=>{
 const f=await fixture(),a=source();let first=0,second=0;
 const stopFirst=f.api.subscribe(()=>first++),stopSecond=f.api.subscribe(()=>second++);
 assert.equal(f.subscriptions(),1);assert.equal(f.api.isHidden(a),false);const reads=f.reads();
 assert.equal(f.api.isHidden(a),false);assert.equal(f.reads(),reads,'immediate repeated checks reuse the lazy read');
 f.reopen().dismiss([a]);assert.equal(f.api.isHidden(a),false,'another tab write may await its notification');
 f.remote();assert.equal(f.api.isHidden(a),true);assert.equal(first,1);assert.equal(second,1);
 stopFirst();assert.equal(f.subscriptions(),1);stopSecond();assert.equal(f.subscriptions(),0);
 f.reopen().clearRoom('alice');f.advance(1000);assert.equal(f.api.isHidden(a),false,'periodic reads recover missed notifications');
});

test('older cleanup cannot lower an existing sample watermark; explicit complete discovery can prune vanished IDs',async()=>{
 const f=await fixture(),a=source(),b=source('bob');f.api.dismiss([{...a,sampleCount:10,sampleAt:950000},b]);
 assert.equal(f.api.dismiss([a,a]),0);
 assert.equal(f.api.isHidden({...a,sampleCount:9,sampleAt:940000}),true);
 assert.equal(f.api.prune([a]),1);assert.equal(f.api.isHidden(a),true);assert.equal(f.api.isHidden(b),false);
});
