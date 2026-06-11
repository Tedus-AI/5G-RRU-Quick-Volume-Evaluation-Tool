(function () {
/* ---- LockError ---- */
class LockError extends Error {
  constructor(lockInfo) {
    super(`資料庫已被 ${lockInfo.lockedBy} 鎖定`);
    this.name = 'LockError';
    this.lockedBy = lockInfo.lockedBy;
    this.lockedByEmail = lockInfo.lockedByEmail;
    this.lockedAt = lockInfo.lockedAt;
    this.expiresAt = lockInfo.expiresAt;
  }
}
window.LockError = LockError;

/* ---- Module state (scoped to this IIFE) ---- */
let msalInstance = null;
let msalAccount = null;
let dbCache = {};
let driveItemId = null;
let _siteId = null;
let currentLock = null;
let dbCorrupted = false;     // 壞檔唯讀保護：JSON 解析失敗時禁止一切寫入
let maxProjectsSeen = 0;     // 本 session 看過的 projects 筆數高水位（歸零保險絲用）

const graphDb = {
  /* ─── MSAL Initialization ─────────────────────────────── */
  async initMsal() {
    if (msalInstance) return;

    const msalConfig = {
      auth: {
        clientId: SHAREPOINT_CONFIG.clientId,
        authority: SHAREPOINT_CONFIG.authority,
        redirectUri: SHAREPOINT_CONFIG.redirectUri
      },
      cache: {
        cacheLocation: 'localStorage',
        storeAuthStateInCookie: false
      }
    };

    msalInstance = new msal.PublicClientApplication(msalConfig);
    await msalInstance.initialize();

    try {
      const response = await msalInstance.handleRedirectPromise();
      if (response) {
        msalAccount = response.account;
      }
    } catch (e) {
      console.warn('[graphDb] handleRedirectPromise failed:', e);
    }

    if (!msalAccount) {
      const accounts = msalInstance.getAllAccounts();
      if (accounts.length > 0) msalAccount = accounts[0];
    }
  },

  /* ─── Authentication ──────────────────────────────────── */
  async signIn() {
    if (!msalInstance) await this.initMsal();
    try {
      const response = await msalInstance.loginPopup({
        scopes: SHAREPOINT_CONFIG.scopes,
        prompt: 'select_account'
      });
      msalAccount = response.account;
      return { success: true, account: msalAccount };
    } catch (e) {
      if (e.errorCode === 'user_cancelled' || e.errorCode === 'popup_window_error') {
        return { success: false, reason: 'cancelled' };
      }
      throw e;
    }
  },

  async signOut() {
    if (!msalInstance) return;
    try {
      await msalInstance.logoutPopup({ account: msalAccount });
    } catch (e) {
      console.warn('[graphDb] logout failed:', e);
    }
    msalAccount = null;
    dbCache = {};
    driveItemId = null;
    _siteId = null;
    currentLock = null;
    dbCorrupted = false;
  },

  isSignedIn() {
    return msalAccount !== null;
  },

  getAccountInfo() {
    if (!msalAccount) return null;
    return { name: msalAccount.name, email: msalAccount.username };
  },

  async _getAccessToken(allowInteractive = true) {
    if (!msalAccount) throw new Error('尚未登入 SharePoint');
    try {
      const response = await msalInstance.acquireTokenSilent({
        scopes: SHAREPOINT_CONFIG.scopes,
        account: msalAccount
      });
      return response.accessToken;
    } catch (e) {
      if (!allowInteractive) throw e;
      const response = await msalInstance.acquireTokenPopup({
        scopes: SHAREPOINT_CONFIG.scopes
      });
      msalAccount = response.account;
      return response.accessToken;
    }
  },

  /* ─── Graph API Helpers ───────────────────────────────── */
  async _graphGet(url, allowInteractive = true) {
    const token = await this._getAccessToken(allowInteractive);
    const resp = await fetch(url, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      throw new Error(`Graph API GET failed: ${resp.status} ${resp.statusText} — ${errText}`);
    }
    return resp;
  },

  async _graphPut(url, body, contentType = 'application/json') {
    const token = await this._getAccessToken(true);
    const resp = await fetch(url, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': contentType
      },
      body: body
    });
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      throw new Error(`Graph API PUT failed: ${resp.status} ${resp.statusText} — ${errText}`);
    }
    return resp;
  },

  /* ─── Site/Drive Resolution & File I/O ────────────────── */
  async _resolveDriveItemId() {
    if (driveItemId && _siteId) return driveItemId;

    const siteResp = await this._graphGet(
      `https://graph.microsoft.com/v1.0/sites/${SHAREPOINT_CONFIG.siteHostname}:${SHAREPOINT_CONFIG.sitePath}`
    );
    const site = await siteResp.json();
    _siteId = site.id;

    const itemResp = await this._graphGet(
      `https://graph.microsoft.com/v1.0/sites/${_siteId}/drive/root:${SHAREPOINT_CONFIG.filePath}`
    );
    const item = await itemResp.json();
    driveItemId = item.id;

    return driveItemId;
  },

  async _readFile() {
    await this._resolveDriveItemId();
    const resp = await this._graphGet(
      `https://graph.microsoft.com/v1.0/sites/${_siteId}/drive/items/${driveItemId}/content`
    );
    const text = await resp.text();
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
        console.error('[graphDb] thermal_db.json 解析失敗 → 唯讀保護模式（保留先前快取，禁止寫入）');
      }
    }
    const n = Object.keys((dbCache && dbCache.projects) || {}).length;
    if (n > maxProjectsSeen) maxProjectsSeen = n;
  },

  /* 寫入前安全檢查：壞檔唯讀 + projects 突然歸零保險絲 */
  _assertWritable(allowEmptyProjects) {
    if (dbCorrupted) {
      throw new Error('資料庫檔案損毀（JSON 解析失敗），已進入唯讀保護模式，本次寫入已擋下以免覆蓋共用資料庫。請至 SharePoint 檢查 thermal_db.json（文件庫「版本歷史」可還原），修復後重新整理頁面。');
    }
    if (!allowEmptyProjects) {
      const n = Object.keys((dbCache && dbCache.projects) || {}).length;
      if (n === 0 && maxProjectsSeen > 0) {
        throw new Error('安全保護：projects 集合由 ' + maxProjectsSeen + ' 筆突然變成 0 筆，寫入已擋下以免抹除共用資料庫。請先至 SharePoint 檢查 thermal_db.json（可用版本歷史還原）；若確認為正常狀態，重新整理頁面即可解除。');
      }
    }
  },

  async _writeFile(opts) {
    this._assertWritable(!!(opts && opts.allowEmptyProjects));
    await this._resolveDriveItemId();
    const body = JSON.stringify(dbCache, null, 2);
    await this._graphPut(
      `https://graph.microsoft.com/v1.0/sites/${_siteId}/drive/items/${driveItemId}/content`,
      body,
      'application/json'
    );
  },

  /* ─── Pessimistic Locking ─────────────────────────────── */
  async acquireLock() {
    if (!msalAccount) throw new Error('尚未登入 SharePoint');

    await this._readFile();

    const now = new Date();
    const existingLock = dbCache.lock;

    if (existingLock && existingLock.lockedByEmail && existingLock.lockedByEmail !== msalAccount.username) {
      const expiresAt = new Date(existingLock.expiresAt);
      if (expiresAt > now) {
        throw new LockError(existingLock);
      }
    }

    const expiresAt = new Date(now.getTime() + SHAREPOINT_CONFIG.lockTimeoutMinutes * 60 * 1000);
    dbCache.lock = {
      lockedBy: msalAccount.name,
      lockedByEmail: msalAccount.username,
      lockedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString()
    };
    await this._writeFile();
    currentLock = dbCache.lock;
    return currentLock;
  },

  async releaseLock() {
    if (!currentLock || !msalAccount) {
      currentLock = null;
      return;
    }
    try {
      if (dbCache.lock && dbCache.lock.lockedByEmail === msalAccount.username) {
        delete dbCache.lock;
        await this._writeFile();
      }
    } catch (e) {
      console.warn('[graphDb] releaseLock failed:', e);
    }
    currentLock = null;
  },

  hasLock() {
    return currentLock !== null;
  },

  /* 目前 dbCache 內的鎖資訊（不重新讀檔，純記憶體） */
  getLockInfo() {
    return dbCache.lock || null;
  },

  /* 重新讀檔以取得最新鎖狀態（供置頂佔用橫幅輪詢用） */
  async peekLock() {
    await this._readFile();
    return dbCache.lock || null;
  },

  /* ─── Collection/Document API (mirrors fileDb) ────────── */
  async openFile() {
    if (!msalInstance) await this.initMsal();
    if (!msalAccount) {
      const result = await this.signIn();
      if (!result.success) return result;
    }
    await this._readFile();
    return { success: true, filename: 'thermal_db.json (SharePoint)' };
  },

  async refresh() {
    await this._readFile();
  },

  isReady() {
    return msalAccount !== null && Object.keys(dbCache).length > 0;
  },

  /* 壞檔唯讀保護模式中？（UI 健康橫幅用） */
  isCorrupted() {
    return dbCorrupted;
  },

  getFilename() {
    return 'thermal_db.json (SharePoint)';
  },

  async getCollection(colName) {
    return dbCache[colName] ?? {};
  },

  async getDoc(colName, docId) {
    return dbCache[colName]?.[docId] ?? null;
  },

  async setDoc(colName, docId, data) {
    if (!dbCache[colName]) dbCache[colName] = {};
    dbCache[colName][docId] = data;
    await this._writeFile();
  },

  async updateDoc(colName, docId, fields) {
    if (!dbCache[colName]) dbCache[colName] = {};
    const existing = dbCache[colName][docId] ?? {};
    dbCache[colName][docId] = { ...existing, ...fields };
    await this._writeFile();
  },

  async deleteDoc(colName, docId) {
    if (dbCache[colName] && dbCache[colName][docId] !== undefined) {
      delete dbCache[colName][docId];
      // 使用者刻意刪除專案（含最後一筆）是合法操作 → 放行並同步保險絲基準
      await this._writeFile({ allowEmptyProjects: colName === 'projects' });
      if (colName === 'projects') {
        maxProjectsSeen = Object.keys(dbCache.projects || {}).length;
      }
    }
  },

  async getProjectsSorted() {
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
    a.download = `thermal_db_backup_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }
};

window.graphDb = graphDb;
})();
