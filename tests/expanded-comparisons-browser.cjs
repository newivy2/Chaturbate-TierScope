const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {instrument,prepareSource}=require('./helpers/instrument.cjs');
const {openLibraryBook}=require('./helpers/library.cjs');
const engine=process.env.TIERSCOPE_BROWSER||'chromium';
const source=instrument(prepareSource(fs.readFileSync(path.join(__dirname,'../tierscope.user.js'),'utf8'))
 .replaceAll('scheduleInit(2000);','').replace('downloadTrackingReport: downloadTrackingReport,',`__expanded:{
 setup(){loadSession(getModelName());const now=Date.now(),h={timestamps:[now-180000,now-120000,now-60000],breaks:[false,false,false]};
 STORAGE_HISTORY_SERIES.forEach(k=>h[k]=[0,0,0]);h.total=[10,20,30];h.red=h.total.slice();h.withTokens=h.total.slice();h.anonymous=[5,5,5];
 restoreSessionState(normalizeStoredSession({timestamp:now,history:h,sessionStartedAt:h.timestamps[0],sessionStartEstimated:false,isPaused:true,
  roomTotalHigh:35,roomTotalHighTime:h.timestamps[2],pausedElapsedTime:120000}));
 isAutoRefreshOn=false;isMinimized=true;createPanel();toggleView();repaintLivePresentation();saveSession(getModelName());stopLiveModelSources();
 window.expandedBase=captureSessionFile();
 },
 archive(room,index,times){const a=JSON.parse(JSON.stringify(window.expandedBase)),s=a.session;a.room=room;
 times=times||[Date.now()-180000,Date.now()-120000,Date.now()-60000];s.timestamp=Math.max(Date.now(),times.at(-1));s.sessionStartedAt=times[0];
 s.history.timestamps=times.slice();s.history.breaks=times.map(()=>false);
 STORAGE_HISTORY_SERIES.forEach(k=>s.history[k]=times.map(()=>0));s.history.total=times.map((_,i)=>20+index+i*10);
 s.history.red=s.history.total.slice();s.history.withTokens=s.history.total.slice();s.history.anonymous=times.map(()=>5);
 STORAGE_HISTORY_SERIES.forEach(k=>{const value=Math.max(...s.history[k]);s.sessionHighs[k]={value,time:value?times[s.history[k].indexOf(value)]:null};});
 s.roomTotalHigh=Math.max(...s.history.total)+5;s.roomTotalHighTime=times[s.history.total.indexOf(s.roomTotalHigh-5)];
 s.pausedElapsedTime=times.at(-1)-times[0];return validateSessionFile(a);},
 seedSaved(){const now=Date.now(),hour=3600000;
 for(let i=0;i<60;i++){const room=['alpha_model','beta_model','gamma_model'][i%3],start=now-(i+1)*900000;
  const archive=this.archive(room,i,[start,start+60000,start+120000]);
  GM_setValue('tierscope:library:v1:bulk_'+i,JSON.stringify({schemaVersion:1,addedAt:now,title:'Bulk session '+String(i).padStart(3,'0'),archive}));}
 for(const [id,room,times] of [
  ['cross_day','cross_day_model',[now-27*hour,now-23*hour,now-hour]],
  ['boundary','boundary_model',[now-24*hour,now-24*hour+60000]],
  ['old_only','old_only_model',[now-27*hour,now-26*hour]],
  ['future_only','future_only_model',[now+hour,now+2*hour]],
  ['enclosing','enclosing_model',[now-25*hour,now+hour]]]){
  GM_setValue('tierscope:library:v1:'+id,JSON.stringify({schemaVersion:1,addedAt:now,title:id,archive:this.archive(room,90,times)}));}
 },
 seedLive(count=40){const now=Date.now();for(let i=0;i<count;i++){
 const suffix=String(i).padStart(2,'0'),room='live_model_'+suffix,publisherId='publisher-'+suffix,recordId='record-'+suffix;
 const archive=this.archive(room,i,[now-120000,now-60000,now]),session={...archive.session,roomEpoch:'legacy',isPaused:false};
 const recordKey='tierscope:tab:v2:'+room+':'+recordId,sessionId='legacy@'+session.sessionStartedAt;
 GM_setValue(recordKey,JSON.stringify(session));GM_setValue('tierscope:live:v1:source:'+publisherId,{version:1,id:publisherId+':'+room+':'+sessionId,
  publisherId,room,roomEpoch:'legacy',sessionId,sessionStartedAt:session.sessionStartedAt,status:'tracking',lastSeenAt:now,sampleAt:now,sampleCount:3,
  revision:recordId+':'+now+':3:'+now,recordKey,recordSavedAt:now});}
 GM_setValue('tierscope:live:v1:changed',{version:1,at:now,token:'seed-live'});},
 updateLive(index,value){const suffix=String(index).padStart(2,'0'),key='tierscope:live:v1:source:publisher-'+suffix,meta=GM_getValue(key),session=JSON.parse(GM_getValue(meta.recordKey)),at=Date.now();
 session.timestamp=at;session.history.timestamps.push(at);session.history.breaks.push(false);
 STORAGE_HISTORY_SERIES.forEach(k=>session.history[k].push(k==='anonymous'?5:['red','total','withTokens'].includes(k)?value:0));
 STORAGE_HISTORY_SERIES.forEach(k=>{const v=Math.max(...session.history[k]);session.sessionHighs[k]={value:v,time:v?session.history.timestamps[session.history[k].indexOf(v)]:null};});
 session.roomTotalHigh=Math.max(session.roomTotalHigh,value+5);session.roomTotalHighTime=at;
 GM_setValue(meta.recordKey,JSON.stringify(session));GM_setValue(key,{...meta,sampleCount:session.history.timestamps.length,sampleAt:at,lastSeenAt:at,recordSavedAt:at,revision:meta.revision+':updated'});
 GM_setValue('tierscope:live:v1:changed',{version:1,at,token:'updated-live'});},
 addRecent(){const archive=this.archive('new_recent_model',150,[Date.now()-120000,Date.now()-60000]);
 GM_setValue('tierscope:library:v1:new_recent',JSON.stringify({schemaVersion:1,addedAt:Date.now(),title:'New recent session',archive}));},
 saved:()=>Object.fromEntries(GM_listValues().filter(k=>k.startsWith('tierscope:library:v1:')).sort().map(k=>[k,GM_getValue(k)])),
 state:()=>({history:JSON.stringify(history),paused:isPaused,mode:presentationMode})
 },downloadTrackingReport: downloadTrackingReport,`));

