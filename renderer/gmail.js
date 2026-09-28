let gmailUiRequest=0;
const gmailLabels={not_configured:'Gmail API not configured',not_connected:'Gmail API not connected',connecting:'Waiting for Google authorization',confirm_identity:'Confirm Gmail mailbox',connected:'Gmail API connected',syncing:'Synchronizing…',reconnect_required:'Reconnect required',permission_required:'Permission required',storage_unavailable:'Secure storage unavailable',error:'Gmail connector error'};
function renderGmailSetup(){
  $('content').insertAdjacentHTML('afterbegin',`<section class="card gmail-setup" id="gmail-setup"><h3>Gmail API connection</h3><p>Connect each saved Gmail account separately to bring real email into Unified Inbox. Browser logins and OAuth connections are independent.</p><div class="action-row"><button class="primary" id="gmail-import">Import Google OAuth JSON</button><button class="secondary" id="gmail-status-refresh">Refresh connection status</button></div><details><summary>Google Cloud setup instructions</summary><ol><li>Create or select a Google Cloud project and enable the Gmail API.</li><li>Configure Google Auth Platform branding, audience and test users. Add your Gmail addresses as test users while the app is in Testing.</li><li>Create an OAuth client of type <strong>Desktop app</strong>, then download its JSON file. Import that file using the button above. Do not choose Web application credentials.</li><li>The app uses a temporary <code>http://127.0.0.1:&lt;random-port&gt;/</code> callback and PKCE. There is no fixed port or hosted callback to configure for the Desktop client.</li><li>The scope is <code>https://www.googleapis.com/auth/gmail.modify</code> for reading, marking read/unread and replies.</li><li>Click Connect Gmail on an account below, authorize the intended Google mailbox in your browser, and confirm its email address here.</li><li>Turn Demo Mode OFF and open Unified Inbox. Refresh fetches up to 25 inbox messages from the last 30 days.</li></ol><p class="muted">Credentials and tokens are encrypted in the connector store under this app's user-data directory. No passwords or browser cookies are imported. Google may require verification or Workspace administrator approval.</p></details><p id="gmail-setup-status" role="status">Checking Gmail API configuration…</p></section>`);
  $('gmail-import').onclick=safely(async()=>{const result=await window.workspace.gmailImportCredentials();if(!result.ok)throw new Error(result.error);if(!result.data.cancelled)toast('Google Desktop OAuth configuration imported.');await refreshGmailCards();});
  $('gmail-status-refresh').onclick=refreshGmailCards;
  document.querySelectorAll('.account-card [data-open]').forEach(open=>{const panel=document.createElement('section');panel.className='gmail-connector-card';panel.dataset.gmailAccount=open.dataset.open;panel.innerHTML='<p class="muted">Checking API connection…</p>';open.closest('.account-card').append(panel);});
  refreshGmailCards();
}
async function refreshGmailCards(){
  const request=++gmailUiRequest;
  try{const result=await window.workspace.gmailStatus();if(request!==gmailUiRequest||selectedPlatform!=='gmail'||!$('gmail-setup'))return;if(!result.ok)throw new Error(result.error);
    $('gmail-setup-status').textContent=result.data.configured?'OAuth client configured. Authorize each mailbox below.':'Gmail API not configured — import your Desktop OAuth JSON to begin.';
    document.querySelectorAll('[data-gmail-account]').forEach(panel=>{const status=result.data.accounts.find(a=>a.accountId===panel.dataset.gmailAccount);if(status)renderGmailAccount(panel,status);});
  }catch(error){if($('gmail-setup-status'))$('gmail-setup-status').textContent=error.message||'Could not read Gmail connection status. Try again.';}
}
function renderGmailAccount(panel,status){
  const id=status.accountId;
  panel.innerHTML=`<strong>${esc(gmailLabels[status.status]||status.status)}</strong>${status.email?`<p class="gmail-mailbox">${esc(status.email)}</p>`:''}<p class="muted" role="status">${esc(status.message)}</p><p class="muted">Last sync: ${status.lastSyncedAt?esc(dateLabel(status.lastSyncedAt)):'Never'} · ${status.cachedMessages} cached messages</p><div class="action-row">${status.status==='confirm_identity'?`<div class="gmail-confirm"><p>Connect <strong>${esc(status.pendingEmail)}</strong> to <strong>${esc(status.accountName)}</strong>?</p><button class="primary" data-gmail-confirm>Confirm this mailbox</button><button class="secondary" data-gmail-cancel>Cancel</button></div>`:status.status==='connecting'?'<button class="secondary" data-gmail-cancel>Cancel authorization</button>':`<button class="primary" data-gmail-connect ${!status.configured||status.status==='storage_unavailable'?'disabled':''}>${status.email?'Reconnect Gmail':'Connect Gmail'}</button>${status.email?'<button class="secondary" data-gmail-sync>Sync this account</button><button class="secondary" data-gmail-disconnect>Disconnect API</button>':''}`}</div>`;
  const checked=async promise=>{const r=await promise;if(!r.ok)throw new Error(r.error);return r.data;};
  panel.querySelector('[data-gmail-connect]')?.addEventListener('click',async()=>{
    renderGmailAccount(panel,{...status,status:'connecting',message:'Complete Google authorization in your browser. You can cancel here.'});
    try{await checked(window.workspace.gmailConnect(id));}catch(error){toast(error.message);}finally{await refreshGmailCards();}
  });
  panel.querySelector('[data-gmail-cancel]')?.addEventListener('click',safely(async()=>{await checked(window.workspace.gmailCancel(id));await refreshGmailCards();}));
  panel.querySelector('[data-gmail-confirm]')?.addEventListener('click',safely(async()=>{await checked(window.workspace.gmailConfirm(id,status.confirmationId));toast('Gmail mailbox connected. Turn Demo Mode OFF to view real email.');await refreshGmailCards();}));
  panel.querySelector('[data-gmail-sync]')?.addEventListener('click',safely(async e=>{e.target.disabled=true;try{const data=await checked(window.workspace.connectorRequest('messages',id,{force:true}));toast(data.status==='ready'?`Synchronized ${data.items.length} Gmail messages.`:data.message);}finally{await refreshGmailCards();}}));
  panel.querySelector('[data-gmail-disconnect]')?.addEventListener('click',safely(async()=>{
    if(!confirm('Disconnect this Gmail API connection and remove its local OAuth tokens and cached emails? Your workspace account and browser session will remain unchanged.'))return;
    await checked(window.workspace.gmailDisconnect(id));await refreshGmailCards();
  }));
}
// Drafts live only in memory, keyed by account and message. No auto-send or AI calls.
const replyDrafts=new Map();
function renderGmailReply(message){
  const key=messageKey(message);let draft=replyDrafts.get(key);if(!draft){draft={text:'',requestId:crypto.randomUUID(),status:'draft',feedback:''};replyDrafts.set(key,draft);}
  $('conversation-detail').insertAdjacentHTML('beforeend',`<section class="gmail-reply" id="gmail-reply"><h4>Reply from ${esc(message.metadata.mailboxEmail)}</h4><p class="muted">To: ${esc(message.replyTo||message.senderEmail)} · ${esc(message.subject)}</p><label class="field-label" for="gmail-reply-text">Your reply</label><textarea id="gmail-reply-text" class="text-input full-width" rows="4" maxlength="20000" ${draft.status!=='draft'?'disabled':''}>${esc(draft.text)}</textarea><button id="gmail-send-reply" class="primary" ${draft.status!=='draft'?'disabled':''}>${draft.status==='sending'?'Sending…':draft.status==='sent'?'Reply sent':'Send reply'}</button><p id="gmail-reply-status" class="muted" role="status">${esc(draft.feedback||'Only sends when you click Send reply. No automatic or AI-generated replies.')}</p></section>`);
  $('gmail-reply-text').oninput=e=>{draft.text=e.target.value;};
  $('gmail-send-reply').onclick=async()=>{
    if(!draft.text.trim())return toast('Write a reply first.');if(draft.status!=='draft')return;
    draft.status='sending';draft.feedback='Sending this reply through the selected Gmail account…';renderConversation();
    try{const r=await window.workspace.connectorRequest('reply',message.accountId,{messageId:message.id,conversationId:message.conversationId,text:draft.text,requestId:draft.requestId});
      if(!r.ok||r.data.status!=='ready'||!r.data.receipt.sent){const error=new Error(r.error||r.data.message||'Could not send the reply.');error.code=r.data?.code;throw error;}
      draft.status='sent';draft.feedback='Reply sent through Gmail.';
    }catch(error){draft.status=error.code==='send_unknown'?'unknown':'draft';draft.feedback=error.message||'Sending failed. Your draft is kept.';}
    if(currentPage==='inbox'&&!workspaceMode.demo&&currentMessage()&&messageKey(currentMessage())===key)renderConversation();else toast(draft.feedback);
  };
}
