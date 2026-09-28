let realRequest=0;
function syncModeControl(){$('demo-mode').checked=workspaceMode.demo;$('demo-mode-label').textContent=workspaceMode.demo?'ON':'OFF';}
function setDemoMode(enabled){
  try{workspaceMode.setDemo(enabled);}catch{syncModeControl();toast('Could not save Demo Mode preference. Your data is unchanged.');return;}
  ++inboxRequest;++realRequest;selectedConversation=null;inboxState={status:'idle',messages:[],accounts:[],errors:[],pending:0};
  inboxFilter={search:'',platform:'',account:'',state:'active'};
  render();toast(workspaceMode.demo?'Demo Mode ON — simulated records visible.':'Demo Mode OFF — only official connector data is shown.');
}
$('demo-mode').onchange=e=>setDemoMode(e.target.checked);
syncModeControl();
async function renderRealPage(page){
  const request=++realRequest;
  const kind={dashboard:'analytics',analytics:'analytics',reports:'analytics',leads:'messages',composer:'posts',scheduler:'posts',calendar:'posts'}[page];
  $('content').innerHTML=inboxBanner()+pageHeader(PAGE_NAMES[page]||'Workspace','Official integrations are separate from saved browser logins.')+(page==='dashboard'||page==='analytics'?`<section class="card"><h3>Saved accounts · Real metadata</h3><p>${appState.accounts.length} saved accounts across ${Object.keys(PLATFORMS).length} available platforms.</p>${distribution()}</section>`:'')+'<section class="card real-connector-state" id="real-connector-state" role="status" aria-live="polite">Loading connector status…</section>';
  try{
    const responses=kind?await Promise.all(appState.accounts.map(async account=>{
      const response=await window.workspace.connectorRequest(kind,account.id);
      if(!response.ok)throw new Error('Could not check connector status.');return response.data;
    })):[];
    if(request!==realRequest||workspaceMode.demo||currentPage!==page||selectedPlatform)return;
    let items=responses.flatMap(r=>r.status==='ready'?r.items:[]),errors=responses.filter(r=>r.status==='error');
    if(page==='leads')items=await Promise.all(items.map(async message=>({message,classification:await realLeadProvider.classify(message)})));
    if(errors.length&&!items.length)throw new Error('The configured connector is unavailable. Try again.');
    const target=$('real-connector-state');
    if(!items.length){target.innerHTML=empty('No real connector configured yet','No simulated records are displayed. Your demo messages, reviews, drafts and schedules remain saved; turn Demo Mode on to use them.')+'<p class="integration-note">Official, account-specific access is required for messaging, lead data, analytics and publishing. No requests are sent to social platforms by this screen.</p>';return;}
    target.innerHTML=`<h3>${page==='leads'?'Real conversations · local mock analysis':'Official connector records'}</h3>${errors.length?'<p role="alert">Some accounts could not be loaded. Refresh to retry.</p>':''}${items.map(item=>page==='leads'?`<article class="simple-row">${badge('Official')} ${badge('Mock AI')} ${platformIcon(item.message.platform)} <strong>${esc(item.message.accountName)}</strong><p>${esc(item.message.message)}</p><small>${item.classification.lead?'Lead':'Non-lead'} · ${item.classification.score}/100 · ${esc(item.classification.priority)} priority · ${item.classification.replied?'Replied':'Unreplied'}</small><p class="muted">${esc(item.classification.reason)}</p><details><summary>Suggested reply · Mock local rules</summary><p>${esc(item.classification.suggestedReply)}</p></details></article>`:`<article class="simple-row">${badge('Official')} ${platformIcon(item.platform)} <strong>${esc(item.accountName)}</strong><p>${esc(kind==='analytics'?`${item.metric}: ${item.value}`:item.text)}</p></article>`).join('')}<p class="muted">${page==='leads'?'Provider: mock-local-rules. Results are generated locally from normalized connector messages and are not trained AI. Nothing is sent automatically.':'Publishing, analytics and listening controls remain disabled until an official connector capability is configured.'}</p>`;
  }catch{if(request!==realRequest||workspaceMode.demo||currentPage!==page)return;$('real-connector-state').innerHTML=empty('Connector unavailable','Your saved data is unchanged. Try loading this page again.')+'<button id="real-retry" class="secondary">Retry</button>';$('real-retry').onclick=()=>renderRealPage(page);}
}
