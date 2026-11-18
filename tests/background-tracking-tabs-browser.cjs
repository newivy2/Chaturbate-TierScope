const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {instrument,prepareSource}=require('./helpers/instrument.cjs');
const engine=process.env.TIERSCOPE_BROWSER||'chromium';
const source=instrument(prepareSource(fs.readFileSync(path.join(__dirname,'../tierscope.user.js'),'utf8'))
 .replaceAll('scheduleInit(2000);','').replace('downloadTrackingReport: downloadTrackingReport,',`__backgroundTabs:{
 async setup(){loadSession(getModelName());isPaused=true;isAutoRefreshOn=false;isMinimized=true;createPanel();toggleView();stopCountdown();
 initializeBackgroundTracking();await tickBackgroundTracking();},
 start:startPersistentBackgroundComparison,stop:stopPersistentBackgroundComparison,tick:tickBackgroundTracking,
 refresh:refreshPersistentBackgroundComparison,states:getPersistentBackgroundComparisonStates,
 sources:readPersistentBackgroundComparisonSources,
 archive(room){const source=readPersistentBackgroundComparisonSources().sources.find(source=>source.room===room);
 return source&&source.sampleCount?readPersistentBackgroundComparisonArchive(source):null;},
 shutdown:shutdownBackgroundTracking
 },downloadTrackingReport: downloadTrackingReport,`));

