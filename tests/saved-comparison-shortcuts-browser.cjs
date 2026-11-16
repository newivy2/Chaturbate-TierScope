const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {instrument,prepareSource}=require('./helpers/instrument.cjs');
const engine=process.env.TIERSCOPE_BROWSER||'chromium';
const source=instrument(prepareSource(fs.readFileSync(process.env.TIERSCOPE_SOURCE||path.join(__dirname,'../tierscope.user.js'),'utf8'))
 .replaceAll('scheduleInit(2000);','').replace('downloadTrackingReport: downloadTrackingReport,',`__savedShortcut:{
 setup(){loadSession(getModelName());const now=Date.now(),h={timestamps:[now-180000,now-120000,now-60000],breaks:[false,false,false]};
 STORAGE_HISTORY_SERIES.forEach(k=>h[k]=[0,0,0]);h.total=[10,20,30];h.red=h.total.slice();h.withTokens=h.total.slice();h.anonymous=[5,5,5];
 restoreSessionState(normalizeStoredSession({timestamp:now,history:h,sessionStartedAt:h.timestamps[0],sessionStartEstimated:false,isPaused:true,pausedElapsedTime:120000}));
 isAutoRefreshOn=false;isMinimized=true;createPanel();toggleView();repaintLivePresentation();window.shortcutBase=captureLiveSessionFile();
 this.seed();initializeLiveModelSources();saveSession(getModelName(),true);
 const session={...shortcutBase.session,roomEpoch:'legacy',isPaused:false},room='room_b',publisherId='other-tab',recordKey='tierscope:tab:v2:'+room+':other-tab';
 GM_setValue(recordKey,JSON.stringify(session));GM_setValue('tierscope:live:v1:source:'+publisherId,{version:1,id:'other-tab:'+room+':legacy@'+session.sessionStartedAt,
 publisherId,room,roomEpoch:'legacy',sessionId:'legacy@'+session.sessionStartedAt,sessionStartedAt:session.sessionStartedAt,status:'tracking',lastSeenAt:now,
 sampleAt:session.history.timestamps.at(-1),sampleCount:3,revision:'other-tab:'+now,recordKey,recordSavedAt:now});},
 seed(){const now=Date.now();for(const [id,room,days]of [['a0','room_a',1],['a1','room_a',2],['b0','room_b',1],['b1','room_b',2],['current-copy','room_a',0]]){
 const a=JSON.parse(JSON.stringify(shortcutBase)),s=a.session,d=days*86400000;a.room=room;s.timestamp-=d;s.sessionStartedAt-=d;s.history.timestamps=s.history.timestamps.map(t=>t-d);
 if(s.roomTotalHighTime!==null)s.roomTotalHighTime-=d;Object.values(s.sessionHighs).forEach(h=>{if(h.time!==null)h.time-=d;});
 GM_setValue('tierscope:library:v1:'+id,JSON.stringify({schemaVersion:1,addedAt:now,title:id,archive:a}));}},
 replay(){openSessionReplay({...shortcutBase,room:'room_b'});if(playback.playing)togglePlayback();},
 empty(){const s=JSON.parse(JSON.stringify(shortcutBase.session));for(const key of Object.keys(s.history))s.history[key]=[];restoreSessionState(s);},
 stopSources:stopLiveModelSources,state:()=>({history:JSON.stringify(history),paused:isPaused,position:playback&&playback.positionMs}),
 },downloadTrackingReport: downloadTrackingReport,`));
