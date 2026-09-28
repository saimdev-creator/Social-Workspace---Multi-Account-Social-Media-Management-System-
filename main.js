const { app, BrowserWindow, BrowserView, ipcMain, dialog, shell, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const AccountManager = require('./services/accountManager');
const SessionManager = require('./services/sessionManager');
const { getPlatform } = require('./services/platformManager');
const { ConnectorRegistry, safeOriginalUrl } = require('./services/connectors');
const connectors = new ConnectorRegistry();
const {SecureStore}=require('./services/gmail/secureStore');
const {GmailService}=require('./services/gmail/gmailService');
const {MetaService}=require('./services/meta/metaService');
let gmail,meta;

let mainWindow;
let activeView = null;
let activeAccount = null;
let detachedWindows = new Set();
let manager;
let sessions;
let browserVisible = true;
let browserError = null;

function sendError(message) { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('app:error', message); }
function state() { return { accounts: manager.list(), settings: manager.settings(), activeAccount: activeAccount ? activeAccount.id : null, browserError, externalFallback:activeAccount?.platform==='whatsapp' }; }
function sendBrowserState() {
  if (!mainWindow || !activeView || !activeAccount) return;
  mainWindow.webContents.send('browser:state', { accountId: activeAccount.id, url: activeView.webContents.getURL(), canGoBack: activeView.webContents.canGoBack(), canGoForward: activeView.webContents.canGoForward() });
}
function layoutView() {
  if (!mainWindow || !activeView || !browserVisible) return;
  const [width, height] = mainWindow.getContentSize();
  // Keep the workspace sidebar visible while the remote account browser fills
  // only the content area to its right.
  const sidebarWidth = 238;
  activeView.setBounds({ x: sidebarWidth, y: 162, width: Math.max(0, width - sidebarWidth), height: Math.max(0, height - 162) });
  activeView.setAutoResize({ width: true, height: true });
}
function destroyActiveView() {
  if (activeView) {
    try { mainWindow.removeBrowserView(activeView); } catch {}
    if (!activeView.webContents.isDestroyed()) activeView.webContents.destroy();
    activeView = null;
  }
}
async function openAccount(id, targetUrl) {
  const account = manager.get(id);
  if (!account) throw new Error('Account not found.');
  const platform = getPlatform(account.platform);
  if (!platform) throw new Error('Unsupported platform.');
  destroyActiveView();
  if(account.platform==='whatsapp'){
    activeAccount=account;browserVisible=false;browserError=null;
    mainWindow.webContents.send('state:changed',state());
    return state();
  }
  browserVisible = true;
  browserError = null;
  activeAccount = manager.markOpened(id);
  activeView = new BrowserView({ webPreferences: { partition: account.sessionPartition, contextIsolation: true, nodeIntegration: false, sandbox: true } });
  mainWindow.addBrowserView(activeView);
  layoutView();
  activeView.webContents.on('did-finish-load', sendBrowserState);
  activeView.webContents.on('did-navigate', sendBrowserState);
  activeView.webContents.on('did-navigate-in-page', sendBrowserState);
  activeView.webContents.on('did-fail-load', (_, code, description, url, isMainFrame) => { if (isMainFrame && code !== -3) { browserError=`Could not load ${platform.name}: ${description}. Check your connection and try Reload.`; sendError(browserError); } });
  const openingView = activeView;
  try { await openingView.webContents.loadURL(targetUrl || platform.url); }
  catch (error) { if (openingView === activeView && error.code !== 'ERR_ABORTED') { browserError=`Could not open ${platform.name}. Check your connection and try Reload.`; sendError(browserError); } }
  if (openingView !== activeView) return state();
  sendBrowserState();
  mainWindow.webContents.send('state:changed', state());
  return state();
}
function createWindow() {
  mainWindow = new BrowserWindow({ width: 1280, height: 800, minWidth: 980, minHeight: 620, backgroundColor: '#f5f7fb', webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false } });
  mainWindow.loadFile(path.join(__dirname, 'renderer/index.html'));
  mainWindow.webContents.once('did-finish-load', () => {
    const lastId = manager.data.lastAccountId;
    if (manager.settings().startup === 'last' && manager.settings().rememberLast !== false && lastId && manager.get(lastId)) {
      openAccount(lastId).catch(error => sendError(`Could not reopen the last account: ${error.message}`));
    }
  });
  mainWindow.on('resize', layoutView);
  mainWindow.on('closed', () => { destroyActiveView(); mainWindow = null; });
}
function result(fn) { return async (_, payload) => { try { return { ok: true, data: await fn(payload) }; } catch (error) { sendError(error.message); return { ok: false, error: error.message }; } }; }

