const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {GifReader}=require('omggif');
const {instrument,prepareSource}=require('./helpers/instrument.cjs');
const {openLibraryBook}=require('./helpers/library.cjs');
const engine=process.env.TIERSCOPE_BROWSER||'chromium';
const source=prepareSource(fs.readFileSync(path.join(__dirname,'../tierscope.user.js'),'utf8')).replaceAll('scheduleInit(2000);','').replace('downloadTrackingReport: downloadTrackingReport,',`
 __book:{setup(){loadSession(getModelName());const now=Date.now(),h={timestamps:[now-240000,now-180000,now-60000,now],breaks:[false,false,true,false]};
 STORAGE_HISTORY_SERIES.forEach((k,i)=>h[k]=[3+i,7+i,4+i,9+i]);h.total=[32,49,42,57];h.withTokens=[21,31,25,40];h.anonymous=[50,70,66,81];
 restoreSessionState(normalizeStoredSession({timestamp:now,history:h,isPaused:true}));isAutoRefreshOn=false;isMinimized=true;createPanel();toggleView();collapsedRows=new Set();applyRowLayout();repaintLivePresentation();
 const a=captureSessionFile();['another_model','broadcaster_name'].forEach(room=>keepSessionInLibrary({...a,room}));},
 state:()=>({history:JSON.stringify(history),paused:isPaused,playback:playback&&{room:playback.archive.room,position:playback.positionMs}}),
 scale:applyScale,archive:captureSessionFile,library:readSessionLibrary,pause:()=>{if(playback&&playback.playing)togglePlayback();}},
 downloadTrackingReport: downloadTrackingReport,`);
