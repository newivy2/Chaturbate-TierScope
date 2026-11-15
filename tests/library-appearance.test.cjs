const test=require('node:test'),assert=require('node:assert/strict');
test('Library appearance persists independently with validated defaults and failed-write feedback',async()=>{
 const {readLibraryAppearance,saveLibraryAppearance,LIBRARY_APPEARANCE_KEY:key}=await import('../src/library-appearance.js');
 const store=new Map([['trackerOpacity',30]]);
 global.GM_getValue=(k,d)=>store.has(k)?store.get(k):d;
 global.GM_setValue=(k,v)=>store.set(k,v);
 assert.deepEqual(readLibraryAppearance(),{scale:1,opacity:95});
 for(const raw of ['broken',JSON.stringify({schemaVersion:2,scale:1,opacity:95}),JSON.stringify({schemaVersion:1,scale:4,opacity:95}),JSON.stringify({schemaVersion:1,scale:1,opacity:10})]){
  store.set(key,raw);assert.deepEqual(readLibraryAppearance(),{scale:1,opacity:95});assert.equal(store.get(key),raw);
 }
 saveLibraryAppearance({scale:1.5,opacity:45});assert.deepEqual(readLibraryAppearance(),{scale:1.5,opacity:45});assert.equal(store.get('trackerOpacity'),30);
 assert.throws(()=>saveLibraryAppearance({scale:NaN,opacity:95}),/Invalid/);
 global.GM_setValue=()=>{};assert.throws(()=>saveLibraryAppearance({scale:2,opacity:50}),/could not be saved/);
 global.GM_setValue=()=>{throw Error('quota');};assert.throws(()=>saveLibraryAppearance({scale:2,opacity:50}),/quota/);
 global.GM_getValue=()=>{throw Error('unavailable');};assert.deepEqual(readLibraryAppearance(),{scale:1,opacity:95});
 delete global.GM_getValue;delete global.GM_setValue;
});
