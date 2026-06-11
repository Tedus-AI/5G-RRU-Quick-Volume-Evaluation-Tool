let fileHandle = null;
let dbCache = {};
let dbCorrupted = false;     // 壞檔唯讀保護：JSON 解析失敗時禁止一切寫入
let maxProjectsSeen = 0;     // 本 session 看過的 projects 筆數高水位（歸零保險絲用）

const fileDb = {
  async openFile() {
    const savedHandle = await this._loadSavedHandle();
    if (savedHandle) {
      try {
        const permission = await savedHandle.requestPermission({ mode: 'readwrite' });
        if (permission === 'granted') {
          fileHandle = savedHandle;
          await this._readFile();
          return { success: true, filename: fileHandle.name };
        }
      } catch(e) {}
    }
    return await this.pickFile();
  },

  async pickFile() {
    try {
      [fileHandle] = await window.showOpenFilePicker({
        types: [{ description: 'JSON Database', accept: { 'application/json': ['.json'] } }],
        multiple: false
      });
      await this._readFile();
      await this._saveHandle(fileHandle);
      return { success: true, filename: fileHandle.name };
    } catch(e) {
      if (e.name === 'AbortError') return { success: false, reason: 'cancelled' };
      throw e;
    }
  },

  async createFile() {
    try {
      fileHandle = await window.showSaveFilePicker({
        suggestedName: 'thermal_db.json',
        types: [{ description: 'JSON Database', accept: { 'application/json': ['.json'] } }]
      });
      dbCache = { rf_library: {}, digital_library: {}, pwr_library: {}, projects: {} };
      dbCorrupted = false;
      maxProjectsSeen = 0;   // 全新檔案 → 重設保險絲基準
      await this._writeFile();
      await this._saveHandle(fileHandle);
      return { success: true, filename: fileHandle.name, isNew: true };
    } catch(e) {
      if (e.name === 'AbortError') return { success: false, reason: 'cancelled' };
      throw e;
    }
  },

  isReady() { return fileHandle !== null; },
  getFilename() { return fileHandle ? fileHandle.name : null; },

  /* 壞檔唯讀保護模式中？（UI 健康橫幅用） */
  isCorrupted() { return dbCorrupted; },

  async getCollection(colName) {
    this._assertReady();
    return dbCache[colName] ?? {};
  },

  async getDoc(colName, docId) {
    this._assertReady();
    return dbCache[colName]?.[docId] ?? null;
  },

  async setDoc(colName, docId, data) {
    this._assertReady();
    if (!dbCache[colName]) dbCache[colName] = {};
    dbCache[colName][docId] = data;
    await this._writeFile();
  },

  async updateDoc(colName, docId, fields) {
    this._assertReady();
    if (!dbCache[colName]) dbCache[colName] = {};
    const existing = dbCache[colName][docId] ?? {};
    dbCache[colName][docId] = { ...existing, ...fields };
    await this._writeFile();
  },

  async deleteDoc(colName, docId) {
    this._assertReady();
    if (dbCache[colName]) {
      delete dbCache[colName][docId];
      // 使用者刻意刪除專案（含最後一筆）是合法操作 → 放行並同步保險絲基準
      await this._writeFile({ allowEmptyProjects: colName === 'projects' });
      if (colName === 'projects') {
        maxProjectsSeen = Object.keys(dbCache.projects || {}).length;
      }
    }
  },

  async getProjectsSorted() {
    this._assertReady();
    const projects = dbCache['projects'] ?? {};
    return Object.entries(projects)
      .map(([id, data]) => ({ id, ...data }))
      .sort((a, b) => {
        const ta = a.meta?.timestamp ?? '';
        const tb = b.meta?.timestamp ?? '';
        return tb.localeCompare(ta);
      });
  },

  exportBackup() {
    const blob = new Blob([JSON.stringify(dbCache, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `thermal_db_backup_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  },

  async _readFile() {
    const file = await fileHandle.getFile();
    const text = await file.text();
    if (text.trim() === '') {
      // 全新空檔（首次建庫）才允許 bootstrap 空骨架
      dbCache = { rf_library: {}, digital_library: {}, pwr_library: {}, projects: {} };
      dbCorrupted = false;
    } else {
      let parsed = null;
      try { parsed = JSON.parse(text); } catch (e) { parsed = null; }
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        dbCache = parsed;
        dbCorrupted = false;
      } else {
        // 壞檔（非法 JSON / 非物件）→ 保留舊快取、進入唯讀保護。
        // 絕不可 fallback 成空骨架，否則下一次寫入會把整份共用 DB 抹掉。
        dbCorrupted = true;
        console.error('[fileDb] 資料庫檔案解析失敗 → 唯讀保護模式（保留先前快取，禁止寫入）');
      }
    }
    const n = Object.keys((dbCache && dbCache.projects) || {}).length;
    if (n > maxProjectsSeen) maxProjectsSeen = n;
  },

  /* 寫入前安全檢查：壞檔唯讀 + projects 突然歸零保險絲 */
  _assertWritable(allowEmptyProjects) {
    if (dbCorrupted) {
      throw new Error('資料庫檔案損毀（JSON 解析失敗），已進入唯讀保護模式，本次寫入已擋下以免覆蓋共用資料庫。請檢查/還原資料庫檔案（或先用「備份」匯出快取），修復後重新整理頁面。');
    }
    if (!allowEmptyProjects) {
      const n = Object.keys((dbCache && dbCache.projects) || {}).length;
      if (n === 0 && maxProjectsSeen > 0) {
        throw new Error('安全保護：projects 集合由 ' + maxProjectsSeen + ' 筆突然變成 0 筆，寫入已擋下以免抹除共用資料庫。請先檢查資料庫檔案；若確認為正常狀態，重新整理頁面即可解除。');
      }
    }
  },

  async _writeFile(opts) {
    this._assertWritable(!!(opts && opts.allowEmptyProjects));
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(dbCache, null, 2));
    await writable.close();
  },

  _assertReady() {
    if (!fileHandle) throw new Error('[fileDb] 尚未開啟資料庫');
  },

  async _saveHandle(handle) {
    try {
      const idb = await this._openIdb();
      const tx = idb.transaction('handles', 'readwrite');
      tx.objectStore('handles').put(handle, 'thermal_db');
    } catch(e) {}
  },

  async _loadSavedHandle() {
    try {
      const idb = await this._openIdb();
      return await new Promise((resolve) => {
        const tx = idb.transaction('handles', 'readonly');
        const req = tx.objectStore('handles').get('thermal_db');
        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror = () => resolve(null);
      });
    } catch { return null; }
  },

  async _openIdb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('fileDbMeta_volumeEval', 1);
      req.onupgradeneeded = e => e.target.result.createObjectStore('handles');
      req.onsuccess = e => resolve(e.target.result);
      req.onerror = reject;
    });
  }
};

window.fileDb = fileDb;