async function download(page,action){const [d]=await Promise.all([page.waitForEvent('download'),action()]);return {name:d.suggestedFilename(),bytes:fs.readFileSync(await d.path())};}
(async()=>{
 const browser=await require('playwright')[engine].launch({headless:true,executablePath:process.env.TIERSCOPE_CHROMIUM_PATH,args:JSON.parse(process.env.TIERSCOPE_CHROMIUM_ARGS||'[]')});
 try{
 const page=await browser.newPage({viewport:{width:1100,height:850},acceptDownloads:true}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://tierscope.test/**',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><body style="background:#252b32"></body>'}));
 await page.goto('https://tierscope.test/testroom/');
 await page.evaluate(()=>{window.store=new Map();window.GM_getValue=(k,d)=>store.has(k)?store.get(k):d;window.GM_setValue=(k,v)=>store.set(k,v);window.GM_listValues=()=>[...store.keys()];window.GM_deleteValue=k=>store.delete(k);});
 await page.addScriptTag({content:instrument(source)});await page.evaluate(()=>ViewerTracker.__book.setup());await page.waitForTimeout(350);
 const panel=page.locator('#tracker-container'),library=page.locator('#tierscope-session-tools'),bounds=await panel.boundingBox(),live=await page.evaluate(()=>ViewerTracker.__book.state());
 assert.deepEqual(await page.locator('#control-session-buttons button').allTextContents(),['Library','Replay']);
 await page.click('#btn-control-library');await page.waitForTimeout(100);
 const dock=await library.boundingBox();assert(Math.abs(dock.x+dock.width-bounds.x-1)<1);assert.equal(dock.y,bounds.y);assert.equal(dock.height,bounds.height);
 assert.equal(await library.getAttribute('aria-modal'),'false');assert.equal(await library.getAttribute('data-layout'),'docked');
 assert.equal(await page.locator('#btn-control-library').getAttribute('aria-expanded'),'true');
 await page.uncheck('#dark-mode-toggle');await page.waitForFunction(()=>document.getElementById('tierscope-session-tools').dataset.theme==='bright');
 assert.equal(await library.evaluate(e=>getComputedStyle(e).getPropertyValue('--panel-solid')),await panel.evaluate(e=>getComputedStyle(e).getPropertyValue('--panel-solid')));
 await page.check('#dark-mode-toggle');
 await openLibraryBook(page);await page.click('#tools-folder-another_model');await page.locator('.tools-row summary').click();
 const row=page.locator('.tools-row'),saved=await page.evaluate(()=>ViewerTracker.__book.library().entries.find(e=>e.archive.room==='another_model').archive);
 for(const format of ['TXT','CSV','Save file']){
  const d=await download(page,()=>row.getByRole('button',{name:format,exact:true}).click());assert(d.name.startsWith('another_model-'));
  if(format==='TXT')assert.match(d.bytes.toString(),/Model: another_model/);
  if(format==='CSV'){const lines=d.bytes.toString().trim().split('\r\n');assert.equal(lines.length,5);assert(lines.slice(1).every(line=>line.startsWith('"another_model",')));}
  if(format==='Save file')assert.deepEqual(JSON.parse(d.bytes),saved);
 }
 const gif=await download(page,()=>row.getByRole('button',{name:'GIF',exact:true}).click());assert(gif.name.startsWith('another_model-'));assert.equal(new GifReader(gif.bytes).numFrames(),4);
 assert.deepEqual(await page.evaluate(()=>ViewerTracker.__book.state()),live,'stored exports do not open replay or change live data');
 // A current GIF captures the whole current session without starting replay.
 await page.click('#tools-keep');await page.locator('[data-library-id] summary').click();
 const liveGif=await download(page,()=>page.locator('[data-library-id]').getByRole('button',{name:'GIF',exact:true}).click());assert(liveGif.name.startsWith('testroom-'));
 assert.deepEqual(await page.evaluate(()=>ViewerTracker.__book.state()),live);
 await page.selectOption('#tools-library-model','another_model');
 // A slow file read must not replace a recording selected afterward.
 await page.evaluate(()=>{const read=File.prototype.text;window.restoreRead=()=>{File.prototype.text=read;};File.prototype.text=function(){return read.call(this).then(text=>new Promise(resolve=>{window.finishRead=()=>resolve(text);}));};});
 const picker=page.waitForEvent('filechooser');await page.click('#tools-open-session');
 await(await picker).setFiles({name:'delayed.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({...saved,room:'late_file'}))});
 await page.waitForFunction(()=>typeof window.finishRead==='function');
 await row.getByRole('button',{name:'Replay',exact:true}).click();assert.equal(await library.count(),1);assert.equal(await page.locator('#tools-current-room-replay').textContent(),'another_model');
 await page.evaluate(async()=>{window.restoreRead();window.finishRead();await new Promise(resolve=>setTimeout(resolve,0));});
 assert.equal((await page.evaluate(()=>ViewerTracker.__book.state())).playback.room,'another_model','a late file cannot replace a newer replay selection');
 await page.click('#tools-close');assert.equal(await page.evaluate(()=>document.activeElement.id),'btn-playback-library','closing after live-to-file switches focus to the visible Library button');await page.click('#btn-playback-library');
 await page.click('#playback-next');const replay=await page.evaluate(()=>ViewerTracker.__book.state());
 const full=await download(page,()=>page.click('#tools-export-csv-replay'));assert.equal(full.bytes.toString().trim().split('\r\n').length,5);
 assert.deepEqual(await page.evaluate(()=>ViewerTracker.__book.state()),replay,'exports preserve replay cursor');
 await page.click('#playback-return');assert.equal(await page.locator('#tools-current-room').textContent(),'testroom');
 await page.click('#tools-close');assert.deepEqual(await panel.boundingBox(),bounds);assert.equal(await page.locator('#btn-control-library').getAttribute('aria-expanded'),'false');
 let cancelledDownloads=0;const countDownload=()=>cancelledDownloads++;page.on('download',countDownload);
 await page.click('#btn-control-library');await page.click('#tools-keep');await page.locator('[data-library-id] summary').click();await page.locator('[data-library-id]').getByRole('button',{name:'GIF',exact:true}).evaluate(e=>{e.click();document.getElementById('tools-close').click();});await page.waitForTimeout(200);assert.equal(cancelledDownloads,0,'closing the library cancels an in-progress export');page.off('download',countDownload);
 // Borrow room only while open; never save that temporary shift.
 await panel.evaluate(e=>{e.style.left='30px';e.style.top='80px';e.style.right='auto';});
 const left=await panel.boundingBox(),geometry=await page.evaluate(()=>GM_getValue('tierscope:ui:geometry:v1',null));
 await page.click('#btn-control-library');await page.waitForTimeout(100);assert((await panel.boundingBox()).x>left.x);
 await page.click('#tools-close');assert.deepEqual(await panel.boundingBox(),left);assert.equal(await page.evaluate(()=>GM_getValue('tierscope:ui:geometry:v1',null)),geometry);
 // The left page scales independently and follows drag and the viewport, while explicit user moves persist.
 await page.click('#btn-control-library');await page.evaluate(()=>ViewerTracker.__book.scale(1.2));await page.waitForTimeout(150);
 assert.equal(Math.round((await library.boundingBox()).width),370);
 // Leave room for a physical leftward drag from Library's upper-left corner.
 await panel.evaluate(e=>{e.style.left='600px';e.style.right='auto';});await page.waitForTimeout(100);
 const scopeSize=await panel.boundingBox(),titleHeight=(await page.locator('#tools-title').boundingBox()).height;
 const grip=await page.locator('#tools-resize-handle').boundingBox();
 assert.equal(await page.locator('#tools-resize-handle').evaluate(e=>getComputedStyle(e).cursor),
  await page.locator('#resize-handle').evaluate(e=>getComputedStyle(e).cursor),'both pink grips use the same resize cursor');
 const libraryCorner=await library.boundingBox();
 assert(Math.abs(grip.x-libraryCorner.x)<2&&Math.abs(grip.y-libraryCorner.y)<2,'resize grip sits in Library’s upper-left corner');
 assert((await page.locator('#tools-title').boundingBox()).x>grip.x+grip.width,'Library title clears the resize grip');
 await page.mouse.move(grip.x+3,grip.y+3);await page.mouse.down();await page.mouse.move(grip.x-71,grip.y+3,{steps:6});
 await page.waitForFunction(()=>document.getElementById('tools-standard-size').textContent==='120%');
 await page.mouse.up();
 await page.waitForFunction(()=>Math.abs(Number(document.getElementById('tierscope-session-tools').dataset.scale)-1.2)<.01);
 await page.waitForTimeout(100);
 assert(Math.abs((await library.boundingBox()).width-444)<1,'Library grip scales the entire panel');
 assert(Math.abs((await page.locator('#tools-title').boundingBox()).height/titleHeight-1.2)<.02,'text scales with the panel');
 assert.equal((await panel.boundingBox()).width,scopeSize.width);assert.equal((await panel.boundingBox()).height,scopeSize.height);
 await page.click('#tools-close');await page.click('#btn-control-library');await page.waitForTimeout(100);
 assert(Math.abs((await library.boundingBox()).width-444)<1,'Library remembers its own scale');
 const setOpacity=async(id,n)=>page.locator('#'+id).evaluate((e,n)=>{e.value=n;e.dispatchEvent(new Event('input'));},n);
 await setOpacity('opacity-slider',30);await setOpacity('tools-opacity-slider',45);await page.waitForTimeout(100);
 assert.equal(await panel.evaluate(e=>getComputedStyle(e).backgroundColor),'rgba(20, 20, 30, 0.3)');
 assert.equal(await library.evaluate(e=>getComputedStyle(e).backgroundColor),'rgba(20, 20, 30, 0.45)');
 await setOpacity('opacity-slider',100);await page.waitForTimeout(100);
 assert.equal(await library.evaluate(e=>getComputedStyle(e).backgroundColor),'rgba(20, 20, 30, 0.45)','Scope opacity does not change Library');
 await page.click('#tools-close');await page.click('#btn-control-library');await page.waitForTimeout(100);
 assert.equal(await page.locator('#tools-opacity-slider').inputValue(),'45');
 await page.uncheck('#dark-mode-toggle');await page.waitForFunction(()=>getComputedStyle(document.getElementById('tierscope-session-tools')).backgroundColor==='rgba(248, 249, 252, 0.45)');
 await page.check('#dark-mode-toggle');
 await page.evaluate(()=>{window.realAppearanceSet=GM_setValue;GM_setValue=(key,value)=>{if(key==='tierscope:library-appearance:v1')throw Error('quota');return realAppearanceSet(key,value);};});
 await page.locator('#tools-resize-handle').focus();await page.keyboard.press('ArrowLeft');
 assert.match(await page.locator('#tools-appearance-status').textContent(),/saving failed/);
 await page.evaluate(()=>{GM_setValue=realAppearanceSet;});await page.keyboard.press('Home');
 assert.equal(await page.locator('#tools-appearance-status').textContent(),'');
 await page.waitForTimeout(100);assert.equal(Math.round((await library.boundingBox()).width),370);
 await setOpacity('tools-opacity-slider',95);await setOpacity('opacity-slider',95);
 await page.locator('#tools-resize-handle').focus();
 for(let i=0;i<30;i++)await page.keyboard.press('ArrowLeft');
 await page.waitForFunction(()=>Math.abs(Number(document.getElementById('tierscope-session-tools').dataset.scale)-2.5)<.001);
 const preferred=await library.getAttribute('data-scale');assert(Number(preferred)>2.4);
 await page.setViewportSize({width:380,height:740});await page.waitForTimeout(150);
 const fitted=await library.boundingBox();assert(fitted.width<=364.5&&fitted.height<=724.5);
 assert.equal(await library.getAttribute('data-scale'),preferred,'narrow windows preserve the preferred scale');
 assert(await library.evaluate(e=>e.scrollWidth<=e.clientWidth+1),'scaled narrow Library fits without horizontal overflow');
 await page.setViewportSize({width:1100,height:850});await page.waitForTimeout(150);
 assert.equal(await library.getAttribute('data-scale'),preferred);
 assert(Math.abs(Number(await library.getAttribute('data-render-scale'))-Number(preferred))<.001,'preferred scale returns in a wide window');
 await page.screenshot({path:'/tmp/library-independent-size-'+engine+'.png'});
 await page.setViewportSize({width:2200,height:1100});await page.waitForTimeout(120);
 await page.click('[data-tools-tab=summary]');
 const chart=page.locator('#tools-analysis-chart');
 assert(await chart.evaluate(e=>e.width>=e.clientWidth*2.4),'scaled Library charts use a sharp backing bitmap');
 await chart.focus();await page.keyboard.press('End');await page.click('#tools-chart-zoom-in');
 const chartRange=await page.locator('#tools-chart-range').textContent(),chartPin=await page.locator('#tools-chart-inspection caption').textContent();
 await page.evaluate(()=>ViewerTracker.__book.scale(1.1));await page.waitForTimeout(100);
 assert.equal(await page.locator('#tools-chart-range').textContent(),chartRange);
 assert.equal(await page.locator('#tools-chart-inspection caption').textContent(),chartPin);
 await page.evaluate(()=>ViewerTracker.__book.scale(1.2));
 await page.screenshot({path:'/tmp/library-independent-chart-'+engine+'.png'});
 await page.click('[data-tools-tab=library]');

 await page.locator('#tools-standard-size').evaluate(e=>e.click());await page.setViewportSize({width:1100,height:850});await page.waitForTimeout(150);

 assert.deepEqual((await page.evaluate(()=>ViewerTracker.__book.state())).history,live.history);

 const header=await page.locator('#drag-handle').boundingBox();await page.mouse.move(header.x+40,header.y+12);await page.mouse.down();await page.mouse.move(header.x-20,header.y+42,{steps:5});await page.mouse.up();await page.waitForTimeout(100);
 const moved=await panel.boundingBox(),movedDock=await library.boundingBox();assert(Math.abs(movedDock.x+movedDock.width-moved.x-1)<1);
 await page.click('#tools-close');assert.deepEqual(await panel.boundingBox(),moved,'closing keeps deliberate moves');
 await page.click('#btn-control-library');await page.setViewportSize({width:380,height:740});await page.waitForTimeout(200);
 assert.equal(await library.getAttribute('data-layout'),'sheet');const small=await library.boundingBox();assert(small.x>=0&&small.x+small.width<=380&&small.y+small.height<=740);
 assert(await library.evaluate(e=>e.scrollWidth<=e.clientWidth+1));
 assert(await panel.evaluate(panel=>{
  const p=panel.getBoundingClientRect(),l=document.getElementById('tierscope-session-tools').getBoundingClientRect();
  const left=Math.max(p.left,l.left,0),right=Math.min(p.right,l.right,innerWidth);
  const top=Math.max(p.top,l.top,0),bottom=Math.min(p.bottom,l.bottom,innerHeight);
  return right>left&&bottom>top&&panel.contains(document.elementFromPoint((left+right)/2,(top+bottom)/2));
 }),'Scope receives pointer input above the overlapping narrow-window Library');
 await page.click('#btn-standard-size');assert.equal(await panel.getAttribute('data-scale'),'1','Scope controls remain clickable over Library');
 await page.keyboard.press('Escape');assert.equal(await library.count(),0);
 await page.setViewportSize({width:1100,height:850});await page.waitForTimeout(150);assert.equal(await panel.getAttribute('data-library-open'),null,'observers do not redock after closing');
 assert.deepEqual(errors,[]);
 console.log('PASS book docking, temporary positioning, drag/scale/theme/narrow screen and cleanup; nonmodal controls; full current/stored TXT/CSV/JSON/GIF exports with live/replay isolation');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
