// dbAdapter.js — unified database entry point
// DB_MODE is defined in config.js (loaded before this file)

const dbAdapter = {
  // 離線資料庫：不在公司／連不到 SharePoint 時，改讀寫一份本機的資料庫 JSON（例如備份檔）。
  // 執行期切換（DB_MODE 仍是 'sharepoint'）；開了就走 fileDb，所有「SharePoint 模式」的判斷都視為否
  // （沒有共用編輯鎖、存檔前先重讀磁碟）。按「登入 SharePoint」成功後切回。
  _offline: false,
  setOffline(on) { this._offline = !!on; },
  isOffline() { return this._offline; },

  _backend() {
    return this.isSharePointMode() ? graphDb : fileDb;
  },

  isSharePointMode() {
    return DB_MODE === 'sharepoint' && !this._offline;
  },

  async init() {
    if (DB_MODE === 'sharepoint') {
      await graphDb.initMsal();
      if (graphDb.isSignedIn()) {
        try {
          await graphDb._readFile();
          return { success: true, filename: graphDb.getFilename() };
        } catch (e) {
          console.warn('[dbAdapter] auto-read failed:', e);
          return { success: false, reason: 'read_failed', error: e };
        }
      }
      return { success: false, reason: 'not_signed_in' };
    }
    return await fileDb.openFile();
  },

  isReady() {
    return this._backend().isReady();
  },

  /* 壞檔唯讀保護模式中？（資料庫檔案解析失敗時為 true，所有寫入會被擋下） */
  isCorrupted() {
    const b = this._backend();
    return typeof b.isCorrupted === 'function' ? b.isCorrupted() : false;
  },

  getDbInfo() {
    if (this.isSharePointMode()) {
      const acct = graphDb.getAccountInfo();
      if (acct) return `SharePoint ｜ ${acct.name} (${acct.email})`;
      return 'SharePoint ｜ 未登入';
    }
    return `本機資料庫 ｜ ${fileDb.getFilename() ?? '未開啟'}`;
  },

  async refresh() {
    return await this._backend().refresh();
  },

  async getCollection(colName) {
    return await this._backend().getCollection(colName);
  },

  async getDoc(colName, docId) {
    return await this._backend().getDoc(colName, docId);
  },

  async setDoc(colName, docId, data) {
    return await this._backend().setDoc(colName, docId, data);
  },

  async updateDoc(colName, docId, fields) {
    return await this._backend().updateDoc(colName, docId, fields);
  },

  async deleteDoc(colName, docId) {
    return await this._backend().deleteDoc(colName, docId);
  },

  async getProjectsSorted() {
    return await this._backend().getProjectsSorted();
  },

  async pickFile() {
    if (this.isSharePointMode()) return await graphDb.openFile();
    return await fileDb.pickFile();
  },

  exportBackup(tag) {
    this._backend().exportBackup(tag);
  },

  /* ─── 還原資料庫（從「💾 備份資料庫」下載的 JSON）───────────
     plan.mode：
       'select' → 只覆蓋勾選的專案（plan.projects：id 陣列）與整個集合（plan.collections：頂層 key 陣列），其餘不動；
       'full'   → 資料庫整份變成備份的內容（備份裡沒有的專案／集合會被刪掉）。
     兩種模式都不碰 RESTORE_KEEP（編輯鎖是「現在誰在用」、version 是現在的計數），
     寫入都在「寫入當下的最新內容」上重算（SharePoint 412 會重讀重算）。 */
  RESTORE_KEEP: ['lock', 'version'],

  restorePlanApply(cache, backup, plan) {
    const keep = this.RESTORE_KEEP;
    const clone = v => (v == null ? v : JSON.parse(JSON.stringify(v)));
    if (plan.mode === 'full') {
      Object.keys(cache).forEach(k => { if (!keep.includes(k)) delete cache[k]; });
      Object.keys(backup).forEach(k => { if (!keep.includes(k)) cache[k] = clone(backup[k]); });
      if (!cache.projects || typeof cache.projects !== 'object') cache.projects = {};
      return cache;
    }
    (plan.projects || []).forEach(id => {
      const d = backup.projects && backup.projects[id];
      if (!d) return;
      if (!cache.projects || typeof cache.projects !== 'object') cache.projects = {};
      cache.projects[id] = clone(d);
    });
    (plan.collections || []).forEach(k => {
      if (k === 'projects' || keep.includes(k) || !(k in backup)) return;
      cache[k] = clone(backup[k]);
    });
    return cache;
  },

  /* 目前資料庫的整份內容（複本，還原比對用） */
  peekDb() {
    const b = this._backend();
    return typeof b.peekCache === 'function' ? JSON.parse(JSON.stringify(b.peekCache() || {})) : {};
  },

  async restoreBackup(backup, plan) {
    const b = this._backend();
    if (typeof b.mutateWholeDb !== 'function') throw new Error('目前的資料庫後端不支援還原');
    await b.mutateWholeDb(cache => this.restorePlanApply(cache, backup, plan));
  },

  /* ─── Auth methods (SharePoint mode) ─────────────────── */
  async signIn() {
    if (DB_MODE !== 'sharepoint') return { success: true };
    return await graphDb.signIn();
  },

  async signOut() {
    if (DB_MODE !== 'sharepoint') return;
    return await graphDb.signOut();
  },

  isSignedIn() {
    if (DB_MODE !== 'sharepoint') return true;
    return graphDb.isSignedIn();
  },

  getAccountInfo() {
    if (DB_MODE !== 'sharepoint') return null;
    return graphDb.getAccountInfo();
  },

  /* ─── Pessimistic lock methods ────────────────────────── */
  async acquireLock() {
    if (!this.isSharePointMode()) return null;
    return await graphDb.acquireLock();
  },

  async releaseLock() {
    if (!this.isSharePointMode()) return;
    return await graphDb.releaseLock();
  },

  hasLock() {
    if (!this.isSharePointMode()) return true;
    return graphDb.hasLock();
  },

  getLockInfo() {
    if (!this.isSharePointMode()) return null;
    return graphDb.getLockInfo();
  },

  async peekLock() {
    if (!this.isSharePointMode()) return null;
    return await graphDb.peekLock();
  }
};

window.dbAdapter = dbAdapter;
