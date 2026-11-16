const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {instrument,prepareSource}=require('./helpers/instrument.cjs');
const engine=process.env.TIERSCOPE_BROWSER||'chromium';
const source=instrument(prepareSource(fs.readFileSync(path.join(__dirname,'../tierscope.user.js'),'utf8'))
 .replaceAll('scheduleInit(2000);','').replace('downloadTrackingReport: downloadTrackingReport,',`__backgroundTest:{
 setup(){const room=getModelName();loadSession(room);const now=Date.now(),timestamps=[now-180000,now-120000,now-60000],h={timestamps,breaks:[false,false,false]};
 STORAGE_HISTORY_SERIES.forEach(k=>h[k]=[0,0,0]);h.total=[10,20,30];h.red=h.total.slice();h.withTokens=h.total.slice();h.anonymous=[5,5,5];
 restoreSessionState(normalizeStoredSession({timestamp:now,history:h,sessionStartedAt:timestamps[0],sessionStartEstimated:false,isPaused:true,
 pausedElapsedTime:120000,roomTotalHigh:35,roomTotalHighTime:timestamps[2]}));
 isAutoRefreshOn=false;isMinimized=true;createPanel();toggleView();repaintLivePresentation();stopCountdown();initializeLiveModelSources();saveSession(room,true);},
 state:()=>({history:JSON.stringify(history),users:JSON.stringify([...users]),highs:JSON.stringify(sessionHighs),paused:isPaused,stopped:isStopped,automatic:isAutoRefreshOn,mode:presentationMode}),
 status:getBackgroundComparisonState,sources:readBackgroundComparisonSources,refresh:refreshBackgroundComparison,
 archive(){const source=readBackgroundComparisonSources().sources[0];return source&&source.sampleCount?readBackgroundComparisonArchive(source):null;},
 leave(){window.history.pushState({},'', '/other_host/');checkUrlChange();},
 stopSources:stopLiveModelSources,policy:readRequestPolicy
 },downloadTrackingReport: downloadTrackingReport,`));