(async()=>{
 const browser=await require('playwright')[engine].launch({headless:true,timeout:15000});
 try{
 const context=await browser.newContext({viewport:{width:1400,height:1050}}),page=await context.newPage(),errors=[];let apiCalls=0;
 page.on('pageerror',e=>errors.push(e.message));
 await context.route('https://tierscope.test/**',r=>{if(r.request().url().includes('/api/'))apiCalls++;return r.fulfill({contentType:'text/html',body:'<!doctype html><body></body>'});});
 await context.addInitScript(()=>{window.testNow=Date.UTC(2026,10,16,12);Date.now=()=>testNow;
 window.GM_getValue=(k,d)=>localStorage.getItem(k)===null?d:JSON.parse(localStorage.getItem(k));window.GM_setValue=(k,v)=>localStorage.setItem(k,JSON.stringify(v));
 window.GM_deleteValue=k=>localStorage.removeItem(k);window.GM_listValues=()=>Object.keys(localStorage);});
 await page.goto('https://tierscope.test/room_a/');await page.addScriptTag({content:source});await page.evaluate(()=>ViewerTracker.__savedShortcut.setup());
 const original=await page.evaluate(()=>ViewerTracker.__savedShortcut.state());
 const stored=()=>page.evaluate(()=>Object.fromEntries(Object.entries(localStorage).filter(([k])=>k.startsWith('tierscope:library:v1:'))));
 const savedBefore=await stored();
 await page.click('#btn-control-library');await page.click('#tools-compare-live');await page.click('#tools-compare-saved');
 async function selected(){return page.locator('[id^=tools-source-]').evaluateAll(nodes=>nodes.map(e=>e.value));}
 async function assertRoomA(first='live'){
  assert.deepEqual(await selected(),[first,'a0','a1']);
  assert.equal(await page.locator('#tools-analysis-model').inputValue(),'room_a');
  assert.equal(await page.locator('#tools-analysis-chart').count(),1);
 }
 await assertRoomA();
 await page.locator('#tools-recording-picker').evaluate(e=>e.open=true);await page.click('#tools-analysis-clear');
 await page.selectOption('#tools-source-a','b0');await page.selectOption('#tools-source-b','b1');
 assert.equal(await page.locator('#tools-source-a').inputValue(),'b0');
 await page.click('#tools-compare-recent');await page.click('#tools-compare-saved');await assertRoomA();
 assert.equal(await page.locator('#tools-analysis-search').inputValue(),'');
 await page.click('#tools-chart-only');await page.waitForFunction(()=>document.getElementById('tierscope-session-tools').dataset.chartOnly==='true');
 await page.click('#tools-compare-live');await page.click('#tools-compare-saved');await assertRoomA();
 assert.equal(await page.locator('#tierscope-session-tools').getAttribute('data-chart-only'),'true');
 await page.click('#tools-compare-saved');await assertRoomA();
 await page.click('#tools-chart-only');
 await page.evaluate(()=>ViewerTracker.__savedShortcut.replay());
 const replay=await page.evaluate(()=>ViewerTracker.__savedShortcut.state());
 await page.click('#tools-compare-live');await page.click('#tools-compare-saved');await assertRoomA();
 assert.deepEqual(await page.evaluate(()=>ViewerTracker.__savedShortcut.state()),replay,'a replay from another model does not replace the actual room comparison or move playback');
 assert.deepEqual(await stored(),savedBefore,'shortcuts never write Library records');
 await page.evaluate(()=>{GM_deleteValue('tierscope:library:v1:a0');GM_deleteValue('tierscope:library:v1:a1');});
 await page.click('#tools-compare-saved');
 assert.equal(await page.locator('#tools-source-b').inputValue(),'');assert.equal(await page.locator('#tools-analysis-chart').count(),0);
 assert.match(await page.locator('#tools-message').textContent(),/No earlier saved sessions for room_a/);
 assert(!((await selected()).some(id=>id==='b0'||id==='b1')),'missing history never selects another model');
 await page.evaluate(()=>{ViewerTracker.__savedShortcut.seed();ViewerTracker.__savedShortcut.empty();});
 await page.click('#tools-compare-saved');await assertRoomA('current-copy');
 assert.equal(apiCalls,0);assert.deepEqual(errors,[]);await page.evaluate(()=>ViewerTracker.__savedShortcut.stopSources());
 assert.equal(original.paused,true);
 console.log(engine+': Saved shortcuts rebuild same-model previous sessions in full/compact modes; mixed selections, current copies, replay, missing history and no live samples remain isolated');
 await context.close();
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