(async()=>{
 const browser=await require('playwright')[engine].launch({headless:true,executablePath:process.env.TIERSCOPE_CHROMIUM_PATH,args:JSON.parse(process.env.TIERSCOPE_CHROMIUM_ARGS||'[]')});
 try{
  const context=await browser.newContext({viewport:{width:1300,height:950}}),errors=[],calls=[],held=[];
  context.setDefaultTimeout(12000);
  await context.addInitScript(()=>{
   const prefix='test:gm:',handlers=new Map();let nextListener=0,intervalId=0;
   Date.now=()=>Number(localStorage.getItem('test:now')||Date.UTC(2026,10,16,12));
   window.setInterval=()=>++intervalId;window.clearInterval=()=>{};
   const schedule=window.setTimeout.bind(window);
   window.setTimeout=(callback,ms,...args)=>schedule(ms>=60000?()=>{}:callback,ms,...args);
   const decode=raw=>raw===null?undefined:JSON.parse(raw);
   const notify=(key,old,value,remote)=>{for(const handler of handlers.values())if(handler.key===key)handler.callback(key,old,value,remote);};
   window.GM_getValue=(key,fallback)=>localStorage.getItem(prefix+key)===null?fallback:decode(localStorage.getItem(prefix+key));
   window.GM_setValue=(key,value)=>{const old=decode(localStorage.getItem(prefix+key));localStorage.setItem(prefix+key,JSON.stringify(value));notify(key,old,value,false);};
   window.GM_deleteValue=key=>{const old=decode(localStorage.getItem(prefix+key));localStorage.removeItem(prefix+key);notify(key,old,undefined,false);};
   window.GM_listValues=()=>Object.keys(localStorage).filter(key=>key.startsWith(prefix)).map(key=>key.slice(prefix.length));
   window.GM_addValueChangeListener=(key,callback)=>{const id=++nextListener;handlers.set(id,{key,callback});return id;};
   window.GM_removeValueChangeListener=id=>handlers.delete(id);
   window.addEventListener('storage',event=>{if(event.key?.startsWith(prefix))notify(event.key.slice(prefix.length),decode(event.oldValue),decode(event.newValue),true);});
  });
  let mode='valid',heldReady;
  await context.route('https://tierscope.test/**',route=>{
   const url=new URL(route.request().url());
   if(url.pathname==='/api/getchatuserlist/'){
    const room=url.searchParams.get('roomname'),host=new URL(route.request().frame().url()).pathname;calls.push({room,host});
    if(process.env.TIERSCOPE_BACKGROUND_DEBUG)console.log(engine+': request '+room+' from '+host+' ('+mode+')');
    if(mode==='held'){held.push(route);if(heldReady)heldReady(route);return;}
    return route.fulfill({body:'5,'+room+'|o|f|0,viewer|m|m|0'});
   }
   return route.fulfill({contentType:'text/html',body:'<!doctype html><body></body>'});
  });
  const open=async room=>{
   const page=await context.newPage();page.on('pageerror',error=>{errors.push(error.message);if(process.env.TIERSCOPE_BACKGROUND_DEBUG)console.error(error.stack);});
   await page.goto('https://tierscope.test/'+room+'/');await page.addScriptTag({content:source});
   await page.evaluate(()=>ViewerTracker.__backgroundTabs.setup());return page;
  };
  const alpha=await open('host_alpha'),beta=await open('host_beta');let clockPage=beta;
  const advance=ms=>clockPage.evaluate(ms=>localStorage.setItem('test:now',String(Date.now()+ms)),ms);
  const sources=page=>page.evaluate(()=>ViewerTracker.__backgroundTabs.sources().sources);
  const state=(page,room)=>page.evaluate(room=>ViewerTracker.__backgroundTabs.states().find(state=>state.room===room),room);
  const count=async(page,room,n)=>{
   try{
    // Intervals are controlled by the fixture. Reconcile the observing tab as
    // the normal heartbeat would: a follower may not receive a storage event
    // promptly while Firefox has another page in front.
    const deadline=Date.now()+12000;
    while(Date.now()<deadline){
     await tick(page);
     const accepted=await page.evaluate(({room,n})=>
      ViewerTracker.__backgroundTabs.sources().sources.find(source=>source.room===room)?.sampleCount===n,{room,n});
     if(accepted)return;
     await page.waitForTimeout(100);
    }
    throw new Error('Expected '+room+' to have exactly '+n+' accepted samples within 12 seconds.');
   }catch(error){
    const tabs=await Promise.all(context.pages().filter(tab=>!tab.isClosed()).map(tab=>tab.evaluate(()=>({
     url:location.href,now:Date.now(),locks:typeof navigator.locks?.request,
     states:ViewerTracker.__backgroundTabs.states(),sources:ViewerTracker.__backgroundTabs.sources(),
     leases:Object.fromEntries(Object.entries(localStorage).filter(([key])=>key.startsWith('tierscope:background-owner:v1:'))),
     preferences:Object.fromEntries(GM_listValues().filter(key=>key.startsWith('tierscope:background-tracking:v1:')).map(key=>[key,GM_getValue(key)])),
     recordings:GM_listValues().filter(key=>key.startsWith('tierscope:background-recording:v1:'))
    }))));
    throw new Error(error.message+'\nRequests: '+JSON.stringify(calls)+'\nTabs: '+JSON.stringify(tabs));
   }
  };
  const tick=page=>page.evaluate(()=>ViewerTracker.__backgroundTabs.tick());
  const refresh=(page,room)=>page.evaluate(room=>Promise.race([ViewerTracker.__backgroundTabs.refresh(room),
   new Promise((resolve,reject)=>setTimeout(()=>reject(new Error('Fixture refresh stalled for '+room)),6000))]),room);
  const library=page=>page.evaluate(()=>GM_listValues().filter(key=>key.startsWith('tierscope:library:v1:')));
  assert.equal(calls.length,0,'opening ordinary pages with no selected rooms makes no background requests');
  await alpha.bringToFront();await alpha.evaluate(()=>ViewerTracker.__backgroundTabs.start('shared_model'));await count(alpha,'shared_model',1);
  await tick(beta);await count(beta,'shared_model',1);
  const original=(await sources(alpha)).find(source=>source.room==='shared_model'),initialCalls=calls.length;
  assert.equal(initialCalls,1);
  const owner=calls[0].host==='/host_alpha/'?alpha:beta,survivor=owner===alpha?beta:alpha;
  await tick(survivor);
  assert.equal(calls.length,initialCalls,'a second tab consumes the shared recording instead of scanning the same room');
  assert.deepEqual(await beta.evaluate(()=>ViewerTracker.__backgroundTabs.archive('shared_model')),
   await alpha.evaluate(()=>ViewerTracker.__backgroundTabs.archive('shared_model')),'both tabs read the same aggregate recording');

  // Explicit pagehide releases this tab's lease before destroying its browser
  // page; Firefox does not reliably deliver unload for immediate test closes.
  await advance(60000);clockPage=survivor;
  await owner.evaluate(()=>window.dispatchEvent(new Event('pagehide')));await owner.close();
  await tick(survivor);await count(survivor,'shared_model',2);
  const resumed=(await sources(survivor)).find(source=>source.room==='shared_model');
  assert.equal(resumed.id,original.id,'failover restores the same recent recording identity');
  assert.equal(resumed.sampleCount,2,'failover has accepted the new owner’s real response');
  const resumedArchive=await survivor.evaluate(()=>ViewerTracker.__backgroundTabs.archive('shared_model'));
  assert(resumedArchive,'the accepted failover snapshot must have a readable archive');
  assert.equal(resumedArchive.session.history.timestamps.length,2);
  assert.equal(resumedArchive.session.history.breaks[1],true,'ownership changes leave an explicit recording gap');
  assert.equal(calls.length,initialCalls+1,'only the new owner polls after the previous host closes');
  const gamma=await open('host_gamma');await tick(gamma);await count(gamma,'shared_model',2);
  const beforeFollower=calls.length;await tick(gamma);assert.equal(calls.length,beforeFollower,'a newly opened tab also follows the established owner');

  await gamma.evaluate(()=>ViewerTracker.__backgroundTabs.stop('shared_model'));await tick(survivor);
  assert.equal((await state(survivor,'shared_model'))?.active||false,false,'Stop from a follower is applied to the owner');
  await advance(60000);await refresh(survivor,'shared_model');
  assert.equal(calls.length,beforeFollower,'a globally stopped room cannot be silently restarted by another tab');

  // Stopping in another tab invalidates an in-flight response in the owner.
  mode='held';await advance(60000);const ready=new Promise(resolve=>{heldReady=resolve;});
  await survivor.evaluate(()=>ViewerTracker.__backgroundTabs.start('held_model'));const pending=await ready;
  await gamma.evaluate(()=>ViewerTracker.__backgroundTabs.stop('held_model'));await tick(survivor);
  await pending.fulfill({body:'5,held_model|o|f|0,viewer|m|m|0'}).catch(()=>{});
  const canceled=(await sources(survivor)).find(source=>source.room==='held_model');
  assert(!canceled||!canceled.sampleCount,'a late response cannot restore a room stopped from another tab');
  assert.equal((await state(survivor,'held_model'))?.active||false,false);
  assert.deepEqual(await library(survivor),[]);assert.deepEqual(await library(gamma),[],'unfavorited comparison recordings remain outside permanent Library storage');
  assert.deepEqual(errors,[]);
  await survivor.evaluate(()=>ViewerTracker.__backgroundTabs.shutdown());await gamma.evaluate(()=>ViewerTracker.__backgroundTabs.shutdown());
  await context.close();
  console.log(engine+': background rooms have one cross-tab owner, share aggregate history, fail over with a gap and respect follower Stop plus late-response cancellation');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
