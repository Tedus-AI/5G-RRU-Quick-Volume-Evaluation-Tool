/*
 * 本機檔／離線資料庫後端（fileDb.js）的樂觀並發 —— 與 AI-Thermal 的 fileDb 同一套（寫入前比對 version）。
 *
 * 以假的 FileSystemFileHandle 驅動「實際的 fileDb.js」（不需要瀏覽器）：
 *   [F1] 每次寫入都遞增 version（AI-Thermal 本機檔模式靠它看出本工具寫過檔）；讀檔不會改檔
 *   [F2] 讀檔後另一個工具寫過檔（version 變了）→ 換成磁碟最新內容、在上面重算後再寫 → 雙方修改都保留
 *   [F3] updateDoc 的 fields 是函式：衝突後在最新 doc 上重算（三方合併用）
 *   [F4] 一直衝突 → 重試上限後丟 ConflictError，不無限迴圈、不寫入
 *   [F5] 寫入前發現磁碟檔壞掉／被截斷 → 唯讀保護、不寫入、快取保留
 *   [F6] deleteDoc：衝突後發現已被別人刪掉 → 不再寫
 *   [F7] mutateWholeDb（還原資料庫）：衝突 → 在最新內容上重算；寫入失敗 → 快取退回還原前
 *   [F8] fields 函式丟例外 → 不寫入、快取不變
 *
 * 執行：node tests/filedb-version.test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

global.window = global;

/* ── 假的本機檔 ── */
const disk = {
  content: JSON.stringify({ rf_library: {}, digital_library: {}, pwr_library: {}, projects: { p1: { a: 1 } } }, null, 2),
  writes: 0,
  beforeWrite: null,   // 一次性 hook：我們讀完、寫入前，另一個工具先寫了
  beforeEveryRead: null,
  failWrite: false,
  db() { return JSON.parse(this.content); },
  external(mut, bump = true) {   // 另一個工具（AI-Thermal）的寫入：照它的規則遞增 version
    const d = this.db();
    mut(d);
    if (bump) d.version = Math.max(Date.now(), (d.version || 0) + 1);
    this.content = JSON.stringify(d, null, 2);
  },
};
const handle = {
  name: 'thermal_db.json',
  async requestPermission() { return 'granted'; },
  async getFile() {
    if (disk.beforeWrite && disk._armed) { const h = disk.beforeWrite; disk.beforeWrite = null; disk._armed = false; h(); }
    if (disk.beforeEveryRead) disk.beforeEveryRead();
    return { text: async () => disk.content };
  },
  async createWritable() {
    let buf = '';
    return {
      async write(s) { buf += s; },
      async close() {
        if (disk.failWrite) { const e = new Error('NotAllowedError: 使用者拒絕寫入'); e.name = 'NotAllowedError'; throw e; }
        disk.content = buf; disk.writes++;
      },
    };
  },
};

