/* Standalone demo domain. No account storage, cookies, sessions, or network access. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WorkspaceData = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  const KEY = 'social-workspace.demo.v1';
  const categories = ['HOT_LEAD','POTENTIAL_LEAD','EXISTING_CLIENT','GENERAL_MESSAGE','IRRELEVANT','SPAM'];
  const samples = [
    ['instagram','Maya Chen','I need a WordPress website for my restaurant. Can you share pricing?','WordPress website','HOT_LEAD',96,'Restaurant owner requesting website pricing.','Thanks, Maya! How many pages do you need, and would you like online reservations?'],
    ['facebook','Omar Ali','Do you provide SEO for small businesses?','SEO','POTENTIAL_LEAD',76,'Small business exploring SEO support.','Yes, we can help. Could you share your website and the locations you serve?'],
    ['linkedin','Elena Brooks',"We’re looking for someone to add an AI chatbot to our website.",'AI chatbot','HOT_LEAD',93,'Team looking for a website chatbot.','Happy to discuss. What should the chatbot help your visitors with?'],
    ['instagram','Sam Reed','Nice work bro.','None','IRRELEVANT',4,'Compliment without buying intent.','Thank you!'],
    ['facebook','Page Boost','Follow my page.','None','IRRELEVANT',2,'Promotion without service interest.','Thanks for reaching out.'],
    ['whatsapp','Aisha Khan','I need an ecommerce website. Budget is $700 and I want to start this week.','Ecommerce website','HOT_LEAD',98,'Buyer has a budget and near-term start date.','Thanks, Aisha! How many products are you launching with, and which payment methods do you need?'],
    ['gmail','Noah Davis','Can you update our existing website this month?','Website maintenance','EXISTING_CLIENT',68,'Existing client requesting an update.','Of course. Please send the changes you have in mind.'],
    ['reddit','Community member','Which editor do you use?','None','GENERAL_MESSAGE',15,'General tooling question.','Thanks for asking! What kind of project are you working on?'],
    ['discord','Promo bot','Guaranteed followers! Buy today.','None','SPAM',0,'Unsolicited promotion.','No reply recommended.']
  ];
  function seed(now = Date.now()) {
    return { version:1, messages:samples.map((s,i)=>({ id:`demo-message-${i}`, platform:s[0], accountId:`demo-${s[0]}`, accountName:`Demo ${s[0]} studio`, senderId:`demo-sender-${i}`, senderName:s[1], senderAvatar:null, message:s[2], timestamp:new Date(now-i*37*60000).toISOString(), unread:i<4||i===5, conversationId:`demo-conversation-${i}`, sourceType:'demo', status:'open', category:'Unassigned', metadata:{demo:true, originalUrl:null}, classification:{service:s[3],category:s[4],score:s[5],summary:s[6],suggestedReply:s[7]}, leadStatus:'New', followUp:false })), posts:[], keywords:['website','SEO','Social Workspace'], activity:[] };
  }
  // Connector contract: listMessages() -> normalized messages. Replace this provider
  // only after implementing official authorization and per-account permissions.
  class MockMessagingProvider { async listMessages(data) { return data.messages; } }
  // AI contract: classify(normalizedMessage) -> service, category, score, summary,
  // suggestedReply. Ollama can implement this in the main process in a later phase.
  class MockAIProvider {
    async classify(message) {
      if (!message.classification) throw new Error('No demo classification is available.');
      return { ...message.classification, provider:'mock', demo:true };
    }
  }
  class MockPublishingProvider {
    async publish(post) { return { ...post, status:'simulated', publishedAt:new Date().toISOString(), demo:true }; }
  }
  // Connector-agnostic local placeholder. It accepts only normalized messages and
  // labels every result as mock so it cannot be mistaken for trained AI output.
  class LocalLeadProvider {
    async classify(message) {
      if(!message||message.sourceType!=='official'||!message.platform||!message.accountId)throw new Error('A normalized official message is required.');
      const text=`${message.subject||''} ${message.message||''}`.toLowerCase();const strong=/quote|price|cost|buy|hire|book|estimate|proposal/.test(text),possible=/interested|information|details|help|service|available/.test(text);const score=strong?82:possible?58:12;
      return {lead:score>=50,score,priority:score>=75?'High':score>=50?'Medium':'Low',reason:strong?'Possible purchasing intent found by local keyword rules.':possible?'Possible interest found by local keyword rules.':'No clear purchasing intent found by local keyword rules.',replied:message.replied===true,suggestedReply:score>=50?'Thanks for reaching out. Could you share a little more about what you need and your preferred timeline?':'Thanks for your message. How can we help?',sourcePlatform:message.platform,sourceAccountId:message.accountId,sourceAccountName:message.accountName,provider:'mock-local-rules',mock:true};
    }
  }
  class Store {
    constructor(storage) {
      this.storage=storage; this.warning=''; this.data=seed();
      try {
        const raw=storage.getItem(KEY);
        if(raw) {
          const data=JSON.parse(raw);
          if(data.version!==1 || !['messages','posts','keywords','activity'].every(k=>Array.isArray(data[k]))) throw new Error('Unsupported demo data');
          this.data=data;
        }
      } catch { this.warning='Saved demo data could not be read. A temporary demo is shown; existing saved data will not be overwritten.'; this.readOnly=true; }
    }
    commit(change) {
      if(this.readOnly) throw new Error(this.warning);
      const next=JSON.parse(JSON.stringify(this.data));
      change(next);
      try { this.storage.setItem(KEY,JSON.stringify(next)); }
      catch { throw new Error('Could not save demo changes. Storage may be full or unavailable.'); }
      this.data=next;
      return next;
    }
    updateMessage(id, updates) {
      const allowed=['unread','status','category','leadStatus','followUp'];
      return this.commit(data=>{const item=data.messages.find(m=>m.id===id);if(!item)throw new Error('Conversation not found.');for(const key of allowed)if(key in updates)item[key]=updates[key];});
    }
    savePost(post, accounts) {
      if(!post.text?.trim()) throw new Error('Write some content first.');
      if(!['draft','scheduled','simulated','cancelled'].includes(post.status))throw new Error('Invalid post status.');
      if(post.status!=='draft'&&!post.accountIds?.length)throw new Error('Select at least one account.');
      if(post.accountIds.some(id=>!accounts.some(a=>a.id===id)))throw new Error('A selected account was removed. Choose another account.');
      if(post.status==='scheduled'&&(!post.scheduledAt||new Date(post.scheduledAt).getTime()<=Date.now()||!Number.isFinite(Date.parse(post.scheduledAt))))throw new Error('Choose a future schedule date and time.');
      const saved={...post,id:post.id||`post-${globalThis.crypto.randomUUID()}`,demo:true,updatedAt:new Date().toISOString()};
      this.commit(data=>{const i=data.posts.findIndex(p=>p.id===saved.id);if(i<0)data.posts.push(saved);else data.posts[i]=saved;data.activity.unshift({text:`${saved.status==='simulated'?'Simulated publish':saved.status==='scheduled'?'Scheduled demo': 'Saved '+saved.status}: ${saved.text.slice(0,65)}`,timestamp:saved.updatedAt});data.activity=data.activity.slice(0,50);});
      return saved;
    }
    cancelPost(id) { this.commit(data=>{const p=data.posts.find(p=>p.id===id);if(!p)throw new Error('Post not found.');p.status='cancelled';}); }
  }
  function metrics(data) {
    return { messages:data.messages.length, unread:data.messages.filter(m=>m.unread&&m.status!=='archived').length, leads:data.messages.filter(m=>['HOT_LEAD','POTENTIAL_LEAD'].includes(m.classification.category)&&m.leadStatus!=='Archived').length, scheduled:data.posts.filter(p=>p.status==='scheduled').length, published:data.posts.filter(p=>p.status==='simulated').length };
  }
  return { Store, seed, metrics, categories, MockAIProvider, MockMessagingProvider, MockPublishingProvider, LocalLeadProvider };
});
