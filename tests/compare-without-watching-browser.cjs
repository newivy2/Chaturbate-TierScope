const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {instrument,prepareSource}=require('./helpers/instrument.cjs');
const engine=process.env.TIERSCOPE_BROWSER||'chromium';
const source=instrument(prepareSource(fs.readFileSync(path.join(__dirname,'../tierscope.user.js'),'utf8'))
 .replaceAll('scheduleInit(2000);','').replace('downloadTrackingReport: downloadTrackingReport,',`__backgroundTest:{
 async setup(){const room=getModelName();loadSession(room);const now=Date.now(),timestamps=[now-180000,now-120000,now-60000],h={timestamps,breaks:[false,false,false]};
 STORAGE_HISTORY_SERIES.forEach(k=>h[k]=[0,0,0]);h.total=[10,20,30];h.red=h.total.slice();h.withTokens=h.total.slice();h.anonymous=[5,5,5];
 restoreSessionState(normalizeStoredSession({timestamp:now,history:h,sessionStartedAt:timestamps[0],sessionStartEstimated:false,isPaused:true,
 pausedElapsedTime:120000,roomTotalHigh:35,roomTotalHighTime:timestamps[2]}));
 isAutoRefreshOn=false;isMinimized=true;createPanel();toggleView();repaintLivePresentation();stopCountdown();initializeLiveModelSources();saveSession(room,true);
 initializeBackgroundTracking();await tickBackgroundTracking();},
 state:()=>({history:JSON.stringify(history),users:JSON.stringify([...users]),highs:JSON.stringify(sessionHighs),paused:isPaused,stopped:isStopped,automatic:isAutoRefreshOn,mode:presentationMode}),
 status:getPersistentBackgroundComparisonState,states:getPersistentBackgroundComparisonStates,sources:readPersistentBackgroundComparisonSources,stop:stopPersistentBackgroundComparison,tick:tickBackgroundTracking,
 async refresh(room){await tickBackgroundTracking();return refreshPersistentBackgroundComparison(room);},
 archive(room){const source=readPersistentBackgroundComparisonSources().sources.find(source=>source.room===room);return source&&source.sampleCount?readPersistentBackgroundComparisonArchive(source):null;},
 leave(){window.history.pushState({},'', '/other_host/');checkUrlChange();},
 stopSources(){shutdownBackgroundTracking();stopLiveModelSources();},policy:readRequestPolicy
 },downloadTrackingReport: downloadTrackingReport,`));

