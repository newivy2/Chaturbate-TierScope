const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const {instrument, prepareSource} = require('./helpers/instrument.cjs');
const engine = process.env.TIERSCOPE_BROWSER || 'chromium';
const injected = prepareSource(fs.readFileSync(process.env.TIERSCOPE_SOURCE || path.join(__dirname, '../tierscope.user.js'), 'utf8'))
    .replaceAll('scheduleInit(2000);', '')
    .replace('capture: () =>', 'capture: window.rangeChartCapture = () =>')
    .replace('downloadTrackingReport: downloadTrackingReport,', `__rangeTest:{
        setup(){
            loadSession(getModelName());isPaused=true;isAutoRefreshOn=false;isMinimized=true;
            createPanel();toggleView();stopCountdown();
            const now=Date.now();
            for(const [room,start,end,value]of [['long_model',now-10800000,now-3600000,10],
                ['medium_model',now-3600000,now-600000,20],['recent_model',now-1200000,now-120000,30]]){
                const timestamps=[start,Math.floor((start+end)/2),end],history={timestamps,breaks:[false,false,false]};
                STORAGE_HISTORY_SERIES.forEach(key=>history[key]=[0,0,0]);
                history.total=[value,value+1,value+2];history.red=history.total.slice();history.withTokens=history.total.slice();history.anonymous=[5,5,5];
                const session=normalizeStoredSession({timestamp:now,history,sessionStartedAt:start,sessionStartEstimated:false,
                    isPaused:true,pausedElapsedTime:end-start,roomTotalHigh:value+7,roomTotalHighTime:end});
                const publisherId='range-'+room.replaceAll('_','-'),recordId=publisherId,recordKey='tierscope:tab:v2:'+room+':'+recordId;
                session.schemaVersion=runtime.STORAGE_SCHEMA_VERSION;session.roomEpoch='legacy';
                validateSessionFile({format:runtime.SESSION_FILE_FORMAT,formatVersion:runtime.SESSION_FILE_VERSION,
                    producerVersion:runtime.TIERSCOPE_VERSION,room,session});
                GM_setValue(recordKey,JSON.stringify(session));
                GM_setValue('tierscope:live:v1:source:'+publisherId,{version:1,id:publisherId+':'+room+':legacy@'+start,
                    publisherId,room,roomEpoch:'legacy',sessionId:'legacy@'+start,sessionStartedAt:start,status:'paused',lastSeenAt:now,
                    sampleAt:end,sampleCount:3,revision:recordId+':3',recordKey,recordSavedAt:now});
            }
        }, state:()=>({history:JSON.stringify(history),paused:isPaused,mode:presentationMode}),
        extendRecent(){
            window.testNow+=60000;const key='tierscope:live:v1:source:range-recent-model',source=GM_getValue(key),session=JSON.parse(GM_getValue(source.recordKey));
            session.timestamp=Date.now();session.history.timestamps.push(Date.now());session.history.breaks.push(true);
            STORAGE_HISTORY_SERIES.forEach(key=>session.history[key].push(session.history[key].at(-1)));
            GM_setValue(source.recordKey,JSON.stringify(session));GM_setValue(key,{...source,lastSeenAt:Date.now(),sampleAt:Date.now(),sampleCount:4,
                recordSavedAt:Date.now(),revision:'range-recent-model:4'});
        },
        cleanup(){shutdownBackgroundTracking();stopLiveModelSources();}
    },downloadTrackingReport: downloadTrackingReport,`);
assert(injected.includes('capture: window.rangeChartCapture ='), 'the test copy exposes the existing chart capture surface');
const source = instrument(injected);

