class MetaService{
  constructor(store){this.store=store;}
  configured(){return Boolean(this.store.data.config?.appId&&this.store.data.config?.appSecret);}
  importCredentials(value){this.store.assertAvailable();const appId=String(value?.app_id||value?.appId||'').trim(),appSecret=String(value?.app_secret||value?.appSecret||'').trim();if(!/^\d{5,30}$/.test(appId)||appSecret.length<16)throw new Error('Choose a Meta app JSON file containing app_id and app_secret.');this.store.commit(data=>{data.config={appId,appSecret};});return {configured:true};}
  status(account){const type=account.platform==='facebook'?'Facebook Page':'Instagram Professional account';return {accountId:account.id,platform:account.platform,accountName:account.name,configured:this.configured(),status:this.store.error?'sync_error':!this.configured()?'not_configured':'connection_required',label:this.store.error?'Sync error':!this.configured()?'Meta connector not configured':`${type} connection required`,message:this.store.error?.userMessage||(!this.configured()?'Meta app credentials required. Import a local Meta app JSON configuration.':`${type} authorization is not active. Official Meta Login, permissions and app review are required before messages can be synchronized.`),connected:false};}
}
module.exports={MetaService};