(async()=>{
 const browser=await require('playwright')[engine].launch({headless:true,executablePath:process.env.TIERSCOPE_CHROMIUM_PATH,args:JSON.parse(process.env.TIERSCOPE_CHROMIUM_ARGS||'[]')});
 try{
  const context=await browser.newContext({viewport:{width:1450,height:1100}}),page=await context.newPage(),errors=[],calls=[],held=[];
  context.setDefaultTimeout(12000);page.on('pageerror',e=>{errors.push(e.message);if(process.env.TIERSCOPE_BACKGROUND_DEBUG)console.error(e.stack);});
  await context.addCookies([{name:'sessionid',value:'fixture-session',domain:'tierscope.test',path:'/'}]);
  await context.addInitScript(()=>{
   Date.now=()=>Number(localStorage.getItem('test:now')||Date.UTC(2026,10,16,12));
   // Keep lease/scan time deterministic: the fixture explicitly reconciles and
   // refreshes; the production manager's immediate start timeouts still run.
   let intervalId=0;window.setInterval=()=>++intervalId;window.clearInterval=()=>{};
   const schedule=window.setTimeout.bind(window);
   window.setTimeout=(callback,ms,...args)=>schedule(ms>=60000?()=>{}:callback,ms,...args);
   const handlers=new Map();let sequence=0;
   window.GM_getValue=(key,fallback)=>localStorage.getItem(key)===null?fallback:JSON.parse(localStorage.getItem(key));
   window.GM_setValue=(key,value)=>{const old=GM_getValue(key);localStorage.setItem(key,JSON.stringify(value));for(const listener of handlers.values())if(listener.key===key)listener.callback(key,old,value,false);};
   window.GM_deleteValue=key=>{const old=GM_getValue(key);localStorage.removeItem(key);for(const listener of handlers.values())if(listener.key===key)listener.callback(key,old,undefined,false);};
   window.GM_listValues=()=>Object.keys(localStorage);
   window.GM_addValueChangeListener=(key,callback)=>{const id=++sequence;handlers.set(id,{key,callback});return id;};
   window.GM_removeValueChangeListener=id=>handlers.delete(id);
  });
  let mode='valid',viewers=3,heldReady;
  await context.route('https://tierscope.test/**',route=>{
   const url=new URL(route.request().url());
   if(url.pathname==='/api/getchatuserlist/'){
    if(process.env.TIERSCOPE_BACKGROUND_DEBUG)console.log(engine+': request '+url.searchParams.get('roomname')+' ('+mode+')');
    calls.push({room:url.searchParams.get('roomname'),query:Object.fromEntries(url.searchParams),headers:route.request().headers(),method:route.request().method()});
    if(mode==='held'){held.push(route);if(heldReady)heldReady(route);return;}
    if(mode==='403')return route.fulfill({status:403,body:'Unavailable'});
    if(mode==='malformed')return route.fulfill({body:'not a user list'});
    if(mode==='mismatch')return route.fulfill({body:'5,current_model|o|f|0,viewer_0|m|m|0'});
    if(mode==='empty')return route.fulfill({body:'0'});
    if(mode==='absent')return route.fulfill({body:'5,viewer_0|m|m|0'});
    return route.fulfill({body:'5,'+url.searchParams.get('roomname')+'|o|f|0,'+Array.from({length:viewers},(_,i)=>'viewer_'+i+'|m|m|0').join(',')});
   }
   return route.fulfill({contentType:'text/html',body:'<!doctype html><body style="background:#303846"><button id="UserListTab" onclick="window.tabClicks++">Users</button><button>Chat</button><script>window.tabClicks=0</script></body>'});
  });
  await page.goto('https://tierscope.test/current_model/');await page.addScriptTag({content:source});await page.evaluate(()=>ViewerTracker.__backgroundTest.setup());
  const initial=await page.evaluate(()=>ViewerTracker.__backgroundTest.state());
  const saved=()=>page.evaluate(()=>Object.fromEntries(Object.entries(localStorage).filter(([key])=>key.startsWith('tierscope:library:v1:'))));
  const beforeLibrary=await saved(),advance=async ms=>{
   // Renew the production lease while advancing the clock. A large jump with
   // no heartbeat would correctly mean suspension/failover, not continuous time.
   while(ms>0){const step=Math.min(ms,20000);await page.evaluate(step=>localStorage.setItem('test:now',String(Date.now()+step)),step);
    await page.evaluate(()=>ViewerTracker.__backgroundTest.tick());ms-=step;}
  };
  const sources=()=>page.evaluate(()=>ViewerTracker.__backgroundTest.sources().sources);
  const archive=(room='comparison_model')=>page.evaluate(room=>ViewerTracker.__backgroundTest.archive(room),room);
  const refresh=(room='comparison_model')=>page.evaluate(room=>Promise.race([ViewerTracker.__backgroundTest.refresh(room),
   new Promise((resolve,reject)=>setTimeout(()=>reject(new Error('Fixture refresh stalled for '+room)),6000))]),room);
  const sourceFor=async room=>(await sources()).find(source=>source.room===room);
  const state=room=>page.evaluate(room=>ViewerTracker.__backgroundTest.status(room),room);
  const sourceCount=async(n,room='comparison_model')=>page.waitForFunction(({n,room})=>ViewerTracker.__backgroundTest.sources().sources.find(source=>source.room===room)?.sampleCount===n,{n,room});
  const stop=async room=>page.locator('[data-background-room="'+room+'"] [data-background-stop]').click();
  const start=async room=>{
   if(!await page.locator('#tools-background-room').count())await page.click('[data-tools-tab=library]');
   await page.fill('#tools-background-room',room);await page.click('#tools-compare-background');
  };
  await page.click('#btn-control-library');
  const card=page.locator('#tools-current-card');
  assert.equal(await card.locator('#tools-compare-previous').textContent(),'Compare with previous');
  assert.equal(await card.locator('#tools-compare-live').textContent(),'Compare all live sessions');
  assert.equal(await card.locator('#tools-compare-last24h').textContent(),'Compare last 24h sessions');
  assert.equal(await card.locator('#tools-compare-background').textContent(),'Compare without watching');
  assert.equal(calls.length,0,'opening Library adds no background scan');
  await start('https://invalid.test/room/');assert.equal(await page.locator('#tools-background-room').evaluate(e=>e.validity.valid),false);
  await start('current_model');assert.equal(await page.locator('#tools-background-room').evaluate(e=>e.validity.valid),false);
  assert.equal(calls.length,0,'invalid input and the already tracked room cannot start background requests');
  await page.fill('#tools-background-room','');
  await page.screenshot({path:'/tmp/tierscope-compare-without-watching-card-'+engine+'.png'});
  await start('comparison_model');await sourceCount(1);
  await page.waitForFunction(()=>document.querySelector('.tools-live-source[data-live-room="comparison_model"] input[data-live-source]')?.checked);
  assert.equal(await page.locator('#tools-compare-live').textContent(),'Live models','comparison-mode labels remain unchanged');
  assert.equal(await page.locator('.tools-live-source[data-live-room="current_model"] input[data-live-source]').isChecked(),true);
  assert.equal(await page.locator('#tools-analysis-chart').count(),1);
  await page.screenshot({path:'/tmp/tierscope-compare-without-watching-live-'+engine+'.png'});
  assert.match(await page.locator('.tools-live-source[data-live-room="comparison_model"]').textContent(),/without watching|background/i);
  assert.equal(page.url(),'https://tierscope.test/current_model/','comparison never navigates to the watched room');
  assert.equal(context.pages().length,1,'the requested room has no tab or iframe');
  assert.equal(calls[0].room,'comparison_model');assert.equal(calls[0].method,'GET');
  assert.equal(calls[0].headers['x-requested-with'],'XMLHttpRequest');assert.match(calls[0].headers.cookie,/sessionid=fixture-session/);
  assert.equal(calls[0].query.private,'false');assert.equal(calls[0].query.exclude_staff,'false');
  const first=await archive();assert.deepEqual(first.session.history.total,[4]);assert.deepEqual(first.session.history.anonymous,[5]);
  assert.deepEqual(first.session.history.timestamps,[Date.UTC(2026,10,16,12)]);
  await advance(3000);viewers=5;await refresh();await sourceCount(2);
  let second=await archive();assert.deepEqual(second.session.history.total,[4,6]);assert.deepEqual(second.session.history.anonymous,[5,5]);
  assert.equal(second.session.history.timestamps[1]-second.session.history.timestamps[0],3000);
  assert.deepEqual(await page.evaluate(()=>ViewerTracker.__backgroundTest.state()),initial,'background samples cannot change the current room owner');
  assert.deepEqual(await saved(),beforeLibrary,'background comparison never keeps sessions implicitly');
  const firstId=(await sourceFor('comparison_model')).id;
  await advance(3000);await start('second_model');await sourceCount(1,'second_model');
  assert.equal((await sourceFor('comparison_model')).id,firstId,'adding another room retains the first recording identity');
  assert.deepEqual((await archive()).session.history,second.session.history,'adding another room does not replace the first history');
  assert.equal(await page.locator('.tools-live-source[data-live-room="comparison_model"] input[data-live-source]').isChecked(),true,'adding a room preserves the earlier comparison selection');
  assert.equal(await page.locator('.tools-live-source[data-live-room="second_model"] input[data-live-source]').isChecked(),true);
  await page.screenshot({path:'/tmp/tierscope-multi-room-comparison-'+engine+'.png'});
  await page.locator('#tools-live-chooser').evaluate(e=>e.open=true);
  const backgroundCheck=page.locator('.tools-live-source[data-live-room="comparison_model"] input[data-live-source]');
  await backgroundCheck.uncheck();await advance(3000);await refresh();await sourceCount(3);
  assert.equal(await backgroundCheck.isChecked(),false,'new samples never reselect a manually hidden background room');
  await backgroundCheck.check();await page.click('#tools-live-freeze');
  const displayedSamples=await page.locator('[data-live-report="comparison_model"] td').nth(2).textContent();
  await advance(3000);await refresh();await sourceCount(4);
  assert.equal(await page.locator('#tools-live-freeze').getAttribute('aria-pressed'),'true');
  assert.equal(await page.locator('[data-live-report="comparison_model"] td').nth(2).textContent(),displayedSamples,'Freeze retains the displayed background snapshot while acquisition continues');
  await page.click('#tools-live-freeze');
  assert.equal(await page.locator('[data-live-report="comparison_model"] td').nth(2).textContent(),'4');second=await archive();
  await advance(3000);mode='mismatch';let requests=calls.length;await refresh();assert.equal(calls.length,requests+1);
  assert.deepEqual((await archive()).session.history,second.session.history,'a server response identifying another broadcaster is rejected');
  await advance(3000);mode='malformed';requests=calls.length;await refresh();assert.equal(calls.length,requests+1);
  assert.deepEqual((await archive()).session.history,second.session.history);
  assert.equal((await sourceFor('comparison_model')).sampleCount,4,'malformed data never appends a fake sample');
  await advance(3000);mode='empty';requests=calls.length;await refresh();assert.equal(calls.length,requests+1);
  assert.deepEqual((await archive()).session.history,second.session.history,'empty room response is not invented as zero audience');
  await advance(3000);mode='403';requests=calls.length;await refresh();assert.equal(calls.length,requests+1);
  assert.deepEqual((await archive()).session.history,second.session.history);
  assert.equal((await state('comparison_model')).active,true,'an access error is not confirmed broadcaster absence and cannot silently remove the tracked room');
  assert.equal((await page.evaluate(()=>ViewerTracker.__backgroundTest.policy())).blocked,0,'a denied background room does not block the current room');
  assert.equal(await page.evaluate(()=>window.tabClicks),0,'background errors never invoke the current page Users tab');
  assert.deepEqual(await page.evaluate(()=>ViewerTracker.__backgroundTest.state()),initial);
  assert.deepEqual(await saved(),beforeLibrary);

  // A waiting source is selected only by the explicit submit. Its first real
  // sample must respect a manual deselection made before that response arrives.
  mode='held';await advance(3000);
  const firstHeldReady=new Promise(resolve=>{heldReady=resolve;});
  const firstRequested=page.waitForRequest(request=>new URL(request.url()).searchParams.get('roomname')==='hidden_first_model');
  await start('hidden_first_model');await firstRequested;const firstHeldRoute=await firstHeldReady;
  await page.waitForFunction(()=>document.querySelector('.tools-live-source[data-live-room="hidden_first_model"] input[data-live-source]')?.checked);
  await page.locator('#tools-live-chooser').evaluate(e=>e.open=true);
  const waitingCheck=page.locator('.tools-live-source[data-live-room="hidden_first_model"] input[data-live-source]');
  await waitingCheck.uncheck();assert.equal((await sourceFor('hidden_first_model')).sampleCount,0);
  await firstHeldRoute.fulfill({body:'5,hidden_first_model|o|f|0,viewer|m|m|0'});await sourceCount(1,'hidden_first_model');
  assert.equal(await waitingCheck.isChecked(),false,'the first accepted background sample cannot undo a manual deselection');

  // Stop targets just one room and invalidates its pending response. Other
  // comparisons remain active, and Library is only a view on that tracking.
  mode='held';await advance(3000);const previousHeld=held.length,heldRequest=new Promise(resolve=>{heldReady=resolve;});
  const requested=page.waitForRequest(request=>new URL(request.url()).searchParams.get('roomname')==='held_model');
  await start('held_model');await requested;await heldRequest;
  await page.waitForFunction(()=>ViewerTracker.__backgroundTest.sources().sources.some(source=>source.room==='held_model'));
  assert.equal(calls.at(-1).room,'held_model');assert.equal(held.length,previousHeld+1);
  await stop('held_model');
  assert.equal((await state('held_model')).active,false);assert.equal((await state('second_model')).active,true);
  await held.at(-1).fulfill({body:'5,held_model|o|f|0,viewer|m|m|0'}).catch(()=>{});
  assert(!await sourceFor('held_model')||(await sourceFor('held_model')).sampleCount===0,'late response cannot append a canceled room sample');
  mode='valid';await advance(3000);await refresh('second_model');
  const beforeClose=(await sourceFor('second_model')).sampleCount;
  await page.click('#tools-close');assert.equal((await state('second_model')).active,true,'closing Library leaves background tracking active');
  await advance(3000);await refresh('second_model');await sourceCount(beforeClose+1,'second_model');
  await page.click('#btn-control-library');
  // Browser integration checks the evidence distinction. The core tests cover
  // the exact >15-minute boundary with a deterministic acquisition clock.
  mode='absent';await advance(3000);await refresh('comparison_model');
  await advance(3000);await refresh('comparison_model');
  assert.equal((await state('comparison_model')).active,true,'a short broadcaster absence does not stop tracking');
  assert((await state('comparison_model')).absenceObservations>=2,'valid ownerless lists provide explicit absence evidence');
  mode='malformed';await advance(3000);await refresh('comparison_model');
  assert.equal((await state('comparison_model')).active,true);assert.equal((await state('comparison_model')).absenceObservations,0,'a rejected response resets continuous absence proof');
  assert.equal((await state('second_model')).active,true,'another room remains tracked');
  assert.deepEqual((await archive()).session.history,second.session.history,'absence is not plotted as manufactured zero samples');
  await page.evaluate(()=>{ViewerTracker.__backgroundTest.stop('comparison_model');ViewerTracker.__backgroundTest.stop('hidden_first_model');});
  const retained=await archive('second_model');
  mode='held';await advance(3000);const reloadReady=new Promise(resolve=>{heldReady=resolve;});
  await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));
  await page.reload();await page.addScriptTag({content:source});await page.evaluate(()=>ViewerTracker.__backgroundTest.setup());
  assert.equal((await state('second_model')).active,true,'the selected room resumes after reload');
  assert.deepEqual((await archive('second_model')).session.history,retained.session.history,'reload restores the recent aggregate recording');
  const reloadRequest=await reloadReady;mode='valid';await reloadRequest.fulfill({body:'5,second_model|o|f|0,viewer|m|m|0'});
  await sourceCount(retained.session.history.timestamps.length+1,'second_model');
  const beforeNavigation=(await sourceFor('second_model')).sampleCount;
  await page.evaluate(()=>ViewerTracker.__backgroundTest.leave());
  assert.equal((await state('second_model')).active,true,'room navigation leaves explicit background selections active');
  await advance(3000);await refresh('second_model');await sourceCount(beforeNavigation+1,'second_model');
  assert.deepEqual(await saved(),beforeLibrary);assert.deepEqual(errors,[]);
  await page.evaluate(()=>ViewerTracker.__backgroundTest.stopSources());
  console.log(engine+': multiple comparison rooms remain independent, stop individually, distinguish absence evidence from errors, survive Library close/reload/navigation, and retain authenticated request, selection and Freeze protections');
  await context.close();
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
