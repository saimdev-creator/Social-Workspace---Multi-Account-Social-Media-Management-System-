// Read-only compatibility observation in a fresh, disposable profile. No UA changes.
const {app,BrowserWindow}=require('electron');
const fs=require('fs'),os=require('os'),path=require('path');
app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'sw-whatsapp-diagnostic-')));
app.whenReady().then(async()=>{
  const win=new BrowserWindow({show:false,webPreferences:{sandbox:true,nodeIntegration:false,contextIsolation:true}});
  console.log(JSON.stringify({electron:process.versions.electron,chromium:process.versions.chrome,userAgent:win.webContents.getUserAgent()}));
  const timeout=setTimeout(()=>{console.log('Diagnostic timed out; no changes made.');app.exit(0);},25000);
  try {
    await win.loadURL('https://web.whatsapp.com/');
    await new Promise(resolve=>setTimeout(resolve,8000));
    console.log(await win.webContents.executeJavaScript('document.body.innerText.slice(0,1800)'));
  }catch(error){console.log('Load error:',error.message);}
  clearTimeout(timeout);app.exit(0);
});
