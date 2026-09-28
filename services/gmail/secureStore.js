const fs=require('node:fs');
const path=require('node:path');
const {GmailError}=require('./errors');
// Only this connector file is written. Account metadata and session paths are not inputs.
class SecureStore {
  constructor(file,safeStorage){this.file=file;this.crypto=safeStorage;this.data={version:1,config:null,accounts:{}};this.error=null;
    try{const bytes=fs.readFileSync(file);this.assertAvailable();const value=JSON.parse(safeStorage.decryptString(bytes));if(value.version!==1||!value.accounts||typeof value.accounts!=='object')throw new Error('Invalid store');this.data=value;}
    catch(error){if(error.code!=='ENOENT')this.error=new GmailError('storage_unavailable','Gmail encrypted storage could not be opened. It has not been reset. Use the same Windows user profile.');}
  }
  assertAvailable(){if(this.error)throw this.error;if(!this.crypto.isEncryptionAvailable())throw new GmailError('storage_unavailable','Windows secure storage is unavailable. Gmail credentials will not be stored in plaintext.');}
  commit(change){this.assertAvailable();const next=structuredClone(this.data);change(next);const encrypted=this.crypto.encryptString(JSON.stringify(next));
    try{fs.mkdirSync(path.dirname(this.file),{recursive:true});fs.writeFileSync(this.file+'.tmp',encrypted,{mode:0o600});fs.renameSync(this.file+'.tmp',this.file);}
    catch{throw new GmailError('storage_unavailable','Could not save the encrypted Gmail connector data. No account sessions were changed.');}
    this.data=next;
  }
}
module.exports={SecureStore};
