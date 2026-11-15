const test=require('node:test'),assert=require('node:assert/strict');
test('Library appearance persists independently with validated defaults and failed-write feedback',async()=>{
 const {readLibraryAppearance,saveLibraryAppearance,LIBRARY_APPEARANCE_KEY:key}=await import('../src/library-appearance.js');
 const store=new Map([['trackerOpacity',30]]);
 global.GM_getValue=(k,d)=>store.has(k)?store.get(k):d;
 global.GM_setValue=(k,v)=>store.set(k,v);
 const defaults={scale:1,opacity:95,compactScale:1,compactOpacity:95};
 assert.deepEqual(readLibraryAppearance(),defaults);
 for(const raw of ['broken',JSON.stringify({schemaVersion:2,scale:1,opacity:95}),JSON.stringify({schemaVersion:1,scale:4,opacity:95}),JSON.stringify({schemaVersion:1,scale:1,opacity:10})]){
  store.set(key,raw);assert.deepEqual(readLibraryAppearance(),defaults);assert.equal(store.get(key),raw);
 }
 saveLibraryAppearance({scale:1.5,opacity:45});assert.deepEqual(readLibraryAppearance(),{scale:1.5,opacity:45,compactScale:1,compactOpacity:95});assert.equal(store.get('trackerOpacity'),30);
 assert.throws(()=>saveLibraryAppearance({scale:NaN,opacity:95}),/Invalid/);
 global.GM_setValue=()=>{};assert.throws(()=>saveLibraryAppearance({scale:2,opacity:50}),/could not be saved/);
 global.GM_setValue=()=>{throw Error('quota');};assert.throws(()=>saveLibraryAppearance({scale:2,opacity:50}),/quota/);
 global.GM_getValue=()=>{throw Error('unavailable');};assert.deepEqual(readLibraryAppearance(),defaults);
 delete global.GM_getValue;delete global.GM_setValue;
});

test('legacy Library appearance fills compact defaults without rewriting saved settings',async()=>{
 const {readLibraryAppearance,LIBRARY_APPEARANCE_KEY:key}=await import('../src/library-appearance.js');
 const store=new Map();let writes=0;
 global.GM_getValue=(k,d)=>store.has(k)?store.get(k):d;global.GM_setValue=()=>writes++;
 try{
  for(const raw of [JSON.stringify({schemaVersion:1,scale:1.4,opacity:55}),{schemaVersion:1,scale:1.4,opacity:55}]){
   store.set(key,raw);assert.deepEqual(readLibraryAppearance(),{scale:1.4,opacity:55,compactScale:1,compactOpacity:95});
   assert.equal(store.get(key),raw);
  }
  store.set(key,JSON.stringify({schemaVersion:1,scale:1.4,opacity:55,compactScale:1.8}));
  assert.deepEqual(readLibraryAppearance(),{scale:1.4,opacity:55,compactScale:1.8,compactOpacity:95});
  assert.equal(writes,0,'reading legacy or partial compact settings never performs a migration write');
 }finally{delete global.GM_getValue;delete global.GM_setValue;}
});

test('full and chart-only Library appearances round-trip independently through combined saves',async()=>{
 const {readLibraryAppearance,saveLibraryAppearance,LIBRARY_APPEARANCE_KEY:key}=await import('../src/library-appearance.js');
 const store=new Map([['trackerOpacity',30]]);global.GM_getValue=(k,d)=>store.has(k)?store.get(k):d;global.GM_setValue=(k,v)=>store.set(k,v);
 try{
  saveLibraryAppearance({scale:1.5,opacity:70,compactScale:.75,compactOpacity:40});
  const compact=readLibraryAppearance();assert.deepEqual(compact,{scale:1.5,opacity:70,compactScale:.75,compactOpacity:40});
  saveLibraryAppearance({...compact,scale:2.5,opacity:55});
  assert.deepEqual(readLibraryAppearance(),{scale:2.5,opacity:55,compactScale:.75,compactOpacity:40});
  saveLibraryAppearance({...readLibraryAppearance(),compactScale:.9,compactOpacity:85});
  assert.deepEqual(readLibraryAppearance(),{scale:2.5,opacity:55,compactScale:.9,compactOpacity:85});
  const saved=JSON.parse(store.get(key));assert.equal(saved.schemaVersion,1);
  assert.deepEqual(Object.keys(saved).sort(),['compactOpacity','compactScale','opacity','scale','schemaVersion']);
  assert.equal(store.get('trackerOpacity'),30,'neither Library mode changes Scope appearance');
  for(const settings of [{scale:.5,opacity:100,compactScale:3,compactOpacity:30},{scale:3,opacity:30,compactScale:.5,compactOpacity:100}]){
   saveLibraryAppearance(settings);assert.deepEqual(readLibraryAppearance(),settings,'both modes accept the supported scale/opacity endpoints');
  }
 }finally{delete global.GM_getValue;delete global.GM_setValue;}
});

test('invalid compact appearance rejects saves and reads fall back without changing the original record',async()=>{
 const {readLibraryAppearance,saveLibraryAppearance,LIBRARY_APPEARANCE_KEY:key}=await import('../src/library-appearance.js');
 const store=new Map();global.GM_getValue=(k,d)=>store.has(k)?store.get(k):d;global.GM_setValue=(k,v)=>store.set(k,v);
 const valid={schemaVersion:1,scale:1.4,opacity:55,compactScale:.8,compactOpacity:45},defaults={scale:1,opacity:95,compactScale:1,compactOpacity:95};
 try{
  for(const patch of [{compactScale:.49},{compactScale:3.01},{compactScale:NaN},{compactScale:Infinity},{compactScale:'1'},
   {compactScale:null},{compactScale:undefined},{compactOpacity:29},{compactOpacity:101},{compactOpacity:NaN},
   {compactOpacity:'95'},{compactOpacity:null},{compactOpacity:undefined}]){
   const invalid={...valid,...patch};store.set(key,invalid);
   assert.deepEqual(readLibraryAppearance(),defaults,'one invalid compact field invalidates the appearance record consistently');
   assert.equal(store.get(key),invalid,'invalid stored values remain untouched');
   assert.throws(()=>saveLibraryAppearance(invalid),/Invalid Library appearance/);
   assert.equal(store.get(key),invalid,'a rejected save cannot replace the existing record');
  }
 }finally{delete global.GM_getValue;delete global.GM_setValue;}
});
