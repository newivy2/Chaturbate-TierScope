const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {instrument,prepareSource}=require('./helpers/instrument.cjs');
const engine=process.env.TIERSCOPE_BROWSER||'chromium';
const source=instrument(prepareSource(fs.readFileSync(path.join(__dirname,'../tierscope.user.js'),'utf8'))
 .replaceAll('scheduleInit(2000);','').replace('downloadTrackingReport: downloadTrackingReport,',`__dismissalTest:{
 archive(room,timestamps=[Date.now()-600000,Date.now()-360000]){
  const history={timestamps,breaks:timestamps.map(()=>false)};STORAGE_HISTORY_SERIES.forEach(key=>history[key]=timestamps.map(()=>0));
  history.total=timestamps.map((_,i)=>10+i);history.red=history.total.slice();history.withTokens=history.total.slice();history.anonymous=timestamps.map(()=>5);
  const end=timestamps.at(-1),session=normalizeStoredSession({timestamp:Math.max(end,Date.now()-240000),history,
   sessionStartedAt:timestamps[0],sessionStartEstimated:false,isPaused:true,pausedElapsedTime:end-timestamps[0],
   roomTotalHigh:history.total.at(-1)+5,roomTotalHighTime:end});
  session.schemaVersion=runtime.STORAGE_SCHEMA_VERSION;
  return validateSessionFile({format:runtime.SESSION_FILE_FORMAT,formatVersion:runtime.SESSION_FILE_VERSION,
   producerVersion:runtime.TIERSCOPE_VERSION,room,session});
 },
 tab(room,status='tracking'){
  const publisherId='dismiss-'+room.replaceAll('_','-'),key='tierscope:live:v1:source:'+publisherId;
  if(GM_getValue(key)!==undefined)return;
  const archive=this.archive(room),session={...archive.session,roomEpoch:'legacy'},recordKey='tierscope:tab:v2:'+room+':'+publisherId;
  GM_setValue(recordKey,JSON.stringify(session));GM_setValue(key,{version:1,id:publisherId+':'+room+':legacy@'+session.sessionStartedAt,
   publisherId,room,roomEpoch:'legacy',sessionId:'legacy@'+session.sessionStartedAt,sessionStartedAt:session.sessionStartedAt,status,lastSeenAt:Date.now(),
   sampleAt:session.history.timestamps.at(-1),sampleCount:2,revision:publisherId+':2',recordKey,recordSavedAt:session.timestamp});
 },
 async setup(){
  loadSession(getModelName());const archive=this.archive(getModelName());restoreSessionState(archive.session);
  isAutoRefreshOn=false;isMinimized=true;createPanel();toggleView();stopCountdown();repaintLivePresentation();
  this.tab('active_model');this.tab('paused_model','paused');this.tab('stopped_model','stopped');this.tab('stale_model');this.tab('closed_model');
  if(GM_getValue('tierscope:background-recording:v1:bg_stopped')===undefined){
   const archive=this.archive('bg_stopped'),start=archive.session.sessionStartedAt,publisherId='background-dismiss-bg-stopped';
   const source={version:1,id:publisherId+':bg_stopped:background@'+start,publisherId,room:'bg_stopped',roomEpoch:'background',
    sessionId:'background@'+start,sessionStartedAt:start,kind:'background',status:'stopped',lastSeenAt:Date.now(),
    sampleAt:archive.session.history.timestamps.at(-1),sampleCount:2,revision:'2',recordKey:null,recordSavedAt:null};
   const state={room:'bg_stopped',active:false,status:'stopped',message:'Comparison tracking stopped.',sampleCount:2,sampleAt:source.sampleAt,nextAt:null,
    absentSince:null,absenceObservedAt:null,absenceObservations:0,absenceMs:0,stoppedReason:'manual'};
   const saved=saveBackgroundRecording('bg_stopped',{archive,source,state});if(!saved.saved)throw Error(saved.error);
   GM_setValue('tierscope:background-tracking:v1:bg_stopped',JSON.stringify({schemaVersion:1,room:'bg_stopped',active:false,revision:'dismiss-bg-choice',changedAt:Date.now()}));
   keepSessionInLibrary(this.archive('kept_model'));
  }
  initializeBackgroundTracking();await tickBackgroundTracking();
 },
 ageStale(){const key='tierscope:live:v1:source:dismiss-stale-model';GM_setValue(key,{...GM_getValue(key),lastSeenAt:Date.now()-240000});},
 closeSource(){GM_deleteValue('tierscope:live:v1:source:dismiss-closed-model');},
 heartbeat(){const key='tierscope:live:v1:source:dismiss-stale-model';GM_setValue(key,{...GM_getValue(key),lastSeenAt:Date.now(),status:'tracking'});},
 fresh(){const key='tierscope:live:v1:source:dismiss-stale-model',before=GM_getValue(key),old=JSON.parse(GM_getValue(before.recordKey));
  const archive=this.archive('stale_model',[...old.history.timestamps,Date.now()]),session={...archive.session,timestamp:Date.now(),roomEpoch:'legacy'};
  GM_setValue(before.recordKey,JSON.stringify(session));GM_setValue(key,{...before,lastSeenAt:Date.now(),sampleAt:Date.now(),sampleCount:3,
   revision:'dismiss-stale-model:3',recordSavedAt:Date.now()});},
 state:()=>({history:JSON.stringify(history),paused:isPaused,stopped:isStopped,highs:JSON.stringify(sessionHighs),mode:presentationMode}),
 sources:readLiveModelSources,background:readPersistentBackgroundComparisonSources,
 cleanup(){shutdownBackgroundTracking();stopLiveModelSources();}
 },downloadTrackingReport: downloadTrackingReport,`));

