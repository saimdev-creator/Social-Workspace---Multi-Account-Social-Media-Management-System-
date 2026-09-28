const http=require('node:http');
const crypto=require('node:crypto');
const {GmailError}=require('./errors');
const SCOPE='https://www.googleapis.com/auth/gmail.modify';
const TOKEN_URL='https://oauth2.googleapis.com/token';
function parseCredentials(json){const c=json?.installed;if(!c||typeof c.client_id!=='string'||!c.client_id.endsWith('.apps.googleusercontent.com')||typeof c.client_secret!=='string'||!c.client_secret)throw new GmailError('configuration','Choose a Google OAuth Desktop app credentials JSON file (with an installed section).');return {clientId:c.client_id,clientSecret:c.client_secret};}
async function exchangeToken(config,fields,fetcher=globalThis.fetch,signal){
  let response;try{response=await fetcher(TOKEN_URL,{method:'POST',redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(12000)]):AbortSignal.timeout(12000),headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:config.clientId,client_secret:config.clientSecret,...fields})});}
  catch{throw new GmailError('offline','Could not reach Google. Check your connection and try again.');}
  let data;try{data=await response.json();}catch{throw new GmailError('api_error','Google returned an unreadable authorization response.');}
  if(!response.ok){if(data.error==='invalid_grant')throw new GmailError('reconnect_required','Google authorization expired or was revoked. Reconnect this Gmail account.');throw new GmailError('authorization_failed','Google could not authorize this connection. Check the Desktop OAuth client, consent settings and requested permissions.');}
  if(typeof data.access_token!=='string')throw new GmailError('authorization_failed','Google did not return an access token.');
  if(data.scope&&!data.scope.split(' ').includes(SCOPE))throw new GmailError('permission_required','Gmail read, mark-read and reply permission was not granted. Reconnect and grant the requested permission.');
  return {accessToken:data.access_token,refreshToken:data.refresh_token,expiresAt:Date.now()+Number(data.expires_in||3600)*1000};
}
function authorize(config,{openExternal,fetcher=globalThis.fetch,loginHint='',timeoutMs=180000}={}){
  const verifier=crypto.randomBytes(48).toString('base64url'),state=crypto.randomBytes(32).toString('base64url');
  const challenge=crypto.createHash('sha256').update(verifier).digest('base64url');
  let settled=false,claimed=false,timer,resolvePromise,rejectPromise;const controller=new AbortController();
  const promise=new Promise((resolve,reject)=>{resolvePromise=resolve;rejectPromise=reject;});
  const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);server.close();controller.abort();error?rejectPromise(error):resolvePromise(value);};
  const server=http.createServer(async(req,res)=>{
    res.setHeader('Content-Type','text/plain; charset=utf-8');res.setHeader('Cache-Control','no-store');res.setHeader('Content-Security-Policy',"default-src 'none'");
    let callback;try{callback=new URL(req.url,'http://127.0.0.1');}catch{res.writeHead(400);res.end('Invalid callback.');return;}
    if(req.method!=='GET'||callback.pathname!=='/'||callback.searchParams.get('state')!==state){res.writeHead(400);res.end('Invalid authorization response. Return to Social Workspace.');return;}
    if(claimed||settled){res.writeHead(409);res.end('Authorization already handled.');return;}claimed=true;
    if(callback.searchParams.has('error')){res.end('Authorization cancelled. Return to Social Workspace.');finish(new GmailError('cancelled','Gmail authorization was cancelled. Existing connections are unchanged.'));return;}
    const code=callback.searchParams.get('code');if(!code){res.writeHead(400);res.end('Authorization code missing.');finish(new GmailError('authorization_failed','Google did not return an authorization code.'));return;}
    res.end('Authorization received. Return to Social Workspace to confirm the Gmail mailbox.');
    try{const tokens=await exchangeToken(config,{grant_type:'authorization_code',code,code_verifier:verifier,redirect_uri:`http://127.0.0.1:${server.address().port}/`},fetcher,controller.signal);finish(null,tokens);}catch(error){finish(error);}
  });
  server.on('error',()=>finish(new GmailError('authorization_failed','Could not start the local OAuth callback. Check local firewall settings and retry.')));
  server.listen(0,'127.0.0.1',async()=>{
    if(settled){server.close();return;}
    timer=setTimeout(()=>finish(new GmailError('cancelled','Gmail authorization timed out. You can connect again.')),timeoutMs);
    const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');url.search=new URLSearchParams({client_id:config.clientId,redirect_uri:`http://127.0.0.1:${server.address().port}/`,response_type:'code',scope:SCOPE,code_challenge:challenge,code_challenge_method:'S256',state,access_type:'offline',prompt:'consent select_account',...(loginHint?{login_hint:loginHint}:{})}).toString();
    try{await openExternal(url.href);}catch{finish(new GmailError('authorization_failed','Could not open the authorization browser.'));}
  });
  return {promise,cancel:()=>finish(new GmailError('cancelled','Gmail authorization was cancelled. Existing connections are unchanged.'))};
}
module.exports={SCOPE,parseCredentials,exchangeToken,authorize};
