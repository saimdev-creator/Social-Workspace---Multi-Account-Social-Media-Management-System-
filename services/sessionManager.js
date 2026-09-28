const { session } = require('electron');

class SessionManager {
  async clear(partition) {
    if (!partition || !partition.startsWith('persist:')) throw new Error('Invalid session partition.');
    await session.fromPartition(partition).clearStorageData();
    await session.fromPartition(partition).clearCache();
  }
}

module.exports = SessionManager;