(async()=>{
 const browser=await require('playwright')[engine].launch({headless:true,executablePath:process.env.TIERSCOPE_CHROMIUM_PATH,args:JSON.parse(process.env.TIERSCOPE_CHROMIUM_ARGS||'[]')});
 try{
  const context=await browser.newContext({viewport:{width:1450,height:1100}}),page=await context.newPage(),errors=[],calls=[],held=[];
  context.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));
  await context.addCookies([{name:'sessionid',value:'fixture-session',domain:'tierscope.test',path:'/'}]);
  await context.addInitScript(()=>{
   window.testNow=Date.UTC(2026,10,16,12);Date.now=()=>testNow;
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
    calls.push({room:url.searchParams.get('roomname'),query:Object.fromEntries(url.searchParams),headers:route.request().headers(),method:route.request().method()});
    if(mode==='held'){held.push(route);if(heldReady)heldReady(route);return;}
    if(mode==='403')return route.fulfill({status:403,body:'Unavailable'});
    if(mode==='malformed')return route.fulfill({body:'not a user list'});
    if(mode==='mismatch')return route.fulfill({body:'5,current_model|o|f|0,viewer_0|m|m|0'});
    if(mode==='empty')return route.fulfill({body:'0'});
    return route.fulfill({body:'5,'+url.searchParams.get('roomname')+'|o|f|0,'+Array.from({length:viewers},(_,i)=>'viewer_'+i+'|m|m|0').join(',')});
   }
   return route.fulfill({contentType:'text/html',body:'<!doctype html><body style="background:#303846"><button id="UserListTab" onclick="window.tabClicks++">Users</button><button>Chat</button><script>window.tabClicks=0</script></body>'});
  });
  await page.goto('https://tierscope.test/current_model/');await page.addScriptTag({content:source});await page.evaluate(()=>ViewerTracker.__backgroundTest.setup());
  const initial=await page.evaluate(()=>ViewerTracker.__backgroundTest.state());
  const saved=()=>page.evaluate(()=>Object.fromEntries(Object.entries(localStorage).filter(([key])=>key.startsWith('tierscope:library:v1:'))));
  const beforeLibrary=await saved(),advance=ms=>page.evaluate(ms=>{window.testNow+=ms;},ms);
  const sources=()=>page.evaluate(()=>ViewerTracker.__backgroundTest.sources().sources);
  const archive=()=>page.evaluate(()=>ViewerTracker.__backgroundTest.archive());
  const refresh=()=>page.evaluate(()=>ViewerTracker.__backgroundTest.refresh());
  const sourceCount=async n=>page.waitForFunction(n=>ViewerTracker.__backgroundTest.sources().sources[0]?.sampleCount===n,n);
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
  await advance(60000);viewers=5;await refresh();await sourceCount(2);
  let second=await archive();assert.deepEqual(second.session.history.total,[4,6]);assert.deepEqual(second.session.history.anonymous,[5,5]);
  assert.equal(second.session.history.timestamps[1]-second.session.history.timestamps[0],60000);
  assert.deepEqual(await page.evaluate(()=>ViewerTracker.__backgroundTest.state()),initial,'background samples cannot change the current room owner');
  assert.deepEqual(await saved(),beforeLibrary,'background comparison never keeps sessions implicitly');
  await page.locator('#tools-live-chooser').evaluate(e=>e.open=true);
  const backgroundCheck=page.locator('.tools-live-source[data-live-room="comparison_model"] input[data-live-source]');
  await backgroundCheck.uncheck();await advance(60000);await refresh();await sourceCount(3);
  assert.equal(await backgroundCheck.isChecked(),false,'new samples never reselect a manually hidden background room');
  await backgroundCheck.check();await page.click('#tools-live-freeze');
  const displayedSamples=await page.locator('[data-live-report="comparison_model"] td').nth(2).textContent();
  await advance(60000);await refresh();await sourceCount(4);
  assert.equal(await page.locator('#tools-live-freeze').getAttribute('aria-pressed'),'true');
  assert.equal(await page.locator('[data-live-report="comparison_model"] td').nth(2).textContent(),displayedSamples,'Freeze retains the displayed background snapshot while acquisition continues');
  await page.click('#tools-live-freeze');
  assert.equal(await page.locator('[data-live-report="comparison_model"] td').nth(2).textContent(),'4');second=await archive();
  await advance(300000);mode='mismatch';let requests=calls.length;await refresh();assert.equal(calls.length,requests+1);
  assert.deepEqual((await archive()).session.history,second.session.history,'a server response identifying another broadcaster is rejected');
  await advance(300000);mode='malformed';requests=calls.length;await refresh();assert.equal(calls.length,requests+1);
  assert.deepEqual((await archive()).session.history,second.session.history);
  assert.equal((await sources())[0].sampleCount,4,'malformed data never appends a fake sample');
  await advance(300000);mode='empty';requests=calls.length;await refresh();assert.equal(calls.length,requests+1);
  assert.deepEqual((await archive()).session.history,second.session.history,'empty room response is not invented as zero audience');
  await advance(300000);mode='403';requests=calls.length;await refresh();assert.equal(calls.length,requests+1);
  assert.deepEqual((await archive()).session.history,second.session.history);
  assert.equal((await page.evaluate(()=>ViewerTracker.__backgroundTest.policy())).blocked,0,'a denied background room does not block the current room');
  assert.equal(await page.evaluate(()=>window.tabClicks),0,'background errors never invoke the current page Users tab');
  assert.deepEqual(await page.evaluate(()=>ViewerTracker.__backgroundTest.state()),initial);
  assert.deepEqual(await saved(),beforeLibrary);

  // A waiting source is selected only by the explicit submit. Its first real
  // sample must respect a manual deselection made before that response arrives.
  mode='held';await advance(60000);
  const firstHeldReady=new Promise(resolve=>{heldReady=resolve;});
  const firstRequested=page.waitForRequest(request=>new URL(request.url()).searchParams.get('roomname')==='hidden_first_model');
  await start('hidden_first_model');await firstRequested;const firstHeldRoute=await firstHeldReady;
  await page.waitForFunction(()=>document.querySelector('.tools-live-source[data-live-room="hidden_first_model"] input[data-live-source]')?.checked);
  await page.locator('#tools-live-chooser').evaluate(e=>e.open=true);
  const waitingCheck=page.locator('.tools-live-source[data-live-room="hidden_first_model"] input[data-live-source]');
  await waitingCheck.uncheck();assert.equal((await sources())[0].sampleCount,0);
  await firstHeldRoute.fulfill({body:'5,hidden_first_model|o|f|0,viewer|m|m|0'});await sourceCount(1);
  assert.equal(await waitingCheck.isChecked(),false,'the first accepted background sample cannot undo a manual deselection');

  // An explicit replacement is a fresh source. Closing Library must abort its
  // pending fetch and ignore any late response, with no retained timer/source.
  mode='held';await advance(60000);const previousHeld=held.length,heldRequest=new Promise(resolve=>{heldReady=resolve;});
  const requested=page.waitForRequest(request=>new URL(request.url()).searchParams.get('roomname')==='held_model');
  await start('held_model');await requested;await heldRequest;
  await page.waitForFunction(()=>ViewerTracker.__backgroundTest.sources().sources[0]?.room==='held_model');
  assert.equal(calls.at(-1).room,'held_model');assert.equal(held.length,previousHeld+1);
  await page.click('#tools-close');assert.equal((await sources()).length,0);
  await held.at(-1).fulfill({body:'5,held_model|o|f|0,viewer|m|m|0'}).catch(()=>{});
  assert.equal((await sources()).length,0,'late response cannot restore a canceled source');
  await page.click('#btn-control-library');mode='valid';await advance(60000);await start('navigation_model');await sourceCount(1);
  await page.evaluate(()=>ViewerTracker.__backgroundTest.leave());
  assert.equal((await sources()).length,0,'navigating away clears the old host comparison');
  assert.deepEqual(await saved(),beforeLibrary);assert.deepEqual(errors,[]);
  await page.evaluate(()=>ViewerTracker.__backgroundTest.stopSources());
  console.log(engine+': Compare without watching requests the named room, shares authenticated API access, isolates live/Library state, preserves real samples on errors and cancels on close/navigation');
  await context.close();
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
