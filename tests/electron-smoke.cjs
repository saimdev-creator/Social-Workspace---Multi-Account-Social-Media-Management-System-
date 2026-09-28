// Run with Electron. This harness NEVER opens the normal user profile.
const {app,BrowserWindow,session,shell,dialog}=require('electron');
const externalCalls=[];
const nativeFetch=globalThis.fetch;
let oauthMailbox='first@gmail-fixture.test';
const gmailRead=new Map();let gmailSent=0;
shell.openExternal=async url=>{externalCalls.push(url);if(url.startsWith('https://accounts.google.com/')){const auth=new URL(url),callback=new URL(auth.searchParams.get('redirect_uri'));callback.search=new URLSearchParams({state:auth.searchParams.get('state'),code:oauthMailbox});await nativeFetch(callback);}};
globalThis.fetch=async(url,options={})=>{
  if(url==='https://oauth2.googleapis.com/token'){const email=options.body.get('code')||options.body.get('refresh_token');return new Response(JSON.stringify({access_token:email,refresh_token:email,expires_in:3600,scope:'https://www.googleapis.com/auth/gmail.modify'}));}
  if(url.startsWith('https://gmail.googleapis.com/')){
    const email=options.headers.Authorization.replace('Bearer ','');let data;
    if(url.endsWith('/profile'))data={emailAddress:email};
    else if(url.includes('/messages?'))data=url.includes('pageToken=fixture-next')?{messages:[{id:'gmail-real-page-2'},{id:'gmail-real-fixture'}]}:{messages:[{id:'gmail-real-fixture'}],nextPageToken:'fixture-next'};
    else if(url.endsWith('/modify')){gmailRead.set(email,!JSON.parse(options.body).addLabelIds);data={id:'gmail-real-fixture',labelIds:gmailRead.get(email)?['INBOX']:['INBOX','UNREAD']};}
    else if(url.endsWith('/send')){gmailSent++;data={id:'gmail-sent',threadId:'gmail-thread'};}
    else {const requestedId=decodeURIComponent(url.split('/messages/')[1].split('?')[0]);data={id:requestedId,threadId:`gmail-thread-${requestedId}`,internalDate:String(Date.now()),labelIds:gmailRead.get(email)?['INBOX']:['INBOX','UNREAD'],payload:{mimeType:'text/plain',headers:[{name:'From',value:'Customer <customer@example.com>'},{name:'Subject',value:'Gmail fixture inquiry'},{name:'Message-ID',value:`<${requestedId}@example.com>`}],body:{data:Buffer.from('An official API fixture message.').toString('base64url')}}};}
    return new Response(JSON.stringify(data));
  }
  throw new Error('Unexpected network access in fixture tests');
};
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const http=require('node:http');
const assert=require('node:assert/strict');
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'social-workspace-smoke-'));
app.setPath('userData',profile);
const fixtures=['facebook','facebook','instagram','gmail'].map((platform,i)=>({id:`fixture-${i}`,name:`Fixture ${i}`,platform,sessionPartition:`persist:fixture-${i}`,createdAt:new Date().toISOString(),lastOpenedAt:null}));
fs.writeFileSync(path.join(profile,'accounts.json'),JSON.stringify({accounts:fixtures,settings:{theme:'light',startup:'dashboard',confirmDelete:true,rememberLast:true},lastAccountId:null}));
const errors=[];
app.on('web-contents-created',(_,wc)=>wc.on('console-message',(_,level,message)=>{if(level>=3&&!message.includes('Content Security Policy'))errors.push(message);}));
const server=http.createServer((req,res)=>{if(req.url==='/offline'){req.socket.destroy();return;}res.writeHead(200,{'Content-Type':'text/html'});res.end(`<h1>Local platform fixture</h1><a href="/next">Next page</a>`);});
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check,label){for(let i=0;i<100;i++){if(await check())return;await pause(50);}throw new Error(`Timed out: ${label}`);}
server.listen(0,'127.0.0.1',async()=>{
  const url=`http://127.0.0.1:${server.address().port}/`;
  for(const p of Object.values(require('../services/platformManager').platforms))p.url=url;
  require('../main');
  try{
    await app.whenReady();await until(()=>BrowserWindow.getAllWindows().length,'main window');
    const win=BrowserWindow.getAllWindows()[0];const run=async code=>{let timer;try{return await Promise.race([win.webContents.executeJavaScript(code),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Renderer command timed out')),8000);})]);}catch(error){throw new Error(code+'\n'+error.message);}finally{clearTimeout(timer);}};
    await until(async()=>await run("!!document.getElementById('dashboard-create')"),'dashboard');
    const screenshot=async name=>{await pause(100);const dir=path.join(__dirname,'artifacts');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,`${name}.png`),(await win.webContents.capturePage()).toPNG());};
    assert.equal(await run('appState.accounts.length'),4);await screenshot('dashboard');
    for(const page of ['inbox','leads','composer','scheduler','calendar','analytics','reports','listening','settings']){await run(`navigatePage('${page}')`);assert.ok(await run("document.getElementById('content').innerText.length>50"));assert.equal(await run("document.getElementById('content').innerText.includes('This page could not load')"),false);}
    await run("navigatePage('inbox')");await screenshot('inbox');
    await run("document.getElementById('inbox-search').value='restaurant';document.getElementById('inbox-search').dispatchEvent(new Event('input'))");assert.equal(await run("document.querySelectorAll('[data-message]').length"),1);
    await run("document.getElementById('toggle-read').click()");assert.equal(await run('demoStore.data.messages[0].unread'),false);
    await run("document.getElementById('archive-conversation').click()");assert.equal(await run('demoStore.data.messages[0].status'),'archived');
    await run("navigatePage('leads')");await screenshot('leads');
    await run("document.querySelector('[data-follow-up]').click()");assert.ok(await run('demoStore.data.messages.some(m=>m.followUp)'));
    await run("navigatePage('composer')");assert.equal(await run("document.querySelectorAll('[data-post-account]').length"),4);
    await run("composer.text='Regression test scheduled post';composer.accountIds=['fixture-0','fixture-1'];composer.scheduledAt=new Date(Date.now()+86400000).toISOString();renderComposer()");await screenshot('composer');
    await run("saveComposer('scheduled')");assert.equal(await run("demoStore.data.posts[0].accountIds.length"),2);
    await run("navigatePage('calendar')");assert.equal(await run("document.querySelectorAll('.calendar-post').length"),1);await screenshot('calendar');
    await run("navigatePage('scheduler')");await run("document.querySelector('[data-duplicate-post]').click()");await until(()=>run("currentPage==='composer'"),'duplicate');assert.equal(await run('composer.id'),undefined);
    await run("saveComposer('draft')");assert.equal(await run('demoStore.data.posts.length'),2);
    await run("document.querySelector('[data-cancel-post]').click()");assert.equal(await run('demoStore.data.posts[0].status'),'cancelled');
    await run("navigatePage('listening')");await run("document.getElementById('keyword-input').value='restaurant';document.getElementById('keyword-form').dispatchEvent(new Event('submit',{cancelable:true}))");assert.ok(await run("demoStore.data.keywords.includes('restaurant')"));
    const demoBefore=await run("localStorage.getItem('social-workspace.demo.v1')");
    await run('setDemoMode(false)');assert.equal(await run("document.getElementById('demo-mode').checked"),false);
    for(const page of ['dashboard','inbox','leads','analytics','composer','scheduler','calendar','reports','listening']){
      await run(`navigatePage('${page}')`);
      await until(()=>run("document.getElementById('content').innerText.includes('No real connector configured yet')"),`real empty state ${page}`);
      assert.equal(await run("/Maya Chen|Regression test scheduled post/.test(document.getElementById('content').innerText)"),false);
    }
    assert.equal(await run("localStorage.getItem('social-workspace.demo.v1')"),demoBefore);
    await run('setDemoMode(true)');assert.equal(await run("localStorage.getItem('social-workspace.demo.v1')"),demoBefore);
    await run("navigatePage('inbox')");await until(()=>run("inboxState.status==='ready'"),'demo inbox loaded');
    await run("window.savedLoader=messagingProvider.listMessages; messagingProvider.listMessages=async()=>{throw new Error('Provider temporarily offline');};loadInbox()");
    assert.ok(await run("!!document.getElementById('inbox-retry')"));
    await run('messagingProvider.listMessages=window.savedLoader;loadInbox()');assert.equal(await run('inboxState.status'),'ready');
    await run("messagingProvider.listMessages=()=>new Promise(resolve=>window.resolveSlowInbox=resolve);loadInbox();setDemoMode(false)");
    await run('window.resolveSlowInbox(demoStore.data.messages)');assert.equal(await run("document.getElementById('content').innerText.includes('Maya Chen')"),false);
    await run('messagingProvider.listMessages=window.savedLoader;setDemoMode(true)');
    for(const platform of Object.keys(require('../services/platformManager').platforms)){await run(`navigatePlatform('${platform}')`);assert.equal(await run('selectedPlatform'),platform);}
    await run("navigatePlatform('facebook')");assert.equal(await run("document.querySelectorAll('.account-card').length"),2);
    await run("call('openAccount','fixture-0')");assert.equal(win.getBrowserViews().length,1);const first=win.getBrowserViews()[0];
    await first.webContents.session.cookies.set({url,name:'fixture-session',value:'account-zero',expirationDate:Math.floor(Date.now()/1000)+3600});
    await run("navigatePage('settings')");assert.equal(win.getBrowserViews().length,0);await run("showAdd()");await run('closeModal()');assert.equal(win.getBrowserViews().length,0);
    await run("call('openAccount','fixture-1')");assert.equal(win.getBrowserViews().length,1);assert.equal((await win.getBrowserViews()[0].webContents.session.cookies.get({name:'fixture-session'})).length,0);
    assert.equal(await run("document.getElementById('page-title').textContent"),'Facebook');
    await run("call('openAccount','fixture-0')");assert.equal((await win.getBrowserViews()[0].webContents.session.cookies.get({name:'fixture-session'}))[0].value,'account-zero');
    const view=win.getBrowserViews()[0];await view.webContents.loadURL(url+'next');await run("call('browserAction','back')");await until(()=>view.webContents.getURL()===url,'back');
    await run("call('browserAction','forward')");await until(()=>view.webContents.getURL()===url+'next','forward');await run("call('browserAction','home')");await until(()=>view.webContents.getURL()===url,'home');await run("call('browserAction','reload')");
    await run("call('browserAction','new-window')");assert.equal(BrowserWindow.getAllWindows().length,2);BrowserWindow.getAllWindows().find(w=>w!==win).close();
    await run("showAdd()");assert.equal(win.getBrowserViews().length,0);await run('closeModal()');assert.equal(win.getBrowserViews().length,1);
    await run("call('renameAccount','fixture-0','Renamed fixture')");assert.equal(await run("appState.accounts[0].name"),'Renamed fixture');
    await run("call('createAccount','whatsapp','Temporary new account')");const added=await run('appState.accounts.at(-1)');assert.ok(added.sessionPartition.startsWith('persist:social-workspace-whatsapp-'));
    assert.equal(win.getBrowserViews().length,0);assert.ok(await run("!!document.querySelector('.whatsapp-fallback')"));
    const whatsappMetadata=fs.readFileSync(path.join(profile,'accounts.json'),'utf8');
    await session.fromPartition(added.sessionPartition).cookies.set({url,name:'whatsapp-fixture',value:'unchanged',expirationDate:Math.floor(Date.now()/1000)+3600});
    await session.fromPartition(fixtures[3].sessionPartition).cookies.set({url,name:'gmail-fixture',value:'unchanged',expirationDate:Math.floor(Date.now()/1000)+3600});
    await run(`call('openAccount',${JSON.stringify(added.id)})`);
    assert.equal(await run("document.querySelector('.whatsapp-fallback h3').textContent"),'Embedded WhatsApp unavailable');
    for(const status of ['Embedded Unavailable','External Browser Only','Login Verification Required'])assert.ok(await run(`document.querySelector('.whatsapp-status').textContent.includes(${JSON.stringify(status)})`));
    assert.ok(await run("document.getElementById('toast').textContent.startsWith('Embedded WhatsApp unavailable')"));
    const whatsappStatus=await run("document.querySelector('.whatsapp-status').textContent");
    await run("document.querySelector('.whatsapp-external').click()");await until(()=>externalCalls.length===1,'external WhatsApp request');assert.equal(externalCalls[0],'https://web.whatsapp.com/');
    assert.equal(await run("document.querySelector('.whatsapp-status').textContent"),whatsappStatus);
    assert.equal(fs.readFileSync(path.join(profile,'accounts.json'),'utf8'),whatsappMetadata);
    assert.equal((await session.fromPartition(added.sessionPartition).cookies.get({name:'whatsapp-fixture'}))[0].value,'unchanged');
    assert.equal((await session.fromPartition(fixtures[3].sessionPartition).cookies.get({name:'gmail-fixture'}))[0].value,'unchanged');
    await screenshot('whatsapp-status');
    assert.equal((await run("window.workspace.openWhatsAppExternal('fixture-2')")).ok,false);assert.equal(externalCalls.length,1);
    await run("call('openAccount','fixture-2')");const instagramView=win.getBrowserViews()[0];assert.equal(instagramView.webContents.getURL(),url);
    await instagramView.webContents.session.cookies.set({url,name:'instagram-fixture',value:'retained',expirationDate:Math.floor(Date.now()/1000)+3600});
    await run(`call('openAccount',${JSON.stringify(added.id)})`);assert.equal(win.getBrowserViews().length,0);
    await run("call('openAccount','fixture-2')");assert.equal((await win.getBrowserViews()[0].webContents.session.cookies.get({name:'instagram-fixture'}))[0].value,'retained');
    await run(`call('deleteAccount',${JSON.stringify(added.id)})`);assert.equal(await run('appState.accounts.length'),4);
    await run("navigatePage('settings')");await run("document.getElementById('theme').value='dark';saveSettings()");assert.equal(await run("document.body.classList.contains('dark')"),true);
    await run("document.getElementById('theme').value='light';saveSettings()");
    await run("navigatePage('inbox')");win.setSize(980,700);await screenshot('inbox-compact');assert.equal(await run('document.documentElement.scrollWidth>window.innerWidth'),false);win.setSize(1280,800);
    require('../services/platformManager').platforms.facebook.url=url+'offline';
    await run("call('openAccount','fixture-0')");assert.ok(await run('appState.browserError'));assert.ok(await run("document.getElementById('toast').textContent.includes('Could not open')"));
    await run('window.workspace.goHome()');
    win.webContents.reload();await until(()=>run("!!document.getElementById('dashboard-create')"),'reload');assert.equal(await run('demoStore.data.posts.length'),2);
    const persisted=JSON.parse(fs.readFileSync(path.join(profile,'accounts.json'),'utf8'));for(const fixture of fixtures)assert.equal(persisted.accounts.find(a=>a.id===fixture.id).sessionPartition,fixture.sessionPartition);
    assert.equal((await session.fromPartition(fixtures[0].sessionPartition).cookies.get({name:'fixture-session'}))[0].value,'account-zero');
    // Gmail end-to-end: credentials remain main-process-only; Google HTTP is mocked.
    await run("navigatePlatform('gmail')");await until(()=>run("document.getElementById('gmail-setup-status').textContent.includes('not configured')"),'Gmail setup empty state');
    const credentialsFile=path.join(profile,'desktop-fixture.json');fs.writeFileSync(credentialsFile,JSON.stringify({installed:{client_id:'fixture.apps.googleusercontent.com',client_secret:'test-secret'}}));
    dialog.showOpenDialog=async()=>({filePaths:[credentialsFile]});
    await run("document.getElementById('gmail-import').click()");await until(()=>run("document.getElementById('gmail-setup-status').textContent.includes('configured. Authorize')"),'import credentials');
    await run("document.querySelector('[data-gmail-connect]').click()");await until(()=>run("!!document.querySelector('[data-gmail-confirm]')"),'confirm first mailbox');
    await run("document.querySelector('[data-gmail-confirm]').click()");await until(()=>run("document.querySelector('.gmail-connector-card').textContent.includes('Gmail API connected')"),'first mailbox connected');
    await run("call('createAccount','gmail','Second Gmail fixture')");const secondGmail=await run('appState.accounts.at(-1)');await run("navigatePlatform('gmail')");await until(()=>run("document.querySelectorAll('[data-gmail-connect]').length===2"),'second Gmail card');
    oauthMailbox='second@gmail-fixture.test';
    await run(`document.querySelector('[data-gmail-account="${secondGmail.id}"] [data-gmail-connect]').click()`);await until(()=>run("!!document.querySelector('[data-gmail-confirm]')"),'confirm second mailbox');
    await run("document.querySelector('[data-gmail-confirm]').click()");await until(()=>run("document.querySelectorAll('[data-gmail-sync]').length===2"),'two Gmail connections');
    await screenshot('gmail-connections');
    const metadataBeforeApi=fs.readFileSync(path.join(profile,'accounts.json'),'utf8');
    await run("setDemoMode(false);navigatePage('inbox')");await until(()=>run("inboxState.messages.length===2"),'two real Gmail messages');assert.equal(await run("inboxState.messages.every(m=>m.platform==='gmail'&&m.sourceType==='official')"),true);
    assert.equal(await run("new Set(inboxState.messages.map(m=>m.accountId)).size"),2);
    await screenshot('gmail-inbox');
    await run("document.getElementById('inbox-account').value='fixture-3';document.getElementById('inbox-account').dispatchEvent(new Event('change'))");assert.equal(await run("document.querySelectorAll('[data-message]').length"),1);
    assert.equal(await run("document.getElementById('inbox-more').textContent"),'Load next 50');await run("document.getElementById('inbox-more').click()");await until(()=>run("inboxState.messages.filter(m=>m.accountId==='fixture-3').length===2"),'Gmail next page');assert.equal(await run("new Set(inboxState.messages.map(m=>m.accountId+'|'+m.id)).size"),3);assert.equal(await run("!!document.getElementById('inbox-more')"),false);
    await run("document.getElementById('toggle-read').click()");await until(()=>run("currentMessage().unread===false"),'Gmail mark read');assert.equal(gmailRead.get('first@gmail-fixture.test'),true);assert.equal(gmailRead.get('second@gmail-fixture.test'),undefined);
    await run("document.getElementById('gmail-reply-text').value='A manually approved fixture reply';document.getElementById('gmail-reply-text').dispatchEvent(new Event('input'));document.getElementById('gmail-send-reply').click()");await until(()=>run("document.getElementById('gmail-reply-status').textContent==='Reply sent through Gmail.'"),'Gmail reply');assert.equal(gmailSent,1);
    await run("document.getElementById('open-original').click()");await until(()=>externalCalls.some(u=>u.startsWith('https://mail.google.com/')),'Gmail original link');assert.ok(externalCalls.at(-1).includes('authuser=first%40gmail-fixture.test'));
    assert.equal(fs.readFileSync(path.join(profile,'accounts.json'),'utf8'),metadataBeforeApi);
    await run('setDemoMode(true)');await until(()=>run("inboxState.status==='ready'"),'return to demo');assert.equal(await run("inboxState.messages.some(m=>m.subject==='Gmail fixture inquiry')"),false);
    assert.equal((await run("window.workspace.gmailDisconnect('fixture-3')")).ok,true);
    assert.equal((await run(`window.workspace.gmailDisconnect(${JSON.stringify(secondGmail.id)})`)).ok,true);
    assert.equal(fs.readFileSync(path.join(profile,'accounts.json'),'utf8'),metadataBeforeApi);
    for(const [index,name,value] of [[0,'fixture-session','account-zero'],[2,'instagram-fixture','retained'],[3,'gmail-fixture','unchanged']])assert.equal((await session.fromPartition(fixtures[index].sessionPartition).cookies.get({name}))[0].value,value);
    await run(`call('deleteAccount',${JSON.stringify(secondGmail.id)})`);assert.equal(await run('appState.accounts.length'),4);
    assert.deepEqual(errors,[]);console.log('PASS: workspace regression, isolated sessions, two Gmail OAuth connections, real inbox, read/reply, original links, demo separation and unchanged metadata/cookies after API disconnect.');
    console.log('Profile used only for tests:',profile);server.close();app.exit(0);
  }catch(error){console.error(error);console.error('Renderer errors:',errors);server.close();app.exit(1);}
});
