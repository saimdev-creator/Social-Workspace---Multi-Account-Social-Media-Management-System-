const crypto=require('node:crypto');
const {GmailError}=require('./errors');
const {parseCredentials,exchangeToken,authorize,SCOPE}=require('./oauth');
const {normalizeGmail,buildReply}=require('./message');
const BASE='https://gmail.googleapis.com/gmail/v1/users/me';
const key=id=>crypto.createHash('sha256').update(id).digest('hex');
class GmailService{
  constructor({store,openExternal,fetcher=globalThis.fetch,authorizeFlow=authorize}){this.store=store;this.openExternal=openExternal;this.fetcher=fetcher;this.authorizeFlow=authorizeFlow;this.jobs=new Map();this.pending=new Map();this.runtime=new Map();this.locks=new Map();this.generations=new Map();}
  entry(id){return this.store.data.accounts[key(id)];}
  generation(id){return this.generations.get(id)||0;}
  requireAccount(account){if(!account||account.platform!=='gmail')throw new GmailError('invalid_account','Choose an existing Gmail workspace account.');}
  configured(){return Boolean(this.store.data.config);}
  requireConfig(){this.store.assertAvailable();if(!this.configured())throw new GmailError('not_configured','Gmail API not configured. Import Desktop OAuth credentials on the Gmail page.');return this.store.data.config;}
  status(account){this.requireAccount(account);const entry=this.entry(account.id),runtime=this.runtime.get(account.id),pending=this.pending.get(account.id);
    return {accountId:account.id,accountName:account.name,email:entry?.email||'',oauthIdentity:entry?.email||'',configured:this.configured(),status:this.store.error?'storage_unavailable':!this.configured()?'not_configured':runtime?.status||(entry?.tokens?.refreshToken?'connected':'not_connected'),message:this.store.error?.userMessage||runtime?.message||(!this.configured()?'Gmail API not configured':entry?.tokens?.refreshToken?'Gmail API connected':'Connect Gmail to authorize this account.'),lastSyncedAt:entry?.lastSyncedAt||null,cachedMessages:entry?.messages?.length||0,...(pending?{pendingEmail:pending.email,confirmationId:pending.confirmationId}:{}),scope:SCOPE};
  }
  importCredentials(json){if(this.jobs.size||this.pending.size||this.locks.size)throw new GmailError('busy','Finish or cancel active Gmail operations before changing OAuth configuration.');const config=parseCredentials(json);if(this.configured()&&config.clientId!==this.store.data.config.clientId&&Object.values(this.store.data.accounts).some(a=>a.tokens?.refreshToken))throw new GmailError('configuration','Disconnect existing Gmail API connections before importing a different OAuth client. Browser sessions are unaffected.');this.store.commit(data=>{data.config=config;});return {configured:true};}
  async connect(account){this.requireAccount(account);const config=this.requireConfig();if(this.jobs.has(account.id)||this.locks.has(account.id))throw new GmailError('busy','This Gmail account is busy. Wait for the current operation or cancel authorization.');
    this.clearPending(account.id);const generation=this.generation(account.id),previous=this.entry(account.id);
    const job=this.authorizeFlow(config,{openExternal:this.openExternal,fetcher:this.fetcher,loginHint:previous?.email||''});this.jobs.set(account.id,job);this.runtime.set(account.id,{status:'connecting',message:'Complete authorization in your browser, then return here.'});
    try{const tokens=await job.promise;const profile=await this.rawApi('/profile',tokens.accessToken);if(generation!==this.generation(account.id))throw new GmailError('cancelled','Authorization was cancelled.');
      const email=String(profile.emailAddress||'').toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new GmailError('authorization_failed','Google did not return a valid Gmail mailbox identity.');
      if(previous?.email&&previous.email!==email)throw new GmailError('identity_mismatch','This authorization belongs to a different mailbox. Reconnect with the previously linked Gmail address, or explicitly disconnect first.');
      if(Object.values(this.store.data.accounts).some(a=>a.accountId!==account.id&&a.email===email&&a.tokens?.refreshToken))throw new GmailError('identity_mismatch','That mailbox is already connected to another workspace account. No accounts were merged.');
      tokens.refreshToken=tokens.refreshToken||(previous?.email===email?previous.tokens?.refreshToken:null);if(!tokens.refreshToken)throw new GmailError('reconnect_required','Google did not grant offline access. Reconnect and approve consent.');
      const confirmationId=crypto.randomUUID();const timer=setTimeout(()=>{this.clearPending(account.id);this.runtime.delete(account.id);},300000);timer.unref?.();
      this.pending.set(account.id,{tokens,email,confirmationId,timer,generation});this.runtime.set(account.id,{status:'confirm_identity',message:'Confirm that this mailbox belongs to the selected workspace account.'});return this.status(account);
    }catch(error){this.runtime.set(account.id,{status:error.code==='cancelled'?(previous?.tokens?'connected':'not_connected'):'error',message:error.userMessage||'Gmail authorization failed. Try again.'});throw error;}
    finally{if(this.jobs.get(account.id)===job)this.jobs.delete(account.id);}
  }
  confirm(account,confirmationId){this.requireAccount(account);const p=this.pending.get(account.id);if(!p||p.confirmationId!==confirmationId||p.generation!==this.generation(account.id))throw new GmailError('cancelled','Mailbox confirmation expired. Connect again.');
    if(Object.values(this.store.data.accounts).some(a=>a.accountId!==account.id&&a.email===p.email&&a.tokens?.refreshToken))throw new GmailError('identity_mismatch','That mailbox is already connected to another account.');
    this.store.commit(data=>{data.accounts[key(account.id)]={...(data.accounts[key(account.id)]||{}),accountId:account.id,email:p.email,tokens:p.tokens,messages:this.entry(account.id)?.messages||[],lastSyncedAt:this.entry(account.id)?.lastSyncedAt||null,replies:this.entry(account.id)?.replies||{}};});
    this.clearPending(account.id);this.runtime.delete(account.id);return this.status(account);
  }
  clearPending(id){const p=this.pending.get(id);if(p)clearTimeout(p.timer);this.pending.delete(id);}
  cancel(account){this.requireAccount(account);this.generations.set(account.id,this.generation(account.id)+1);this.jobs.get(account.id)?.cancel();this.clearPending(account.id);this.runtime.delete(account.id);return {cancelled:true};}
  disconnect(account){this.requireAccount(account);if(this.locks.has(account.id))throw new GmailError('busy','Wait for synchronization or sending to finish before disconnecting.');this.cancel(account);this.store.commit(data=>{delete data.accounts[key(account.id)];});return this.status(account);}
  dispose(){for(const job of this.jobs.values())job.cancel();for(const id of this.pending.keys())this.clearPending(id);}
  async rawApi(path,accessToken,{method='GET',body,signal}={}){
    let response;try{response=await this.fetcher(BASE+path,{method,redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(12000)]):AbortSignal.timeout(12000),headers:{Authorization:`Bearer ${accessToken}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});}
    catch{throw new GmailError('offline','Gmail is offline or the request timed out. Check your connection and refresh.');}
    if(response.status===401)throw new GmailError('reconnect_required','Gmail authorization expired. Reconnect this account.');
    if(response.status===403)throw new GmailError('permission_required','Gmail access was denied. Enable the Gmail API, check test-user/admin settings and grant gmail.modify permission.');
    if(response.status===429)throw new GmailError('rate_limited','Google limited requests. Wait a minute before refreshing this account.');
    if(response.status===404)throw new GmailError('not_found','This Gmail message is no longer available. Refresh the inbox.');
    if(!response.ok)throw new GmailError('api_error','Gmail could not complete this request. Try again later.');
    try{return await response.json();}catch{throw new GmailError('api_error','Gmail returned an unreadable response.');}
  }
  async accessToken(account,signal,force=false){const config=this.requireConfig(),entry=this.entry(account.id);if(!entry?.tokens?.refreshToken)throw new GmailError('not_connected','Connect this Gmail account before synchronizing messages.');if(!force&&entry.tokens.accessToken&&entry.tokens.expiresAt>Date.now()+60000)return entry.tokens.accessToken;
    const generation=this.generation(account.id),tokens=await exchangeToken(config,{grant_type:'refresh_token',refresh_token:entry.tokens.refreshToken},this.fetcher,signal);
    if(generation!==this.generation(account.id))throw new GmailError('cancelled','This connection changed. Refresh the account.');
    this.store.commit(data=>{data.accounts[key(account.id)].tokens={...entry.tokens,...tokens,refreshToken:tokens.refreshToken||entry.tokens.refreshToken};});return tokens.accessToken;
  }
  async api(account,path,options={}){let token=await this.accessToken(account,options.signal);try{return await this.rawApi(path,token,options);}catch(error){if(error.code!=='reconnect_required')throw error;token=await this.accessToken(account,options.signal,true);return this.rawApi(path,token,options);}}
  cached(account){return (this.entry(account.id)?.messages||[]).map(m=>({...m,accountName:account.name,accountId:account.id}));}
  async exclusive(account,work){if(this.jobs.has(account.id))throw new GmailError('busy','Complete or cancel Gmail authorization first.');if(this.locks.has(account.id))throw new GmailError('busy','This account is synchronizing or sending. Please wait.');const job=work();this.locks.set(account.id,job);try{return await job;}finally{if(this.locks.get(account.id)===job)this.locks.delete(account.id);}}
  failure(account,error){this.runtime.set(account.id,{status:['not_configured','not_connected','reconnect_required','permission_required','storage_unavailable'].includes(error.code)?error.code:'error',message:error.userMessage||'Gmail request failed. Try again.'});}
  async sync(account,{force=false,loadMore=false}={},options={}){
    this.requireAccount(account);this.requireConfig();if(!this.entry(account.id)?.tokens?.refreshToken)throw new GmailError('not_connected','Connect this Gmail account before synchronizing messages.');
    const existing=this.entry(account.id);const age=Date.now()-Date.parse(existing.lastSyncedAt||'');if(!loadMore&&age<(force?10000:60000))return {items:this.cached(account),hasMore:Boolean(existing.nextPageToken)};
    return this.exclusive(account,async()=>{
      this.runtime.set(account.id,{status:'syncing',message:'Synchronizing up to 25 recent inbox messages…'});
      try{
        const cursor=loadMore?this.entry(account.id).nextPageToken:null;if(loadMore&&!cursor)return {items:this.cached(account),hasMore:false};
        const query=`/messages?labelIds=INBOX&maxResults=50&q=newer_than%3A30d${cursor?`&pageToken=${encodeURIComponent(cursor)}`:''}`;
        const listed=await this.api(account,query,options);const ids=(listed.messages||[]).slice(0,50).map(m=>m.id);const page=[];
        for(let i=0;i<ids.length;i+=4){const batch=await Promise.all(ids.slice(i,i+4).map(async id=>{try{return await this.api(account,`/messages/${encodeURIComponent(id)}?format=full`,options);}catch(error){if(error.code==='not_found')return null;throw error;}}));for(const raw of batch)if(raw)page.push(normalizeGmail(raw,account,this.entry(account.id).email));}
        const existingMessages=this.entry(account.id).messages||[],prior=loadMore?existingMessages:[];const priorById=new Map(existingMessages.map(m=>[m.id,m])),unique=new Map(prior.map(m=>[m.id,m]));for(const message of page)unique.set(message.id,{...message,replied:priorById.get(message.id)?.replied===true});const messages=[...unique.values()].sort((a,b)=>Date.parse(b.timestamp)-Date.parse(a.timestamp));
        const now=new Date().toISOString();this.store.commit(data=>{const a=data.accounts[key(account.id)];a.messages=messages;a.nextPageToken=listed.nextPageToken||null;a.lastSyncedAt=now;a.syncState={strategy:'paged-recent-inbox',pageSize:50,days:30,loaded:messages.length,newestMessageAt:messages[0]?.timestamp||null};});this.runtime.delete(account.id);return {items:this.cached(account),hasMore:Boolean(listed.nextPageToken),added:messages.length-prior.length};
      }catch(error){this.failure(account,error);throw error;}
    });
  }
  async updateMessage(account,payload,{signal}={}){return this.exclusive(account,async()=>{
    const original=this.cached(account).find(m=>m.id===payload.messageId&&m.conversationId===payload.conversationId);if(!original)throw new GmailError('not_found','Refresh and select a message from this Gmail account.');
    if(typeof payload.updates?.unread!=='boolean'||Object.keys(payload.updates).some(k=>k!=='unread'))throw new GmailError('unsupported','This Gmail connector currently supports read/unread changes only.');
    try{const body=payload.updates.unread?{addLabelIds:['UNREAD']}:{removeLabelIds:['UNREAD']};const raw=await this.api(account,`/messages/${encodeURIComponent(original.id)}/modify`,{method:'POST',body,signal});
      const updated={...original,unread:(raw.labelIds||[]).includes('UNREAD')};this.store.commit(data=>{data.accounts[key(account.id)].messages=data.accounts[key(account.id)].messages.map(m=>m.id===original.id?updated:m);});this.runtime.delete(account.id);return updated;
    }catch(error){this.failure(account,error);throw error;}
  });}
  async reply(account,payload,{signal}={}){return this.exclusive(account,async()=>{
    if(payload.demo===true||typeof payload.requestId!=='string'||!/^[a-zA-Z0-9-]{16,80}$/.test(payload.requestId))throw new GmailError('invalid_reply','Invalid reply request. Reopen the conversation.');
    const accountEntry=this.entry(account.id),original=this.cached(account).find(m=>m.id===payload.messageId&&m.conversationId===payload.conversationId);if(!original)throw new GmailError('not_found','Refresh and select a message from this account before replying.');
    const fingerprint=crypto.createHash('sha256').update(JSON.stringify([original.id,payload.text])).digest('hex');const old=accountEntry.replies?.[payload.requestId];
    if(old&&old.fingerprint!==fingerprint)throw new GmailError('invalid_reply','This reply request has changed. Reopen the conversation.');
    if(old?.status==='sent')return {sent:true,id:old.id,conversationId:original.conversationId};
    if(Object.values(accountEntry.replies||{}).some(r=>r.fingerprint===fingerprint&&r.status!=='sent'))throw new GmailError('send_unknown','A previous send may have succeeded. Check Gmail Sent before composing another reply.');
    const body=buildReply(original,accountEntry.email,payload.text);
    await this.accessToken(account,signal); // No send is recorded until authorization is ready.
    this.store.commit(data=>{const a=data.accounts[key(account.id)];a.replies??={};a.replies[payload.requestId]={fingerprint,status:'sending',at:Date.now()};});
    try{const sent=await this.api(account,'/messages/send',{method:'POST',body,signal});if(!sent.id)throw new Error('No receipt');
      this.store.commit(data=>{const a=data.accounts[key(account.id)];a.replies[payload.requestId]={fingerprint,status:'sent',id:sent.id,at:Date.now()};a.messages=a.messages.map(m=>m.id===original.id?{...m,replied:true}:m);});return {sent:true,id:sent.id,conversationId:original.conversationId};
    }catch{throw new GmailError('send_unknown','Gmail may have received the reply, but confirmation failed. Check Gmail Sent before sending again.');}
  });}
  provider(){return {timeoutMs:60000,listMessages:(a,p,o)=>this.sync(a,p,o),getStatus:a=>this.status(a),getCachedMessages:a=>this.cached(a),updateMessage:(a,p,o)=>this.updateMessage(a,p,o),reply:(a,p,o)=>this.reply(a,p,o)};}
}
module.exports={GmailService};
