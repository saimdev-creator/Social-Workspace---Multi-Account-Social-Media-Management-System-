const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const AccountManager=require('../services/accountManager');
const D=require('../services/workspaceData');
const {Mode}=require('../services/workspaceMode');
const {ConnectorRegistry,normalizeMessage,safeOriginalUrl}=require('../services/connectors');
const storage=()=>{const items=new Map();return {getItem:k=>items.get(k),setItem:(k,v)=>items.set(k,v)};};
test('account rename, reopen and new platform imports preserve persistent identifiers',()=>{
  const file=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'sw-account-test-')),'accounts.json');
  const manager=new AccountManager(file), a=manager.create('facebook','A','https://www.facebook.com/'), b=manager.create('facebook','B','https://www.facebook.com/');
  assert.notEqual(a.sessionPartition,b.sessionPartition);manager.rename(a.id,'Renamed');manager.markOpened(a.id);
  const loaded=new AccountManager(file);assert.equal(loaded.get(a.id).sessionPartition,a.sessionPartition);assert.equal(loaded.get(b.id).name,'B');
  assert.equal(loaded.importMetadata({accounts:[{id:'wa-import',platform:'whatsapp',name:'Imported',sessionPartition:'persist:existing-whatsapp'}]}),1);
  assert.equal(loaded.get('wa-import').sessionPartition,'persist:existing-whatsapp');loaded.remove(b.id);assert.equal(loaded.get(a.id).sessionPartition,a.sessionPartition);
});
test('demo changes persist separately and classification distinguishes buying intent',async()=>{
  const s=storage(),store=new D.Store(s);store.updateMessage('demo-message-0',{unread:false,followUp:true});
  assert.equal(new D.Store(s).data.messages[0].unread,false);
  const ai=new D.MockAIProvider();assert.equal((await ai.classify(store.data.messages[0])).category,'HOT_LEAD');assert.ok((await ai.classify(store.data.messages[3])).score<10);
  assert.equal(D.metrics(store.data).leads,4);
});
test('publishing validates account identities and time; drafts, schedules and cancellation persist',()=>{
  const store=new D.Store(storage()),accounts=[{id:'facebook-A'},{id:'facebook-B'}];
  const post={text:'Hello',accountIds:accounts.map(a=>a.id),media:[],status:'scheduled',scheduledAt:new Date(Date.now()+3600000).toISOString()};
  const saved=store.savePost(post,accounts);assert.equal(saved.accountIds.length,2);
  assert.throws(()=>store.savePost({...post,scheduledAt:'invalid'},accounts),/future/);
  assert.throws(()=>store.savePost({...post,accountIds:['deleted']},accounts),/removed/);
  assert.throws(()=>store.savePost({...post,text:''},accounts),/content/);
  store.cancelPost(saved.id);assert.equal(D.metrics(store.data).scheduled,0);
  assert.equal(store.savePost({...post,status:'draft',accountIds:[]},[]).status,'draft');
});
test('storage failures do not report successful writes or overwrite corrupt demo data',()=>{
  const store=new D.Store({getItem:()=>null,setItem:()=>{throw new Error('quota');}});
  assert.throws(()=>store.updateMessage('demo-message-0',{unread:false}),/Could not save/);assert.equal(store.data.messages[0].unread,true);
  const corrupt=new D.Store({getItem:()=>'{broken',setItem:()=>assert.fail('must not overwrite')});
  assert.ok(corrupt.warning);assert.throws(()=>corrupt.updateMessage('demo-message-0',{unread:false}));
});
test('Demo Mode persists independently without modifying saved demo records',()=>{
  const s=storage(),store=new D.Store(s);store.updateMessage('demo-message-0',{unread:false});
  const before=s.getItem('social-workspace.demo.v1'),mode=new Mode(s);
  mode.setDemo(false);assert.equal(new Mode(s).demo,false);assert.equal(s.getItem('social-workspace.demo.v1'),before);
  mode.setDemo(true);assert.equal(new Mode(s).demo,true);assert.equal(s.getItem('social-workspace.demo.v1'),before);
});
const identity={id:'ig-A',platform:'instagram',name:'Current display name',sessionPartition:'persist:never-expose'};
const official={id:'same-provider-id',platform:'instagram',accountId:'ig-A',accountName:'Stale name',conversationId:'thread-1',senderId:'sender-1',senderName:'Customer',message:'A real message',timestamp:'2026-09-03T12:00:00Z',unread:true,metadata:{originalUrl:'https://www.instagram.com/direct/t/123/',token:'must-not-leak'}};
test('normalized official messages enforce account identity and strip private metadata',()=>{
  const message=normalizeMessage(official,identity);assert.equal(message.accountName,identity.name);assert.equal(message.metadata.token,undefined);assert.equal(message.sourceType,'official');
  assert.throws(()=>normalizeMessage({...official,accountId:'other'},identity),/wrong account/);
  assert.throws(()=>normalizeMessage({...official,sourceType:'demo'},identity),/Demo/);
  assert.throws(()=>normalizeMessage({...official,unread:'yes'},identity),/read state/);
  assert.equal(safeOriginalUrl('instagram','https://instagram.com.attacker.test/x'),null);assert.equal(safeOriginalUrl('instagram','javascript:alert(1)'),null);
  assert.equal(safeOriginalUrl('instagram','https://user:pass@instagram.com/'),null);
});
test('connectors are account-specific even within the same platform',async()=>{
  const registry=new ConnectorRegistry();let passed;
  registry.register('instagram','ig-A',{listMessages:async account=>{passed=account;return [official];}});
  assert.equal((await registry.request('messages',identity)).status,'ready');assert.equal(passed.sessionPartition,undefined);
  assert.equal((await registry.request('messages',{...identity,id:'ig-B'})).status,'pending');
  registry.register('instagram','ig-B',{listMessages:async()=>[{...official,accountId:'ig-B'}]});
  const second=await registry.request('messages',{...identity,id:'ig-B'});assert.equal(second.items[0].accountId,'ig-B');
});
test('connector errors remain recoverable; demo publishing is rejected before delivery',async()=>{
  const registry=new ConnectorRegistry();let sent=false;
  registry.register('instagram','ig-A',{listMessages:async()=>{throw new Error('private credential details');},publish:async()=>{sent=true;return [];}});
  const result=await registry.request('messages',identity);assert.equal(result.status,'error');assert.equal(result.message.includes('credential'),false);
  await assert.rejects(()=>registry.request('publish',identity,{demo:true}),/Demo/);assert.equal(sent,false);
});
test('local lead provider consumes normalized official messages and labels output as mock',async()=>{const provider=new D.LocalLeadProvider(),result=await provider.classify(normalizeMessage({...official,message:'Can I get a price quote?',subject:'New project'},identity));assert.equal(result.lead,true);assert.equal(result.priority,'High');assert.equal(result.sourcePlatform,'instagram');assert.equal(result.sourceAccountId,'ig-A');assert.equal(result.mock,true);assert.match(result.provider,/mock/);await assert.rejects(()=>provider.classify({...official,sourceType:'demo'}),/official/);});
