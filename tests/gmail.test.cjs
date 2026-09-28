const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {SecureStore}=require('../services/gmail/secureStore');
const {GmailService}=require('../services/gmail/gmailService');
const {authorize,parseCredentials,SCOPE}=require('../services/gmail/oauth');
const {normalizeGmail,buildReply}=require('../services/gmail/message');
const {ConnectorRegistry}=require('../services/connectors');
const {MetaService}=require('../services/meta/metaService');
const account=(id,name=id)=>({id,name,platform:'gmail'});
const client={installed:{client_id:'fixture.apps.googleusercontent.com',client_secret:'fixture-client-secret'}};
const response=(data,status=200)=>({ok:status>=200&&status<300,status,json:async()=>data});
function fixtureMail(id='shared-id') {return {id,threadId:'thread-1',internalDate:String(Date.now()),labelIds:['INBOX','UNREAD'],payload:{mimeType:'multipart/alternative',headers:[{name:'From',value:'Customer <customer@example.com>'},{name:'Subject',value:'Website estimate'},{name:'Message-ID',value:'<original@example.com>'}],parts:[{mimeType:'text/plain',body:{data:Buffer.from('Hello! What would a new website cost?').toString('base64url')}},{mimeType:'text/html',body:{data:Buffer.from('<script>bad()</script><p>Hello HTML</p>').toString('base64url')}}]}};}
function encryption(){const key=crypto.randomBytes(32);return {isEncryptionAvailable:()=>true,encryptString:text=>{const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,iv);const data=Buffer.concat([cipher.update(text,'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),data]);},decryptString:bytes=>{const decipher=crypto.createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));decipher.setAuthTag(bytes.subarray(12,28));return Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]).toString('utf8');}};}
function harness(){
  const safe=encryption(),file=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'gmail-test-')),'gmail-connector','state.enc'),store=new SecureStore(file,safe);
  const state={calls:[],sends:0,offline:false,sendUncertain:false,invalidRefresh:false,mail:fixtureMail(),ids:['shared-id'],pages:null,email:'one@example.com'};
  const fetcher=async(url,options={})=>{state.calls.push({url,options});if(state.offline)throw new Error('offline');
    if(url.includes('oauth2.googleapis.com')){if(state.invalidRefresh)return response({error:'invalid_grant'},400);return response({access_token:'refreshed',expires_in:3600,scope:SCOPE});}
    if(url.endsWith('/profile'))return response({emailAddress:state.email});
    if(url.includes('/messages?')){const token=new URL(url).searchParams.get('pageToken')||'first',page=state.pages?.[token];return response(page||{messages:state.ids.map(id=>({id}))});}
    if(url.endsWith('/modify')){const updates=JSON.parse(options.body);state.mail.labelIds=updates.addLabelIds?['INBOX','UNREAD']:['INBOX'];return response({id:'shared-id',labelIds:state.mail.labelIds});}
    if(url.endsWith('/send')){state.sends++;if(state.sendUncertain)throw new Error('connection lost');return response({id:'sent-1',threadId:'thread-1'});}
    if(url.includes('/messages/'))return response({...state.mail,id:decodeURIComponent(url.split('/messages/')[1].split('?')[0])});
    throw new Error('Unexpected fixture route');
  };
  const service=new GmailService({store,fetcher,openExternal:async()=>{},authorizeFlow:()=>({promise:Promise.resolve({accessToken:'access-secret',refreshToken:'refresh-secret',expiresAt:Date.now()+3600000}),cancel(){}})});
  const connect=async id=>{const pending=await service.connect(account(id));return service.confirm(account(id),pending.confirmationId);};
  const expireSync=id=>store.commit(data=>{Object.values(data.accounts).find(a=>a.accountId===id).lastSyncedAt='2000-01-01T00:00:00.000Z';});
  return {safe,file,store,state,service,connect,expireSync};
}
test('Gmail starts unconfigured; imported Desktop credentials remain encrypted and absent from public status',async()=>{
  const h=harness();assert.equal(h.service.status(account('a')).status,'not_configured');assert.equal(fs.existsSync(h.file),false);
  await assert.rejects(()=>h.service.sync(account('a')),/not configured/);
  assert.throws(()=>parseCredentials({web:client.installed}),/Desktop/);h.service.importCredentials(client);
  assert.equal(h.service.status(account('a')).status,'not_connected');await h.connect('a');
  const bytes=fs.readFileSync(h.file);assert.equal(bytes.includes(Buffer.from('refresh-secret')),false);assert.equal(bytes.includes(Buffer.from('fixture-client-secret')),false);
  assert.equal(JSON.stringify(h.service.status(account('a'))).includes('access-secret'),false);
  assert.equal(new SecureStore(h.file,h.safe).data.config.clientId,client.installed.client_id);
});
test('Gmail identity confirmation isolates two accounts and refuses accidental mailbox rebinding',async()=>{
  const h=harness();h.service.importCredentials(client);const pending=await h.service.connect(account('a','Personal'));
  assert.equal(h.service.entry('a'),undefined);assert.equal(pending.pendingEmail,'one@example.com');h.service.confirm(account('a'),pending.confirmationId);
  await assert.rejects(()=>h.service.connect(account('b')),/already connected/);
  h.state.email='two@example.com';await h.connect('b');
  await h.service.sync(account('a','Personal'));await h.service.sync(account('b','Business'));
  assert.equal(h.service.cached(account('a'))[0].accountId,'a');assert.equal(h.service.cached(account('b'))[0].accountId,'b');assert.notEqual(h.service.entry('a').email,h.service.entry('b').email);
  await assert.rejects(()=>h.service.connect(account('a')),/different mailbox/);
  h.service.disconnect(account('a'));assert.equal(h.service.status(account('b')).status,'connected');assert.equal(h.service.cached(account('b')).length,1);
});
test('bounded sync persists normalized emails, refreshes newer messages and does not poll on cached reads',async()=>{
  const h=harness();h.service.importCredentials(client);await h.connect('a');const registry=new ConnectorRegistry();registry.register('gmail','a',h.service.provider());
  const result=await registry.request('messages',account('a','Mailbox A'));assert.equal(result.status,'ready');const m=result.items[0];
  for(const field of ['connectorMessageId','senderEmail','subject','originalUrl','accountId','accountName','conversationId','timestamp'])assert.ok(m[field]);assert.equal(m.subject,'Website estimate');assert.equal(m.accountName,'Mailbox A');assert.equal(m.metadata.mailboxEmail,'one@example.com');assert.equal(m.message.includes('bad()'),false);
  const calls=h.state.calls.length;await h.service.sync(account('a'));assert.equal(h.state.calls.length,calls);
  const persisted=new GmailService({store:new SecureStore(h.file,h.safe),fetcher:async()=>assert.fail('should use persisted cache')});assert.equal((await persisted.sync(account('a','Renamed'))).items[0].accountName,'Renamed');
  h.expireSync('a');h.state.ids=['newest','shared-id'];await h.service.sync(account('a'),{force:true});assert.equal(h.service.cached(account('a')).length,2);
  assert.ok(h.state.calls.some(c=>c.url.includes('maxResults=50')&&c.url.includes('newer_than')));
});
test('Gmail pagination uses nextPageToken, merges only new IDs and remains compatible with old cache',async()=>{
  const h=harness();h.service.importCredentials(client);await h.connect('a');h.state.pages={first:{messages:[{id:'one'},{id:'two'}],nextPageToken:'page-2'},'page-2':{messages:[{id:'two'},{id:'three'}]}};
  let page=await h.service.sync(account('a'));assert.equal(page.items.length,2);assert.equal(page.hasMore,true);const firstGets=h.state.calls.filter(c=>c.url.includes('/messages/')&&!c.url.includes('/messages?')).length;
  page=await h.service.sync(account('a'),{loadMore:true});assert.equal(page.items.length,3);assert.equal(page.added,1);assert.equal(page.hasMore,false);assert.ok(h.state.calls.some(c=>c.url.includes('pageToken=page-2')));assert.equal(h.state.calls.filter(c=>c.url.includes('/messages/one')).length,1);assert.equal(firstGets,2);
  const legacyStore=new SecureStore(h.file,h.safe);delete Object.values(legacyStore.data.accounts)[0].nextPageToken;legacyStore.commit(()=>{});const compatible=new GmailService({store:new SecureStore(h.file,h.safe),fetcher:h.service.fetcher});assert.equal(compatible.cached(account('a')).length,3);
});
test('read/unread commits only after Gmail succeeds, rejects cross-account operations',async()=>{
  const h=harness();h.service.importCredentials(client);await h.connect('a');await h.service.sync(account('a'));
  const payload={messageId:'shared-id',conversationId:'thread-1',updates:{unread:false}};
  assert.equal((await h.service.updateMessage(account('a'),payload)).unread,false);
  h.state.offline=true;await assert.rejects(()=>h.service.updateMessage(account('a'),{...payload,updates:{unread:true}}),/offline/);assert.equal(h.service.cached(account('a'))[0].unread,false);
  await assert.rejects(()=>h.service.updateMessage(account('b'),payload),/this Gmail account/);
});
test('refresh-token expiry yields reconnect state; offline sync returns explicitly stale cached data',async()=>{
  const h=harness();h.service.importCredentials(client);await h.connect('a');await h.service.sync(account('a'));h.expireSync('a');
  const registry=new ConnectorRegistry();registry.register('gmail','a',h.service.provider());h.state.offline=true;const offline=await registry.request('messages',account('a'));assert.equal(offline.stale,true);assert.equal(offline.items.length,1);
  h.state.offline=false;h.state.invalidRefresh=true;h.store.commit(data=>Object.values(data.accounts)[0].tokens.expiresAt=0);
  const expired=await registry.request('messages',account('a'));assert.equal(expired.code,'reconnect_required');assert.equal(h.service.status(account('a')).status,'reconnect_required');
});
test('replies use correct mailbox, recipient and threading; duplicate/uncertain sends are not retried',async()=>{
  const h=harness();h.service.importCredentials(client);await h.connect('a');await h.service.sync(account('a'));
  const payload={messageId:'shared-id',conversationId:'thread-1',text:'Here is the estimate.\nThanks!',requestId:crypto.randomUUID()};
  const sent=await h.service.reply(account('a'),payload);assert.equal(sent.sent,true);await h.service.reply(account('a'),payload);assert.equal(h.state.sends,1);
  const request=h.state.calls.find(c=>c.url.endsWith('/send'));const body=JSON.parse(request.options.body),mime=Buffer.from(body.raw,'base64url').toString();assert.equal(body.threadId,'thread-1');assert.match(mime,/From: one@example.com/);assert.match(mime,/To: customer@example.com/);assert.match(mime,/In-Reply-To: <original@example.com>/);
  h.state.sendUncertain=true;const second={...payload,text:'Another reply',requestId:crypto.randomUUID()};await assert.rejects(()=>h.service.reply(account('a'),second),/may have received/);await assert.rejects(()=>h.service.reply(account('a'),{...second,requestId:crypto.randomUUID()}),/previous send/);assert.equal(h.state.sends,2);
});
test('MIME normalization renders text safely and reply headers cannot inject extra recipients',()=>{
  const mail=fixtureMail();mail.payload.parts=mail.payload.parts.slice(1);const m=normalizeGmail(mail,account('a'),'one@example.com');assert.equal(m.message,'Hello HTML');
  const reply=buildReply({...m,subject:'hello\r\nBcc: victim@example.com'},'one@example.com','Body');assert.equal(Buffer.from(reply.raw,'base64url').toString().includes('\r\nBcc:'),false);
  assert.throws(()=>buildReply({...m,rfcMessageId:''},'one@example.com','body'),/Message-ID/);
});
test('secure-store failures never silently reset credentials or write plaintext',()=>{
  const h=harness();h.service.importCredentials(client);const original=fs.readFileSync(h.file);const corrupt=new SecureStore(h.file,{isEncryptionAvailable:()=>true,decryptString:()=>{throw new Error('wrong Windows user');}});assert.throws(()=>corrupt.commit(()=>{}),/not been reset/);assert.deepEqual(fs.readFileSync(h.file),original);
});
test('Meta foundation never reports Connected from credentials alone',()=>{const h=harness(),meta=new MetaService(h.store);assert.equal(meta.status({id:'fb',name:'Page',platform:'facebook'}).label,'Meta connector not configured');meta.importCredentials({app_id:'1234567890',app_secret:'1234567890abcdef'});for(const platform of ['facebook','instagram']){const status=meta.status({id:platform,name:'Account',platform});assert.equal(status.connected,false);assert.equal(status.status,'connection_required');assert.match(status.label,/connection required/);}});
test('desktop OAuth validates state, sends PKCE verifier only to token endpoint and supports cancellation',async()=>{
  let authorizationUrl,tokenBody;const oauth=authorize(parseCredentials(client),{timeoutMs:5000,openExternal:async url=>{
    authorizationUrl=new URL(url);const callback=new URL(authorizationUrl.searchParams.get('redirect_uri'));assert.equal(callback.hostname,'127.0.0.1');
    callback.search=new URLSearchParams({state:'wrong',code:'fixture'});assert.equal((await fetch(callback)).status,400);
    callback.search=new URLSearchParams({state:authorizationUrl.searchParams.get('state'),code:'fixture'});assert.equal((await fetch(callback)).status,200);
  },fetcher:async(url,options)=>{tokenBody=options.body;return response({access_token:'token',refresh_token:'refresh',expires_in:3600,scope:SCOPE});}});
  const tokens=await oauth.promise;assert.equal(tokens.refreshToken,'refresh');assert.equal(authorizationUrl.searchParams.get('code_challenge_method'),'S256');assert.equal(authorizationUrl.searchParams.has('client_secret'),false);assert.equal(crypto.createHash('sha256').update(tokenBody.get('code_verifier')).digest('base64url'),authorizationUrl.searchParams.get('code_challenge'));
  const cancel=authorize(parseCredentials(client),{openExternal:async()=>{},timeoutMs:5000});cancel.cancel();await assert.rejects(()=>cancel.promise,/cancelled/);
});
