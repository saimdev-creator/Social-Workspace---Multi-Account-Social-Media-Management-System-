const crypto=require('node:crypto');
const {GmailError}=require('./errors');
function header(payload,name){return payload?.headers?.find(h=>h.name.toLowerCase()===name.toLowerCase())?.value||'';}
function decodeWords(value){return String(value).replace(/=\?([^?]+)\?([bq])\?([^?]*)\?=/gi,(_,charset,encoding,text)=>{try{const bytes=encoding.toLowerCase()==='b'?Buffer.from(text,'base64'):Buffer.from(text.replace(/_/g,' ').replace(/=([0-9a-f]{2})/gi,(_,hex)=>String.fromCharCode(parseInt(hex,16))),'latin1');return new TextDecoder(charset).decode(bytes);}catch{return text;}}).replace(/[\r\n]+/g,' ');}
function address(value){const text=decodeWords(value);const match=text.match(/<([^<>\s]+@[^<>\s]+)>/)||text.match(/([^\s<>(),;:]+@[^\s<>(),;:]+)/);const email=match?.[1]||'';return {email:/^[^\s<>"\\,;:\r\n]+@[^\s<>"\\,;:\r\n]+\.[^\s<>"\\,;:\r\n]+$/.test(email)?email:'',name:text.replace(/<[^>]+>/g,'').replace(/^"|"$/g,'').trim()||email};}
function bodyText(payload){
  const plain=[],html=[];function visit(part){if(!part||part.filename||/attachment/i.test(header(part,'Content-Disposition')))return;
    if(part.body?.data&&/^text\/(plain|html)$/i.test(part.mimeType)){const charset=header(part,'Content-Type').match(/charset=["']?([^;"'\s]+)/i)?.[1]||'utf-8';const bytes=Buffer.from(part.body.data.slice(0,160000),'base64url');let text;try{text=new TextDecoder(charset).decode(bytes);}catch{text=bytes.toString('utf8');}(part.mimeType.toLowerCase()==='text/plain'?plain:html).push(text);}
    for(const child of part.parts||[])visit(child);
  }visit(payload);
  return (plain.length?plain.join('\n'):html.join('\n').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,'').replace(/<\s*br\s*\/?>|<\/p>|<\/div>/gi,'\n').replace(/<[^>]*>/g,'').replace(/&(?:amp|lt|gt|quot|apos|nbsp);/g,x=>({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'",'&nbsp;':' '}[x]))).trim().slice(0,100000)||'[No text body — open in Gmail to view attachments or formatted content.]';
}
function normalizeGmail(raw,account,email){
  if(!raw?.id||!raw.threadId||!Number.isFinite(Number(raw.internalDate)))throw new GmailError('api_error','Gmail returned an invalid message.');
  const sender=address(header(raw.payload,'From')),replyTo=address(header(raw.payload,'Reply-To')).email||sender.email;
  const originalUrl=`https://mail.google.com/mail/?authuser=${encodeURIComponent(email)}#all/${encodeURIComponent(raw.threadId)}`;
  return {id:raw.id,connectorMessageId:raw.id,platform:'gmail',accountId:account.id,accountName:account.name,conversationId:raw.threadId,senderId:sender.email||'unknown-sender',senderName:sender.name||sender.email||'Unknown sender',senderEmail:sender.email,subject:decodeWords(header(raw.payload,'Subject'))||'(No subject)',message:bodyText(raw.payload),timestamp:new Date(Number(raw.internalDate)).toISOString(),unread:(raw.labelIds||[]).includes('UNREAD'),replied:false,sourceType:'official',status:(raw.labelIds||[]).includes('INBOX')?'open':'archived',category:'Unassigned',originalUrl,metadata:{originalUrl,mailboxEmail:email},replyTo,rfcMessageId:header(raw.payload,'Message-ID'),references:header(raw.payload,'References')};
}
function buildReply(original,from,text){
  if(typeof text!=='string'||!text.trim()||text.length>20000)throw new GmailError('invalid_reply','Write a reply between 1 and 20,000 characters.');
  const to=address(original.replyTo).email;
  if(!to||!address(from).email)throw new GmailError('invalid_reply','A valid sender/reply address is unavailable. Open this message in Gmail to reply.');
  const messageId=original.rfcMessageId?.match(/<[^<>\s]+@[^<>\s]+>/)?.[0];
  if(!messageId)throw new GmailError('invalid_reply','This message has no valid Message-ID for threading. Reply in Gmail instead.');
  const subject=/^re:/i.test(original.subject)?original.subject:`Re: ${original.subject}`;
  const characters=Array.from(subject.replace(/[\r\n]/g,' ').slice(0,500)),words=[];for(let i=0;i<characters.length;i+=10)words.push(`=?UTF-8?B?${Buffer.from(characters.slice(i,i+10).join('')).toString('base64')}?=`);
  const refs=[...new Set([...(original.references?.match(/<[^<>\s]+@[^<>\s]+>/g)||[]),messageId])].slice(-15).join('\r\n ');
  const mime=[`From: ${from}`,`To: ${to}`,`Subject: ${words.join('\r\n ')}`,`In-Reply-To: ${messageId}`,`References: ${refs}`,`Message-ID: <${crypto.randomUUID()}@social-workspace.local>`,'MIME-Version: 1.0','Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: base64','',Buffer.from(text.replace(/\r?\n/g,'\r\n')).toString('base64').match(/.{1,76}/g).join('\r\n')].join('\r\n');
  return {raw:Buffer.from(mime).toString('base64url'),threadId:original.conversationId};
}
module.exports={normalizeGmail,buildReply,decodeWords,address};
