// Main-process-only official connector boundary. Gmail is registered per account.
// Providers receive canonical account identity, never cookies or session partitions.
const {getPlatform}=require('./platformManager');
const {GmailError}=require('./gmail/errors');
const METHODS={messages:'listMessages',leads:'listLeads',analytics:'getAnalytics',posts:'listPosts',publish:'publish',updateMessage:'updateMessage',reply:'reply'};
const DOMAINS={facebook:['facebook.com','messenger.com'],instagram:['instagram.com'],threads:['threads.com','threads.net'],x:['x.com','twitter.com'],linkedin:['linkedin.com'],whatsapp:['whatsapp.com'],pinterest:['pinterest.com'],gmail:['mail.google.com'],reddit:['reddit.com'],discord:['discord.com']};
function safeOriginalUrl(platform,value){
  try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&(DOMAINS[platform]||[]).some(host=>u.hostname===host||u.hostname.endsWith('.'+host))?u.href:null;}catch{return null;}
}
function normalizeMessage(raw,account){
  if(!raw||raw.sourceType==='demo'||raw.demo===true||raw.metadata?.demo===true)throw new Error('Demo records cannot enter a real connector.');
  if(raw.accountId!==account.id||raw.platform!==account.platform)throw new Error('Connector returned a message for the wrong account.');
  for(const key of ['id','conversationId','senderId','senderName','message','timestamp'])if(typeof raw[key]!=='string'||!raw[key])throw new Error(`Message requires ${key}.`);
  if(!Number.isFinite(Date.parse(raw.timestamp))||typeof raw.unread!=='boolean')throw new Error('Message requires a valid timestamp and read state.');
  const originalUrl=safeOriginalUrl(account.platform,raw.metadata?.originalUrl||raw.originalUrl);
  return {id:raw.id,connectorMessageId:typeof raw.connectorMessageId==='string'?raw.connectorMessageId:raw.id,platform:account.platform,accountId:account.id,accountName:account.name,conversationId:raw.conversationId,senderId:raw.senderId,senderName:raw.senderName,senderEmail:typeof raw.senderEmail==='string'?raw.senderEmail:'',subject:typeof raw.subject==='string'?raw.subject:'',replyTo:typeof raw.replyTo==='string'?raw.replyTo:'',senderAvatar:null,message:raw.message,timestamp:new Date(raw.timestamp).toISOString(),unread:raw.unread,replied:raw.replied===true,sourceType:'official',status:raw.status==='archived'?'archived':'open',category:typeof raw.category==='string'?raw.category:'Unassigned',originalUrl,metadata:{originalUrl,...(account.platform==='gmail'?{mailboxEmail:raw.metadata?.mailboxEmail||''}:{})}};
}
function normalizeItems(kind,items,account){
  if(!Array.isArray(items))throw new Error('Connector returned an invalid collection.');
  return items.map(raw=>{
    if(kind==='messages')return normalizeMessage(raw,account);
    if(kind==='leads'){
      const message=normalizeMessage(raw,account),c=raw.classification;
      if(!c||!Number.isFinite(c.score)||c.score<0||c.score>100||!['HOT_LEAD','POTENTIAL_LEAD','EXISTING_CLIENT','GENERAL_MESSAGE','IRRELEVANT','SPAM'].includes(c.category))throw new Error('Connector returned an invalid lead.');
      return {...message,classification:{score:c.score,category:c.category,service:String(c.service||''),summary:String(c.summary||''),suggestedReply:String(c.suggestedReply||'')}};
    }
    if(!raw||raw.accountId!==account.id||raw.platform!==account.platform||raw.demo===true||raw.sourceType==='demo')throw new Error('Connector returned data for the wrong account or mode.');
    const identity={accountId:account.id,accountName:account.name,platform:account.platform,sourceType:'official'};
    if(kind==='analytics'){
      if(typeof raw.metric!=='string'||!Number.isFinite(raw.value)||!Number.isFinite(Date.parse(raw.timestamp)))throw new Error('Invalid analytics record.');
      return {...identity,metric:raw.metric,value:raw.value,timestamp:raw.timestamp};
    }
    if(typeof raw.id!=='string'||typeof raw.text!=='string'||!['draft','scheduled','published','failed','cancelled'].includes(raw.status))throw new Error('Invalid post record.');
    return {...identity,id:raw.id,text:raw.text,status:raw.status,scheduledAt:raw.scheduledAt||null};
  });
}
class ConnectorRegistry{
  constructor(){this.providers=new Map();}
  // Registration is main-process code only. Each account needs its own approved
  // connection; a platform registration never implicitly authorizes all accounts.
  register(platform,accountId,provider){if(!getPlatform(platform)||!accountId)throw new Error('Invalid connector account.');this.providers.set(JSON.stringify([platform,accountId]),provider);}
  unregister(platform,accountId){this.providers.delete(JSON.stringify([platform,accountId]));}
  async request(kind,account,payload={}){
    if(!METHODS[kind])throw new Error('Unsupported connector capability.');
    if(!account||!getPlatform(account.platform))throw new Error('Account not found.');
    const identity={id:account.id,platform:account.platform,name:account.name};
    const provider=this.providers.get(JSON.stringify([account.platform,account.id]));
    if(kind==='publish'&&(payload.demo===true||payload.sourceType==='demo'))throw new Error('Demo posts cannot be sent through a real connector.');
    if(!provider||typeof provider[METHODS[kind]]!=='function')return {status:'pending',accountId:account.id,platform:account.platform,items:[],message:'No real connector configured yet'};
    const controller=new AbortController();let timer;
    try{
      const result=await Promise.race([provider[METHODS[kind]](identity,payload,{signal:controller.signal}),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('Connector timed out. Try again.'));},Math.min(60000,provider.timeoutMs||15000));})]);
      if(kind==='reply')return {status:'ready',accountId:account.id,receipt:{sent:result.sent===true,id:result.id,conversationId:result.conversationId}};
      if(kind==='updateMessage')return {status:'ready',accountId:account.id,items:normalizeItems('messages',[result],account)};
      const collection=Array.isArray(result)?{items:result}:result;const items=normalizeItems(kind==='publish'?'posts':kind,collection.items,account);
      return {status:'ready',accountId:account.id,platform:account.platform,items,hasMore:collection.hasMore===true,added:Number.isFinite(collection.added)?collection.added:undefined,...(provider.getStatus?{connection:provider.getStatus(identity)}:{})};
    }catch(error){
      const known=error instanceof GmailError;
      const cached=kind==='messages'&&known&&['offline','api_error','rate_limited'].includes(error.code)?normalizeItems('messages',provider.getCachedMessages?.(identity)||[],identity):[];
      return {status:known&&['not_configured','not_connected'].includes(error.code)?'pending':'error',accountId:account.id,platform:account.platform,items:cached,stale:cached.length>0,code:known?error.code:'connector_error',message:known?error.userMessage:'The connector could not load this account. Try again.',...(provider.getStatus?{connection:provider.getStatus(identity)}:{})};
    }
    finally{clearTimeout(timer);}
  }
}
module.exports={ConnectorRegistry,normalizeMessage,safeOriginalUrl};