(async()=>{
 const browser=await require('playwright')[engine].launch({headless:true,executablePath:process.env.TIERSCOPE_CHROMIUM_PATH,
  args:JSON.parse(process.env.TIERSCOPE_CHROMIUM_ARGS||'[]')});
 try{
  const context=await browser.newContext({viewport:{width:1450,height:1100}}),page=await context.newPage(),errors=[],calls=[];
  context.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));
  await context.addInitScript(()=>{
   Date.now=()=>Number(localStorage.getItem('test:now')||Date.UTC(2026,10,16,12));
   let intervalId=0;window.setInterval=()=>++intervalId;window.clearInterval=()=>{};
   const timeout=window.setTimeout.bind(window);window.setTimeout=(fn,ms,...args)=>timeout(ms>=60000?()=>{}:fn,ms,...args);
   const handlers=new Map();let nextListener=0;
   window.GM_getValue=(key,fallback)=>localStorage.getItem(key)===null?fallback:JSON.parse(localStorage.getItem(key));
   window.GM_setValue=(key,value)=>{const old=GM_getValue(key);localStorage.setItem(key,JSON.stringify(value));for(const handler of handlers.values())if(handler.key===key)handler.callback(key,old,value,false);};
   window.GM_deleteValue=key=>{const old=GM_getValue(key);localStorage.removeItem(key);for(const handler of handlers.values())if(handler.key===key)handler.callback(key,old,undefined,false);};
   window.GM_listValues=()=>Object.keys(localStorage);
   window.GM_addValueChangeListener=(key,callback)=>{const id=++nextListener;handlers.set(id,{key,callback});return id;};
   window.GM_removeValueChangeListener=id=>handlers.delete(id);
  });
  let held=null,requestReady;
  await context.route('https://tierscope.test/**',route=>{
   const url=new URL(route.request().url());
   if(url.pathname==='/api/getchatuserlist/'){calls.push(url.searchParams.get('roomname'));held=route;if(requestReady)requestReady();return;}
   return route.fulfill({contentType:'text/html',body:'<!doctype html><body style="background:#303846"></body>'});
  });
  async function setup(){await page.addScriptTag({content:source});await page.evaluate(()=>ViewerTracker.__dismissalTest.setup());}
  await page.goto('https://tierscope.test/current_model/');await setup();
  const owner=await page.evaluate(()=>ViewerTracker.__dismissalTest.state());
  const originalRecords=()=>page.evaluate(()=>Object.fromEntries(Object.entries(localStorage).filter(([key])=>
   ['tierscope:library:v1:','tierscope:tab:v2:','tierscope:background-recording:v1:','tierscope:background-tracking:v1:'].some(prefix=>key.startsWith(prefix)))));
  const before=await originalRecords();
  const room=room=>page.locator('.tools-live-source[data-live-room="'+room+'"]');
  const backgroundRow=()=>page.locator('[data-background-room="bg_stopped"]');
  const chooser=()=>page.locator('#tools-live-chooser').evaluate(element=>element.open=true);
  const refresh=()=>page.click('#tools-live-refresh');
  async function assertActive(){
   for(const model of ['active_model','paused_model']){assert.equal(await room(model).count(),1);assert(await room(model).locator('input[data-live-source]').isChecked());}
  }
  await page.click('#btn-control-library');assert.equal(await backgroundRow().count(),1);
  await page.click('#tools-clear-background-inactive');
  assert.equal(await backgroundRow().count(),0,'clearing stopped background entries hides their rows');
  assert.deepEqual(await originalRecords(),before,'clearing the tracking list preserves recoverable and saved recordings');
  await page.click('#tools-compare-live');await chooser();
  for(const model of ['active_model','paused_model','stopped_model','stale_model','closed_model'])assert.equal(await room(model).count(),1);
  assert.equal(await room('bg_stopped').count(),0,'a background entry cleared in Sessions also stays out of Live comparison');
  await page.evaluate(()=>{ViewerTracker.__dismissalTest.ageStale();ViewerTracker.__dismissalTest.closeSource();});await refresh();
  assert.match(await room('stale_model').textContent(),/Stale/);
  assert.match(await room('closed_model').textContent(),/Unavailable/,'a closed selected tab remains cached until cleanup');
  const aged=await originalRecords();
  await page.click('#tools-live-clear-inactive');
  for(const model of ['stopped_model','stale_model','closed_model','bg_stopped']){
   assert.equal(await room(model).count(),0,model+' is removed from the chooser');
   assert.equal(await page.locator('.tools-chart-legend label').filter({hasText:model}).count(),0,model+' no longer occupies a chart trace');
  }
  await assertActive();await refresh();await refresh();
  assert.equal(await room('stopped_model').count(),0);assert.equal(await room('stale_model').count(),0,'refresh never resurrects a cached stale selection');
  assert.equal(await room('closed_model').count(),0,'refresh never resurrects a closed selected source');
  assert.deepEqual(await originalRecords(),aged,'clearing Live entries does not remove or rewrite their saved data');
  assert.equal(calls.length,0,'cleanup controls never scan or join a room');
  await page.click('#tools-close');await page.click('#btn-control-library');assert.equal(await backgroundRow().count(),0);
  await page.click('#tools-compare-live');await chooser();await assertActive();
  assert.equal(await room('stopped_model').count(),0);assert.equal(await room('stale_model').count(),0,'Library reopening preserves the cleanup');

  await page.evaluate(()=>ViewerTracker.__dismissalTest.heartbeat());await refresh();
  assert.equal(await room('stale_model').count(),0,'a heartbeat or status change alone is not a fresh audience sample');
  await page.reload();await setup();await page.click('#btn-control-library');assert.equal(await backgroundRow().count(),0);
  await page.click('#tools-compare-live');await chooser();await assertActive();
  assert.equal(await room('stopped_model').count(),0);assert.equal(await room('stale_model').count(),0,'reload keeps old entries dismissed');
  assert.equal(await room('closed_model').count(),0,'republishing only an old snapshot does not restore a dismissed closed source');
  await page.evaluate(()=>{localStorage.setItem('test:now',String(Date.now()+3000));ViewerTracker.__dismissalTest.fresh();});await refresh();
  assert.equal(await room('stale_model').count(),1,'a genuinely new sample makes the source available again');
  assert.equal(await room('stopped_model').count(),0,'refreshing one room does not restore another stopped entry');

  // An explicit user restart returns the old background source even before
  // the next response, without waiting for a new sample to clear its marker.
  await page.click('[data-tools-tab=library]');const requested=new Promise(resolve=>{requestReady=resolve;});
  await page.fill('#tools-background-room','bg_stopped');await page.click('#tools-compare-background');await requested;
  await page.waitForSelector('.tools-live-source[data-live-room="bg_stopped"]');
  assert(await room('bg_stopped').locator('input[data-live-source]').isChecked(),'explicit restart restores and selects that room');
  assert.equal(calls.length,1);assert.equal(calls[0],'bg_stopped');
  await held.fulfill({body:'5,bg_stopped|o|f|0,viewer_0|m|m|0'});
  await page.waitForFunction(()=>ViewerTracker.__dismissalTest.background().sources.find(source=>source.room==='bg_stopped')?.sampleCount===3);
  await page.evaluate(()=>ViewerTracker.__dismissalTest.tab('second_stopped','stopped'));await refresh();await chooser();
  assert.equal(await room('second_stopped').count(),1);
  const activeBackground=(await page.evaluate(()=>ViewerTracker.__dismissalTest.background().sources)).find(source=>source.room==='bg_stopped');
  await page.click('#tools-live-clear-inactive');
  assert.equal(await room('second_stopped').count(),0);
  assert.equal(await room('bg_stopped').count(),1,'clearing another stopped entry never hides the restarted active background room');
  assert(await room('bg_stopped').locator('input[data-live-source]').isChecked());
  assert.deepEqual((await page.evaluate(()=>ViewerTracker.__dismissalTest.background().sources)).find(source=>source.room==='bg_stopped'),activeBackground,'clearing leaves active background tracking and samples unchanged');
  await page.click('[data-tools-tab=library]');assert.equal(await backgroundRow().count(),1);
  assert(await backgroundRow().locator('[data-background-stop]').isVisible());
  assert(await page.locator('#tools-clear-background-inactive').isDisabled(),'background cleanup is unavailable when only an active room remains');
  assert.deepEqual(await page.evaluate(()=>ViewerTracker.__dismissalTest.state()),owner,'cleanup and restart never mutate the current live owner');
  assert.deepEqual(errors,[]);await page.screenshot({path:'/tmp/tierscope-comparison-dismissals-'+engine+'.png'});
  await page.evaluate(()=>ViewerTracker.__dismissalTest.cleanup());await context.close();
  console.log(engine+': stopped/stale entries clear from Library lists and traces, stay dismissed across refresh/reopen/reload, preserve recordings and active tracking, and return on fresh data or explicit restart');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