(async () => {
    const browser = await require('playwright')[engine].launch({headless:true, executablePath:process.env.TIERSCOPE_CHROMIUM_PATH,
        args:JSON.parse(process.env.TIERSCOPE_CHROMIUM_ARGS || '[]')});
    try {
        const context = await browser.newContext({viewport:{width:1450,height:1100},timezoneId:'UTC'});
        const page = await context.newPage(), errors = []; let requests = 0;
        context.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));
        await context.route('https://tierscope.test/**',route=>{
            if (route.request().url().includes('/api/')) requests++;
            return route.fulfill({contentType:'text/html',body:'<!doctype html><body style="background:#303846"></body>'});
        });
        await context.addInitScript(()=>{
            window.testNow=Date.UTC(2026,10,16,12);Date.now=()=>testNow;
            window.GM_getValue=(key,fallback)=>localStorage.getItem(key)===null?fallback:JSON.parse(localStorage.getItem(key));
            window.GM_setValue=(key,value)=>localStorage.setItem(key,JSON.stringify(value));
            window.GM_deleteValue=key=>localStorage.removeItem(key);window.GM_listValues=()=>Object.keys(localStorage);
        });
        await page.goto('https://tierscope.test/chart_host/');await page.addScriptTag({content:source});
        await page.evaluate(()=>ViewerTracker.__rangeTest.setup());
        const original = await page.evaluate(()=>ViewerTracker.__rangeTest.state());
        const library = () => page.evaluate(()=>Object.fromEntries(Object.entries(localStorage).filter(([key])=>key.startsWith('tierscope:library:v1:'))));
        const stored = await library();
        await page.click('#btn-control-library');await page.click('#tools-compare-live');
        const sourceCheck = room => page.locator('.tools-live-source[data-live-room="'+room+'"] input[data-live-source]');
        const lineCheck = room => page.locator('.tools-chart-legend label').filter({hasText:room}).locator('input');
        const showChooser = () => page.locator('#tools-live-chooser').evaluate(element=>element.open=true);
        const selected = () => page.locator('[data-live-source]').evaluateAll(nodes=>nodes.map(node=>[node.closest('[data-live-room]').dataset.liveRoom,node.checked]));
        const chart = () => page.evaluate(()=>{
            if(typeof window.rangeChartCapture !== 'function') throw new Error('No comparison chart: '+document.getElementById('tools-live-models')?.textContent);
            return window.rangeChartCapture();
        });
        const now = Date.UTC(2026,10,16,12);
        async function bounds(start,end,reason){
            const captured=await chart();
            assert.equal(captured.originAt+captured.start,start,reason+' — first visible sample');
            assert.equal(captured.originAt+captured.end,end,reason+' — last visible sample');
        }
        await page.selectOption('#tools-live-window','Infinity');
        await bounds(now-10800000,now-120000,'Full sessions includes all initially selected recordings');
        await showChooser();await sourceCheck('long_model').uncheck();
        await bounds(now-3600000,now-120000,'Removing the longest source contracts Full sessions');
        await lineCheck('medium_model').uncheck();
        await bounds(now-1200000,now-120000,'Hiding the remaining older line contracts Full sessions');
        const chosen = await selected();
        await page.selectOption('#tools-live-window','900000');
        assert.deepEqual(await selected(),chosen,'changing the preset keeps the chosen sources');
        assert.equal(await lineCheck('medium_model').isChecked(),false,'changing the preset keeps a hidden line hidden');
        await bounds(now-900000,now,'finite presets retain their wall-clock anchor');
        await page.selectOption('#tools-live-window','Infinity');
        assert.deepEqual(await selected(),chosen);assert.equal(await lineCheck('medium_model').isChecked(),false);
        await bounds(now-1200000,now-120000,'returning to Full sessions uses the visible recording');

        // Inserting a source before a hidden line changes its chart index. Its
        // stable source identity must keep that same model hidden.
        await sourceCheck('long_model').check();
        assert.equal(await lineCheck('medium_model').isChecked(),false,'adding another source retains hidden choices by identity');
        await bounds(now-10800000,now-120000,'adding the older visible source expands Full sessions');
        await sourceCheck('long_model').uncheck();
        assert.equal(await lineCheck('medium_model').isChecked(),false,'removing another source retains hidden choices by identity');
        await bounds(now-1200000,now-120000,'removing the older source restores the shorter visible range');
        await page.click('#tools-live-metric-total');
        assert.equal(await lineCheck('medium_model').isChecked(),false,'changing metrics retains hidden lines');
        await bounds(now-1200000,now-120000,'metric changes preserve the selected time extent');
        await lineCheck('medium_model').check();
        await bounds(now-3600000,now-120000,'showing the line again expands Full sessions');
        await lineCheck('medium_model').uncheck();
        await page.click('[data-tools-tab=library]');await page.click('#tools-compare-live');
        assert.deepEqual(await selected(),chosen,'switching away and back preserves source selection');
        assert.equal(await lineCheck('medium_model').isChecked(),false,'switching away and back preserves line visibility');
        await bounds(now-1200000,now-120000,'reopening Live comparison fits the same visible recording');

        await showChooser();await sourceCheck('long_model').check();
        await lineCheck('recent_model').uncheck();
        await sourceCheck('long_model').uncheck();
        assert.equal(await lineCheck('medium_model').isChecked(),false);
        assert.equal(await lineCheck('recent_model').isChecked(),false,'removing the sole visible source does not silently show another line');
        await page.selectOption('#tools-live-window','900000');await page.selectOption('#tools-live-window','Infinity');
        assert.equal(await lineCheck('medium_model').isChecked(),false);
        assert.equal(await lineCheck('recent_model').isChecked(),false,'range changes preserve a fully hidden chart');
        await lineCheck('recent_model').check();
        await bounds(now-1200000,now-120000,'explicitly restoring one line fits its full recording');

        await showChooser();await page.click('#tools-live-clear');
        assert.equal(await page.locator('#tools-analysis-chart').count(),0);
        await page.selectOption('#tools-live-window','900000');
        assert((await selected()).every(([,checked])=>!checked),'range changes preserve an explicitly empty selection');
        await page.selectOption('#tools-live-window','Infinity');
        assert((await selected()).every(([,checked])=>!checked));
        await sourceCheck('recent_model').check();
        await bounds(now-1200000,now-120000,'a single reselected recording determines its full range');
        await page.selectOption('#tools-live-window','3600000');
        await page.locator('#tools-analysis-chart').focus();await page.keyboard.press('End');await page.click('#tools-chart-zoom-in');
        const zoomed=await chart();
        await page.evaluate(()=>ViewerTracker.__rangeTest.extendRecent());await page.click('#tools-live-refresh');
        const updated=await chart();
        assert.equal(updated.originAt+updated.start,zoomed.originAt+zoomed.start,'new samples preserve an explicitly zoomed absolute start');
        assert.equal(updated.originAt+updated.end,zoomed.originAt+zoomed.end,'new samples preserve an explicitly zoomed absolute end');
        assert.equal(updated.originAt+updated.cursor,zoomed.originAt+zoomed.cursor,'new samples preserve a pinned timestamp');
        assert.equal(requests,0,'range and visibility controls add no API scans');
        assert.deepEqual(await library(),stored,'chart customization does not write recordings');
        assert.deepEqual(await page.evaluate(()=>ViewerTracker.__rangeTest.state()),original,'chart customization leaves the live owner unchanged');
        assert.deepEqual(errors,[]);await page.evaluate(()=>ViewerTracker.__rangeTest.cleanup());
        await context.close();
        console.log(engine+': Full sessions follows selected visible recordings; presets retain source/line choices, stable identities and empty selections without scans or session changes');
    } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
