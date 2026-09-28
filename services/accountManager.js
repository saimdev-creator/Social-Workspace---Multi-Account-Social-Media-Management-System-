const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class AccountManager {
  constructor(file) {
    this.file = file;
    this.defaults = { accounts: [], settings: { theme: 'light', startup: 'dashboard', confirmDelete: true, rememberLast: true }, lastAccountId: null };
    this.data = this.load();
  }

  load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return { ...this.defaults, ...parsed, accounts: Array.isArray(parsed.accounts) ? parsed.accounts : [], settings: { ...this.defaults.settings, ...(parsed.settings || {}) } };
    } catch {
      return JSON.parse(JSON.stringify(this.defaults));
    }
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temp = `${this.file}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(this.data, null, 2), 'utf8');
    fs.renameSync(temp, this.file);
  }

  list() { return this.data.accounts; }
  settings() { return this.data.settings; }
  get(id) { return this.data.accounts.find(account => account.id === id); }

  create(platform, name, url) {
    const now = new Date().toISOString();
    const id = `${platform}-${crypto.randomUUID()}`;
    const account = { id, platform, name: name.trim(), sessionPartition: `persist:social-workspace-${id}`, createdAt: now, lastOpenedAt: null, url };
    this.data.accounts.push(account);
    this.save();
    return account;
  }

  rename(id, name) {
    const account = this.get(id);
    if (!account || !name.trim()) throw new Error('Invalid account name.');
    account.name = name.trim();
    this.save();
    return account;
  }

  remove(id) {
    const index = this.data.accounts.findIndex(account => account.id === id);
    if (index < 0) throw new Error('Account not found.');
    const [account] = this.data.accounts.splice(index, 1);
    if (this.data.lastAccountId === id) this.data.lastAccountId = null;
    this.save();
    return account;
  }

  markOpened(id) {
    const account = this.get(id);
    if (!account) throw new Error('Account not found.');
    account.lastOpenedAt = new Date().toISOString();
    this.data.lastAccountId = id;
    this.save();
    return account;
  }

  updateSettings(settings) {
    this.data.settings = { ...this.data.settings, ...settings };
    this.save();
    return this.data.settings;
  }

  importMetadata(payload) {
    const incoming = Array.isArray(payload) ? payload : payload.accounts;
    if (!Array.isArray(incoming)) throw new Error('The selected file is not a valid account export.');
    let added = 0;
    for (const item of incoming) {
      if (!item || this.get(item.id) || !item.id || !item.platform || !item.name || !item.sessionPartition) continue;
      if (!require('./platformManager').getPlatform(item.platform)) continue;
      this.data.accounts.push({ id: item.id, platform: item.platform, name: String(item.name), sessionPartition: item.sessionPartition, createdAt: item.createdAt || new Date().toISOString(), lastOpenedAt: item.lastOpenedAt || null, url: item.url });
      added++;
    }
    this.save();
    return added;
  }
}

module.exports = AccountManager;
