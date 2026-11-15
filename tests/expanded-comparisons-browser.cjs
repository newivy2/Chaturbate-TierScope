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
 addCompactRecent(suffix=''){const archive=this.archive('compact_model'+suffix,170,[Date.now()-120000,Date.now()-60000]);
 GM_setValue('tierscope:library:v1:compact_recent'+suffix,JSON.stringify({schemaVersion:1,addedAt:Date.now(),title:'Compact recent session'+suffix,archive}));},
 refreshTools:()=>updateSessionToolsStatus(),
 seedCurrentStyles(){const now=Date.now(),room=getModelName(),current=JSON.parse(JSON.stringify(window.expandedBase));
 GM_setValue('tierscope:library:v1:current_ongoing',JSON.stringify({schemaVersion:1,addedAt:now,title:'Current ongoing session',archive:current}));
 const older=this.archive(room,5,[now-3*3600000,now-3*3600000+60000]);
 GM_setValue('tierscope:library:v1:current_historical',JSON.stringify({schemaVersion:1,addedAt:now,title:'Earlier current-model session',archive:older}));
 for(const [publisherId,archive]of [['current-older-publisher',older],['aaa-publisher',this.archive('aaa_model',10,[now-120000,now-60000,now])]]){
  const model=archive.room,recordKey='tierscope:tab:v2:'+model+':'+publisherId,session={...archive.session,roomEpoch:'legacy',isPaused:false},sessionId='legacy@'+session.sessionStartedAt;
  GM_setValue(recordKey,JSON.stringify(session));GM_setValue('tierscope:live:v1:source:'+publisherId,{version:1,id:publisherId+':'+model+':'+sessionId,
   publisherId,room:model,roomEpoch:'legacy',sessionId,sessionStartedAt:session.sessionStartedAt,status:'tracking',lastSeenAt:now,
   sampleAt:session.history.timestamps.at(-1),sampleCount:session.history.timestamps.length,revision:publisherId+':'+now,recordKey,recordSavedAt:now});
 }
 initializeLiveModelSources();saveSession(getModelName(),true);GM_setValue('tierscope:live:v1:changed',{version:1,at:now,token:'current-style'});
 },
 stopSources:stopLiveModelSources,
 sources:readLiveModelSources,
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
  await page.click('#btn-control-library');
  assert.equal(await page.locator('#tools-compare-live').textContent(),'Live sessions');
  assert.equal(await page.locator('#tools-compare-last24h').textContent(),'Last 24h sessions');
  await page.screenshot({path:'/tmp/tierscope-current-session-shortcuts-'+engine+'.png'});
  await page.click('#tools-compare-live');assert.equal(await page.locator('[data-tools-tab=compare]').getAttribute('aria-pressed'),'true');
  assert.match(await page.locator('#tools-live-status').textContent(),/40 models selected/);
  await page.click('[data-tools-tab=library]');await page.click('#tools-compare-last24h');
  assert.equal(await page.locator('#tools-recent-range').inputValue(),'86400000','Current Live shortcut opens the full 24-hour saved-session view');
  await page.click('#tools-compare-saved');
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
  await page.selectOption('#tools-recent-range','43200000');
  assert.match(await page.locator('#tools-recent-status').textContent(),/50 sessions/,'the 12-hour preset filters actual recent samples from every model');
  await page.click('#tools-recent-metric-total');await page.click('#tools-recent-refresh');
  assert.equal(await page.locator('#tools-recent-range').inputValue(),'43200000','metric and source refresh retain the selected range');
  await page.locator('#tools-content').evaluate(element=>element.scrollTop=0);
  await page.screenshot({path:'/tmp/tierscope-recent-range-'+engine+'.png'});
  await page.click('#tools-compare-saved');await page.click('#tools-compare-recent');
  assert.equal(await page.locator('#tools-recent-range').inputValue(),'43200000','switching comparison modes retains the selected range');
  await page.click('[data-tools-tab=library]');await page.click('[data-tools-tab=compare]');
  assert.equal(await page.locator('#tools-recent-range').inputValue(),'43200000','Library tab navigation preserves the range');
  await page.click('[data-tools-tab=library]');await page.click('#tools-compare-live');
  assert.equal(await page.locator('#tools-live-models').count(),1,'Current Live card routes directly to live models');
  await page.click('#tools-compare-recent');assert.equal(await page.locator('#tools-recent-range').inputValue(),'43200000');
  await page.click('[data-tools-tab=library]');await page.click('#tools-compare-last24h');
  assert.equal(await page.locator('#tools-recent-range').inputValue(),'86400000','the explicit Last 24h shortcut resets the chosen preset');
  await assertGlobalRecent(63);
  await screenshot('recent');
  for(const bright of [false,true]){await page.locator('#dark-mode-toggle').setChecked(!bright);await page.setViewportSize({width:380,height:850});
   assert(await page.locator('#tools-content').evaluate(element=>element.scrollWidth<=element.clientWidth+1));await page.setViewportSize({width:1250,height:1050});}
  const savedAfter=await page.evaluate(()=>ViewerTracker.__expanded.saved());
  for(const [key,value]of Object.entries(savedBefore))assert.equal(savedAfter[key],value,'comparison never rewrites '+key);
  assert.equal(Object.keys(savedAfter).length,Object.keys(savedBefore).length+1,'only the explicit fixture addition changes saved recordings');
  assert.deepEqual(await page.evaluate(()=>ViewerTracker.__expanded.state()),liveBefore);assert.equal(requests,0,'comparisons and shortcuts add no API scans');
  await page.evaluate(()=>ViewerTracker.__expanded.seedCurrentStyles());
  const styleSavedBefore=await page.evaluate(()=>ViewerTracker.__expanded.saved());
  await page.click('[data-tools-tab=library]');await page.click('#tools-compare-last24h');
  const historicalStyle=async title=>{
   const recordId=await page.evaluate(title=>{
    const entries=Object.entries(ViewerTracker.__expanded.saved()).map(([key,value])=>({key,record:JSON.parse(value)}));
    const record=entries.find(entry=>entry.record.title===title);return record&&record.key.slice('tierscope:library:v1:'.length);
   },title);
   await page.fill('#tools-chart-line-search','comparison_room');
   // Session starts are part of the chart label; determine the exact selected
   // record index through the saved reports rather than matching a room alone.
   const start=await page.evaluate(id=>JSON.parse(ViewerTracker.__expanded.saved()['tierscope:library:v1:'+id]).archive.session.sessionStartedAt,recordId);
   const text=await page.evaluate(start=>new Date(start).toLocaleString(),start);
   const row=page.locator('.tools-chart-legend label').filter({hasText:text});assert.equal(await row.count(),1);
   return row.evaluate(element=>({dash:element.querySelector('.tools-series-swatch').style.borderTopStyle,
    opacity:Number(element.querySelector('.tools-series-swatch').style.opacity),color:element.style.color}));
  };
  let style=await historicalStyle('Current ongoing session');
  assert.equal(style.dash,'solid');assert.equal(style.opacity,1);assert.equal(style.color,'rgb(180, 35, 112)','paused current-room metadata keeps its actual ongoing session pink in the bright theme');
  assert.equal((await historicalStyle('Earlier current-model session')).dash,'dashed','a smaller same-room publisher cannot style its older recording as current');
  await page.locator('#tools-content').evaluate(element=>element.scrollTop=0);await page.screenshot({path:'/tmp/tierscope-current-history-style-'+engine+'.png'});
  await page.click('#tools-compare-live');await page.locator('#tools-live-chooser').evaluate(element=>element.open=true);await page.click('#tools-live-select-all');
  await page.fill('#tools-chart-line-search','comparison_room');
  assert.equal(await page.locator('.tools-chart-legend label').count(),1,
   'Current-room chart source missing: '+JSON.stringify(await page.evaluate(()=>ViewerTracker.__expanded.sources().sources.filter(source=>source.room==='comparison_room')))+'\n'+await page.locator('#tools-live-models').innerText());
  const currentLiveStyle=()=>page.locator('.tools-chart-legend label').evaluate(element=>({dash:element.querySelector('.tools-series-swatch').style.borderTopStyle,
   opacity:Number(element.querySelector('.tools-series-swatch').style.opacity),color:element.style.color}));
  style=await currentLiveStyle();assert.equal(style.dash,'solid');assert.equal(style.opacity,1);assert.equal(style.color,'rgb(180, 35, 112)');
  await page.fill('#tools-chart-line-search','aaa_model');
  assert.notEqual(await page.locator('.tools-chart-legend label').evaluate(element=>element.style.color),style.color,'an alphabetically earlier model never takes the current room’s pink');
  await page.fill('#tools-chart-line-search','comparison_room');await page.locator('#dark-mode-toggle').setChecked(true);
  await page.waitForFunction(()=>document.querySelector('.tools-chart-legend label')?.style.color==='rgb(255, 105, 180)');
  style=await currentLiveStyle();assert.equal(style.color,'rgb(255, 105, 180)');
  assert.deepEqual(await page.evaluate(()=>ViewerTracker.__expanded.saved()),styleSavedBefore,'metadata styling never rewrites saved sessions');
  assert.deepEqual(await page.evaluate(()=>ViewerTracker.__expanded.state()),liveBefore);assert.equal(requests,0);

  // Chart-only comparison is a second presentation of the existing view. Its
  // geometry/preferences are independent, while the chart and user choices live on.
  const library=page.locator('#tierscope-session-tools');
  const opacity=async value=>page.locator('#tools-opacity-slider').evaluate((element,value)=>{
   element.value=String(value);element.dispatchEvent(new Event('input'));
  },value);
  const resized=async scale=>page.waitForFunction(scale=>Math.abs(Number(document.getElementById('tierscope-session-tools').dataset.scale)-scale)<.001,scale);
  const appearance=()=>page.evaluate(()=>{
   const value=GM_getValue('tierscope:library-appearance:v1');return typeof value==='string'?JSON.parse(value):value;
  });
  async function captureChart(){return page.evaluate(()=>({
   range:document.getElementById('tools-chart-range').textContent,
   cursor:document.querySelector('#tools-chart-inspection caption').textContent,
   legend:[...document.querySelectorAll('.tools-chart-legend input')].map(element=>[element.dataset.analysisSeries,element.checked]),
   metric:document.querySelector('.tools-metric-strip [aria-checked=true]')?.id
  }));}
  async function chooseChart(query){
   await page.fill('#tools-chart-line-search',query);
   assert.equal(await page.locator('.tools-chart-legend input').count(),1);
   await page.locator('.tools-chart-legend input').uncheck();
   await page.locator('#tools-analysis-chart').focus();await page.keyboard.press('End');await page.click('#tools-chart-zoom-in');
   assert.match(await page.locator('#tools-chart-inspection caption').textContent(),/pinned/);
   await page.evaluate(()=>{
    window.compactCanvas=document.getElementById('tools-analysis-chart');
    window.compactControls=[...document.querySelectorAll('.tools-metric-strip,#tools-live-window,#tools-recent-range,#tools-compare-axis,#tools-shared-length')]
     .map(element=>({element,parent:element.parentElement}));
   });
   return captureChart();
  }
  async function toggleCompact(enabled){
   await page.click('#tools-chart-only');
   await page.waitForFunction(enabled=>document.getElementById('tierscope-session-tools').dataset.chartOnly===String(enabled),enabled);
   await page.waitForFunction(enabled=>{
    const library=document.getElementById('tierscope-session-tools'),expected=(enabled?400:Math.max(420,document.getElementById('tracker-container').offsetHeight))*Number(library.dataset.renderScale);
    return Math.abs(library.getBoundingClientRect().height-Math.min(expected,innerHeight-16))<2;
   },enabled);
  }
  async function assertCompactChart(before,reason){
   assert(await page.evaluate(()=>window.compactCanvas===document.getElementById('tools-analysis-chart')),reason+': the existing canvas is retained');
   assert.deepEqual(await captureChart(),before,reason+': hidden lines, zoom, cursor and metric stay intact');
   assert(await page.locator('#tools-analysis-chart').isVisible());assert(await page.locator('#tools-compact-status').isVisible());
   for(const selector of ['#tierscope-session-tools nav','.tools-chart-legend'])
    assert(!(await page.locator(selector).isVisible()),reason+': analysis controls are hidden');
   assert(await page.locator('.tools-metric-strip').isVisible(),reason+': tier selection stays visible');
   assert(await page.locator('#tools-chart-zoom-in').isVisible(),reason+': chart range controls stay visible');
   for(const selector of ['#tools-live-window','#tools-recent-range','#tools-compare-axis','#tools-shared-length'])
    if(await page.locator(selector).count())assert(await page.locator(selector).isVisible(),reason+': comparison range stays visible');
   assert(await page.evaluate(()=>compactControls.every(({element,parent})=>
    document.getElementById(element.id)===element&&element.parentElement===parent)),reason+': compact controls retain their original DOM nodes and parents');
   assert(await page.locator('#tools-standard-size').isVisible());assert(await page.locator('#tools-opacity-slider').isVisible());
   assert(await library.evaluate(element=>{
    const panel=element.getBoundingClientRect(),chart=element.querySelector('#tools-analysis-chart').getBoundingClientRect();
    return element.scrollWidth<=element.clientWidth+1&&chart.width>150&&chart.height>70&&chart.left>=panel.left-1&&chart.right<=panel.right+1&&chart.top>=panel.top&&chart.bottom<=panel.bottom;
   }),reason+': the chart fits inside the compact Library');
  }
  await page.click('#tools-compare-saved');await picker();await page.click('#tools-analysis-clear');
  await page.fill('#tools-analysis-search','Bulk session');await page.click('#tools-compare-all-matching');
  await page.locator('#tools-recording-picker').evaluate(element=>element.open=false);await page.click('#tools-metric-total');
  const savedCompact=await chooseChart('Bulk session 059');
  await page.locator('#tools-resize-handle').focus();await page.keyboard.press('ArrowLeft');await page.keyboard.press('ArrowLeft');await resized(1.1);
  await opacity(75);await page.waitForFunction(()=>document.getElementById('tools-opacity-slider').value==='75');
  await toggleCompact(true);await resized(1);
  assert.equal(await page.locator('#tools-opacity-slider').inputValue(),'95','compact appearance starts independently of the full Library');
  await assertCompactChart(savedCompact,'Saved comparison minimizes');
  await page.click('#tools-metric-withTokens');
  assert.equal(await page.locator('#tools-metric-withTokens').getAttribute('aria-checked'),'true');
  assert.match(await page.locator('#tools-compact-subtitle').textContent(),/Viewers with tokens/);
  assert.match(await page.locator('#tools-analysis-chart').getAttribute('aria-label'),/Viewers with tokens/);
  await page.click('#tools-metric-total');await assertCompactChart(savedCompact,'Saved compact metric round trip');
  const sharedLength=await page.locator('#tools-shared-length').isChecked();
  await page.locator('#tools-shared-length').setChecked(!sharedLength);
  assert.equal(await page.locator('#tools-shared-length').isChecked(),!sharedLength);
  await page.locator('#tools-shared-length').setChecked(sharedLength);
  await assertCompactChart(savedCompact,'Saved compact shared length round trip');
  await opacity(40);await page.locator('#tools-resize-handle').focus();await page.keyboard.press('ArrowLeft');await resized(1.05);
  await page.click('#tools-standard-size');await resized(1);
  assert.equal(await page.locator('#tools-opacity-slider').inputValue(),'40','100% resets scale without changing compact opacity');
  await page.locator('#tools-resize-handle').focus();await page.keyboard.press('ArrowLeft');await page.keyboard.press('ArrowLeft');await resized(1.1);
  await assertCompactChart(savedCompact,'Compact resizing');
  await page.screenshot({path:'/tmp/tierscope-chart-only-saved-'+engine+'.png'});
  await toggleCompact(false);await resized(1.1);
  assert.equal(await page.locator('#tools-opacity-slider').inputValue(),'75');assert.deepEqual(await captureChart(),savedCompact);
  assert(await page.evaluate(()=>window.compactCanvas===document.getElementById('tools-analysis-chart')),'expanding keeps the same Saved chart');
  assert(await page.locator('.tools-chart-legend').isVisible());assert.equal(await page.locator('#tools-compare-saved').getAttribute('aria-pressed'),'true');
  const appearanceAfterSaved=await appearance();
  assert.equal(appearanceAfterSaved.scale,1.1);assert.equal(appearanceAfterSaved.opacity,75);
  assert.equal(appearanceAfterSaved.compactScale,1.1);assert.equal(appearanceAfterSaved.compactOpacity,40);
  await toggleCompact(true);await page.selectOption('#tools-compare-axis','clock');
  assert.equal(await library.getAttribute('data-chart-only'),'true');assert(await page.locator('#tools-shared-length').isDisabled());
  assert.match(await page.locator('#tools-analysis-chart').getAttribute('aria-label'),/local time of day/);
  await page.selectOption('#tools-compare-axis','elapsed');assert(await page.locator('#tools-shared-length').isEnabled());
  assert.match(await page.locator('#tools-analysis-chart').getAttribute('aria-label'),/real elapsed time/);
  await toggleCompact(false);assert.equal(await page.locator('#tools-compare-axis').inputValue(),'elapsed');

  await page.click('#tools-compare-recent');await page.click('#tools-recent-metric-total');
  let recentCompact=await chooseChart('cross_day_model');await page.click('#tools-recent-freeze');
  await toggleCompact(true);await assertCompactChart(recentCompact,'Recent comparison minimizes');
  assert.match(await page.locator('#tools-compact-status').textContent(),/frozen/i,'the minimized strip makes frozen charts recognizable');
  assert.equal(await page.locator('#tools-compact-status').getAttribute('title'),await page.locator('#tools-compact-status').textContent(),'the status tooltip preserves its full explanation');
  assert.match(await page.locator('#tools-chart-only').getAttribute('aria-label'),/expand/i);
  await page.click('#tools-recent-metric-withTokens');
  assert.match(await page.locator('#tools-compact-subtitle').textContent(),/Viewers with tokens/);
  await page.click('#tools-recent-metric-total');await assertCompactChart(recentCompact,'Recent compact metric round trip');
  await page.selectOption('#tools-recent-range','14400000');
  assert.equal(await library.getAttribute('data-chart-only'),'true');assert.equal(await page.locator('#tools-recent-range').inputValue(),'14400000');
  assert.match(await page.locator('#tools-compact-status').textContent(),/frozen/i);
  assert(!(await page.locator('.tools-chart-legend input').isChecked()),'narrowing a frozen Recent range retains the hidden session');
  assert.doesNotMatch(await page.locator('#tools-chart-inspection caption').textContent(),/pinned/,'an intentional preset resets inspection and zoom');
  await page.selectOption('#tools-recent-range','86400000');
  assert(!(await page.locator('.tools-chart-legend input').isChecked()));
  await page.locator('#tools-analysis-chart').focus();await page.keyboard.press('End');
  recentCompact=await captureChart();await page.evaluate(()=>{window.compactCanvas=document.getElementById('tools-analysis-chart');});
  await page.evaluate(()=>{window.testNow+=30000;ViewerTracker.__expanded.addCompactRecent();ViewerTracker.__expanded.refreshTools();});
  await assertCompactChart(recentCompact,'Frozen Recent chart ignores incoming saved data');
  await toggleCompact(false);assert.deepEqual(await captureChart(),recentCompact);
  assert.equal(await page.locator('#tools-recent-freeze').getAttribute('aria-pressed'),'true');
  await page.click('#tools-recent-freeze');
  await page.fill('#tools-chart-line-search','compact_model');assert.equal(await page.locator('.tools-chart-legend label').count(),1,'expanding and resuming catches the saved session added while compact');
  await page.fill('#tools-chart-line-search','cross_day_model');
  await page.locator('#tools-analysis-chart').focus();await page.keyboard.press('End');await page.click('#tools-chart-zoom-in');
  const topologyBefore=await captureChart();await page.evaluate(()=>{window.compactCanvas=document.getElementById('tools-analysis-chart');});
  await toggleCompact(true);
  await page.evaluate(()=>{window.testNow+=30000;ViewerTracker.__expanded.addCompactRecent('_next');ViewerTracker.__expanded.refreshTools();});
  await page.waitForFunction(()=>{
   const canvas=document.getElementById('tools-analysis-chart');return canvas!==window.compactCanvas&&canvas?.hasAttribute('data-compact-path');
  });
  assert.equal(await library.getAttribute('data-chart-only'),'true','a new eligible saved session preserves compact presentation during chart rebuild');
  assert(await page.locator('#tools-analysis-chart').isVisible());assert(!(await page.locator('.tools-chart-legend').isVisible()));
  const topologyAfter=await captureChart();
  assert.equal(topologyAfter.range,topologyBefore.range);assert.equal(topologyAfter.cursor,topologyBefore.cursor);
  assert.equal(topologyAfter.metric,topologyBefore.metric);assert.equal(topologyAfter.legend[0][1],false,'the existing model remains hidden after its chart index changes');
  await page.screenshot({path:'/tmp/tierscope-chart-only-recent-'+engine+'.png'});
  await toggleCompact(false);

  await page.click('#tools-compare-live');await page.click('#tools-live-metric-total');
  const liveCompact=await chooseChart('live_model_39');
  const liveCountBefore=await lastLiveCount();await page.click('#tools-live-freeze');
  await toggleCompact(true);await assertCompactChart(liveCompact,'Live comparison minimizes');
  assert.match(await page.locator('#tools-compact-status').textContent(),/frozen/i);
  for(const status of ['stopped','paused','offline','tracking']){
   await page.evaluate(status=>{
    const key='tierscope:live:v1:source:publisher-00',meta=GM_getValue(key);
    GM_setValue(key,{...meta,status,lastSeenAt:Date.now()});
    GM_setValue('tierscope:live:v1:changed',{version:1,at:Date.now(),token:'compact-status-'+status});
    ViewerTracker.__expanded.refreshTools();
   },status);
   const strip=page.locator('#tools-compact-status');
   if(status==='tracking')assert(!/stopped|offline/.test(await strip.textContent()),'the compact source warning clears when tracking recovers');
   else assert.match(await strip.textContent(),new RegExp('\\b\\d+ '+status+'\\b'),'compact view reports '+status+' sources');
   assert.match(await strip.textContent(),/frozen/i);assert.equal(await strip.getAttribute('title'),await strip.textContent());
   assert.equal(await strip.getAttribute('data-warning'),String(['stopped','offline'].includes(status)));
   await assertCompactChart(liveCompact,'Compact source status '+status);
  }
  await page.evaluate(()=>{window.testNow+=30000;ViewerTracker.__expanded.updateLive(39,360);ViewerTracker.__expanded.refreshTools();});
  assert.equal(await lastLiveCount(),liveCountBefore);await assertCompactChart(liveCompact,'Frozen Live comparison retains its values');
  await toggleCompact(false);assert.deepEqual(await captureChart(),liveCompact);
  await page.click('#tools-live-freeze');assert.equal(await lastLiveCount(),'360');
  await toggleCompact(true);
  await page.evaluate(()=>{window.testNow+=30000;ViewerTracker.__expanded.updateLive(39,390);ViewerTracker.__expanded.refreshTools();});
  await page.waitForFunction(()=>document.querySelector('#tools-live-samples [data-live-report="live_model_39"] td')?.textContent==='390');
  assert.equal(await library.getAttribute('data-chart-only'),'true','ongoing scans update the compact chart without expanding it');
  assert(!(await page.locator('.tools-chart-legend input').isChecked()),'ongoing compact updates preserve the hidden Live model');
  const liveSelected=await page.locator('[data-live-source]:checked').count();
  await page.click('#tools-live-metric-withTokens');
  assert.match(await page.locator('#tools-compact-subtitle').textContent(),/Viewers with tokens/);
  assert.match(await page.locator('#tools-analysis-chart').getAttribute('aria-label'),/Viewers with tokens/);
  await page.selectOption('#tools-live-window','14400000');
  assert.equal(await library.getAttribute('data-chart-only'),'true');assert.equal(await page.locator('#tools-live-window').inputValue(),'14400000');
  assert.equal(await page.locator('[data-live-source]:checked').count(),liveSelected,'compact Live window changes retain the chosen models');
  await page.selectOption('#tools-live-window','3600000');await page.click('#tools-live-metric-total');
  assert.equal(await page.locator('#tools-live-window').inputValue(),'3600000');
  await page.screenshot({path:'/tmp/tierscope-chart-only-live-'+engine+'.png'});
  await page.setViewportSize({width:380,height:850});
  await page.waitForFunction(()=>document.getElementById('tierscope-session-tools').dataset.layout==='sheet');
  assert(await library.evaluate(element=>{
   const rect=element.getBoundingClientRect();return rect.left>=0&&rect.right<=innerWidth&&rect.top>=0&&rect.bottom<=innerHeight&&element.scrollWidth<=element.clientWidth+1;
  }),'compact Library fits narrow windows');
  await page.locator('#tracker-container').evaluate(element=>{element.style.left='90px';element.style.top='80px';element.style.right='auto';});
  await page.waitForFunction(()=>Math.abs(document.getElementById('tierscope-session-tools').getBoundingClientRect().top-80)<1);
  assert(await page.locator('#tracker-container').evaluate(panel=>{
   const p=panel.getBoundingClientRect(),l=document.getElementById('tierscope-session-tools').getBoundingClientRect(),left=Math.max(p.left,l.left,0),right=Math.min(p.right,l.right,innerWidth),top=Math.max(p.top,l.top,0),bottom=Math.min(p.bottom,l.bottom,innerHeight);
   return right>left&&bottom>top&&panel.contains(document.elementFromPoint((left+right)/2,(top+bottom)/2));
  }),'Scope receives input above its overlapping compact Library');
  await page.setViewportSize({width:320,height:240});
  await page.locator('#tracker-container').evaluate(element=>{element.style.left='330px';});
  const shortLayout=await library.evaluate(async element=>{
   const heights=[];for(let i=0;i<8;i++){await new Promise(requestAnimationFrame);heights.push(element.getBoundingClientRect().height);}
   const content=element.querySelector('#tools-content'),footer=element.querySelector('.tools-appearance').getBoundingClientRect(),rect=element.getBoundingClientRect();
   return {heights,scrollHeight:content.scrollHeight,clientHeight:content.clientHeight,overflow:getComputedStyle(content).overflowY,
    footerTop:footer.top,footerBottom:footer.bottom,left:rect.left,right:rect.right,bottom:rect.bottom,horizontal:element.scrollWidth-element.clientWidth};
  });
  assert(Math.max(...shortLayout.heights)-Math.min(...shortLayout.heights)<1,'short-window chart height settles without a resize loop');
  assert(shortLayout.left>=0&&shortLayout.right<=320&&shortLayout.bottom<=240&&shortLayout.horizontal<=1);
  assert(shortLayout.footerTop>=0&&shortLayout.footerBottom<=240,'the transparency footer stays within a short viewport');
  assert(shortLayout.scrollHeight>shortLayout.clientHeight&&['auto','scroll'].includes(shortLayout.overflow),'short compact views scroll the chart controls vertically');
  for(const selector of ['.tools-metric-strip','#tools-live-window','#tools-chart-zoom-in','#tools-analysis-chart']){
   const control=page.locator(selector);await control.evaluate(element=>element.scrollIntoView({block:'center',inline:'nearest'}));
   assert(await control.evaluate(element=>{
    const rect=element.getBoundingClientRect(),view=document.getElementById('tools-content').getBoundingClientRect();
    return rect.bottom>view.top&&rect.top<view.bottom&&rect.left>=view.left-1&&rect.right<=view.right+1;
   }),selector+' remains reachable by scrolling in a short compact view');
  }
  await page.screenshot({path:'/tmp/tierscope-chart-only-short-'+engine+'.png'});
  await page.setViewportSize({width:1250,height:1050});await toggleCompact(false);
  await toggleCompact(true);
  await page.locator('#tools-live-clear').evaluate(element=>element.click());
  await page.waitForFunction(()=>document.getElementById('tierscope-session-tools').dataset.chartOnly==='false');
  assert.equal(await page.locator('#tools-analysis-chart').count(),0);assert(await page.locator('#tools-chart-only').isDisabled());
  assert(await page.locator('#tierscope-session-tools nav').isVisible(),'an empty comparison restores its navigation');
  await page.locator('#tools-live-chooser').evaluate(element=>element.open=true);await page.click('#tools-live-select-all');
  assert(await page.locator('#tools-chart-only').isEnabled());
  await page.click('[data-tools-tab=library]');assert(await page.locator('#tools-chart-only').isDisabled());
  await page.click('[data-tools-tab=summary]');assert(await page.locator('#tools-chart-only').isDisabled(),'chart-only is reserved for comparison charts');
  await page.click('[data-tools-tab=compare]');await toggleCompact(true);
  await page.click('#tools-close');await page.click('#btn-control-library');
  assert.equal(await library.getAttribute('data-chart-only'),'false','reopening begins with the full Library');
  assert.equal(await page.locator('#tools-opacity-slider').inputValue(),'75');await resized(1.1);
  await page.click('#tools-compare-live');await toggleCompact(true);await resized(1.1);
  assert.equal(await page.locator('#tools-opacity-slider').inputValue(),'40','compact preferences survive closing and reopening');
  await toggleCompact(false);
  const compactSavedAfter=await page.evaluate(()=>ViewerTracker.__expanded.saved());
  for(const [key,value]of Object.entries(styleSavedBefore))assert.equal(compactSavedAfter[key],value,'chart-only actions never rewrite '+key);
  assert.equal(Object.keys(compactSavedAfter).length,Object.keys(styleSavedBefore).length+2,'only the explicit incoming fixtures add recordings');
  assert.deepEqual(await page.evaluate(()=>ViewerTracker.__expanded.state()),liveBefore);assert.equal(requests,0,'chart-only views add no API traffic');
  await page.evaluate(()=>ViewerTracker.__expanded.stopSources());
  assert.deepEqual(errors,[]);console.log(engine+': expanded Saved/Live/Recent comparisons and chart-only views preserve selections, Frozen state, live updates, independent appearance and narrow-window stacking without API scans');
  await context.close();
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