app.whenReady().then(() => {
  const dataFile = path.join(app.getPath('userData'), 'accounts.json');
  if (!fs.existsSync(dataFile)) fs.copyFileSync(path.join(__dirname, 'data/accounts.json'), dataFile);
  manager = new AccountManager(dataFile);
  sessions = new SessionManager();
  gmail = new GmailService({store:new SecureStore(path.join(app.getPath('userData'),'gmail-connector','state.enc'),safeStorage),openExternal:url=>shell.openExternal(url)});
  meta = new MetaService(new SecureStore(path.join(app.getPath('userData'),'meta-connector','state.enc'),safeStorage));
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

ipcMain.handle('state:get', () => state());
function gmailAccount(id){const account=manager.get(id);if(!account||account.platform!=='gmail')throw new Error('Choose an existing Gmail account.');return account;}
ipcMain.handle('gmail:status',result(()=>({configured:gmail.configured(),accounts:manager.list().filter(a=>a.platform==='gmail').map(a=>gmail.status(a))})));
ipcMain.handle('gmail:importCredentials',result(async()=>{
  const {filePaths}=await dialog.showOpenDialog(mainWindow,{title:'Import Google Desktop OAuth credentials',properties:['openFile'],filters:[{name:'Google OAuth JSON',extensions:['json']}]});
  if(!filePaths?.[0])return {cancelled:true};if(fs.statSync(filePaths[0]).size>65536)throw new Error('This credentials file is too large. Choose the downloaded Desktop OAuth JSON.');
  let json;try{json=JSON.parse(fs.readFileSync(filePaths[0],'utf8'));}catch{throw new Error('Choose a valid Google Desktop OAuth JSON file.');}return gmail.importCredentials(json);
}));
ipcMain.handle('gmail:connect',result(async id=>{const status=await gmail.connect(gmailAccount(id));if(!manager.get(id)){gmail.cancel({id,platform:'gmail'});throw new Error('This workspace account was removed during authorization.');}return status;}));
ipcMain.handle('gmail:confirm',result(({id,confirmationId})=>gmail.confirm(gmailAccount(id),confirmationId)));
ipcMain.handle('gmail:cancel',result(id=>gmail.cancel(gmailAccount(id))));
ipcMain.handle('gmail:disconnect',result(id=>gmail.disconnect(gmailAccount(id))));
ipcMain.handle('meta:status',result(platform=>{if(!['facebook','instagram'].includes(platform))throw new Error('Choose Facebook or Instagram.');return {configured:meta.configured(),accounts:manager.list().filter(a=>a.platform===platform).map(a=>meta.status(a))};}));
ipcMain.handle('meta:importCredentials',result(async()=>{const {filePaths}=await dialog.showOpenDialog(mainWindow,{title:'Import Meta app credentials',properties:['openFile'],filters:[{name:'Meta app JSON',extensions:['json']}]});if(!filePaths?.[0])return {cancelled:true};if(fs.statSync(filePaths[0]).size>65536)throw new Error('Meta app configuration is too large.');let json;try{json=JSON.parse(fs.readFileSync(filePaths[0],'utf8'));}catch{throw new Error('Choose a valid Meta app JSON file.');}return meta.importCredentials(json);}));
ipcMain.handle('whatsapp:external', result(async id => {
  const account=manager.get(id);
  if(!account||account.platform!=='whatsapp')throw new Error('Choose a saved WhatsApp account.');
  await shell.openExternal('https://web.whatsapp.com/');return true;
}));
ipcMain.handle('connectors:request', result(async ({kind,accountId,payload}) => {
  const account=manager.get(accountId);if(account?.platform==='gmail')connectors.register('gmail',account.id,gmail.provider());
  return connectors.request(kind,account,payload);
}));
ipcMain.handle('conversation:openOriginal', result(async ({accountId,messageId}) => {
  const selected=manager.get(accountId);
  if(selected?.platform==='gmail'){
    const message=gmail.cached(selected).find(m=>m.id===messageId);const link=message&&safeOriginalUrl('gmail',message.originalUrl);
    if(!link)throw new Error('Refresh this Gmail account and select the message again.');await shell.openExternal(link);return {external:true};
  }
  const account=manager.get(accountId), response=await connectors.request('messages',account);
  const message=response.items.find(item=>item.id===messageId);
  const url=message&&safeOriginalUrl(account.platform,message.metadata.originalUrl);
  if(!url)throw new Error('No original conversation link is available for this account.');
  if(account.platform==='whatsapp')throw new Error('Embedded WhatsApp conversations are unavailable. Use the external-browser action.');
  return openAccount(account.id,url);
}));
ipcMain.handle('browser:visible', (_, visible) => {
  browserVisible = visible === true;
  if (activeView && mainWindow) {
    if (browserVisible) { mainWindow.addBrowserView(activeView); layoutView(); }
    else mainWindow.removeBrowserView(activeView);
  }
});
ipcMain.handle('account:create', result(({ platform, name }) => { const p = getPlatform(platform); if (!p || !name || !name.trim()) throw new Error('Choose a platform and enter an account name.'); const account = manager.create(platform, name, p.url); return openAccount(account.id); }));
ipcMain.handle('account:rename', result(({ id, name }) => manager.rename(id, name)));
ipcMain.handle('account:delete', result(async id => { const existing=manager.get(id); if(existing?.platform==='gmail'){if(gmail.entry(id))gmail.disconnect(existing);else gmail.cancel(existing);connectors.unregister('gmail',id);} const account = manager.remove(id); if (activeAccount && activeAccount.id === id) { destroyActiveView(); activeAccount = null; } await sessions.clear(account.sessionPartition); mainWindow.webContents.send('state:changed', state()); return state(); }));
ipcMain.handle('account:open', result(({ id }) => openAccount(id)));
ipcMain.handle('workspace:home', () => {
  destroyActiveView();
  activeAccount = null;
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('state:changed', state());
  return state();
});
ipcMain.handle('browser:action', result(async action => { if (!activeView || !activeAccount) throw new Error('Open an account first.'); const p = getPlatform(activeAccount.platform); if (action === 'back' && activeView.webContents.canGoBack()) activeView.webContents.goBack(); else if (action === 'forward' && activeView.webContents.canGoForward()) activeView.webContents.goForward(); else if (action === 'reload') activeView.webContents.reload(); else if (action === 'home') await activeView.webContents.loadURL(p.url); else if (action === 'messenger' && activeAccount.platform === 'facebook') await activeView.webContents.loadURL('https://www.messenger.com/'); else if (action === 'new-window') { const win = new BrowserWindow({ width: 1200, height: 800, webPreferences: { partition: activeAccount.sessionPartition, contextIsolation: true, nodeIntegration: false, sandbox: true } }); detachedWindows.add(win); win.loadURL(activeView.webContents.getURL()).catch(() => sendError('Could not load the detached window. Check your connection and retry.')); win.on('closed', () => detachedWindows.delete(win)); } sendBrowserState(); return true; }));
ipcMain.handle('settings:update', (_, settings) => manager.updateSettings(settings));
ipcMain.handle('session:clear', result(async id => { const account = manager.get(id); if (!account) throw new Error('Account not found.'); await sessions.clear(account.sessionPartition); if (activeAccount && activeAccount.id === id) await openAccount(id); return true; }));
ipcMain.handle('session:clearAll', result(async () => { for (const account of manager.list()) await sessions.clear(account.sessionPartition); return true; }));
ipcMain.handle('external:open', (_, url) => shell.openExternal(url));
ipcMain.handle('accounts:export', async () => { const { filePath } = await dialog.showSaveDialog(mainWindow, { title: 'Export account metadata', defaultPath: 'social-workspace-accounts.json', filters: [{ name: 'JSON', extensions: ['json'] }] }); if (!filePath) return false; fs.writeFileSync(filePath, JSON.stringify({ accounts: manager.list().map(({ id, platform, name, sessionPartition, createdAt, lastOpenedAt, url }) => ({ id, platform, name, sessionPartition, createdAt, lastOpenedAt, url })) }, null, 2)); return true; });
ipcMain.handle('accounts:import', async () => { const { filePaths } = await dialog.showOpenDialog(mainWindow, { title: 'Import account metadata', properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] }); if (!filePaths?.[0]) return false; const payload = JSON.parse(fs.readFileSync(filePaths[0], 'utf8')); const count = manager.importMetadata(payload); mainWindow.webContents.send('state:changed', state()); return count; });

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit',()=>gmail?.dispose());
