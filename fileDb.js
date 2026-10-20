/* ---- ConflictError：寫入前發現檔案已被別人改過（version 不同）；與 AI-Thermal 的 fileDb 同名 ---- */
class ConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConflictError';
  }
}
window.ConflictError = ConflictError;

let fileHandle = null;
let dbCache = {};
let dbCorrupted = false;     // 壞檔唯讀保護：JSON 解析失敗時禁止一切寫入
let lastReadProjects = 0;    // 上次成功讀檔時的 projects 筆數（歸零保險絲基準）
let sawRealData = false;     // 本 session 是否曾持有實際資料（區分「全新空庫」vs「截斷成空檔」）
let currentVersion = 0;      // 上次讀到／寫入的 version（寫入前與磁碟比對：不同＝別人寫過這個檔）
function _fdbClone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }   // 讀寫用複本

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
    if (typeof window.showOpenFilePicker !== 'function') return { success: false, reason: 'unsupported' };
    try {
      const [picked] = await window.showOpenFilePicker({
        types: [{ description: 'JSON Database', accept: { 'application/json': ['.json'] } }],
        multiple: false
      });
      // 挑檔只給讀取權；趁還在同一次點擊裡先要寫入權（拿不到也照常開啟，存檔時瀏覽器會再問一次）
      try { if (picked.requestPermission) await picked.requestPermission({ mode: 'readwrite' }); } catch (e) {}
      // 換檔：上一份檔案的狀態不可沿用（壞檔旗標、歸零保險絲基準）；新檔讀不懂 → 整個退回上一份
      const prev = { fileHandle, dbCache, dbCorrupted, lastReadProjects, sawRealData, currentVersion };
      fileHandle = picked;
      dbCorrupted = false;
      lastReadProjects = 0;
      sawRealData = false;
      currentVersion = 0;
      try { await this._readFile(); }
      catch (e) { ({ fileHandle, dbCache, dbCorrupted, lastReadProjects, sawRealData, currentVersion } = prev); throw e; }
      if (dbCorrupted) {
        ({ fileHandle, dbCache, dbCorrupted, lastReadProjects, sawRealData, currentVersion } = prev);
        return { success: false, reason: 'corrupt', filename: picked.name };
      }
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
      dbCache = { version: Date.now(), rf_library: {}, digital_library: {}, pwr_library: {}, projects: {} };
      currentVersion = dbCache.version;
      dbCorrupted = false;
      lastReadProjects = 0;   // 全新檔案 → 重設保險絲基準
      sawRealData = false;
      await this._writeFileRaw();   // 使用者選了「另存新檔」：照寫，不比對磁碟上原本的內容
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

  /** 重新讀磁碟上的檔案（另一個工具可能剛寫過同一個檔） */
  async refresh() {
    this._assertReady();
    await this._readFile();
  },

  // 讀寫一律用複本（與 graphDb 同一套理由：活參照會讓畫面上的試改直接改到快取）
  async getDoc(colName, docId) {
    this._assertReady();
    return _fdbClone(dbCache[colName]?.[docId] ?? null);
  },

  async setDoc(colName, docId, data) {
    this._assertReady();
    const copy = _fdbClone(data);
    await this._withOptimisticWrite((cache) => {
      if (!cache[colName]) cache[colName] = {};
      cache[colName][docId] = copy;
    });
  },

  // fields 可以是函式：在目前（最新）的 doc 上計算要寫的欄位（三方合併用，見 compMerge.js）；
  // 版本衝突重讀後會在最新內容上重算一次。先算完才動快取：算的途中丟例外 → 快取不變、不寫入。
  async updateDoc(colName, docId, fields) {
    this._assertReady();
    await this._withOptimisticWrite((cache) => {
      const existing = (cache[colName] || {})[docId];
      const f = _fdbClone(typeof fields === 'function' ? fields(existing ? _fdbClone(existing) : null) : fields);
      if (!cache[colName]) cache[colName] = {};
      cache[colName][docId] = { ...(existing ?? {}), ...f };
    });
  },

  async deleteDoc(colName, docId) {
    this._assertReady();
    // 使用者刻意刪除專案（含最後一筆）是合法操作 → 放行並同步保險絲基準
    await this._withOptimisticWrite((cache) => {
      if (cache[colName] && cache[colName][docId] !== undefined) {
        delete cache[colName][docId];
        return {};
      }
      return { skipWrite: true };   // 已不存在（可能別人先刪了）→ 不需寫
    }, { allowEmptyProjects: colName === 'projects' });
    if (colName === 'projects') {
      lastReadProjects = Object.keys(dbCache.projects || {}).length;   // 刪除後磁碟即此筆數
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

  // 整份快取（唯讀！還原資料庫的比對畫面用，呼叫端不可修改）
  peekCache() { return dbCache; },

  // 還原資料庫（dbAdapter.restoreBackup）：先重讀磁碟（另一個工具可能剛寫過），在最新內容上套用 mutateFn 再寫回。
  // 寫入仍走 _writeFile → _assertWritable（壞檔唯讀、projects 歸零保險絲照樣生效）；版本衝突 → 在最新內容上重算。
  async mutateWholeDb(mutateFn) {
    this._assertReady();
    await this._readFile();
    if (dbCorrupted) this._assertWritable(false);   // 讀到壞檔 → 直接丟唯讀錯誤，不動快取
    let prev = null;
    try {
      await this._withOptimisticWrite(() => {
        const next = _fdbClone(dbCache);
        mutateFn(next);                              // 先算完再換快取：算的途中丟例外 → 快取不變
        prev = dbCache;
        dbCache = next;
      });
    } catch (e) {
      // 沒寫成功 → 快取退回還原前的內容（不可留著一份沒寫進檔案的還原結果，下一次存檔會把它整份寫出去）。
      // 版本衝突用盡重試時，_writeFile 已換成磁碟上的最新內容 → 不退回。
      if (prev && !(e instanceof ConflictError)) dbCache = prev;
      throw e;
    }
    lastReadProjects = Object.keys(dbCache.projects || {}).length;
  },

  exportBackup(tag) {
    const blob = new Blob([JSON.stringify(dbCache, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `thermal_db_backup_${new Date().toISOString().slice(0,10)}${tag ? '_' + tag : ''}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  },

  async _readFile() {
    const file = await fileHandle.getFile();
    this._adoptText(await file.text());
  },

  /* 採用磁碟上的內容（_readFile 與寫入前發現版本不同時共用）。
     回傳 false＝壞檔／截斷 → 已進唯讀保護、保留舊快取。 */
  _adoptText(text) {
    let parsed;
    if (text.trim() === '') {
      if (sawRealData) {
        // 先前已持有實際資料、現在卻讀到空檔 → 截斷異常，保留舊快取進唯讀，不可 bootstrap 後寫回。
        dbCorrupted = true;
        console.error('[fileDb] 讀到空檔但先前已有資料 → 截斷疑慮，進入唯讀保護');
        return false;
      }
      // 真正的全新空檔（首次建庫）→ bootstrap 空骨架
      parsed = { rf_library: {}, digital_library: {}, pwr_library: {}, projects: {} };
    } else {
      try { parsed = JSON.parse(text); } catch (e) { parsed = null; }
      if (!(parsed && typeof parsed === 'object' && !Array.isArray(parsed))) {
        // 壞檔（非法 JSON / 非物件）→ 保留舊快取、進入唯讀保護。
        // 絕不可 fallback 成空骨架，否則下一次寫入會把整份共用 DB 抹掉。
        dbCorrupted = true;
        console.error('[fileDb] 資料庫檔案解析失敗 → 唯讀保護模式（保留先前快取，禁止寫入）');
        return false;
      }
    }
    dbCache = parsed;
    dbCorrupted = false;
    // 沒有 version 的舊檔當成 0（不在讀檔時寫回補 version：開一份備份檔來看不該改到它；第一次存檔時才戳上）
    currentVersion = parsed.version || 0;
    // 記錄這次讀到的 projects 筆數作為歸零保險絲基準（反映磁碟現況，非 session 高水位）。
    lastReadProjects = Object.keys((dbCache && dbCache.projects) || {}).length;
    if (lastReadProjects > 0) sawRealData = true;
    return true;
  },

  /* 寫入前安全檢查：壞檔唯讀 + projects 突然歸零保險絲 */
  _assertWritable(allowEmptyProjects) {
    if (dbCorrupted) {
      throw new Error('資料庫檔案損毀（JSON 解析失敗），已進入唯讀保護模式，本次寫入已擋下以免覆蓋共用資料庫。請檢查/還原資料庫檔案（或先用「備份」匯出快取），修復後重新整理頁面。');
    }
    if (!allowEmptyProjects) {
      const n = Object.keys((dbCache && dbCache.projects) || {}).length;
      // 上次讀檔有 projects、現在卻要寫入 0 筆 → 記憶體異常丟失，擋下。
      if (n === 0 && lastReadProjects > 0) {
        throw new Error('安全保護：projects 集合由 ' + lastReadProjects + ' 筆突然變成 0 筆，寫入已擋下以免抹除共用資料庫。請先檢查資料庫檔案；若確認為正常狀態，重新整理頁面即可解除。');
      }
    }
  },

  /* 檔案級樂觀並發（與 AI-Thermal 的 fileDb 同一套）：寫入前重讀磁碟比對 version。
     不同＝我們讀檔之後有人（另一個工具、另一個分頁）寫過這個檔 → 換成磁碟上的最新內容並丟 ConflictError，
     由 _withOptimisticWrite 在最新內容上重算後再寫（等同 SharePoint 的 If-Match／412）。
     每次寫入都遞增 version：AI-Thermal 的本機檔模式也靠它看出本工具寫過檔。
     ⚠ 不遞增 version 的寫入者（手動編輯檔案、還沒更新的舊版前端）偵測不到。 */
  async _writeFile(opts) {
    this._assertWritable(!!(opts && opts.allowEmptyProjects));
    const text = await (await fileHandle.getFile()).text();
    let disk = null;
    if (text.trim() !== '') { try { disk = JSON.parse(text); } catch (e) { disk = null; } }
    const usable = text.trim() === '' ? !sawRealData : !!(disk && typeof disk === 'object' && !Array.isArray(disk));
    if (!usable) {
      // 寫入前發現磁碟檔已損毀／被截斷 → 進入唯讀保護（保留快取），本次寫入擋下
      this._adoptText(text);
      this._assertWritable(false);
    }
    const diskVersion = (disk && disk.version) || 0;
    if (diskVersion !== currentVersion) {
      this._adoptText(text);
      throw new ConflictError('版本衝突：資料庫檔案在你讀取之後已被更新（可能是 AI-Thermal 或另一個分頁剛存檔）');
    }
    // 嚴格遞增（同一毫秒內連續寫入也不會撞號）
    const newVersion = Math.max(Date.now(), currentVersion + 1);
    dbCache.version = newVersion;
    await this._writeFileRaw();
    currentVersion = newVersion;
    if (Object.keys((dbCache && dbCache.projects) || {}).length > 0) sawRealData = true;
  },

  /** 不比對版本直接寫（只給 createFile 用） */
  async _writeFileRaw() {
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(dbCache, null, 2));
    await writable.close();
  },

  // 與 graphDb._withOptimisticWrite 同一個介面：在目前快取上套用 mutateFn 後寫檔；版本衝突
  // （_writeFile 已換成磁碟上的最新內容）→ 在最新內容上重跑 mutateFn 再寫，最多 4 次。
  // mutateFn(cache) 可：直接改 cache（預設要寫）；return {skipWrite:true} 不寫；return {value:x} 帶回傳值；throw → 原樣往外丟。
  async _withOptimisticWrite(mutateFn, opts) {
    const MAX = 4;
    for (let attempt = 0; ; attempt++) {
      const decision = mutateFn(dbCache) || {};
      if (decision.skipWrite) return decision.value;
      try {
        await this._writeFile(opts);
        return decision.value;
      } catch (e) {
        if (e instanceof ConflictError && attempt < MAX) continue;
        throw e;
      }
    }
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
