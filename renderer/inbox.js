// Inbox presentation consumes either the mock provider OR account-scoped IPC data.
// A request generation prevents late responses from restoring a previous mode/page.
let inboxRequest=0;
let inboxState={status:'idle',messages:[],accounts:[],errors:[],pending:0,moreAccounts:[]};
function messageKey(m){return JSON.stringify([m.platform,m.accountId,m.conversationId,m.id]);}
function currentMessage(){return inboxState.messages.find(m=>messageKey(m)===selectedConversation||m.id===selectedConversation);}
function inboxBanner(){return workspaceMode.demo?demoBanner():'<div class="demo-notice"><span class="badge">REAL DATA ONLY</span> Demo Mode is OFF. Saved demo records are retained but hidden.</div>';}
async function loadInbox(force=false,loadMore=false){
  const previousMessages=inboxState.messages;
  const request=++inboxRequest, demo=workspaceMode.demo;
  inboxState.status='loading';inboxState.messages=[];inboxState.errors=[];renderInboxShell();
  try{
    let messages,accounts,pending=0,errors=[],notices=[],connected=0,targets=[],results=[];
    if(demo){
      if(demoStore.warning)throw new Error(demoStore.warning);
      messages=await messagingProvider.listMessages(demoStore.data);
      if(!Array.isArray(messages)||messages.some(m=>m.sourceType!=='demo'))throw new Error('The demo provider returned invalid data.');
      accounts=Array.from(new Map(messages.map(m=>[m.accountId,{id:m.accountId,name:m.accountName,platform:m.platform}])).values());
    }else{
      accounts=appState.accounts;
      targets=(force||loadMore)&&inboxFilter.account?accounts.filter(a=>a.id===inboxFilter.account):accounts;
      results=await Promise.all(targets.map(async account=>{
        try{const response=await window.workspace.connectorRequest('messages',account.id,{force:force===true,loadMore});if(!response.ok)throw new Error(response.error);return {...response.data,name:account.name};}
        catch{return {status:'error',items:[],name:account.name,message:'Could not load this account. Try again.'};}
      }));
      accounts=accounts.map(a=>({...a,mailboxEmail:results.find(r=>r.accountId===a.id)?.connection?.email||inboxState.accounts.find(old=>old.id===a.id)?.mailboxEmail||''}));
      messages=[...previousMessages.filter(m=>accounts.some(a=>a.id===m.accountId)&&!targets.some(a=>a.id===m.accountId)&&m.sourceType==='official'),...results.flatMap(r=>r.status==='ready'||r.stale?r.items.map(m=>({...m,cached:r.stale===true})):[])].sort((a,b)=>Date.parse(b.timestamp)-Date.parse(a.timestamp));pending=results.filter(r=>r.status==='pending').length;connected=results.filter(r=>r.status==='ready').length;errors=results.filter(r=>r.status==='error').map(r=>`${r.name}: ${r.message}${r.stale?' Showing cached messages from the last successful sync.':''}`);notices=results.filter(r=>r.status==='pending'&&r.code).map(r=>`${r.name}: ${r.message}`);
    }
    if(request!==inboxRequest||demo!==workspaceMode.demo||currentPage!=='inbox'||selectedPlatform)return;
    const untouchedMore=(inboxState.moreAccounts||[]).filter(id=>!targets?.some(a=>a.id===id));inboxState={status:errors.length&&!messages.length?'error':'ready',messages,accounts,errors,pending,notices,connected,moreAccounts:[...untouchedMore,...(results?.filter(r=>r.hasMore).map(r=>r.accountId)||[])]};renderInboxShell();
  }catch(error){if(request!==inboxRequest||demo!==workspaceMode.demo||currentPage!=='inbox')return;inboxState={status:'error',messages:[],accounts:[],errors:[error.message],pending:0};renderInboxShell();}
}
function renderInbox(){return loadInbox();}
function filteredMessages(){return inboxState.messages.filter(m=>(!inboxFilter.platform||m.platform===inboxFilter.platform)&&(!inboxFilter.account||m.accountId===inboxFilter.account)&&(inboxFilter.state==='all'||(inboxFilter.state==='archived'?m.status==='archived':m.status!=='archived'))&&(inboxFilter.state!=='unread'||m.unread)&&(inboxFilter.state!=='read'||!m.unread)&&`${m.senderName} ${m.senderEmail||''} ${m.subject||''} ${m.message} ${m.accountName}`.toLowerCase().includes(inboxFilter.search.trim().toLowerCase()));}
function renderInboxShell(){
  const accounts=inboxState.accounts.filter(a=>!inboxFilter.platform||a.platform===inboxFilter.platform);
  if(inboxFilter.account&&!accounts.some(a=>a.id===inboxFilter.account))inboxFilter.account='';
  $('content').innerHTML=inboxBanner()+`<div class="filter-bar"><input class="text-input" id="inbox-search" aria-label="Search conversations" placeholder="Search messages, people or accounts" value="${esc(inboxFilter.search)}"><select id="inbox-platform" class="select" aria-label="Filter platform">${options([['','All platforms'],...Object.entries(PLATFORMS).map(([id,p])=>[id,p.name])],inboxFilter.platform)}</select><select id="inbox-account" class="select" aria-label="Filter account">${options([['',workspaceMode.demo?'All demo accounts':'All saved accounts'],...accounts.map(a=>[a.id,`${PLATFORMS[a.platform]?.name} · ${a.name}${a.mailboxEmail?' · '+a.mailboxEmail:''}`])],inboxFilter.account)}</select><select id="inbox-state" class="select" aria-label="Filter read status">${options([['active','Active'],['unread','Unread'],['read','Read'],['archived','Archived'],['all','All conversations']],inboxFilter.state)}</select><button id="inbox-refresh" class="secondary" ${inboxState.status==='loading'?'disabled':''}>Refresh</button>${!workspaceMode.demo&&inboxFilter.account&&inboxState.moreAccounts?.includes(inboxFilter.account)?'<button id="inbox-more" class="secondary">Load next 50</button>':''}</div><div id="inbox-feedback" role="status" aria-live="polite"></div><div class="inbox-layout" aria-busy="${inboxState.status==='loading'}"><section class="card conversation-list" id="conversation-list" aria-label="Conversations"></section><section class="card conversation-detail" id="conversation-detail" aria-label="Selected conversation"></section><aside class="card contact-panel" id="contact-panel"></aside></div>`;
  $('inbox-search').oninput=e=>{inboxFilter.search=e.target.value;renderConversationList();};
  ['platform','account','state'].forEach(key=>$(`inbox-${key}`).onchange=e=>{inboxFilter[key]=e.target.value;if(key==='platform')inboxFilter.account='';renderInboxShell();});
  $('inbox-refresh').onclick=()=>loadInbox(true);
  if($('inbox-more'))$('inbox-more').onclick=()=>loadInbox(false,true);
  if(inboxState.status==='loading'){
    $('conversation-list').innerHTML=empty('Loading conversations…','Checking the selected data source.');$('conversation-detail').innerHTML=empty('Loading…','Your messages will appear here.');$('contact-panel').hidden=true;return;
  }
  if(inboxState.errors.length){$('inbox-feedback').innerHTML=`<div class="inbox-error" role="alert">${inboxState.errors.map(esc).join('<br>')} <button id="inbox-retry" class="text-button">Retry</button></div>`;$('inbox-retry').onclick=()=>loadInbox(true);}
  if(!workspaceMode.demo&&inboxState.pending)$('inbox-feedback').insertAdjacentHTML('beforeend',`<p class="muted">${inboxState.pending} saved account(s) have no official messaging connector.</p>`);
  if(!workspaceMode.demo){$('inbox-feedback').insertAdjacentHTML('beforeend',`<div class="action-row"><button class="text-button" id="inbox-gmail-setup">Gmail connection & setup →</button></div>${(inboxState.notices||[]).map(n=>`<p class="muted">${esc(n)}</p>`).join('')}`);$('inbox-gmail-setup').onclick=()=>navigatePlatform('gmail');}
  renderConversationList();
}
function renderConversationList(){
  const list=filteredMessages();
  let selected=list.find(m=>messageKey(m)===selectedConversation||m.id===selectedConversation);
  if(!selected)selected=list[0];selectedConversation=selected?messageKey(selected):null;
  const noConnector=!workspaceMode.demo&&!inboxState.messages.length&&!inboxState.connected&&inboxState.status!=='error';
  const title=inboxState.status==='error'?'Conversations unavailable':noConnector?'No real connector configured yet':inboxState.connected&&!inboxState.messages.length?'No recent inbox messages':'No matching conversations';
  const detail=inboxState.status==='error'?'Use Retry above to load the inbox again.':noConnector?'Your saved platform sessions remain available. Official messaging access must be configured separately.':'Change your filters or search. Archived messages appear in Archived or All conversations.';
  $('conversation-list').innerHTML=`<h3>Conversations <span class="count">${list.length}</span></h3>`+(list.map(m=>`<button class="conversation-item ${messageKey(m)===selectedConversation?'selected':''}" data-message="${esc(messageKey(m))}" aria-pressed="${messageKey(m)===selectedConversation}"><div class="conversation-heading">${platformIcon(m.platform)}<strong>${esc(m.senderName)}</strong>${m.unread?'<span class="unread-dot" title="Unread" aria-label="Unread"></span>':''}</div><small>${esc(m.accountName)} · ${dateLabel(m.timestamp)}</small>${m.subject?`<strong class="gmail-subject">${esc(m.subject)}</strong>`:''}<p>${esc(m.message)}</p><div class="action-row">${m.cached?badge('Cached'):''}${badge(workspaceMode.demo?'Demo':'Official')}<small>${esc(m.category)} · ${esc(m.status)} · ${m.unread?'Unread':'Read'}</small></div></button>`).join('')||empty(title,detail));
  document.querySelectorAll('[data-message]').forEach(b=>b.onclick=()=>{selectedConversation=b.dataset.message;renderConversationList();});renderConversation();
}
function renderConversation(){
  const m=currentMessage();$('contact-panel').hidden=!m;
  if(!m){$('conversation-detail').innerHTML=empty('Select a conversation','Choose a message from the current results.');$('contact-panel').innerHTML='';return;}
  const source=workspaceMode.demo?'Demo':'Official';
  const original=!workspaceMode.demo&&m.metadata?.originalUrl&&m.platform!=='whatsapp';
  $('conversation-detail').innerHTML=`<div class="section-head"><div><h3>${esc(m.senderName)}</h3><small>${esc(PLATFORMS[m.platform]?.name)} · ${esc(m.accountName)}</small></div><div>${badge(source)} ${badge(m.status)}</div></div>${m.subject?`<h4 class="gmail-subject">${esc(m.subject)}</h4>`:''}${m.cached?'<p class="cached-warning">Cached email — refresh when online for current state.</p>':''}<div class="conversation-body"><div class="message-bubble">${esc(m.message)}</div><small class="muted">${dateLabel(m.timestamp)} · Incoming ${workspaceMode.demo?'demo ':''}message</small></div><div class="action-row"><button class="secondary" id="toggle-read">Mark ${m.unread?'read':'unread'}</button><button class="secondary" id="archive-conversation">${m.status==='archived'?'Restore':'Archive'}</button></div><p class="integration-note" id="original-explanation">${workspaceMode.demo?'Demo messages have no original platform conversation.':original?(m.platform==='gmail'?'Opens in your default browser using the connected mailbox address. Browser login is separate; verify the Google account shown.':'Opens this conversation using the same saved account session.'):'This connector has not supplied a supported original conversation link.'}</p><button id="open-original" class="secondary" ${original?'':'disabled'} aria-describedby="original-explanation">${m.platform==='gmail'&&!workspaceMode.demo?'Open in Gmail':'Open original conversation ↗'}</button>`;
  $('contact-panel').innerHTML=`<div class="avatar contact-avatar">${esc(m.senderName[0])}</div><h3>${esc(m.senderName)}</h3>${badge(source)}<p class="muted">${esc(m.accountName)}</p><hr><label class="field-label" for="assigned-category">Assigned category</label><select class="select full-width" id="assigned-category">${options(['Unassigned','Sales','Support','Community'].map(x=>[x,x]),m.category)}</select><h4>Source</h4><p>${platformIcon(m.platform)} ${esc(PLATFORMS[m.platform]?.name)}</p><p class="muted">${workspaceMode.demo?'Demo account · Not linked to your saved accounts':'Official connector · Scoped to this saved account'}</p><h4>Read state</h4><p>${m.unread?'Unread':'Read'}</p><h4>Received</h4><p class="muted">${dateLabel(m.timestamp)}</p>`;
  const update=safely(async updates=>{
    const request=inboxRequest,mode=workspaceMode.demo;
    $('toggle-read').disabled=true;
    if(workspaceMode.demo){demoStore.updateMessage(m.id,updates);inboxState.messages=demoStore.data.messages;}
    else{const response=await window.workspace.connectorRequest('updateMessage',m.accountId,{messageId:m.id,conversationId:m.conversationId,updates});if(!response.ok||response.data.status!=='ready')throw new Error(response.error||response.data.message||'This connector cannot update messages yet.');inboxState.messages=inboxState.messages.map(item=>messageKey(item)===messageKey(m)?response.data.items[0]:item);}
    if(request===inboxRequest&&currentPage==='inbox'&&mode===workspaceMode.demo)renderConversationList();
  });
  $('toggle-read').onclick=async()=>{await update({unread:!m.unread});if($('toggle-read'))$('toggle-read').disabled=false;};$('archive-conversation').onclick=()=>update({status:m.status==='archived'?'open':'archived'});$('assigned-category').onchange=e=>update({category:e.target.value});
  if(m.platform==='gmail'&&!workspaceMode.demo){$('archive-conversation').disabled=true;$('archive-conversation').title='Archive is not implemented for Gmail in this first connector.';$('assigned-category').disabled=true;renderGmailReply(m);}
  $('open-original').onclick=safely(async()=>{const response=await window.workspace.openOriginalConversation(m.accountId,m.id);if(!response.ok)throw new Error(response.error);if(response.data?.external){toast('Opened Gmail in your default browser.');return;}appState=await window.workspace.getState();selectedPlatform=m.platform;browserVisible=true;render();});
}