(async()=>{
 const browser=await require('playwright')[engine].launch({headless:true,executablePath:process.env.TIERSCOPE_CHROMIUM_PATH,args:JSON.parse(process.env.TIERSCOPE_CHROMIUM_ARGS||'[]')});
 try{
  const context=await browser.newContext({viewport:{width:1250,height:1050},timezoneId:'America/Sao_Paulo'}),page=await context.newPage(),errors=[];
  context.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));let requests=0;
  await context.route('https://tierscope.test/**',route=>{if(route.request().url().includes('/api/')){requests++;return route.fulfill({body:'5,comparison_room|o|f|0,viewer|m|m|0'});}
   return route.fulfill({contentType:'text/html',body:'<!doctype html><body style="background:#26303a"></body>'});});
  await context.addInitScript(()=>{
   window.testNow=Date.UTC(2026,10,15,15);Date.now=()=>window.testNow;
   const listeners=new Map();let nextListener=0;
   window.GM_getValue=(key,fallback)=>localStorage.getItem(key)===null?fallback:JSON.parse(localStorage.getItem(key));
   window.GM_setValue=(key,value)=>{const old=GM_getValue(key);localStorage.setItem(key,JSON.stringify(value));for(const [id,listener]of listeners)if(listener.key===key)listener.callback(key,old,value,false);};
   window.GM_deleteValue=key=>{const old=GM_getValue(key);localStorage.removeItem(key);for(const [id,listener]of listeners)if(listener.key===key)listener.callback(key,old,undefined,false);};
   window.GM_listValues=()=>Object.keys(localStorage);
   window.GM_addValueChangeListener=(key,callback)=>{const id=++nextListener;listeners.set(id,{key,callback});return id;};
   window.GM_removeValueChangeListener=id=>listeners.delete(id);
  });
  await page.goto('https://tierscope.test/comparison_room/');await page.addScriptTag({content:source});
  await page.evaluate(()=>{ViewerTracker.__expanded.setup();ViewerTracker.__expanded.seedSaved();ViewerTracker.__expanded.seedLive();});
  const savedBefore=await page.evaluate(()=>ViewerTracker.__expanded.saved()),liveBefore=await page.evaluate(()=>ViewerTracker.__expanded.state());
  await page.click('#btn-control-library');await page.click('[data-tools-tab=compare]');await page.click('#tools-compare-saved');
  const picker=async()=>page.locator('#tools-recording-picker').evaluate(element=>element.open=true);
  const screenshot=async kind=>{await page.locator('#tools-content').evaluate(element=>element.scrollTop=0);
   await page.screenshot({path:'/tmp/expanded-comparisons-'+kind+'.png'});};
  await picker();await page.fill('#tools-analysis-search','Bulk session');await page.click('#tools-compare-all-matching');await picker();
  assert.equal(await page.locator('#tools-compare-slots').textContent(),'60 sessions selected');
  assert.equal(await page.locator('[id^=tools-source-]').count(),2,'large comparisons avoid quadratic source dropdowns');
  const ids=await page.locator('[id^=tools-source-]').evaluateAll(elements=>elements.map(element=>element.value));
  do{
   ids.push(...await page.locator('#tools-selected-sessions [data-compare-id]').evaluateAll(elements=>elements.map(element=>element.dataset.compareId)));
   if(await page.locator('#tools-selection-next').isDisabled())break;await page.click('#tools-selection-next');
  }while(true);
  assert.equal(ids.length,60);assert.equal(new Set(ids).size,60);assert.deepEqual(new Set(ids),new Set(Array.from({length:60},(_,i)=>'bulk_'+i)));
  assert.equal(await page.locator('#tools-chart-inspection tbody tr').count(),30);assert.match(await page.locator('#tools-chart-lines-status').textContent(),/60/);
  await page.fill('#tools-chart-line-search','Bulk session 059');
  assert.equal(await page.locator('.tools-chart-legend label').count(),1);assert.match(await page.locator('.tools-chart-legend label').textContent(),/Bulk session 059/);
  assert.equal(await page.locator('.tools-series-swatch').evaluate(element=>Number(element.style.opacity)),.12,'older saved sessions remain faint background traces');
  const tailCheck=page.locator('.tools-chart-legend input');await tailCheck.uncheck();
  await page.click('#tools-metric-total');assert(!(await tailCheck.isChecked()),'metric changes preserve a hidden line beyond the first page');await tailCheck.check();
  await page.fill('#tools-chart-line-search','');await page.click('#tools-chart-lines-next');assert.equal(await page.locator('#tools-chart-inspection tbody tr').count(),30);
  assert.equal(await page.locator('#tools-summary-table thead th').count(),26);await page.click('#tools-report-next');assert.equal(await page.locator('#tools-summary-table thead th').count(),26);
  await page.click('#tools-report-next');assert.equal(await page.locator('#tools-summary-table thead th').count(),11);assert.match(await page.locator('#tools-report-page').textContent(),/60/);
  await page.locator('#tools-recording-picker').evaluate(element=>element.open=false);await screenshot('saved');
  await picker();await page.click('#tools-analysis-clear');await page.click('#tools-compare-all-matching');
  assert.equal(await page.locator('#tools-compare-slots').textContent(),'65 sessions selected','Select all matching includes saved sessions, never the transient current snapshot');

  // Live model selection uses all40 publishers, retaining snapshots beyond the chart-control page.
  await page.click('#tools-compare-live');assert.match(await page.locator('#tools-live-status').textContent(),/40 models selected/);
  await page.click('#tools-live-metric-room');
  assert.equal(await page.locator('[data-live-source]:checked').count(),40);assert.equal(await page.locator('#tools-live-samples tbody tr').count(),40);
  assert.equal(await page.locator('#tools-chart-inspection tbody tr').count(),30);
  await page.fill('#tools-chart-line-search','live_model_39');assert.equal(await page.locator('.tools-chart-legend label').count(),1);
  const lastLiveCount=()=>page.locator('#tools-live-samples [data-live-report="live_model_39"] td').first().textContent();
  const beforeFreeze=await lastLiveCount();await page.click('#tools-live-freeze');
  await page.evaluate(()=>{window.testNow+=30000;ViewerTracker.__expanded.updateLive(39,300);});await page.click('#tools-live-refresh');
  assert.equal(await lastLiveCount(),beforeFreeze,'a source beyond thirty keeps its frozen snapshot');
  await page.click('#tools-live-freeze');assert.equal(await lastLiveCount(),'305','Resume catches up the fortieth model');
  await page.locator('#tools-live-chooser').evaluate(element=>element.open=true);
  await page.click('#tools-live-clear');assert.equal(await page.locator('[data-live-source]:checked').count(),0);assert.equal(await page.locator('#tools-analysis-chart').count(),0);
  await page.click('#tools-live-select-all');assert.equal(await page.locator('[data-live-source]:checked').count(),40);assert.equal(await page.locator('#tools-live-samples tbody tr').count(),40);
  await page.fill('#tools-live-search','live_model_39');assert.equal(await page.locator('.tools-live-source').count(),1);
  assert.equal(await page.locator('#tools-live-samples tbody tr').count(),40,'finding a model never filters the comparison');await page.fill('#tools-live-search','');
  await page.locator('#tools-live-chooser').evaluate(element=>element.open=false);await screenshot('live');

  async function assertGlobalRecent(expected=62){
   assert.match(await page.locator('#tools-recent-status').textContent(),new RegExp('\\b'+expected+' sessions'));
   const found=[];
   while(await page.locator('#tools-recent-previous').isEnabled())await page.click('#tools-recent-previous');
   do{found.push(...await page.locator('#tools-recent-samples [data-recent-room]').evaluateAll(rows=>rows.map(row=>row.dataset.recentRoom)));
    if(await page.locator('#tools-recent-next').isDisabled())break;await page.click('#tools-recent-next');}while(true);
   assert.equal(found.length,expected);
   for(const room of ['alpha_model','beta_model','gamma_model','cross_day_model','boundary_model'])assert(found.includes(room),room+' is included globally');
   for(const room of ['old_only_model','future_only_model','enclosing_model'])assert(!found.includes(room),room+' has no accepted sample in the rolling window');
   assert.equal(await page.locator('#tools-chart-inspection tbody tr').count(),30);
  }
  // Last24h ignores Saved filters and includes sessions that started before the window.
  await page.click('#tools-compare-saved');await picker();await page.selectOption('#tools-analysis-model','alpha_model');await page.fill('#tools-analysis-search','No matching recording');
  await page.click('#tools-compare-recent');await assertGlobalRecent();
  await page.click('[data-tools-tab=library]');await openLibraryBook(page);await page.selectOption('#tools-library-model','alpha_model');
  await page.fill('#tools-library-from','2099-01-01');await page.check('#tools-library-favorites');await page.fill('#tools-library-search','No matching recording');
  await page.click('#tools-last24h');await assertGlobalRecent();
  await page.click('[data-tools-tab=library]');assert(await page.locator('#tools-compare-previous').isDisabled(),'this page model has no saved history');
  await page.click('#tools-compare-last24h');await assertGlobalRecent();
  assert.match(await page.locator('#tools-recent-comparison h3').textContent(),/all models/i);
  await page.click('[data-tools-tab=library]');await openLibraryBook(page);await page.click('#tools-library-clear');await page.selectOption('#tools-library-model','alpha_model');
  await page.click('#tools-model-history');await page.click('#tools-history-last24h');await assertGlobalRecent();
  await page.click('#tools-recent-freeze');assert(await page.locator('#tools-recent-refresh').isDisabled());
  await page.evaluate(()=>ViewerTracker.__expanded.addRecent());assert.match(await page.locator('#tools-recent-status').textContent(),/62 sessions/);
  await page.click('#tools-recent-freeze');await assertGlobalRecent(63);
  assert.match(await page.locator('#tools-recent-status').textContent(),/6 models/);
  await screenshot('recent');
  for(const bright of [false,true]){await page.locator('#dark-mode-toggle').setChecked(!bright);await page.setViewportSize({width:380,height:850});
   assert(await page.locator('#tools-content').evaluate(element=>element.scrollWidth<=element.clientWidth+1));await page.setViewportSize({width:1250,height:1050});}
  const savedAfter=await page.evaluate(()=>ViewerTracker.__expanded.saved());
  for(const [key,value]of Object.entries(savedBefore))assert.equal(savedAfter[key],value,'comparison never rewrites '+key);
  assert.equal(Object.keys(savedAfter).length,Object.keys(savedBefore).length+1,'only the explicit fixture addition changes saved recordings');
  assert.deepEqual(await page.evaluate(()=>ViewerTracker.__expanded.state()),liveBefore);assert.equal(requests,0,'comparisons and shortcuts add no API scans');
  assert.deepEqual(errors,[]);console.log(engine+': 60 mixed saved sessions, 40 live models, bounded controls with all lines selectable, frozen tail updates, and globally unfiltered rolling Last24h shortcuts passed');
  await context.close();
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