/* ── 載入實際的 fileDb.js（全域腳本：頂層 let 留在同一個 context） ── */
vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'fileDb.js'), 'utf8'));
const fileDb = global.fileDb;
fileDb._loadSavedHandle = async () => handle;

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS:', name); }
  else { fail++; console.log('  FAIL:', name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}
async function expectThrow(name, fn, predicate) {
  try { await fn(); check(name + '（應丟錯卻成功）', false); return null; }
  catch (e) { check(name, predicate(e), e && e.message); return e; }
}
// 下一次寫入「重讀磁碟比對 version」之前，先插入另一個工具的寫入
const interfere = (fn) => { disk.beforeWrite = fn; disk._armed = true; };

(async () => {
  console.log('[F1] 每次寫入都遞增 version；讀檔不會改檔');
  const r = await fileDb.openFile();
  check('開檔成功', r && r.success === true);
  check('讀檔沒有寫回（沒有 version 的舊檔也不補）', disk.writes === 0 && disk.db().version === undefined);
  await fileDb.setDoc('projects', 'p2', { b: 2 });
  const v1 = disk.db().version;
  await fileDb.updateDoc('projects', 'p2', { b: 3 });
  const v2 = disk.db().version;
  check('第一次寫入戳上 version', typeof v1 === 'number' && v1 > 0, v1);
  check('version 嚴格遞增', v2 > v1, { v1, v2 });
  check('內容正確', disk.db().projects.p2.b === 3 && disk.db().projects.p1.a === 1);

  console.log('[F2] 讀檔後另一個工具寫過檔 → 在最新內容上重算再寫，雙方修改都保留');
  interfere(() => disk.external(d => { d.projects.p1.theirs = 'AI-Thermal'; d.tim_library = { t1: { model: 'X' } }; }));
  let w0 = disk.writes;
  await fileDb.updateDoc('projects', 'p1', { mine: 'RRU' });
  let d = disk.db();
  check('對方在同一個專案寫的欄位保留', d.projects.p1.theirs === 'AI-Thermal');
  check('對方寫的其他集合保留', d.tim_library && d.tim_library.t1.model === 'X');
  check('我方欄位寫入', d.projects.p1.mine === 'RRU' && d.projects.p1.a === 1);
  check('只寫了一次（第一次在比對時就擋下，沒有蓋掉對方）', disk.writes === w0 + 1);

  console.log('[F3] updateDoc 的 fields 是函式：衝突後在最新 doc 上重算');
  let calls = 0;
  interfere(() => disk.external(d => { d.projects.p1.a = 5; }));
  await fileDb.updateDoc('projects', 'p1', (cur) => { calls++; return { derived: cur.a + 1 }; });
  check('函式跑了兩次', calls === 2, calls);
  check('寫入的是在最新內容上重算的結果（5+1=6）', disk.db().projects.p1.derived === 6);

  console.log('[F4] 一直衝突 → 重試上限後丟 ConflictError');
  disk.beforeEveryRead = () => disk.external(d => { d.projects.p1.spin = (d.projects.p1.spin || 0) + 1; });
  w0 = disk.writes;
  await expectThrow('丟 ConflictError', () => fileDb.setDoc('projects', 'pX', { x: 1 }), e => e && e.name === 'ConflictError');
  disk.beforeEveryRead = null;
  check('沒有寫入', disk.writes === w0 && disk.db().projects.pX === undefined);
  check('window.ConflictError 存在（存檔流程用來判斷）', typeof window.ConflictError === 'function');

  console.log('[F5] 寫入前發現磁碟檔壞掉／被截斷 → 唯讀保護');
  await fileDb.refresh();
  const good = disk.content;
  disk.content = '{ broken json';
  w0 = disk.writes;
  await expectThrow('壞檔 → 寫入被擋', () => fileDb.setDoc('projects', 'pB', {}), e => /唯讀保護/.test(e.message));
  check('進入唯讀保護、沒有寫入', fileDb.isCorrupted() === true && disk.writes === w0);
  check('快取保留原本的內容', !!(await fileDb.getDoc('projects', 'p1')));
  disk.content = good;
  await fileDb.refresh();
  check('檔案修好後重讀 → 解除', fileDb.isCorrupted() === false);
  disk.content = '';
  await expectThrow('截斷成空檔 → 寫入被擋', () => fileDb.setDoc('projects', 'pE', {}), e => /唯讀保護/.test(e.message));
  check('沒有用空骨架蓋掉檔案', disk.content === '' && disk.writes === w0);
  disk.content = good;
  await fileDb.refresh();

  console.log('[F6] deleteDoc：衝突後發現已被別人刪掉 → 不再寫');
  await fileDb.setDoc('projects', 'pDel', { z: 1 });
  interfere(() => disk.external(d => { delete d.projects.pDel; }));
  w0 = disk.writes;
  await fileDb.deleteDoc('projects', 'pDel');
  check('沒有多寫一次', disk.writes === w0);
  check('pDel 不存在、其他專案完整', disk.db().projects.pDel === undefined && !!disk.db().projects.p1);

  console.log('[F7] mutateWholeDb：衝突 → 在最新內容上重算；寫入失敗 → 快取退回還原前');
  disk.beforeWrite = null;
  // mutateWholeDb 自己會先重讀一次 → 第二次讀（寫入前比對）才插入對方的寫入
  let reads = 0;
  disk.beforeEveryRead = () => { if (++reads === 2) disk.external(d => { d.projects.pOther = { o: 1 }; }); };
  await fileDb.mutateWholeDb(c => { c.projects.pRestored = { r: 1 }; });
  disk.beforeEveryRead = null;
  d = disk.db();
  check('還原的專案寫入', d.projects.pRestored && d.projects.pRestored.r === 1);
  check('對方同時寫的專案保留', d.projects.pOther && d.projects.pOther.o === 1);
  disk.failWrite = true;
  await expectThrow('寫入失敗原樣丟出', () => fileDb.mutateWholeDb(c => { c.projects.pGhost = { g: 1 }; }), e => e.name === 'NotAllowedError');
  disk.failWrite = false;
  check('快取不留沒寫進檔案的還原結果', (await fileDb.getDoc('projects', 'pGhost')) === null);

  console.log('[F8] fields 函式丟例外 → 不寫入、快取不變');
  w0 = disk.writes;
  const before = JSON.stringify(await fileDb.getDoc('projects', 'p1'));
  await expectThrow('例外原樣丟出', () => fileDb.updateDoc('projects', 'p1',
    () => { const e = new Error('pending'); e.name = 'MergePending'; throw e; }), e => e.name === 'MergePending');
  check('沒有寫入、快取不變', disk.writes === w0 && JSON.stringify(await fileDb.getDoc('projects', 'p1')) === before);

  console.log(`\n結果：${pass} pass / ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('UNEXPECTED:', e); process.exit(1); });
