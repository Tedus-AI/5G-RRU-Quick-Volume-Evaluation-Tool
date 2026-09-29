/*
 * 3D 模擬視圖（viewer3d.js）接進工具 —— headless 驗證
 * ---------------------------------------------------------------------------
 * 原本的 3D 頁是 Plotly 方塊（電子艙＋基板＋鰭片）加一段「AI 寫實渲染」提示詞流程。改成寫實 3D 模型：
 * 外殼、腔體濾波器、屏蔽罩、PCB、元件、基板凹槽與補肉、分模面螺絲柱、防水膠條，全部由參數控制台與元件設定產生；
 * 使用者在 3D 頁的調整（橫向位置、轉向、I/O、天線座、屏蔽罩）存成專案的 layout3d，元件相對高度直接寫回元件設定。
 *
 * 驗證情境：
 *   [A] 版面：Plotly 方塊與 AI 渲染流程拿掉；檢視器掛進 #tab3-3d；工具列有「下載目前畫面」「輸出 PDF」
 *   [B] 單一事實來源：3D 用的長寬高、鰭片數／高、體積＝computeAll；建出來的鰭片沿「長」、排在「寬」範圍內
 *   [C] 擋下計算：Tab3 顯示跟其他頁同一份 calcGateHtml，不畫 3D
 *   [D] 元件相對高度在 3D 改＝寫回元件設定 Height(mm)＋重算；狀態列與專案都標成未存
 *   [E] 橫向位置 → layout3d（以 _cid 為 key）；存檔寫進 DB、換專案不沿用、重新載入還原；元件改名後照樣對得上
 *   [F] 複製專案、匯出／匯入本機檔都帶著 layout3d
 *   [G] 切到別的分頁：取消選取、方向鍵不會動到 3D；有未存的修改（含 3D 調整）離開頁面會提醒
 *   [H] PDF 報告第 6 節：3D 圖由檢視器在畫面外渲染（JPEG），不改使用者目前的視角與顯示方式
 *   [I] 3D 頁的「輸出 PDF」（兩頁 A4）與「下載目前畫面」（PNG）在工具裡是一般下載
 *   [J] 版面：3D 頁自動收合參數控制台；並排門檻依 3D 頁本身的寬度；尺寸標註不被工具列／視角方塊蓋住；
 *       畫面大小變了、還沒動過視角 → 自動重新對焦（自己縮放過就不動）
 *   [L] Die-casting 鰭片：梯形斷面（根部 T_root、鰭尖 Fin_t）、節距＝Fin_t＋Gap、整排在散熱器寬度內
 *   [M] 補肉疊在鰭片上：鰭片一律從基板長到鰭尖（跨在補肉邊緣的也不截短），只有穿過凹槽的那段從凹槽頂往上長
 *   [N] 工具列「視窗」組：全螢幕（整頁進瀏覽器全螢幕、只剩 3D 檢視器，照樣重畫）、儲存（沒解除資料庫保護 → 頁內密碼小視窗，
 *       解除後接著存；訊息在畫面內提示，不跳原生對話框）；右下角專案名稱；部件可複選；部件沿長邊中心軸翻轉 180°
 *   [O] 翻轉交叉測試：組裝／爆炸（含直立）× 15 種部件組合＝整組剛體翻、攤開＝各自原地翻；翻轉途中剛體；隨機切換序列不留殘值；
 *       鰭片尺寸標註、剖面疊層、攤開標題、報告截圖、拖曳都跟著翻轉正確
 *   [P] 正交視圖左旋／右旋 90°（正視圖記住轉向、其他視角原地轉）；元件／I/O／天線座個別隱藏（👁、選取後隱藏、H 鍵、全部顯示、
 *       換專案清掉、不存檔）；專案名稱圓體字；I/O 分類（SFP／電源、Signal、Debug port）；FDD 通道配對（每一顆 Final PA 自帶一組
 *       Pre-driver／Driver／環形器：沒拆的列自動錯開、拆開的列照元件清單；各組高度不交錯 → 上下排、交錯 → 左右並排；自動錯開的只能左右拖、
 *       拖 PA 時跟著動；盲插／腔體每一路每一組、開關存 layout3d.pair）；同一個專案的元件／I/O 清單變了，側欄跟著重畫
 *   [Q] 元件預設轉向：Final PA／Driver 預設轉 90°（長邊橫跨訊號方向）、銅塊底板固定跟著板子；⟳／R＝跟預設方向差 90°（layout3d.turn）；
 *       舊版 layout3d.rot（絕對角度）載入時轉成 turn（PA／Driver 回到預設）、之後只寫 turn
 *   [K] 瀏覽器沒有 WebGL：工具照常可用、Tab3 顯示原因、沒有未攔截的錯誤
 *
 * 執行：
 *   npx http-server . -p 8123 -c-1 &      # 於 repo 根目錄
 *   THREE_DIR=/path/to/three node tests/viewer3d.test.js
 *     THREE_DIR：three@0.170.0 的本機副本（底下有 build/ 與 jsm/＝examples/jsm）；沒給就直接連 cdn.jsdelivr.net
 *     需要 WebGL：Chromium 以 SwiftShader 軟體繪圖（已加在啟動參數）
 */

let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const fs = require('fs'), path = require('path');

const BASE = process.env.TEST_URL || 'http://127.0.0.1:8123/index.html';
const EXEC = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const THREE_DIR = process.env.THREE_DIR || '';
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;

(async () => {
  const browser = await chromium.launch(Object.assign(EXEC ? { executablePath: EXEC } : {}, {
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    env: Object.assign({}, process.env, { LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' }) }));   // 沒設 locale 時 Chromium 會把中文下載檔名換成 download
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const root = BASE.replace(/index\.html$/, '');
  await page.route('**', r => {
    const u = r.request().url(), m = u.match(/cdn\.jsdelivr\.net\/npm\/three@0\.170\.0\/(build|examples\/jsm)\/(.+)$/);
    if (m && THREE_DIR) return r.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(path.join(THREE_DIR, m[1] === 'build' ? 'build' : 'jsm', m[2])) });
    if (m || u.startsWith(root)) return r.continue();
    return r.abort();
  });
  await page.addInitScript(() => {
    window.Plotly = { newPlot(){}, Plots:{resize(){}}, relayout(){}, purge(){}, toImage: async()=>'' };
    window.XLSX = { utils:{book_new:()=>({}),aoa_to_sheet:()=>({}),book_append_sheet(){}}, writeFile(){} };
    window.msal = { PublicClientApplication: class {
      async initialize(){} async handleRedirectPromise(){return null} getAllAccounts(){return []} } };
    window.__alerts = []; window.alert = m => window.__alerts.push(String(m));
    window.confirm = () => true;
  });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.fill('#login-pw', 'tedus');
  await page.click('#login-page button');
  await page.waitForFunction(() => typeof calcResults !== 'undefined' && calcResults && calcResults.rows.length > 0);
  await page.waitForFunction(() => !!window.RRU3D, null, { timeout: 90000 });
  const show3d = async () => {
    await page.evaluate(() => switchTab(3));
    await page.waitForFunction(() => window.RRU3D.dbg.P() && window.RRU3D.dbg.LAY() && !document.getElementById('tab3-3d').hidden, null, { timeout: 60000 });
    await page.waitForTimeout(600);
  };
  await show3d();
  // 模擬共用 DB（跟 project-load.test.js 同一種做法）
  await page.evaluate(() => {
    window.__db = { projects: {} }; window.__writes = [];
    fbOk = true;
    dbAdapter.isReady = () => true;
    dbAdapter.getDoc = async (c, id) => (window.__db[c] || {})[id] || null;
    dbAdapter.getCollection = async (c) => window.__db[c] || {};
    dbAdapter.updateDoc = async (c, id, f) => {
      window.__db[c] = window.__db[c] || {};
      const cur = window.__db[c][id], ff = typeof f === 'function' ? f(cur ? JSON.parse(JSON.stringify(cur)) : null) : f;
      window.__writes.push({ c, id, f: JSON.parse(JSON.stringify(ff)) });
      window.__db[c][id] = Object.assign({}, cur || {}, JSON.parse(JSON.stringify(ff)));
    };
    dbAdapter.refresh = async () => {};
    dbAdapter.deleteDoc = async (c, id) => { delete (window.__db[c] || {})[id]; };
    dbAdapter.getProjectsSorted = async () => Object.entries(window.__db.projects).map(([id, d]) => Object.assign({ id }, d));
    _ensureLockBeforeWrite = async () => true;
  });

  console.log('\n[A] 版面：舊的 Plotly 方塊與 AI 渲染拿掉、檢視器掛進 Tab3');
  const a = await page.evaluate(() => ({
    old: ['tab3-info', 'tab3-ai', 'ai-prompt', 'copy-status'].filter(id => document.getElementById(id)),
    copyFn: typeof copyPrompt, plotly3d: !!document.querySelector('#tab3 .js-plotly-plot'),
    mounted: !!document.querySelector('#tab3-3d > .r3d canvas#r3d-cv'),
    importmap: !!document.querySelector('script[type="importmap"]'),
    tools: [...document.querySelectorAll('#tab3 .r3d .tgrp .tbtn')].map(b => b.textContent.trim()),
    intro: document.body.innerHTML.includes('AI 寫實渲染'),
    idsPrefixed: [...document.querySelectorAll('#tab3 .r3d [id]')].every(el => el.id.startsWith('r3d-')),
    cssScoped: [...document.getElementById('r3d-css').sheet.cssRules].every(r => !r.selectorText || r.selectorText.split(',').every(s => s.trim().startsWith('.r3d'))),
  }));
  ok('舊的 3D 方塊與 AI 渲染流程都拿掉了（沒有 tab3-info／tab3-ai／提示詞／複製鈕）', !a.old.length && a.copyFn === 'undefined' && !a.plotly3d && !a.intro, a);
  ok('檢視器掛進 #tab3-3d（three.js 走 importmap）', a.mounted && a.importmap, a);
  ok('工具列有「📷 下載目前畫面」與「輸出 PDF」', a.tools.includes('📷 下載目前畫面') && a.tools.includes('輸出 PDF'), a.tools);
  ok('檢視器的 id 一律加 r3d- 前綴、樣式全部限定在 .r3d（不影響工具其他頁面）', a.idsPrefixed && a.cssScoped, a);

  console.log('\n[B] 單一事實來源：尺寸、鰭片、體積＝computeAll');
  const b = await page.evaluate(() => {
    const R = calcResults, P = RRU3D.dbg.P(), fins = RRU3D.dbg.HSK().userData.fins, zs = new Set();
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    fins.children.forEach(m => {
      m.geometry.computeBoundingBox(); const bb = m.geometry.boundingBox;
      const list = m.isInstancedMesh ? Array.from({ length: m.count }, (_, i) => m.instanceMatrix.array[i * 16 + 14]) : [m.position.z];
      list.forEach(z => { zs.add(Math.round(z * 100) / 100); z0 = Math.min(z0, z + bb.min.z); z1 = Math.max(z1, z + bb.max.z); });
      x0 = Math.min(x0, bb.min.x + (m.isInstancedMesh ? 0 : m.position.x)); x1 = Math.max(x1, bb.max.x + (m.isInstancedMesh ? 0 : m.position.x));
    });
    return { L: [P.r.L, R.L_hsk], W: [P.r.W, R.W_hsk], H: [P.r.H, R.RRU_Height], FH: [P.r.FH, R.Fin_Height], n: [P.r.n, R.Fin_Count, zs.size],
             V: [P.r.V, R.Volume_L], x: [x0, x1], z: [z0, z1], rows: [P.rows.length, R.rows.length], key: P.key };
  });
  ok('長寬高、鰭片高、體積＝computeAll', b.L[0] === b.L[1] && b.W[0] === b.W[1] && b.H[0] === b.H[1] && b.FH[0] === b.FH[1] && b.V[0] === b.V[1], b);
  ok('鰭片數＝computeAll（實際建出來的鰭片）', b.n[0] === b.n[1] && b.n[2] === b.n[1], b.n);
  ok('鰭片沿「長」延伸（x 由 0 到 L）、排在「寬」範圍內', near(b.x[0], 0, 0.01) && near(b.x[1], b.L[1], 0.01) && b.z[0] >= -0.01 && b.z[1] <= b.W[1] + 0.01, b);
  ok('每一列計算結果都進 3D（未存專案的 key＝__new__）', b.rows[0] === b.rows[1] && b.key === '__new__', b);

  console.log('\n[C] 擋下計算：Tab3 顯示原因，不畫 3D');
  const c = await page.evaluate(async () => {
    const cpu = components.digital.find(x => /CPU/.test(x.Component)), keep = cpu['Height(mm)'];
    delete cpu['Height(mm)']; recalc(); renderTab3();
    const r = { msg: document.getElementById('tab3-msg').textContent, msgHidden: document.getElementById('tab3-msg').hidden, box: document.getElementById('tab3-3d').hidden, blocked: calcResults.blocked };
    cpu['Height(mm)'] = keep; recalc(); renderTab3();
    r.after = { msgHidden: document.getElementById('tab3-msg').hidden, box: document.getElementById('tab3-3d').hidden };
    return r;
  });
  ok('缺必填欄位 → Tab3 顯示「無法計算體積」，3D 視窗收起來', c.blocked && /無法計算體積/.test(c.msg) && !c.msgHidden && c.box, c);
  ok('補回來 → 提示拿掉、3D 回來', c.after.msgHidden && !c.after.box, c.after);

  console.log('\n[D] 元件相對高度在 3D 改＝寫回元件設定＋重算');
  await page.evaluate(() => { markProjectClean(); renderTab3(); });
  const d = await page.evaluate(async () => {
    const name = 'CPU (FPGA)', comp = components.digital.find(x => x.Component === name), r0 = calcResults.rows.find(r => r.Component === name);
    const before = { h: comp['Height(mm)'], V: calcResults.Volume_L, adt: r0.Allowed_dT, bn: calcResults.Bottleneck_Name, dirty: projectIsDirty() };
    const inp = document.querySelector('#r3d-ctab .cr[data-row="' + name + '"] .c-h');
    inp.value = String(before.h + 40); inp.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 300));
    const row = calcResults.rows.find(r => r.Component === name), P = RRU3D.dbg.P();
    return { before, h: comp['Height(mm)'], rowH: row['Height(mm)'], adt: row.Allowed_dT, V: calcResults.Volume_L, viewerH: P.rows.find(r => r.name === name).hgt,
             viewerV: P.r.V, slope: G.Slope,
             pending: RRU3D.dbg.ed().hgt, dirty: projectIsDirty(), saved: document.getElementById('r3d-saved').textContent,
             tab0: [...document.querySelectorAll('#tab0 input')].some(i => i.value === String(before.h + 40)) };
  });
  ok('Height(mm) 寫回元件設定（＋40 mm）', d.h === d.before.h + 40 && d.rowH === d.h, d);
  ok('整個工具重算：允許溫升少 Slope × 40；它是瓶頸 → 散熱器變大、體積變大', near(d.before.adt - d.adt, d.slope * 40, 0.05) && d.before.bn === 'CPU (FPGA)' && d.V > d.before.V,
     [d.before.adt, d.adt, d.before.V, d.V]);
  ok('3D 用的是重算後的新值（高度、體積）', d.viewerH === d.h && d.viewerV === d.V, [d.viewerH, d.viewerV]);
  ok('寫回後 3D 端的暫存清空（不重複寫）', JSON.stringify(d.pending) === '{}', d.pending);
  ok('專案標成未存；3D 狀態列提醒按「儲存專案」', !d.before.dirty && d.dirty && /儲存專案/.test(d.saved), [d.before.dirty, d.dirty, d.saved]);
  ok('元件設定頁（Tab0）顯示同一個新值', d.tab0, d);

  console.log('\n[E] 3D 調整 → layout3d（以 _cid 為 key）：存檔、換專案、重新載入、改名');
  const e = await page.evaluate(async () => {
    const name = 'CPU (FPGA)', comp = components.digital.find(x => x.Component === name);
    const inp = document.querySelector('#r3d-ctab .stp[data-key="' + name + '#0"] input');
    inp.value = '100'; inp.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 200));
    const z0 = G.Left, o = RRU3D.dbg.LAY().inst.find(q => q.key === name + '#0');
    const r = { cid: comp._cid, l3d: JSON.parse(JSON.stringify(layout3d)), z: o.z - z0, dirty: projectIsDirty() };
    projectNameSet('3D 測試案'); window.__writes = [];
    await cloudSaveProject();
    r.writes = window.__writes.map(w => w.id); r.id = currentProjectId;
    r.dbL3d = (window.__db.projects[currentProjectId] || {}).layout3d; r.dirtyAfter = projectIsDirty();
    // 另一個專案（沒有 layout3d）→ 不可沿用上一個專案的調整
    window.__db.projects.OTHER = JSON.parse(JSON.stringify(window.__db.projects[currentProjectId])); delete window.__db.projects.OTHER.layout3d;
    window.__db.projects.OTHER.project_name = '別的專案';
    await cloudLoadOne('OTHER', { silent: true }); renderTab3();
    const o2 = RRU3D.dbg.LAY().inst.find(q => q.key === name + '#0');
    r.other = { l3d: layout3d, manual: o2.manualZ, key: RRU3D.dbg.P().key };
    // 重新載入原專案 → 還原
    await cloudLoadOne(r.id, { silent: true }); renderTab3();
    const o3 = RRU3D.dbg.LAY().inst.find(q => q.key === name + '#0');
    r.back = { z: o3.z - z0, key: RRU3D.dbg.P().key, dirty: projectIsDirty() };
    // 改名（AI-Thermal 或這裡改都一樣）→ _cid 不變，調整照樣對得上
    components.digital.find(x => x._cid === r.cid).Component = 'FPGA-改名'; recalc(); renderTab3();
    const o4 = RRU3D.dbg.LAY().inst.find(q => q.key === 'FPGA-改名#0');
    r.renamed = o4 ? o4.z - z0 : null;
    return r;
  });
  ok('橫向位置存成 layout3d.posW[_cid]（不是元件名稱）', e.l3d && e.l3d.posW && JSON.stringify(e.l3d.posW[e.cid]) === '[100]' && !('CPU (FPGA)' in e.l3d.posW), e.l3d);
  ok('3D 上的位置＝100 mm（距 PCB 左緣）；專案標成未存', near(e.z, 100, 0.01) && e.dirty, e);
  ok('💾 儲存專案 → layout3d 寫進 DB（同一筆 updateDoc），存完不再是未存', e.dbL3d && JSON.stringify(e.dbL3d.posW[e.cid]) === '[100]' && e.writes.length === 1 && !e.dirtyAfter, e);
  ok('換到別的專案 → 不沿用上一個專案的調整', e.other.l3d === null && e.other.manual == null && e.other.key === 'OTHER', e.other);
  ok('重新載入原專案 → 位置還原、不算未存', near(e.back.z, 100, 0.01) && e.back.key === e.id && !e.back.dirty, e.back);
  ok('元件改名後調整照樣對得上（以 _cid 為 key）', e.renamed !== null && near(e.renamed, 100, 0.01), e.renamed);

  console.log('\n[F] 複製專案、匯出／匯入本機檔都帶著 layout3d');
  const f = await page.evaluate(async () => {
    const cid = components.digital.find(x => x.Component === 'FPGA-改名')._cid;
    document.getElementById('copyProjectName').value = '3D 測試案 複本';
    await confirmCopyProject();
    const copyId = currentProjectId, copyL = (window.__db.projects[copyId] || {}).layout3d;
    let blob = null; const orig = URL.createObjectURL; URL.createObjectURL = x => { blob = x; return 'blob:test'; };
    try { saveProject(); } finally { URL.createObjectURL = orig; }
    const exported = JSON.parse(await blob.text());
    layout3d = null; recalc();
    const file = new File([JSON.stringify(exported)], 'x.json', { type: 'application/json' });
    handleFileLoad({ target: { files: [file], value: '' } });
    await new Promise(r => setTimeout(r, 400));
    return { copyId, copyL: copyL && copyL.posW && copyL.posW[cid], exported: exported.layout3d && exported.layout3d.posW && exported.layout3d.posW[cid],
             imported: layout3d && layout3d.posW && layout3d.posW[cid], importedId: currentProjectId };
  });
  ok('複製專案 → 複本也有同一份 layout3d', f.copyId && JSON.stringify(f.copyL) === '[100]', f);
  ok('匯出本機檔帶 layout3d；匯入後還原', JSON.stringify(f.exported) === '[100]' && JSON.stringify(f.imported) === '[100]' && f.importedId === null, f);

  console.log('\n[G] 切到別的分頁：取消選取、方向鍵不動 3D；未存修改離開頁面會提醒');
  await show3d();
  const g1 = await page.evaluate(() => { RRU3D.dbg.select('c:Final PA#0'); return RRU3D.dbg.sel(); });
  await page.evaluate(() => switchTab(0));
  const before = await page.evaluate(() => JSON.stringify(layout3d));
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowUp');
  const g = await page.evaluate(b => {
    const same = JSON.stringify(layout3d) === b;
    markProjectClean();
    const E = RRU3D.dbg.ed(); E.posW['Final PA'] = [20, null, null, null]; RRU3D.dbg.saveEdit();   // 在 3D 頁動了一顆（還沒存）
    const dirtyNow = projectIsDirty();
    const ev1 = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(ev1);
    markProjectClean();
    const ev2 = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(ev2);
    return { sel: RRU3D.dbg.sel(), same, dirtyNow, warnDirty: ev1.defaultPrevented, warnClean: ev2.defaultPrevented };
  }, before);
  ok('切到別的分頁 → 3D 的選取取消', g1 === 'c:Final PA#0' && g.sel === null, [g1, g.sel]);
  ok('3D 頁不在畫面上時，方向鍵不會改到 3D 的調整', g.same, g);
  ok('3D 頁有還沒存的調整 → 離開頁面會提醒；存過／沒改 → 不提醒', g.dirtyNow && g.warnDirty && !g.warnClean, g);

  console.log('\n[H] PDF 報告第 6 節：3D 圖由檢視器渲染');
  await show3d();
  await page.evaluate(() => { document.querySelector('#tab3 [data-state="exp"]').click(); document.querySelector('#tab3 [data-mode="therm"]').click(); });
  await page.waitForFunction(() => !RRU3D.dbg.busy(), null, { timeout: 30000 });   // 轉場動畫跑完（軟體繪圖時一幀可能要幾百 ms）
  await page.waitForTimeout(300);
  const h = await page.evaluate(async () => {
    const D = RRU3D.dbg;
    // 使用者自己轉過的視角（不是任何預設視角）：產生報告後必須原封不動
    D.camera.position.x += 173; D.camera.position.y -= 61; D.controls.target.z += 23; D.controls.update();
    const cam0 = D.camera.position.toArray().map(v => Math.round(v)).concat(D.controls.target.toArray().map(v => Math.round(v))), st0 = [D.state.st, D.state.mode];
    window.pdfMake = { createPdf: dd => ({ download() { window.__dd = dd; } }) };
    window.__dd = null; await generatePDFReport();
    const dd = window.__dd; if (!dd) return { none: true, alerts: window.__alerts.slice(-2) };
    const i6 = dd.content.findIndex(n => n && typeof n.text === 'string' && n.text.startsWith('6. 3D'));
    const img = i6 >= 0 ? dd.content.slice(i6, i6 + 3).find(n => n && n.image) : null;
    return { i6, img: img ? img.image.slice(0, 22) : null, len: img ? img.image.length : 0,
             cam: D.camera.position.toArray().map(v => Math.round(v)).concat(D.controls.target.toArray().map(v => Math.round(v))), cam0, st: [D.state.st, D.state.mode], st0 };
  });
  ok('第 6 節有 3D 圖（檢視器渲染的 JPEG）', h.i6 >= 0 && h.img === 'data:image/jpeg;base64' && h.len > 50000, h);
  ok('產生報告不改使用者目前的視角（自己轉過的角度）與顯示方式（爆炸＋熱分佈照舊）', JSON.stringify(h.cam) === JSON.stringify(h.cam0) && JSON.stringify(h.st) === JSON.stringify(h.st0), h);

  console.log('\n[I] 3D 頁的「輸出 PDF」與「下載目前畫面」');
  const [pdl] = await Promise.all([
    page.waitForEvent('download', { timeout: 240000 }),
    (async () => {
      await page.click('#r3d-t-pdf');
      await page.waitForFunction(() => RRU3D.dbg.pdf() && !RRU3D.dbg.pdfBusy(), null, { timeout: 240000 });
      await page.click('#r3d-pdf-save');
    })(),
  ]);
  const pdfBuf = fs.readFileSync(await pdl.path());
  const pages = (pdfBuf.toString('latin1').match(/\/Type \/Page\b/g) || []).length;
  const note = await page.evaluate(() => document.getElementById('r3d-pdf-note').textContent);
  ok('輸出 PDF：兩頁 A4、一般下載（檔名＝專案名_3D模型_日期.pdf）', pages === 2 && /_3D模型_\d{8}\.pdf$/.test(pdl.suggestedFilename()) && /已存檔/.test(note), [pages, pdl.suggestedFilename(), note]);
  await page.keyboard.press('Escape');
  const [sdl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.click('#r3d-t-shot')]);
  const png = fs.readFileSync(await sdl.path());
  ok('下載目前畫面：PNG（含標註）', png.slice(1, 4).toString() === 'PNG' && /_3D畫面_\d{8}-\d{4}\.png$/.test(sdl.suggestedFilename()) && png.length > 20000, [sdl.suggestedFilename(), png.length]);

  console.log('\n[J] 版面：3D 頁自動收合參數控制台；並排門檻依 3D 頁本身的寬度；尺寸標註不被蓋住；畫面大小變了自動重新對焦');
  await page.evaluate(() => { document.querySelector('#tab3 [data-state="asm"]').click(); document.querySelector('#tab3 [data-mode="real"]').click(); });
  const measure = () => page.evaluate(() => {
    const R = el => el.getBoundingClientRect(), stEl = document.getElementById('r3d-stage');
    const vis = el => { const r = R(el); if (!r.width || !r.height) return false; for (let e = el; e; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden') return false; } return true; };
    const root = document.querySelector('#tab3 .r3d'), st = R(stEl), side = R(root.querySelector('.side'));
    const overlays = [...root.querySelectorAll('.tools .tgrp, #r3d-vcube > *, #r3d-hint, #r3d-selbar, #r3d-pname')].filter(vis).map(R);
    const labels = [...root.querySelectorAll('#r3d-labels .dim')].filter(vis);
    const hit = [];
    labels.forEach(el => { const a = R(el); overlays.forEach(o => { if (Math.min(a.right, o.right) - Math.max(a.left, o.left) > 0 && Math.min(a.bottom, o.bottom) - Math.max(a.top, o.top) > 0) hit.push(el.innerText.replace(/\s+/g, ' ')); }); });
    const inStage = labels.every(el => { const a = R(el); return a.left >= st.left && a.right <= st.right && a.top >= st.top && a.bottom <= st.bottom; });
    const fs = RRU3D.dbg.frameSize() || [0, 0];
    return { stageW: Math.round(st.width), sideBySide: side.left >= st.right - 1, stacked: side.top >= st.bottom - 1, labels: labels.length, hit, inStage,
             appBottom: Math.round(R(root.querySelector('.app')).bottom - R(root).bottom), collapsed: document.body.classList.contains('sidebar-collapsed'),
             framedAtSize: Math.abs(fs[0] - stEl.clientWidth) <= 2 && Math.abs(fs[1] - stEl.clientHeight) <= 2, view: RRU3D.dbg.curView() };
  });
  const K = {};
  for (const [w, hh] of [[1440, 900], [1920, 1080]]) {
    await page.setViewportSize({ width: w, height: hh });
    await page.waitForTimeout(500);
    await page.evaluate(() => { RRU3D.resize(); document.querySelector('#tab3 [data-view="iso"]').click(); });
    await page.waitForFunction(() => !RRU3D.dbg.busy(), null, { timeout: 15000 });
    await page.waitForTimeout(400);
    K[w] = await measure();
  }
  // 1440×900：使用者在 3D 頁自己展開參數控制台 → 3D 畫面變了 → 還沒動過視角 → 用新的大小重新對焦
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(500);
  await page.evaluate(() => { RRU3D.resize(); document.querySelector('#tab3 [data-view="iso"]').click(); });
  await page.waitForFunction(() => !RRU3D.dbg.busy(), null, { timeout: 15000 });
  // ResizeObserver 的通知跟著畫面更新送出；軟體繪圖（SwiftShader）一幀可能要好幾秒 → 等兩次 requestAnimationFrame 真的跑完（通知一定已送達），不要用固定毫秒數
  const frames2 = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.evaluate(() => setSidebarCollapsed(false));
  await frames2();
  await page.waitForFunction(() => { const fs = RRU3D.dbg.frameSize(), st = document.getElementById('r3d-stage'); return !!fs && Math.abs(fs[0] - st.clientWidth) <= 2 && Math.abs(fs[1] - st.clientHeight) <= 2; }, null, { timeout: 30000 }).catch(() => {});
  K.open = await measure();
  // 自己調過視角（滾輪；deltaY 0 → 標記「使用者動過」但相機不動，免得縮放的慣性干擾判斷）→ 畫面大小再變也不重新對焦（不搶使用者的鏡頭）
  const zm = await page.evaluate(async () => {
    const D = RRU3D.dbg, raf2 = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    document.getElementById('r3d-cv').dispatchEvent(new WheelEvent('wheel', { deltaY: 0, bubbles: true, cancelable: true })); await raf2();
    const c0 = D.camera.position.clone(), fs0 = JSON.stringify(D.frameSize()), st = document.getElementById('r3d-stage'), sz0 = [st.clientWidth, st.clientHeight];
    setSidebarCollapsed(true); await raf2(); await raf2();
    return { view: D.curView(), moved: +D.camera.position.distanceTo(c0).toFixed(2), sameFrame: JSON.stringify(D.frameSize()) === fs0,
             resized: sz0[0] !== st.clientWidth || sz0[1] !== st.clientHeight, collapsed: document.body.classList.contains('sidebar-collapsed') };
  });
  await page.setViewportSize({ width: 1600, height: 1000 });
  ok('切到 3D 頁時參數控制台自動收合 → 1440×900 也是 3D 畫面＋編輯面板並排（3D ≥ 900 px）', K[1440].collapsed && K[1440].sideBySide && K[1440].stageW >= 900, K[1440]);
  ok('1920×1080：並排，3D 畫面 ≥ 900 px', K[1920].sideBySide && K[1920].stageW >= 900, K[1920]);
  ok('在 3D 頁自己展開參數控制台（1440×900）→ 編輯面板排到下方、3D 仍 ≥ 900 px、外框跟著內容撐高', !K.open.collapsed && K.open.stacked && K.open.stageW >= 900 && K.open.appBottom <= 0, K.open);
  ok('畫面大小變了、還沒動過視角 → 用新的大小重新對焦（仍是等角視角）', K.open.framedAtSize && K.open.view === 'iso', K.open);
  ok('尺寸標註都在 3D 畫面內、不被工具列／視角方塊／平移鍵蓋住（三種情況）', [K[1440], K[1920], K.open].every(k => k.labels >= 3 && !k.hit.length && k.inStage), K);
  ok('自己用滾輪調過視角 → 畫面大小再變也不自動重新對焦', zm.collapsed && zm.resized && zm.view === null && zm.sameFrame && zm.moved < 1, zm);

  console.log('\n[L] Die-casting 鰭片：根厚尖薄（拔模角）、節距＝Fin_t＋Gap、整排在散熱器寬度內');
  const setIn = (id, v) => page.evaluate(([id, v]) => { const e = document.getElementById(id); e.value = String(v); e.dispatchEvent(new Event('change', { bubbles: true })); }, [id, v]);
  await page.evaluate(() => { const s = document.getElementById('fin_tech_selector_v2'); s.value = 'Die-casting Fin (0.90)'; s.dispatchEvent(new Event('change', { bubbles: true })); });
  await setIn('Fin_t', 2); await setIn('Gap', 10);     // 範例的 1.2／11.6 在 Die-casting 會被 DRC 擋下（AR > 45）
  await page.waitForFunction(() => !calcResults.drc_failed && RRU3D.dbg.P().r.isDC, null, { timeout: 30000 });
  await page.waitForTimeout(800);
  const Ld = await page.evaluate(() => {
    const D = RRU3D.dbg, P = D.P(), R = calcResults, fins = D.HSK().userData.fins, zs = new Set();
    let shape = null;
    fins.children.forEach(m => {
      const pos = m.geometry.attributes.position; let y0 = 1e9, y1 = -1e9;
      for (let i = 0; i < pos.count; i++) { y0 = Math.min(y0, pos.getY(i)); y1 = Math.max(y1, pos.getY(i)); }
      let b0 = 1e9, b1 = -1e9, t0 = 1e9, t1 = -1e9;
      for (let i = 0; i < pos.count; i++) { const y = pos.getY(i), z = pos.getZ(i); if (Math.abs(y - y0) < 1e-3) { b0 = Math.min(b0, z); b1 = Math.max(b1, z); } if (Math.abs(y - y1) < 1e-3) { t0 = Math.min(t0, z); t1 = Math.max(t1, z); } }
      if (!shape && Math.abs((y1 - y0) - P.r.FH) < 0.01) shape = { type: m.geometry.type, root: +(b1 - b0).toFixed(3), tip: +(t1 - t0).toFixed(3) };
      (m.isInstancedMesh ? Array.from({ length: m.count }, (_, i) => m.instanceMatrix.array[i * 16 + 14]) : [m.position.z]).forEach(z => zs.add(Math.round(z * 1000) / 1000));
    });
    const z = [...zs].sort((a, b) => a - b);
    return { T_root: R.T_root, Fin_t: G.Fin_t, Gap: G.Gap, n: R.Fin_Count, W: R.W_hsk, shape, count: z.length, pitch: (z[z.length - 1] - z[0]) / (z.length - 1),
             root0: z[0] - R.T_root / 2, root1: z[z.length - 1] + R.T_root / 2, spec: document.querySelector('#tab3 .r3d').textContent.includes('尖→根') };
  });
  ok('鰭片斷面是梯形：根部厚＝T_root、鰭尖厚＝Fin_t（computeAll 的值）', !!Ld.shape && Ld.shape.type === 'ExtrudeGeometry' && near(Ld.shape.root, Ld.T_root, 0.01) && near(Ld.shape.tip, Ld.Fin_t, 0.01), Ld);
  ok('片數＝computeAll；節距＝Fin_t＋Gap（跟 G_root＝節距 − T_root 同一個定義）', Ld.count === Ld.n && near(Ld.pitch, Ld.Fin_t + Ld.Gap, 0.01), Ld);
  ok('整排鰭片（根部）在散熱器寬度內、左右置中', Ld.root0 >= -0.01 && Ld.root1 <= Ld.W + 0.01 && near(Ld.root0, Ld.W - Ld.root1, 0.01), Ld);
  ok('元件清單寫出鰭尖→根部厚度與拔模角', Ld.spec, Ld);

  console.log('\n[M] 補肉疊在鰭片上：鰭片一律從基板長到鰭尖（跨在補肉邊緣的也不截短），只讓開凹槽');
  await page.evaluate(() => { const s = document.getElementById('fin_tech_selector_v2'); s.value = 'Embedded Fin (0.95)'; s.dispatchEvent(new Event('change', { bubbles: true })); });
  await setIn('Fin_t', 1.2);
  // 補肉位置不動，找一個 Gap 讓某片鰭片剛好跨在補肉的邊緣（使用者回報「整片鰭片被挖空」的情況）
  const gM = await page.evaluate(() => {
    const b = (RRU3D.dbg.LAY().bosses || [])[0]; if (!b) return null;
    const W = calcResults.W_hsk, t = G.Fin_t;
    for (let k = 0; k < 400; k++) { const gp = +(9 + k * 0.01).toFixed(2), n = calcFinCount(W, gp, t), pitch = t + gp, zf0 = (W - ((n - 1) * pitch + t)) / 2;
      for (let i = 0; i < n; i++) { const z = zf0 + i * pitch + t / 2; if (Math.abs(z - b.z0) < t * 0.2 || Math.abs(z - b.z1) < t * 0.2) return gp; } }
    return null;
  });
  await setIn('Gap', gM);
  await page.waitForFunction(() => !calcResults.drc_failed && !RRU3D.dbg.P().r.isDC, null, { timeout: 30000 });
  await page.waitForTimeout(800);
  const M = await page.evaluate(() => {
    const D = RRU3D.dbg, L = D.LAY(), P = D.P(), fins = D.HSK().userData.fins, t = P.g.Fin_t, b = L.bosses[0];
    const holes = []; (L.bosses || []).forEach(bb => bb.insts.forEach(o => { const pk = o.pocket; if (pk && pk.depth - L.tb > 0) holes.push({ x0: o.x - pk.L / 2, x1: o.x + pk.L / 2, z0: o.z - pk.W / 2, z1: o.z + pk.W / 2, top: pk.depth - L.tb }); }));
    const cut = [], intrude = [], byZ = {};
    fins.children.forEach(m => {
      const pos = m.geometry.attributes.position; let x0 = 1e9, x1 = -1e9, y0 = 1e9;
      for (let i = 0; i < pos.count; i++) { x0 = Math.min(x0, pos.getX(i)); x1 = Math.max(x1, pos.getX(i)); y0 = Math.min(y0, pos.getY(i)); }
      (m.isInstancedMesh ? Array.from({ length: m.count }, (_, i) => m.instanceMatrix.array[i * 16 + 14]) : [m.position.z]).forEach(z => {
        const k = Math.round(z * 1000) / 1000; (byZ[k] = byZ[k] || []).push({ x0, x1, y0 });
        const over = h => x0 < h.x1 - 0.01 && x1 > h.x0 + 0.01 && z + t / 2 > h.z0 && z - t / 2 < h.z1;
        if (y0 > 0.01) { const h = holes.find(h => x0 >= h.x0 - 0.01 && x1 <= h.x1 + 0.01 && z + t / 2 > h.z0 && z - t / 2 < h.z1); if (!h) cut.push({ z: +z.toFixed(2), x0, x1, y0 }); else if (y0 < h.top) intrude.push({ z, y0, top: h.top }); }
        else holes.forEach(h => { if (over(h)) intrude.push({ z: +z.toFixed(2), x0, x1, top: h.top }); });
      });
    });
    const edge = Object.keys(byZ).map(Number).find(z => (z + t / 2 > b.z0 && z - t / 2 < b.z1) && !(z - t / 2 >= b.z0 && z + t / 2 <= b.z1));
    const eSegs = edge != null ? byZ[Math.round(edge * 1000) / 1000] : null;
    return { gap: G.Gap, boss: [b.z0, b.z1, b.h], holes: holes.length, edge, eSegs, cut, intrude,
             edgeFull: !!eSegs && eSegs.every(s => s.y0 < 0.01) && Math.min(...eSegs.map(s => s.x0)) < 0.01 && Math.max(...eSegs.map(s => s.x1)) > P.r.L - 0.01 };
  });
  ok('有一片鰭片跨在補肉邊緣 → 它照樣從基板完整長到鰭尖（不被挖空）', M.edge != null && M.edgeFull, M);
  ok('不是從基板長起的鰭片段只出現在凹槽範圍內（其他地方一律完整）', M.cut.length === 0, M.cut);
  ok('鰭片不會穿進凹槽（穿過凹槽的那段從凹槽頂往上長）', M.holes > 0 && M.intrude.length === 0, M);

  console.log('\n[N] 全螢幕、儲存鈕、專案名稱、部件複選、部件翻轉');
  await show3d();
  await page.evaluate(() => { projectNameSet('N 測試專案 8T8R'); tab3Stale = true; renderTab3(); });
  await page.waitForFunction(() => !RRU3D.dbg.busy(), null, { timeout: 30000 });
  const n1 = await page.evaluate(() => { const e = document.getElementById('r3d-pname'), st = document.getElementById('r3d-stage').getBoundingClientRect(), r = e.getBoundingClientRect();
    return { t: e.textContent, name: projectNameGet(), vis: getComputedStyle(e).display !== 'none', inStage: r.right <= st.right + 0.5 && r.bottom <= st.bottom + 0.5 && r.left >= st.left + st.width / 2,
      icons: ['r3d-t-fs', 'r3d-t-save'].map(id => { const b = document.getElementById(id); return !!b.querySelector('svg') && !b.textContent.trim() && !!b.getAttribute('aria-label'); }),
      sameGrp: document.getElementById('r3d-t-fs').parentElement === document.getElementById('r3d-t-save').parentElement,
      saveRight: document.getElementById('r3d-t-save').getBoundingClientRect().left > document.getElementById('r3d-t-fs').getBoundingClientRect().left,
      afterTools: document.getElementById('r3d-t-fs').parentElement.previousElementSibling.contains(document.getElementById('r3d-t-pdf')) }; });
  ok('右下角顯示專案名稱（跟工具的專案名稱同一個）', n1.t === n1.name && n1.vis && n1.inStage, n1);
  ok('全螢幕、儲存兩顆是圖示鈕（有 aria-label），並排放在「工具」組後面、儲存在右', n1.icons.every(Boolean) && n1.sameGrp && n1.saveRight && n1.afterTools, n1);

  // 全螢幕
  const f0 = await page.evaluate(() => [document.getElementById('r3d-stage').clientWidth, RRU3D.dbg.frames()]);
  await page.click('#r3d-t-fs');
  await page.waitForFunction(() => document.fullscreenElement && document.getElementById('r3d-stage').clientWidth > 0, null, { timeout: 10000 });
  await page.waitForFunction(f => RRU3D.dbg.frames() > f + 2, f0[1] + 0, { timeout: 60000 });
  const n2 = await page.evaluate(() => { const el = document.querySelector('.r3d'), b = el.getBoundingClientRect(), hdr = document.querySelector('.header');
    return { cls: el.classList.contains('r3d-fs'), pressed: document.getElementById('r3d-t-fs').getAttribute('aria-pressed'), native: document.fullscreenElement === document.documentElement,
      full: b.left <= 0 && b.top <= 0 && b.right >= innerWidth - 0.5 && b.bottom >= innerHeight - 0.5,
      covers: [[5, 5], [innerWidth - 5, innerHeight - 5], [innerWidth / 2, 3]].every(([x, y]) => el.contains(document.elementFromPoint(x, y))),
      hdrCovered: !hdr || !hdr.contains(document.elementFromPoint(innerWidth / 2, 10)), stageW: document.getElementById('r3d-stage').clientWidth }; });
  ok('按全螢幕 → 整頁進瀏覽器全螢幕，只剩 3D 檢視器（蓋滿畫面、工具的標題列被蓋住）', n2.cls && n2.pressed === 'true' && n2.native && n2.full && n2.covers && n2.hdrCovered, n2);
  ok('全螢幕時 3D 畫面變大、照樣在重畫（position:fixed 不可讓 onScreen 誤判）', n2.stageW > f0[0], [f0, n2.stageW]);

  // 儲存：保護啟用中 → 頁內密碼小視窗
  await page.evaluate(() => { window.__prompts = 0; window.prompt = () => { window.__prompts++; return null; }; window.__alerts = [];
    dbAdapter.isSharePointMode = () => false; cloudLocked = true; _applyCloudLockUI(); window.__w0 = window.__writes.length; });
  await page.click('#r3d-t-save');
  await page.waitForSelector('#r3dUnlockModal.active', { timeout: 5000 });
  const n3 = await page.evaluate(() => { const f = document.getElementById('r3dUnlockForm').getBoundingClientRect();
    return { top: document.getElementById('r3dUnlockForm').contains(document.elementFromPoint(f.left + f.width / 2, f.top + 30)), focus: document.activeElement.id,
      stillFs: !!document.fullscreenElement && document.querySelector('.r3d').classList.contains('r3d-fs') }; });
  ok('沒解除資料庫保護就按儲存 → 跳出頁內密碼小視窗（疊在全螢幕的 3D 上、游標在密碼欄）', n3.top && n3.focus === 'r3dUnlockPwd' && n3.stillFs, n3);
  await page.fill('#r3dUnlockPwd', '9999'); await page.press('#r3dUnlockPwd', 'Enter');
  const n4 = await page.evaluate(() => ({ err: document.getElementById('r3dUnlockErr').textContent, open: document.getElementById('r3dUnlockModal').classList.contains('active'), locked: cloudLocked, w: window.__writes.length - window.__w0 }));
  ok('密碼錯 → 小視窗不關、顯示「密碼錯誤」，不解鎖也不寫入', /密碼錯誤/.test(n4.err) && n4.open && n4.locked && n4.w === 0, n4);
  await page.click('#r3dUnlockCancel');
  await page.waitForTimeout(300);
  const n5 = await page.evaluate(() => ({ open: document.getElementById('r3dUnlockModal').classList.contains('active'), locked: cloudLocked, w: window.__writes.length - window.__w0, busy: document.getElementById('r3d-t-save').getAttribute('aria-busy') }));
  ok('取消 → 不解鎖、不寫入', !n5.open && n5.locked && n5.w === 0 && n5.busy === null, n5);
  await page.click('#r3d-t-save');
  await page.waitForSelector('#r3dUnlockModal.active', { timeout: 5000 });
  await page.fill('#r3dUnlockPwd', '0000'); await page.press('#r3dUnlockPwd', 'Enter');
  await page.waitForFunction(() => !document.getElementById('r3dToast').hidden, null, { timeout: 15000 });
  const n6 = await page.evaluate(() => ({ locked: cloudLocked, w: window.__writes.length - window.__w0, toast: document.getElementById('r3dToast').textContent, alerts: window.__alerts.length, prompts: window.__prompts,
    stillFs: !!document.fullscreenElement && document.querySelector('.r3d').classList.contains('r3d-fs'), lockBtn: document.getElementById('cloudLockBtn').textContent, alertBack: String(window.alert).includes('__alerts') }));
  ok('密碼對 → 解除保護（工具列的保護鈕同步）並接著儲存專案（寫入一次）', !n6.locked && n6.w === 1 && /關閉/.test(n6.lockBtn), n6);
  ok('存檔訊息在畫面內提示、不跳原生 alert／prompt（全螢幕不會被瀏覽器退出），之後 alert 還原', /已儲存/.test(n6.toast) && n6.alerts === 0 && n6.prompts === 0 && n6.stillFs && n6.alertBack, n6);
  await page.evaluate(() => { window.__w0 = window.__writes.length; document.getElementById('r3dToast').hidden = true; });
  await page.click('#r3d-t-save');
  await page.waitForFunction(() => !document.getElementById('r3dToast').hidden, null, { timeout: 15000 });
  const n7 = await page.evaluate(() => ({ modal: document.getElementById('r3dUnlockModal').classList.contains('active'), w: window.__writes.length - window.__w0 }));
  ok('已解除保護 → 直接儲存，不再問密碼', !n7.modal && n7.w === 1, n7);
  // 退出全螢幕：再按一次；瀏覽器自己退出（Esc）時檢視器也跟著還原
  await page.click('#r3d-t-fs');
  await page.waitForFunction(() => !document.fullscreenElement, null, { timeout: 10000 });
  const n8 = await page.evaluate(() => ({ cls: document.querySelector('.r3d').classList.contains('r3d-fs'), pressed: document.getElementById('r3d-t-fs').getAttribute('aria-pressed') }));
  await page.click('#r3d-t-fs');
  await page.waitForFunction(() => !!document.fullscreenElement, null, { timeout: 10000 });
  await page.evaluate(() => document.exitFullscreen());
  await page.waitForFunction(() => !document.fullscreenElement, null, { timeout: 10000 });
  // 檢視器是在 fullscreenchange 事件裡還原（非同步，機器忙的時候會晚一點）→ 等到條件成立，最多 5 秒；一直沒還原照樣失敗
  await page.waitForFunction(() => !document.querySelector('.r3d').classList.contains('r3d-fs'), null, { timeout: 5000 }).catch(() => {});
  const n9 = await page.evaluate(() => document.querySelector('.r3d').classList.contains('r3d-fs'));
  ok('再按一次 → 退出全螢幕；瀏覽器自己退出全螢幕（Esc）→ 檢視器也還原', !n8.cls && n8.pressed === 'false' && !n9, [n8, n9]);
  await page.waitForFunction(() => !RRU3D.dbg.busy(), null, { timeout: 30000 });

  // 部件複選
  const soloClick = k => page.click('#tab3 [data-solo="' + k + '"]');
  const soloState = () => page.evaluate(() => { const D = RRU3D.dbg; return { solo: D.state.solo, vis: { fil: D.FIL().visible, shd: D.SHD().visible, pcb: D.PCB().visible, hsk: D.HSK().visible },
    pressed: Object.fromEntries([...document.querySelectorAll('#tab3 [data-solo]')].map(b => [b.dataset.solo || 'all', b.getAttribute('aria-pressed')])) }; });
  await soloClick('fil'); await soloClick('shd');
  await page.waitForFunction(() => !RRU3D.dbg.busy(), null, { timeout: 30000 });
  const s1 = await soloState();
  const sb = await page.evaluate(() => { const D = RRU3D.dbg, u = D.soloBox(), one = k => { D.state.solo = [k]; const b = D.soloBox(); return b; }, keep = D.state.solo.slice();
    const bf = one('fil'), bs = one('shd'); D.state.solo = keep; const e = bf.clone().union(bs); const d = Math.max(...u.min.clone().sub(e.min).toArray().concat(u.max.clone().sub(e.max).toArray()).map(Math.abs)); return d; });
  ok('點「濾波器」再點「屏蔽罩」→ 兩件都顯示（複選），按鈕都亮、「全部」不亮', JSON.stringify(s1.solo) === '["fil","shd"]' && s1.vis.fil && s1.vis.shd && !s1.vis.pcb && !s1.vis.hsk
    && s1.pressed.fil === 'true' && s1.pressed.shd === 'true' && s1.pressed.pcb === 'false' && s1.pressed.all === 'false', s1);
  ok('複選時對焦框＝選到的部件合起來的外框', sb < 0.01, sb);
  await soloClick('shd'); const s2 = await soloState();
  await soloClick('fil'); const s3 = await soloState();
  ok('再按一次取消那一件；全部取消 → 回到「全部」', JSON.stringify(s2.solo) === '["fil"]' && !s2.vis.shd && s3.solo === null && s3.pressed.all === 'true' && Object.values(s3.vis).every(Boolean), [s2, s3]);
  for (const k of ['fil', 'shd', 'pcb', 'hsk']) await soloClick(k);
  const s4 = await soloState();
  ok('四件都選 → 等於「全部」', s4.solo === null && s4.pressed.all === 'true', s4);

  // 部件翻轉 180°（爆炸、只看濾波器）：只顯示一件 → 繞它自己的長邊中心軸
  await page.click('#tab3 [data-state="exp"]'); await soloClick('fil');
  await page.waitForFunction(() => !RRU3D.dbg.busy(), null, { timeout: 30000 });
  const pose = () => page.evaluate(() => { const D = RRU3D.dbg, o = D.FIL(), P = { fil: D.FIL(), shd: D.SHD(), pcb: D.PCB(), hsk: D.HSK() }, m = {}; o.updateWorldMatrix(true, true);
    Object.keys(P).forEach(k => { P[k].updateMatrix(); m[k] = P[k].matrix.elements.slice(); });
    const c = D.partCenter('fil').clone().applyMatrix4(o.matrixWorld), q = o.getWorldQuaternion(new D.camera.quaternion.constructor()), V = D.camera.position.constructor;
    return { c: c.toArray(), x: new V(1, 0, 0).applyQuaternion(q).toArray(), y: new V(0, 1, 0).applyQuaternion(q).toArray(), m,
      pflip: String(D.state.pflip), pressed: document.getElementById('r3d-t-pflip').getAttribute('aria-pressed') }; });
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const relErr = (A, B) => page.evaluate(([A, B]) => { const M4 = RRU3D.dbg.camera.matrix.constructor, ks = Object.keys(A); let d = 0;
    ks.forEach(i => ks.forEach(j => { if (i >= j) return; const a = new M4().fromArray(A[i]).invert().multiply(new M4().fromArray(A[j])), b = new M4().fromArray(B[i]).invert().multiply(new M4().fromArray(B[j]));
      for (let n = 0; n < 16; n++) d = Math.max(d, Math.abs(a.elements[n] - b.elements[n])); })); return d; }, [A, B]);
  const p0 = await pose();
  await page.click('#r3d-t-pflip'); await page.waitForFunction(() => !RRU3D.dbg.busy(), null, { timeout: 30000 });
  const p1 = await pose();
  ok('只看濾波器按「翻轉」→ 濾波器沿長邊（x）中心軸轉 180°：中心不動、長邊方向不變、上下顛倒', dist(p0.c, p1.c) < 0.01 && dot(p0.x, p1.x) > 0.9999 && dot(p0.y, p1.y) < -0.9999 && p1.pflip === 'true' && p1.pressed === 'true', [p0.c, p1.c, p1.pflip]);
  const r01 = await relErr(p0.m, p1.m);
  ok('沒顯示的部件跟著同一個剛體變換（四件相對位置不變 → 再顯示出來時已經在對的位置）', r01 < 1e-6, r01);
  const snap = await page.evaluate(() => { const u = RRU3D.snapshot(400, 250); return !!u && u.startsWith('data:image/jpeg'); });
  const pS = await pose();
  ok('翻轉後產生報告用的 3D 圖（組裝、不翻）→ 不動到畫面上的翻轉', snap && pS.pflip === 'true' && dist(p1.c, pS.c) < 0.01 && dot(p1.y, pS.y) > 0.9999, pS.pflip);
  await soloClick('fil');   // 回到「全部」：翻轉照樣開著（整組一起翻）；再按一次全部翻回原位
  await page.waitForFunction(() => !RRU3D.dbg.busy(), null, { timeout: 30000 });
  const pa = await page.evaluate(() => [RRU3D.dbg.state.solo, document.getElementById('r3d-t-pflip').getAttribute('aria-pressed')]);
  const pA = await pose();
  await page.click('#r3d-t-pflip'); await page.waitForFunction(() => !RRU3D.dbg.busy(), null, { timeout: 30000 });
  const p3 = await pose(), r03 = await relErr(p0.m, p3.m), r0A = await relErr(p0.m, pA.m);
  ok('回到「全部」時翻轉照樣開著、四件整組翻（相對位置不變）；再按一次全部翻回原位', pa[0] === null && pa[1] === 'true' && r0A < 1e-6 && p3.pflip === 'false'
    && dist(p0.c, p3.c) < 0.01 && dot(p0.y, p3.y) > 0.9999 && r03 < 1e-6, [pa, r0A, p3.pflip, r03]);
  await page.click('#tab3 [data-state="asm"]');
  await page.waitForFunction(() => !RRU3D.dbg.busy(), null, { timeout: 30000 });

  console.log('\n[O] 翻轉交叉測試：狀態 × 直立 × 15 種部件組合、翻轉途中剛體、隨機切換序列、標註／剖面／報告／拖曳');
  {
    // 頁面內的檢查工具：部件外框與期望姿態由測試自己算（不呼叫被測的 withFlips／flipPivot）
    await page.evaluate(() => {
      const D = RRU3D.dbg, T = D.camera.position.constructor, Q = D.camera.quaternion.constructor, M4 = D.camera.matrix.constructor;
      const parts = () => ({ fil: D.FIL(), shd: D.SHD(), pcb: D.PCB(), hsk: D.HSK() });
      const locBox = k => { const o = parts()[k]; o.updateWorldMatrix(true, true); const inv = new M4().copy(o.matrixWorld).invert(), mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
        const add = (x, bb) => { if (!bb || bb.isEmpty()) return;
          for (let i = 0; i < 8; i++) { const p = new T(i & 1 ? bb.max.x : bb.min.x, i & 2 ? bb.max.y : bb.min.y, i & 4 ? bb.max.z : bb.min.z).applyMatrix4(x.matrixWorld).applyMatrix4(inv);
            ['x', 'y', 'z'].forEach((a, j) => { mn[j] = Math.min(mn[j], p[a]); mx[j] = Math.max(mx[j], p[a]); }); } };
        const walk = x => { if (x.userData && (x.userData.noCenter || x.userData.secHelper)) return;          // 不含尺寸標註、剖面輔助
          if (x.isInstancedMesh) { x.computeBoundingBox(); add(x, x.boundingBox); } else if (x.isMesh) { if (!x.geometry.boundingBox) x.geometry.computeBoundingBox(); add(x, x.geometry.boundingBox); }
          x.children.forEach(walk); };
        walk(o); return { mn, mx }; };
      const boxAt = (k, m) => { const b = locBox(k), mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
        for (let i = 0; i < 8; i++) { const v = new T(i & 1 ? b.mx[0] : b.mn[0], i & 2 ? b.mx[1] : b.mn[1], i & 4 ? b.mx[2] : b.mn[2]).applyMatrix4(m);
          ['x', 'y', 'z'].forEach((a, j) => { mn[j] = Math.min(mn[j], v[a]); mx[j] = Math.max(mx[j], v[a]); }); }
        return { mn, mx }; };
      const QXv = new Q().setFromAxisAngle(new T(1, 0, 0), Math.PI);
      window.__shown = () => Object.keys(parts()).filter(k => !D.state.solo || D.state.solo.includes(k));
      // 期望：沒翻＝targets0；組裝／爆炸翻＝顯示中的部件（沒翻時）合起來的外框中心、繞 x 轉 180°，四件同一個剛體變換；攤開翻＝各自繞自己的中心
      window.__expect = () => { const st = D.state.st, T0 = D.targets0(st), ks = Object.keys(parts());
        if (!D.state.pflip) return T0;
        const E = {};
        if (st === 'flat') { ks.forEach(k => { const [p, q] = T0[k], b = locBox(k), c = new T((b.mn[0] + b.mx[0]) / 2, (b.mn[1] + b.mx[1]) / 2, (b.mn[2] + b.mx[2]) / 2);
          E[k] = [p.clone().add(new T(0, 2 * c.y, 2 * c.z).applyQuaternion(q)), q.clone().multiply(QXv)]; }); return E; }
        const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
        __shown().forEach(k => { const b = boxAt(k, new M4().compose(T0[k][0], T0[k][1], new T(1, 1, 1))); for (let j = 0; j < 3; j++) { mn[j] = Math.min(mn[j], b.mn[j]); mx[j] = Math.max(mx[j], b.mx[j]); } });
        const c = new T((mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2);
        ks.forEach(k => { const [p, q] = T0[k]; E[k] = [c.clone().add(p.clone().sub(c).applyQuaternion(QXv)), QXv.clone().multiply(q)]; });
        return E; };
      window.__diff = () => { const E = __expect(), P = parts(); let dp = 0, dq = 0; const bad = [];
        Object.keys(P).forEach(k => { const a = P[k].position.distanceTo(E[k][0]), b = 1 - Math.abs(P[k].quaternion.dot(E[k][1]));
          dp = Math.max(dp, a); dq = Math.max(dq, b); if (a > 1e-3 || b > 1e-9) bad.push(k); });
        return { dp, dq, bad }; };
      window.__mats = () => { const P = parts(), r = {}; Object.keys(P).forEach(k => { P[k].updateMatrix(); r[k] = P[k].matrix.elements.slice(); }); return r; };
      window.__relErr = (A, B, ks) => { let d = 0; ks.forEach(i => ks.forEach(j => { if (i >= j) return;
        const a = new M4().fromArray(A[i]).invert().multiply(new M4().fromArray(A[j])), b = new M4().fromArray(B[i]).invert().multiply(new M4().fromArray(B[j]));
        for (let n = 0; n < 16; n++) d = Math.max(d, Math.abs(a.elements[n] - b.elements[n])); })); return d; };
      window.__wbox = ks => { const P = parts(), out = {}; ks.forEach(k => { P[k].updateWorldMatrix(true, false); out[k] = boxAt(k, P[k].matrixWorld); }); return out; };
    });
    const settle = () => page.evaluate(() => RRU3D.dbg.settle());
    const clk = sel => page.evaluate(s => document.querySelector(s).click(), sel);
    const sclk = k => clk('#tab3 [data-solo="' + k + '"]');
    const ALL = ['fil', 'shd', 'pcb', 'hsk'];
    const setSubset = async S => {          // 用真的按鈕把部件組合切到 S（null／四件 → 全部）
      const cur = await page.evaluate(() => RRU3D.dbg.state.solo);
      if (!S || S.length === 4) { if (cur) await sclk(''); return; }
      if (!cur) await sclk(S[0]);
      const now = new Set(await page.evaluate(() => RRU3D.dbg.state.solo));
      for (const k of S) if (!now.has(k)) { await sclk(k); now.add(k); }
      for (const k of [...now]) if (!S.includes(k)) { await sclk(k); now.delete(k); }
    };
    const subsets = []; for (let m = 1; m < 16; m++) subsets.push(ALL.filter((k, i) => m & (1 << i)));
    const flipOff = async () => { if (await page.evaluate(() => RRU3D.dbg.state.pflip)) { await clk('#r3d-t-pflip'); await settle(); } };
    const unionOf = wb => { const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9]; Object.values(wb).forEach(x => { for (let j = 0; j < 3; j++) { mn[j] = Math.min(mn[j], x.mn[j]); mx[j] = Math.max(mx[j], x.mx[j]); } }); return mn.concat(mx); };
    const maxAbs = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));
    const frames2 = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));   // CSS 標籤要等畫面更新一次

    // [O1] 狀態 × 直立 × 15 種組合：部件組合一件一件切換（翻轉開著切換也照樣對）
    for (const [st, up] of [['asm', false], ['asm', true], ['exp', false], ['exp', true], ['flat', false]]) {
      await clk('#tab3 [data-state="' + st + '"]'); await settle();
      if (st !== 'flat' && (await page.evaluate(() => RRU3D.dbg.state.upright)) !== up) { await clk('#r3d-t-up'); await settle(); }
      const w = { d: 0, off: 0, rel: 0, box: 0, hp: 0, where: [], pressed: [] };
      for (const S of subsets) {
        await flipOff(); await setSubset(S); await settle();
        const b = await page.evaluate(() => ({ m: __mats(), wb: __wbox(__shown()), d: __diff(), hp: RRU3D.dbg.HSK().parent.parent.position.toArray() }));
        await clk('#r3d-t-pflip'); await settle();
        const f = await page.evaluate(() => ({ m: __mats(), wb: __wbox(__shown()), d: __diff(), hp: RRU3D.dbg.HSK().parent.parent.position.toArray(), pressed: document.getElementById('r3d-t-pflip').getAttribute('aria-pressed') }));
        const rel = st === 'flat' ? 0 : await page.evaluate(([A, B]) => __relErr(A, B, ['fil', 'shd', 'pcb', 'hsk']), [b.m, f.m]);
        const box = st === 'flat' ? Math.max(...Object.keys(b.wb).map(k => maxAbs(unionOf({ k: b.wb[k] }), unionOf({ k: f.wb[k] })))) : maxAbs(unionOf(b.wb), unionOf(f.wb));
        const d = Math.max(b.d.dp, f.d.dp, b.d.dq * 1e6, f.d.dq * 1e6);
        if (d > 1e-3) w.where.push(S.join('+') + ':' + b.d.bad.concat(f.d.bad).join(','));
        w.d = Math.max(w.d, d); w.rel = Math.max(w.rel, rel); w.box = Math.max(w.box, box); w.hp = Math.max(w.hp, maxAbs(b.hp, f.hp));
        if (f.pressed !== 'true') w.pressed.push(S.join('+'));
        await clk('#r3d-t-pflip'); await settle();
        w.off = Math.max(w.off, (await page.evaluate(() => __diff())).dp);
      }
      const lbl = { asm: '組裝', exp: '爆炸', flat: '拆機攤開' }[st] + (up ? '＋直立安裝' : '');
      ok(lbl + '：15 種部件組合，翻轉開／關後每一件的姿態都等於期望（' + (st === 'flat' ? '各自原地翻面' : '顯示中的部件整組翻') + '；關掉回原位）、翻轉鈕亮著',
        w.d < 1e-3 && w.off < 1e-3 && !w.pressed.length, w);
      if (st !== 'flat') ok(lbl + '：翻轉後四件的相對位置完全不變（不會互相穿插）', w.rel < 1e-6, w.rel);
      ok(lbl + '：翻轉後顯示中的部件' + (st === 'flat' ? '各自' : '合起來') + '的外框不變、整台在地面上的位置不動', w.box < 1e-3 && w.hp < 1e-6, [w.box, w.hp]);
      if (up) { await clk('#r3d-t-up'); await settle(); }
    }
    await flipOff(); await setSubset(null); await settle();

    // [O2] 翻轉動畫途中整組保持剛體（翻上去、翻回來；翻到一半再按一次）
    const mids = [];
    for (const [st, S] of [['asm', null], ['exp', ['fil', 'shd']], ['asm', ['shd', 'pcb', 'hsk']], ['exp', null], ['asm', ['fil', 'hsk']]]) {
      await clk('#tab3 [data-state="' + st + '"]'); await settle(); await setSubset(S); await settle(); await flipOff();
      mids.push(await page.evaluate(() => { const D = RRU3D.dbg, base = __mats(), out = [];
        for (let n = 0; n < 2; n++) { document.getElementById('r3d-t-pflip').click(); const tw = D.tween();
          [0.2, 0.5, 0.8].forEach(e => { D.tweenApply(tw, e); out.push(__relErr(base, __mats(), ['fil', 'shd', 'pcb', 'hsk'])); }); D.settle(); }
        return Math.max(...out); }));
    }
    const half = await page.evaluate(() => { const D = RRU3D.dbg, base = __mats(), b = document.getElementById('r3d-t-pflip'), rel = [];
      b.click(); D.tweenApply(D.tween(), 0.45); b.click(); const tw = D.tween();
      [0.3, 0.7].forEach(e => { D.tweenApply(tw, e); rel.push(__relErr(base, __mats(), ['fil', 'shd', 'pcb', 'hsk'])); }); D.settle();
      return { rel: Math.max(...rel), d: __diff().dp, pflip: D.state.pflip }; });
    ok('翻轉動畫途中（20／50／80%，翻上去與翻回來；5 種狀態＋組合）四件相對位置都不變 → 轉的途中也不會互相穿插', Math.max(...mids) < 1e-6, mids);
    ok('翻到一半再按一次 → 轉回來的途中照樣是剛體、最後回原位', half.rel < 1e-6 && half.d < 1e-3 && half.pflip === false, half);
    await setSubset(null); await settle();

    // [O3] 隨機切換序列（部件、全部、翻轉、三種狀態、直立、PCB 翻面；三成的動作在動畫跑到一半就按下一個）
    let seed = 7; const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const acts = ['fil', 'shd', 'pcb', 'hsk', '', 'flip', 'flip', 'asm', 'exp', 'flat', 'up', 'pcbflip'], bad = []; let checked = 0;
    for (let i = 0; i < 200; i++) {
      const a = acts[Math.floor(rnd() * acts.length)];
      await page.evaluate(a => { const q = s => document.querySelector(s);
        if (['fil', 'shd', 'pcb', 'hsk', ''].includes(a)) q('#tab3 [data-solo="' + a + '"]').click();
        else if (a === 'flip') q('#r3d-t-pflip').click();
        else if (a === 'up') { if (!q('#r3d-t-up').disabled) q('#r3d-t-up').click(); }
        else if (a === 'pcbflip') { if (!q('#r3d-t-flip').disabled) q('#r3d-t-flip').click(); }
        else q('#tab3 [data-state="' + a + '"]').click(); }, a);
      if (rnd() < 0.3) { const e = rnd(); await page.evaluate(e => { const t = RRU3D.dbg.tween(); if (t) RRU3D.dbg.tweenApply(t, e); }, e); continue; }
      await settle(); checked++;
      const r = await page.evaluate(() => { const D = RRU3D.dbg, d = __diff(), sh = __shown(), P = { fil: D.FIL(), shd: D.SHD(), pcb: D.PCB(), hsk: D.HSK() };
        return { d, vis: Object.keys(P).every(k => P[k].visible === sh.includes(k)),
          pressed: document.getElementById('r3d-t-pflip').getAttribute('aria-pressed') === String(D.state.pflip),
          solo: [...document.querySelectorAll('#tab3 [data-solo]')].every(b => b.getAttribute('aria-pressed') === String(b.dataset.solo ? !!D.state.solo && sh.includes(b.dataset.solo) : !D.state.solo)) }; });
      if (r.d.dp > 1e-3 || r.d.dq > 1e-9 || !r.vis || !r.pressed || !r.solo) bad.push({ i, a, r });
    }
    ok('隨機切換 200 步（' + checked + ' 步停下來檢查）：每一件的姿態都等於「目前狀態＋顯示組合＋翻轉」的期望值、按鈕狀態一致、沒有哪一件殘留翻轉', bad.length === 0, bad.slice(0, 3));
    await page.evaluate(() => { const D = RRU3D.dbg; if (D.state.pflip) document.getElementById('r3d-t-pflip').click(); document.querySelector('#tab3 [data-solo=""]').click();
      if (D.state.flip) { document.querySelector('#tab3 [data-state="flat"]').click(); document.getElementById('r3d-t-flip').click(); }   // 「PCB 翻面」只在攤開時能按
      document.querySelector('#tab3 [data-state="asm"]').click(); if (D.state.upright) document.getElementById('r3d-t-up').click(); D.settle(); });
    const reset = await page.evaluate(() => { const D = RRU3D.dbg; return !D.state.pflip && !D.state.flip && !D.state.upright && !D.state.solo && D.state.st === 'asm'; });
    ok('序列結束的收尾：翻轉、PCB 翻面、直立、部件組合都回到預設（後面的檢查不受序列影響）', reset, reset);
    const back = await page.evaluate(() => { const D = RRU3D.dbg, T0 = D.targets0('asm'), P = { fil: D.FIL(), shd: D.SHD(), pcb: D.PCB(), hsk: D.HSK() }; let d = 0;
      Object.keys(P).forEach(k => { d = Math.max(d, P[k].position.distanceTo(T0[k][0]), (1 - Math.abs(P[k].quaternion.dot(T0[k][1]))) * 1e6); }); return d; });
    ok('序列結束：關翻轉＋全部＋組裝 → 四件完全回到原本的組裝位置', back < 1e-3, back);

    // [O4] 標註、剖面疊層、報告截圖、拖曳
    await clk('#r3d-t-pflip'); await settle();
    const fin = await page.evaluate(() => { const D = RRU3D.dbg, V = D.camera.position.constructor, M4 = D.camera.matrix.constructor, fins = D.HSK().userData.fins; let mn = 1e9, mx = -1e9;
      fins.updateWorldMatrix(true, true);
      fins.traverse(o => { if (!o.isMesh) return; const g = o.geometry; if (!g.boundingBox) g.computeBoundingBox(); const bb = g.boundingBox;
        for (let i = 0; i < (o.isInstancedMesh ? o.count : 1); i++) { const im = new M4(); if (o.isInstancedMesh) o.getMatrixAt(i, im); const w = new M4().multiplyMatrices(o.matrixWorld, im);
          for (let c = 0; c < 8; c++) { const y = new V(c & 1 ? bb.max.x : bb.min.x, c & 2 ? bb.max.y : bb.min.y, c & 4 ? bb.max.z : bb.min.z).applyMatrix4(w).y; mn = Math.min(mn, y); mx = Math.max(mx, y); } } });
      let dim = null; D.scene.traverse(o => { if (o.userData && o.userData.fin) dim = o.userData.fin; }); dim.updateWorldMatrix(true, true);
      const ln = dim.children.find(c => c.isLine), pa = ln.geometry.attributes.position, ys = [0, 1].map(i => new V(pa.getX(i), pa.getY(i), pa.getZ(i)).applyMatrix4(ln.matrixWorld).y).sort((a, b) => a - b);
      return { fins: [mn, mx], dim: ys, vis: dim.parent.visible }; });
    ok('組裝＋全部＋翻轉：「鰭片」尺寸標註跟著移到翻過去的鰭片位置（上下範圍一致）', fin.vis && Math.abs(fin.fins[0] - fin.dim[0]) < 0.05 && Math.abs(fin.fins[1] - fin.dim[1]) < 0.05, fin);
    await clk('#r3d-t-sec'); await page.waitForTimeout(200);
    const su1 = await page.evaluate(() => [...document.querySelectorAll('#r3d-stackup .su-row span')].map(e => e.textContent).concat(document.querySelector('#r3d-stackup h3').textContent));
    await clk('#r3d-t-pflip'); await settle();
    const su0 = await page.evaluate(() => [...document.querySelectorAll('#r3d-stackup .su-row span')].map(e => e.textContent));
    ok('剖面的疊層清單照畫面由上往下：翻轉中濾波器在最上面、關掉翻轉回到鰭片在最上面', /翻轉中/.test(su1[su1.length - 1]) && /濾波器/.test(su1[0]) && su0[0] === '鰭片', [su1, su0]);
    await clk('#r3d-t-sec'); await settle();
    await clk('#tab3 [data-state="flat"]'); await settle(); await frames2();
    const fl0 = await page.evaluate(() => ({ tags: [...document.querySelectorAll('#r3d-labels .dim.src')].filter(e => e.style.display !== 'none').length }));
    await clk('#r3d-t-pflip'); await settle(); await frames2();
    const fl1 = await page.evaluate(() => ({ tags: [...document.querySelectorAll('#r3d-labels .dim.src')].filter(e => e.style.display !== 'none').length, pcbFlip: RRU3D.dbg.state.flip,
      titles: [...document.querySelectorAll('#r3d-labels .ptitle')].filter(e => e.style.display !== 'none').map(e => e.textContent) }));
    const pcbUp = fl1.pcbFlip ? 'HSK 側朝上' : '濾波器側朝上';   // 「PCB 翻面」開著時再翻一次＝HSK 側朝上
    ok('拆機攤開＋翻轉：四件標題都改成翻面後朝上的那一面（PCB＝「PCB 翻面」與翻轉互斥或），貼在原本那一面上的參數標註收起來', fl0.tags > 0 && fl1.tags === 0 && fl1.titles.length === 4 && fl1.titles.every(t => /翻面/.test(t))
      && fl1.titles.some(t => /鰭片朝上/.test(t)) && fl1.titles.some(t => /^③ PCB/.test(t) && t.includes(pcbUp)), [fl0, fl1]);
    await clk('#r3d-t-pflip'); await settle();
    await clk('#tab3 [data-state="asm"]'); await settle(); await setSubset(['fil', 'shd']); await settle(); await clk('#r3d-t-pflip'); await settle();
    const sn = await page.evaluate(() => { const D = RRU3D.dbg, before = __mats(), u = RRU3D.snapshot(400, 250), after = __mats(); let d = 0;
      Object.keys(before).forEach(k => before[k].forEach((v, i) => { d = Math.max(d, Math.abs(v - after[k][i])); }));
      return { ok: !!u, d, pflip: D.state.pflip, solo: JSON.stringify(D.state.solo), diff: __diff().dp }; });
    ok('組裝＋濾波器＋屏蔽罩＋翻轉時產生報告用的 3D 圖 → 畫面上的姿態、部件組合、翻轉都原封不動', sn.ok && sn.d < 1e-9 && sn.pflip === true && sn.solo === '["fil","shd"]' && sn.diff < 1e-3, sn);
    // 翻轉時拖曳元件：只看 PCB 翻過來（濾波器側朝上）→ 拖 Final PA，元件跟著游標的方向走（不會反向）
    await flipOff(); await setSubset(['pcb']); await settle(); await clk('#r3d-t-pflip'); await settle(); await clk('#r3d-t-edit');
    const drags = [];
    for (const [dx, dy] of [[-60, 0], [0, -60], [60, 0], [0, 60]]) {
      const s0 = await page.evaluate(() => RRU3D.dbg.screenOf('c:Final PA#0'));
      await page.mouse.move(s0.x, s0.y); await page.mouse.down();
      await page.mouse.move(s0.x + dx * 0.3, s0.y + dy * 0.3, { steps: 3 }); await page.mouse.move(s0.x + dx, s0.y + dy, { steps: 6 });
      const s1 = await page.evaluate(() => RRU3D.dbg.screenOf('c:Final PA#0'));
      await page.mouse.up(); await page.waitForFunction(() => !RRU3D.dbg.busy(), null, { timeout: 30000 });
      drags.push([dx, dy, +(s1.x - s0.x).toFixed(1), +(s1.y - s0.y).toFixed(1)]);
    }
    // 碰到板邊／高度上限時只會少走（不會反向）→ 四個方向都不可反向，而且至少兩個方向完全跟著游標
    ok('翻轉時拖曳元件：往四個方向拖，元件都不會反向、沒被擋住的方向完全跟著游標（不會因為翻面而反向）',
      drags.every(([dx, dy, mx, my]) => dx * mx + dy * my >= 0) && drags.filter(([dx, dy, mx, my]) => dx * mx + dy * my > 0.85 * 3600).length >= 2, drags);
    await clk('#r3d-t-edit'); await flipOff(); await setSubset(null); await settle();
  }

  console.log('\n[P] 正交視圖左旋／右旋 90°、個別隱藏（元件／I/O／天線座）、專案名稱字型、FDD 通道配對、I/O 分類');
  {
    const idle = () => page.waitForFunction(() => !RRU3D.dbg.busy(), null, { timeout: 30000 });
    const view = async () => { await idle(); return page.evaluate(() => { const D = RRU3D.dbg; D.settle(); const r3 = v => Math.round(v * 1000) / 1000;
      return { up: D.camera.up.toArray().map(r3), roll: D.viewRoll(), cur: D.curView(), ortho: D.ortho(), p: D.camera.position.toArray(), t: D.controls.target.toArray() }; }); };
    const scr = k => page.evaluate(k => { RRU3D.dbg.settle(); const s = RRU3D.dbg.screenOf(k), r = document.getElementById('r3d-cv').getBoundingClientRect(); return { dx: s.x - (r.left + r.width / 2), dy: s.y - (r.top + r.height / 2) }; }, k);
    await page.click('#tab3 [data-state="asm"]'); await idle();

    // ── 左旋／右旋 ──
    await page.click('#tab3 .vc-cross [data-std="top"]'); const v0 = await view();
    const ioKey = await page.evaluate(() => 'io:' + RRU3D.dbg.ioList()[0].id), a0 = await scr(ioKey);
    await page.click('#tab3 [data-roll="1"]'); const v1 = await view(); const a1 = await scr(ioKey);
    ok('上視按「右旋」→ 畫面順時針轉 90°（I/O 端從畫面左邊轉到上面），仍是正交上視、依轉過去的方向重新對焦',
      v0.cur === 'top' && v0.ortho && JSON.stringify(v0.up) === '[0,0,-1]' && JSON.stringify(v1.up) === '[-1,0,0]' && v1.roll === 1 && v1.cur === 'top' && v1.ortho
      && a0.dx < 0 && Math.abs(a0.dx) > Math.abs(a0.dy) && a1.dy < 0 && Math.abs(a1.dy) > Math.abs(a1.dx), [v0.up, v1.up, v1.roll, a0, a1]);
    await page.click('#tab3 [data-roll="-1"]'); await page.click('#tab3 [data-roll="-1"]'); const v2 = await view();
    ok('連按兩次「左旋」（第二下在轉場途中）→ 從原本方向逆時針 90°', JSON.stringify(v2.up) === '[1,0,0]' && v2.roll === 3 && v2.cur === 'top', v2);
    await page.setViewportSize({ width: 1500, height: 950 }); await page.waitForTimeout(500); const v3 = await view();
    await page.setViewportSize({ width: 1600, height: 1000 }); await page.waitForTimeout(500); await idle();
    ok('畫面大小變了 → 重新對焦但保持轉向', JSON.stringify(v3.up) === '[1,0,0]' && v3.roll === 3 && v3.cur === 'top', v3);
    await page.click('#tab3 .vc-cross [data-std="top"]'); const v4 = await view();
    ok('再按一次「上」→ 回到原本的方向', JSON.stringify(v4.up) === '[0,0,-1]' && v4.roll === 0, v4);
    await page.click('#tab3 .vc-cross [data-std="front"]'); await page.click('#tab3 [data-roll="1"]'); const v5 = await view();
    await page.click('#tab3 .vc-cross [data-std="left"]'); const v6 = await view();
    ok('前視右旋（up＝−x）後換「左」視圖 → 新的正視圖從原本方向開始（不沿用上一個的轉向）', JSON.stringify(v5.up) === '[-1,0,0]' && v5.roll === 1 && v6.roll === 0 && JSON.stringify(v6.up) === '[0,1,0]', [v5, v6]);
    await page.click('#tab3 [data-view="iso"]'); const c0 = await view();
    await page.click('#tab3 [data-roll="1"]'); const c1 = await view();
    const cexp = await page.evaluate(c0 => { const V = RRU3D.dbg.camera.position.constructor, d = new V(...c0.p).sub(new V(...c0.t)).normalize(); return new V(...c0.up).applyAxisAngle(d, Math.PI / 2).toArray(); }, c0);
    ok('等角（不是正視圖）按右旋 → 原地繞視線轉 90°：相機位置、看的點不動；轉過就不再是預設視角', dist(c0.p, c1.p) < 1e-6 && dist(c0.t, c1.t) < 1e-6 && dist(cexp, c1.up) < 2e-3 && c0.cur === 'iso' && c1.cur === null, [c0.up, c1.up, cexp, c1.cur]);
    const rb = await page.evaluate(() => [...document.querySelectorAll('#tab3 .vc-cross [data-roll]')].map(b => ({ area: b.style.gridArea, label: b.getAttribute('aria-label'), svg: !!b.querySelector('svg') })));
    ok('十字鈕上有「左旋 90°」「右旋 90°」兩顆圖示鈕（在「上」的兩側）', rb.length === 2 && rb[0].label === '左旋 90°' && rb[1].label === '右旋 90°' && rb.every(b => b.svg) && /rl/.test(rb[0].area) && /rr/.test(rb[1].area), rb);
    await page.click('#tab3 [data-view="iso"]'); await idle();

    // ── 個別隱藏 ──
    const vis = k => page.evaluate(k => { let v = null; RRU3D.dbg.scene.traverse(o => { if (v === null && o.userData && o.userData.selKey === k) v = o.visible; }); return v; }, k);
    const pk = await page.evaluate(() => { const D = RRU3D.dbg, L = D.LAY(); let tim = null; D.HSK().traverse(o => { if (!tim && o.userData && o.userData.kind === 'tim' && o.userData.inst && o.userData.inst.row.qty === 1) tim = o.userData.inst; });
      const multi = L.inst.find(o => o.row.qty > 1 && o.role !== 'sfp');
      return { tim: tim && tim.row.name, timKey: tim && 'c:' + tim.key, multi: multi.row.name, qty: multi.row.qty, io: 'io:' + D.ioList()[1].id, ant: 'ant:' + D.antList()[0].id }; });
    const eyeClick = (name, i) => page.evaluate(([name, i]) => document.querySelector('#r3d-ctab .cr' + (i == null ? ':not(.sub)' : '.sub') + '[data-row="' + CSS.escape(name) + '"]' + (i == null ? '' : '[data-i="' + i + '"]') + ' .eye').click(), [name, i]);
    const timVis = k => page.evaluate(k => { const v = []; RRU3D.dbg.HSK().traverse(o => { if (o.userData && o.userData.kind === 'tim' && o.userData.inst && 'c:' + o.userData.inst.key === k) v.push(o.visible); }); return v; }, k);
    await eyeClick(pk.tim);
    const h1 = await page.evaluate(k => ({ eye: document.querySelector('#r3d-ctab .cr:not(.sub)[data-row="' + CSS.escape(k) + '"] .eye').getAttribute('aria-pressed'), bar: document.getElementById('r3d-hidebar').hidden,
      barT: document.getElementById('r3d-hidebar-t').textContent, tree: document.querySelector('#r3d-tree li[data-part="comp"] .nm').textContent }), pk.tim);
    ok('元件列的 👁 → 那一顆在 3D 隱藏（連同它的 TIM），其他元件照常；按鈕按下、左下出現「已隱藏 元件 1 · 全部顯示」、模型樹寫出數量',
      (await vis(pk.timKey)) === false && (await timVis(pk.timKey)).every(v => v === false) && (await timVis(pk.timKey)).length > 0 && (await vis('c:' + pk.multi + '#0')) === true
      && h1.eye === 'true' && !h1.bar && /元件\s*1/.test(h1.barT) && /個別隱藏 1/.test(h1.tree), [pk, h1]);
    await eyeClick(pk.multi, 1);
    const h2 = await page.evaluate(n => ({ row: document.querySelector('#r3d-ctab .cr:not(.sub)[data-row="' + CSS.escape(n) + '"] .eye').getAttribute('aria-pressed'),
      sub: document.querySelector('#r3d-ctab .cr.sub[data-row="' + CSS.escape(n) + '"][data-i="1"] .eye').getAttribute('aria-pressed') }), pk.multi);
    ok('多顆的列展開後可以只藏一顆（整列的 👁 顯示「部分」）', (await vis('c:' + pk.multi + '#1')) === false && (await vis('c:' + pk.multi + '#0')) === true && h2.row === 'mixed' && h2.sub === 'true', h2);
    await eyeClick(pk.multi);
    const h3 = await Promise.all(Array.from({ length: pk.qty }, (_, i) => vis('c:' + pk.multi + '#' + i)));
    ok('「部分」時按整列的 👁 → 整列都藏', h3.every(v => v === false), h3);
    await eyeClick(pk.multi);
    const h4 = await Promise.all(Array.from({ length: pk.qty }, (_, i) => vis('c:' + pk.multi + '#' + i)));
    ok('整列都藏時再按 → 整列顯示回來', h4.every(v => v === true), h4);
    // I/O：清單的 👁；天線座：3D 上選取後按「隱藏」鈕；再選一個按 H
    await page.click('#r3d-tab-io');
    await page.evaluate(k => document.querySelector('#r3d-io-list li[data-i="1"] .eye').click(), pk.io);
    await page.evaluate(k => RRU3D.dbg.select(k), pk.ant);
    const sb1 = await page.evaluate(() => ({ t: document.getElementById('r3d-selbar-hide').textContent, bar: !document.getElementById('r3d-selbar').hidden }));
    await page.click('#r3d-selbar-hide');
    const sb2 = await page.evaluate(() => ({ sel: RRU3D.dbg.sel(), bar: document.getElementById('r3d-selbar').hidden }));
    const antKey2 = await page.evaluate(() => 'ant:' + RRU3D.dbg.antList()[1].id);
    await page.evaluate(k => RRU3D.dbg.select(k), antKey2); await page.mouse.move(700, 400); await page.keyboard.press('h');
    const h5 = await page.evaluate(() => ({ n: RRU3D.dbg.hidKeys(), barT: document.getElementById('r3d-hidebar-t').textContent, sel: RRU3D.dbg.sel(),
      ioEye: document.querySelector('#r3d-io-list li[data-i="1"] .eye').getAttribute('aria-pressed'), antEye: document.querySelector('#r3d-ant-list li[data-i="0"] .eye').getAttribute('aria-pressed') }));
    ok('I/O 清單的 👁、選取後的「隱藏」鈕、H 鍵都能藏（藏了就取消選取）；I/O、天線座的 👁 同步按下', (await vis(pk.io)) === false && (await vis(pk.ant)) === false && (await vis(antKey2)) === false
      && sb1.bar && sb1.t === '隱藏' && sb2.sel === null && sb2.bar && h5.sel === null && h5.n.io === 1 && h5.n.ant === 2 && h5.ioEye === 'true' && h5.antEye === 'true' && /I\/O\s*1/.test(h5.barT) && /天線座\s*2/.test(h5.barT), [sb1, sb2, h5]);
    // 重建（重算、改參數）照樣藏；報告用的 3D 圖全部顯示、拍完還原
    await page.evaluate(() => { recalc(); renderTab3(true); }); await idle();
    const h6 = [await vis(pk.timKey), await vis(pk.io), await vis(pk.ant)];
    const sn = await page.evaluate(() => { const D = RRU3D.dbg, u = RRU3D.snapshot(400, 250); return { ok: !!u, n: D.hidKeys(), bar: document.getElementById('r3d-hidebar').hidden }; });
    ok('重算、重建後照樣藏；產生報告用的 3D 圖後隱藏狀態原封不動', h6.every(v => v === false) && sn.ok && sn.n.c === 1 && sn.n.io === 1 && sn.n.ant === 2 && !sn.bar && (await vis(pk.timKey)) === false, [h6, sn]);
    await page.click('#r3d-hidebar-all');
    const h7 = await page.evaluate(() => ({ n: RRU3D.dbg.HIDEI.size, bar: document.getElementById('r3d-hidebar').hidden }));
    ok('「全部顯示」→ 全部回來、左下提示收起', h7.n === 0 && h7.bar && (await vis(pk.timKey)) === true && (await vis(pk.io)) === true && (await vis(pk.ant)) === true, h7);
    await eyeClick(pk.tim);
    await page.evaluate(() => { const d = build3dData(); d.key = '__other__'; RRU3D.update(d, { onEdit: r3dOnEdit, onSave: r3dSave }); }); await idle();
    const h8 = await page.evaluate(() => RRU3D.dbg.HIDEI.size);
    await page.evaluate(() => renderTab3(true)); await idle();
    const l3dStr = await page.evaluate(() => JSON.stringify(layout3d || {}));
    ok('換專案 → 個別隱藏清掉（只在這次檢視、不存檔）', h8 === 0 && (await vis(pk.timKey)) === true && !/hid|HIDE/.test(l3dStr), [h8, l3dStr]);

    // ── 專案名稱：圓體字、清楚的顏色 ──
    const pn = await page.evaluate(() => { const cs = getComputedStyle(document.getElementById('r3d-pname')); return { ff: cs.fontFamily, fw: cs.fontWeight, color: cs.color, syn: cs.getPropertyValue('font-synthesis') }; });
    ok('右下角專案名稱：圓體字（Arial Rounded MT Bold，沒有就 Nunito）、亮藍字面（#1f6fd6）、不假粗體', /^"?Arial Rounded MT Bold/.test(pn.ff) && /Nunito/.test(pn.ff) && pn.color === 'rgb(31, 111, 214)' && pn.fw === '800' && /none/.test(pn.syn), pn);

    // ── I/O 分類 ──
    await page.click('#r3d-tab-io');
    const io1 = await page.evaluate(() => ({ add: [...document.querySelectorAll('#r3d-io-add-t optgroup')].map(g => g.label + '：' + [...g.children].map(o => o.value).join(',')),
      rowSel: [...document.querySelectorAll('#r3d-io-list .p-t')].map(s => s.value), types: RRU3D.dbg.ioList().map(it => it.type) }));
    ok('I/O 類型分三大類：SFP／電源、Signal（RJ45 等、AISG）、Debug port；接地歸其他；清單的下拉照原本的類型', JSON.stringify(io1.add) === JSON.stringify(['SFP／電源：sfp,pwr', 'Signal：rj45,aisg', 'Debug port：dbg', '其他：gnd'])
      && JSON.stringify(io1.rowSel) === JSON.stringify(io1.types), io1);
    await page.evaluate(() => { const L = RRU3D.dbg.ioList(), keep = L.filter(it => it.type === 'sfp');
      L.splice(0, L.length, ...keep, ...['pwr', 'rj45', 'aisg', 'dbg', 'gnd', 'xyz'].map((t, i) => ({ id: 'p' + i, type: t, pos: null }))); RRU3D.dbg.saveEdit(); RRU3D.dbg.rebuild(null, true); });
    await idle();
    const io2 = await page.evaluate(() => { const D = RRU3D.dbg, g = {}; D.HSK().userData.io.children.forEach(pg => { if (!pg.userData.port) return; const ms = []; pg.traverse(o => { if (o.isMesh) { o.geometry.computeBoundingBox(); const s = o.geometry.boundingBox.getSize(o.position.clone()); ms.push([o.material.color.getHexString(), +s.y.toFixed(1), +s.z.toFixed(1)]); } }); g[pg.userData.port.it.type] = ms; });
      return { g, rows: [...document.querySelectorAll('#r3d-io-list li')].length, list: D.ioList().length, sel: [...document.querySelectorAll('#r3d-io-list .p-t')].map(s => s.value),
        unk: [...document.querySelectorAll('#r3d-io-list .p-t')].pop().selectedOptions[0].textContent, tags: [...document.querySelectorAll('#r3d-labels .ptag')].map(e => e.textContent) }; });
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    ok('電源口跟 SFP 光口同一種外觀（白色凸台＋金屬框＋黑色開口，寬 19）', io2.g.pwr && io2.g.sfp && same(io2.g.pwr.map(m => m[0]), io2.g.sfp.map(m => m[0])) && io2.g.pwr[0][2] === 19, [io2.g.pwr, io2.g.sfp]);
    ok('Debug port＝金屬框＋黑色開口（寬 28、高 14）；Signal＝圓形防水座', io2.g.dbg && io2.g.dbg.length === 2 && io2.g.dbg[0][1] === 14 && io2.g.dbg[0][2] === 28 && io2.g.rj45 && io2.g.rj45.length === 3, [io2.g.dbg, io2.g.rj45]);
    ok('I/O 清單在程式改了之後（同一個專案）跟著重畫：列數、類型一致；不認得的類型標「（未知）」不靜默改掉', io2.rows === io2.list && same(io2.sel, [...Array(io2.list - 6).fill('sfp'), 'pwr', 'rj45', 'aisg', 'dbg', 'gnd', 'xyz']) && /未知/.test(io2.unk), io2);

    // ── FDD 通道配對：每一顆 Final PA 自帶一組 Pre-driver／Driver／環形器（使用者畫的圖：2 排 × 4 路） ──
    await page.click('#r3d-tab-comp');
    const tdd = await page.evaluate(() => ({ avail: RRU3D.dbg.pairPlan().avail, hidden: document.getElementById('r3d-pair').hidden }));
    ok('TDD（每種 RF 元件都是通道數 4 顆）→ 不出現通道配對', !tdd.avail && tdd.hidden, tdd);
    const V0 = await page.evaluate(() => calcResults.Volume_L);
    // 三種資料形狀（仿備份裡的真實 FDD 專案）：A＝只有 PA 分頻段、Driver／Pre／環形器各 8 顆沒拆；B＝Pre／Driver 拆開但高度交錯、環形器 8 顆沒拆；C＝全部拆開、各組高度不重疊
    const fddLoad = (kind, pa1) => page.evaluate(([kind, pa1]) => {
      if (!window.__rfKeep) { window.__rfKeep = JSON.parse(JSON.stringify(components.rf)); window.__specKeep = dbSpecs3dCache; }
      const rf = window.__rfKeep, base = n => JSON.parse(JSON.stringify(rf.find(x => x.Component === n))), specs = {};
      const mk = (src, name, qty, h, type, sz) => { const c = base(src); c.Component = name; c.Qty = qty; c['Height(mm)'] = h; c.Type = type; delete c._cid; specs[name] = { size: sz, h: 2, proj: 'demo' }; return c; };
      const pa = (n, h) => mk('Final PA', n, 4, h, 'Final PA', '25.4*9.78'), dv = (n, q, h) => mk('Driver PA', n, q, h, 'Driver', '12*7');
      const pr = (n, q, h) => mk('Pre Driver', n, q, h, 'Pre-driver', '3*3'), cr = (n, q, h) => mk('Circulator', n, q, h, 'CR', '10*10');
      const fil = Object.assign(base('Cavity Filter'), { Qty: 8 }); delete fil._cid;
      components.rf = kind === 'A' ? [dv('Driver-B8B20B28', 8, 250), pa('Final-B8', pa1 || 320), pa('Final-B20B28', 400), pr('PreDriver', 8, 210), cr('Circulators', 8, 450), fil]
        : kind === 'B' ? [pa('Final-B3', 400), pa('Final-B1', 320), dv('Driver-B3', 4, 270), dv('Driver-B1', 4, 250), pr('PreDriver-B3', 4, 230), pr('PreDriver-B1', 4, 210), fil, cr('Circulators', 8, 450)]
        : [pa('Final-B8', 200), pa('Final-B20B28', 400), dv('Driver-B8', 4, 150), dv('Driver-B20B28', 4, 350), pr('Pre-B8', 4, 110), pr('Pre-B20B28', 4, 310), cr('CR-B8', 4, 250), cr('CR-B20B28', 4, 450), fil];
      dbSpecs3dCache = specs; CompMerge.ensureCids(components.rf);
      document.getElementById('L_pcb').value = 510; document.getElementById('W_pcb').value = 385;   // 真實 FDD 專案的 PCB 大小
      recalc(); renderTab3(true);
    }, [kind, pa1 || 0]);
    // 每一路每一組的發射鏈：[名稱, 高度（3D）, 元件清單的高度, fdd, 橫向偏離那一格中心]
    const fddState = () => page.evaluate(() => {
      const D = RRU3D.dbg, L = D.LAY(), g = D.P().g, z0 = g.Left, lw = L.laneW, FD = L.fdd;
      const chains = [];
      for (let lane = 0; lane < L.N; lane++) for (let gi = 0; gi < L.G; gi++) chains.push({ lane, grp: gi, m: L.inst.filter(o => o.lane === lane && o.grp === gi).sort((a, b) => a.x - b.x)
        .map(o => ({ n: o.row.name, role: o.role, x: +(o.x - g.Btm).toFixed(2), h: o.hgt, fdd: o.fdd, bL: o.bL, sub: o.sub, subN: o.subN,
          dz: +Math.abs(o.z - (z0 + lw * o.lane + lw / o.subN * (Math.max(0, o.sub) + 0.5))).toFixed(2) })) });
      return { N: L.N, G: L.G, on: L.pair.on, mode: FD && FD.mode, s: FD && FD.s, why: FD && FD.why, shared: FD ? FD.F.shared.map(r => r.name) : [], fixed: FD ? FD.F.fixed.map(r => r.name) : [],
        ord: FD ? FD.ord.map(D.grpLabel) : [], chains, overlap: L.inst.filter(o => o.overlap).length, merged: L.shd.cells.filter(c => c.keep.merged).map(c => c.keep.label),
        conns: L.conns.map(c => [c.lane, c.grp, c.ref.role, c.ref.grp]), circCells: L.shd.cells.filter(c => c.keep.roles.includes('circ')).map(c => c.keep.label),
        t: document.getElementById('r3d-pair-t').textContent, box: document.getElementById('r3d-pair').hidden, pressed: document.querySelector('#r3d-pair [data-pair="1"]').getAttribute('aria-pressed') };
    });
    const ORD = ['pre', 'drv', 'pa', 'circ'];
    const chainOk = c => c.m.length === 4 && same(c.m.map(o => o.role), ORD);                       // 一條鏈＝Pre → Driver → PA → 環形器（由下往上）
    const noGap = (lo, hi) => Math.max(...lo.m.map(o => o.x + o.bL / 2)) < Math.min(...hi.m.map(o => o.x - o.bL / 2));   // 下面那一組整條都在上面那一組下方
    await fddLoad('A'); await idle();
    const fa1 = await fddState();
    ok('FDD：2 種 Final PA 各 4 顆 → 4 路 × 2 組；Driver／Pre-driver／環形器（各 8 顆、沒拆）自動偵測、預設開', fa1.N === 4 && fa1.G === 2 && fa1.on && !fa1.box && fa1.pressed === 'true'
      && same(fa1.shared, ['Driver-B8B20B28', 'PreDriver', 'Circulators']) && !fa1.fixed.length, fa1);
    ok('每一顆 PA 自帶一組：8 條完整的發射鏈（Pre-driver → Driver → PA → 環形器），上下排（B8 在下、B20B28 在上），每一路一欄、都在那一路正中間',
      fa1.mode === 'stack' && fa1.chains.length === 8 && fa1.chains.every(chainOk) && same(fa1.ord, ['B8', 'B20B28'])
      && [0, 1, 2, 3].every(l => noGap(fa1.chains[l * 2], fa1.chains[l * 2 + 1])) && fa1.chains.every(c => c.m.every(o => o.dz < 0.01 && o.sub === -1)) && fa1.overlap === 0, fa1.chains.slice(0, 2));
    ok('Final PA 照元件清單的高度（320、400＝溫度計算的位置）；沒拆的列由 3D 自動錯開、緊跟在自己那一顆 PA 旁邊（元件清單的高度照舊＝溫度計算用）',
      fa1.chains.every(c => c.m.every(o => o.fdd === (o.role === 'pa' ? 'fixed' : 'auto'))) && fa1.chains.every(c => { const p = c.m.find(o => o.role === 'pa'); return p.x === p.h; })
      && fa1.chains.every(c => { const p = c.m.find(o => o.role === 'pa'), d = c.m.find(o => o.role === 'drv'); return d.h === 250 && d.x !== 250 && p.x - d.x < 30; }), fa1.chains.slice(0, 2).map(c => c.m.map(o => [o.role, o.x, o.h])));
    ok('每一路每一組的腔體各自一格（沒有合併）、盲插接頭 8 個（跟著那一組的環形器）', !fa1.merged.length && fa1.conns.length === 8 && fa1.conns.every(([l, gi, role, g2]) => role === 'circ' && g2 === gi)
      && fa1.circCells.length === 8 && fa1.circCells.includes('CH1 B8 · 環形器') && fa1.circCells.includes('CH4 B20B28 · 環形器'), [fa1.merged, fa1.conns, fa1.circCells]);
    ok('兩種 PA 只差 80 mm → 疊不下完整的屏蔽罩腔體：縮小留邊（s < 1）並在說明寫出來；說明也寫出怎麼排、溫度計算照清單、要分開指定就拆成兩列',
      fa1.s < 1 && /上下排/.test(fa1.t) && /B8 在下、B20B28 在上/.test(fa1.t) && /自動錯開/.test(fa1.t) && /溫度計算照元件清單的高度/.test(fa1.t) && /拆成 2 列（例：Driver-B8、Driver-B20B28）/.test(fa1.t)
      && /兩種 PA 只差 80 mm/.test(fa1.t), [fa1.s, fa1.t]);
    const fa2 = await page.evaluate(() => {
      const D = RRU3D.dbg, L = D.LAY(), g = D.P().g, au = L.inst.find(o => o.row.name === 'Driver-B8B20B28' && o.lane === 0 && o.grp === 1), pa = L.inst.find(o => o.row.name === 'Final-B20B28' && o.lane === 0);
      const tip = D.tipHtml(au), tAu = D.selTarget('c:' + au.key), jAu = D.selJob('c:' + au.key, 'v', 1), jAuZ = D.selJob('c:' + au.key, 'z', 1);
      const row = [...document.querySelectorAll('#r3d-ctab .cr:not(.sub)')].find(r => r.dataset.row === 'Driver-B8B20B28');
      const sub = [...document.querySelectorAll('#r3d-ctab .cr.sub[data-row="Driver-B8B20B28"] .c-ch')].map(e => e.textContent);
      // 拖 B20B28 的 PA 往上 30 mm（即時預覽）：它那一組自動錯開的元件跟著上移，B8 那一組不動
      const before = L.inst.filter(o => o.fdd === 'auto').map(o => [o.key, o.grp, o.x]);
      const tPa = D.selTarget('c:' + pa.key); tPa.live(null, 430);
      const moved = L.inst.filter(o => o.fdd === 'auto').map(o => { const b = before.find(q => q[0] === o.key); return [o.grp, +(o.x - b[2]).toFixed(2)]; });
      D.rebuild(null, true);
      return { tip, lockAu: tAu.lockH, lockPa: tPa.lockH, jAu, jAuZ: !!jAuZ, small: row.querySelector('.cn small').textContent, title: row.querySelector('.c-h').title, sub, moved,
        backPa: +(D.LAY().inst.find(o => o.row.name === 'Final-B20B28' && o.lane === 0).x - g.Btm).toFixed(2), hgt: components.rf.find(c => c.Component === 'Final-B20B28')['Height(mm)'] };
    });
    ok('自動錯開的元件只能左右拖（上下鎖住，↑↓ 也不動）；PA 照常可以上下拖', fa2.lockAu && fa2.jAu === null && fa2.jAuZ && !fa2.lockPa, fa2);
    ok('游標提示寫出兩個高度：元件相對高度（溫度計算用）＋3D 位置（自動錯開，緊跟哪一組的 PA）', /溫度計算用/.test(fa2.tip) && /3D 位置/.test(fa2.tip) && /緊跟 B20B28 那一顆 PA/.test(fa2.tip)
      && (!/拖曳/.test(fa2.tip) || /上下由通道配對自動排/.test(fa2.tip)), fa2.tip);
    ok('元件分頁：那一列標「3D 自動錯開」、高度欄說明寫出各組的 3D 位置、展開後每一顆寫出 CH／組／3D 位置', /3D 自動錯開/.test(fa2.small) && /B8 \d+(\.\d)?／B20B28 \d+(\.\d)? mm/.test(fa2.title)
      && /這格只影響溫度計算/.test(fa2.title) && /^CH1 B8 · 3D \d/.test(fa2.sub[0]) && /^CH1 B20B28 · 3D \d/.test(fa2.sub[1]), [fa2.small, fa2.title, fa2.sub.slice(0, 2)]);
    ok('拖 PA 上下（即時預覽）→ 它那一組自動錯開的元件跟著往上移（另一組照舊緊跟自己的 PA：兩排之間空間變大 → 縮小的腔體留邊跟著放寬，只微調）；沒放開就不寫回（元件清單不變）',
      fa2.moved.every(([gi, d]) => gi === 1 ? d > 10 : Math.abs(d) < 15) && fa2.backPa === 400 && fa2.hgt === 400, fa2.moved);
    await fddLoad('A', 200); await idle();
    const fa3 = await fddState();
    ok('把 B8 的 PA 拉到 200 mm（空間夠）→ 腔體完整（s = 1）、不再提醒；發射鏈照舊緊跟各自的 PA', fa3.mode === 'stack' && fa3.s === 1 && !/只差/.test(fa3.t) && fa3.chains.every(chainOk)
      && [0, 1, 2, 3].every(l => noGap(fa3.chains[l * 2], fa3.chains[l * 2 + 1])) && !fa3.merged.length && fa3.overlap === 0, [fa3.s, fa3.chains[0].m.map(o => [o.role, o.x])]);
    await fddLoad('B'); await idle();
    const fb1 = await fddState();
    ok('拆開的列（Driver-B1 250／B3 270、Pre 210／230）高度交錯 → 每一路左右並排（每一組一格），拆開的列照元件清單的高度；說明寫出原因',
      fb1.mode === 'side' && fb1.why === 'inter' && same(fb1.fixed.slice().sort(), ['Driver-B1', 'Driver-B3', 'PreDriver-B1', 'PreDriver-B3']) && same(fb1.shared, ['Circulators'])
      && fb1.chains.every(c => chainOk(c) && c.m.every(o => o.sub === c.grp && o.subN === 2 && o.dz < 0.01)) && fb1.chains.every(c => c.m.every(o => o.fdd === 'auto' || o.x === o.h))
      && /左右並排/.test(fb1.t) && /高度交錯（Driver-B1 250、Driver-B3 270）/.test(fb1.t) && /已拆開的列/.test(fb1.t) && fb1.overlap === 0, [fb1.mode, fb1.chains.slice(0, 2), fb1.t]);
    ok('沒拆的環形器（8 顆）照樣自動錯開：緊跟在各自那一顆 PA 上方（B1 的在 320 上方、B3 的在 400 上方）', fb1.chains.every(c => { const p = c.m.find(o => o.role === 'pa'), r = c.m.find(o => o.role === 'circ');
      return r.fdd === 'auto' && r.x > p.x && r.x - p.x < 35; }) && fb1.conns.length === 8 && !fb1.merged.length, fb1.chains.slice(0, 2).map(c => c.m.map(o => [o.role, o.x])));
    await fddLoad('C'); await idle();
    const fc1 = await fddState();
    ok('全部拆開、各組高度不重疊 → 上下排，每一顆都在元件清單的高度（照拆後的方式排，沒有自動錯開）', fc1.mode === 'stack' && fc1.s === 1 && !fc1.shared.length && fc1.fixed.length === 6
      && fc1.chains.every(c => chainOk(c) && c.m.every(o => o.fdd === 'fixed' && o.x === o.h && o.dz < 0.01)) && /已拆開的列/.test(fc1.t) && !/自動錯開/.test(fc1.t) && fc1.overlap === 0, [fc1.chains[0].m, fc1.t]);
    // 開關：關掉＝舊排法；存進 layout3d.pair、重新載入照樣是關的
    await fddLoad('A'); await idle();
    const Von = await page.evaluate(() => calcResults.Volume_L);
    await page.click('#r3d-pair [data-pair="0"]'); await idle();
    const f2 = await page.evaluate(() => { const L = RRU3D.dbg.LAY(); return { on: L.pair.on, G: L.G, fdd: L.fdd, lanes: L.inst.filter(o => o.row.name === 'Circulators').map(o => o.lane), conns: L.conns.length, l3d: layout3d && layout3d.pair,
      dirty: projectIsDirty(), V: calcResults.Volume_L, auto: L.inst.filter(o => o.fdd).length, pressed: document.querySelector('#r3d-pair [data-pair="0"]').getAttribute('aria-pressed') }; });
    ok('關掉 → 舊排法（共用的元件不分路、盲插每一路一個、沒有自動錯開）；存成 layout3d.pair = false、專案標成未存；溫度計算完全不變', !f2.on && f2.G === 0 && !f2.fdd && !f2.auto && f2.lanes.every(l => l === -1) && f2.conns === 4 && f2.l3d === false
      && f2.dirty && f2.pressed === 'true' && f2.V === Von, f2);
    const sv = await page.evaluate(async () => { window.__writes = []; await cloudSaveProject(); const id = currentProjectId, db = (window.__db.projects[id] || {}).layout3d;
      await cloudLoadOne(id, { silent: true }); renderTab3(true); return { id, db: db && db.pair, back: RRU3D.dbg.LAY().pair.on, l3d: layout3d && layout3d.pair }; });
    await idle();
    ok('存檔寫進共用 DB（layout3d.pair = false）、重新載入照樣是關的', sv.db === false && sv.back === false && sv.l3d === false, sv);
    await page.click('#r3d-pair [data-pair="1"]'); await idle();
    const f3 = await page.evaluate(() => ({ on: RRU3D.dbg.LAY().pair.on, mode: RRU3D.dbg.LAY().fdd && RRU3D.dbg.LAY().fdd.mode, l3d: layout3d ? ('pair' in layout3d) : false }));
    ok('再打開 → 回到通道配對（上下排；開著不寫 key）', f3.on && f3.mode === 'stack' && !f3.l3d, f3);
    // 非 FDD：TDD 但環形器 8 顆（例：環形器＋隔離器）→ 每一路 2 顆並排，腔體各自一格、盲插仍是每一路一個
    await page.evaluate(() => { components.rf = JSON.parse(JSON.stringify(window.__rfKeep)); components.rf.find(x => x.Component === 'Circulator').Qty = 8; recalc(); renderTab3(true); });
    await idle();
    const f4 = await page.evaluate(() => { const L = RRU3D.dbg.LAY(); return { avail: L.pair.avail, fdd: L.pair.fdd, G: L.G, cr: L.inst.filter(o => o.role === 'circ').map(o => [o.lane, o.sub, o.grp]), conns: L.conns.length,
      cells: L.shd.cells.filter(c => c.keep.roles.includes('circ')).length, t: document.getElementById('r3d-pair-t').textContent }; });
    ok('非 FDD（只有一種 Final PA）但環形器 8 顆 → 也分到每一路（2 顆並排、各自一格腔體），盲插仍每一路一個', f4.avail && !f4.fdd && f4.G === 0 && f4.cr.every(([l, s, g], i) => l === Math.floor(i / 2) && s === i % 2 && g === -1)
      && f4.conns === 4 && f4.cells === 8 && !/偵測到 FDD/.test(f4.t), f4);
    await page.evaluate(() => { components.rf = window.__rfKeep; dbSpecs3dCache = window.__specKeep; recalc(); renderTab3(true); }); await idle();
  }

  console.log('\n[Q] 元件預設轉向：Final PA／Driver 預設轉 90°（長邊橫跨訊號方向，全部專案）、銅塊底板固定跟著板子、舊資料的 rot 轉成 turn');
  {
    const idle = () => page.waitForFunction(() => !RRU3D.dbg.busy(), null, { timeout: 30000 });
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    await page.evaluate(() => { layout3d = null; renderTab3(true); }); await idle();
    const rowOf = (name) => page.evaluate(n => { const L = RRU3D.dbg.LAY(); return L.inst.filter(o => o.row.name === n).map(o => ({ rot: o.rot, turn: o.turn, bL: o.bL, bW: o.bW, cL: o.cL, cW: o.cW, fpL: o.fpL, fpW: o.fpW, bodyL: o.body.L, bodyW: o.body.W })); }, name);
    const q1 = await page.evaluate(() => { const L = RRU3D.dbg.LAY(), by = {}; L.inst.forEach(o => { (by[o.role] = by[o.role] || []).push(o.rot ? (o.turn ? 'T' : 'R') : (o.turn ? 't' : '0')); });
      return Object.fromEntries(Object.entries(by).map(([k, v]) => [k, v.join('')])); });
    ok('Final PA、Driver 預設轉 90°（沒有使用者調整）；其他元件（Pre-driver、環形器、FPGA、DDR、SFP…）照 AI-Thermal 規格的方向', /^R+$/.test(q1.pa) && /^R+$/.test(q1.drv)
      && Object.entries(q1).filter(([k]) => k !== 'pa' && k !== 'drv').every(([, v]) => /^0+$/.test(v)), q1);
    const pa0 = (await rowOf('Final PA'))[0];
    const plate = await page.evaluate(() => { RRU3D.dbg.PCB().updateMatrixWorld(true); const out = [];
      RRU3D.dbg.PCB().traverse(m => { if (m.isMesh && m.userData.sec === 'cu' && m.userData.inst && m.userData.inst.key === 'Final PA#0') { m.geometry.computeBoundingBox(); const bb = m.geometry.boundingBox.clone().applyMatrix4(m.matrixWorld), s = bb.max.clone().sub(bb.min); out.push([+s.x.toFixed(1), +s.y.toFixed(2), +s.z.toFixed(1)]); } });
      const g = RRU3D.dbg.P().g; return { out, Coin: [g.Coin_L, g.Coin_W, g.Coin_T] }; });
    const [CL, CW] = plate.Coin, big = plate.out.find(v => Math.abs(v[0] - CL) < 0.2 && Math.abs(v[2] - CW) < 0.2), ped = plate.out.find(v => v !== big);
    ok('銅塊底板固定跟著板子方向（Coin_L 沿長度、Coin_W 沿寬度），只有凸台（＝PA 本體）跟著轉 → 元件佔的板面跟轉之前一樣，8T8R 窄通道也不會擠',
      !!big && !!ped && Math.abs(ped[0] - pa0.bodyW) < 0.2 && Math.abs(ped[2] - pa0.bodyL) < 0.2 && pa0.cL === CL && pa0.cW === CW && pa0.fpL === Math.max(pa0.bL, CL) && pa0.fpW === Math.max(pa0.bW, CW), [plate, pa0]);
    // 元件分頁：整列的 ⟳＝跟預設方向差 90°
    await page.click('#r3d-tab-comp');
    const btn = n => page.evaluate(n => { const b = [...document.querySelectorAll('#r3d-ctab .cr:not(.sub)')].find(r => r.dataset.row === n).querySelector('.c-rot'); return { p: b.getAttribute('aria-pressed'), t: b.title }; }, n);
    const clickRot = n => page.evaluate(n => [...document.querySelectorAll('#r3d-ctab .cr:not(.sub)')].find(r => r.dataset.row === n).querySelector('.c-rot').click(), n);
    const b1 = await btn('Final PA'), tip0 = await page.evaluate(() => RRU3D.dbg.tipHtml(RRU3D.dbg.LAY().inst.find(o => o.row.name === 'Final PA')));
    ok('預設轉的不算「使用者轉過」：⟳ 沒按下、說明寫出預設已轉 90°；游標提示寫「預設轉 90°」', b1.p === 'false' && /預設已轉 90°/.test(b1.t) && /（預設轉 90°）/.test(tip0), [b1, tip0.match(/本體.{0,60}/)]);
    await clickRot('Final PA'); await idle();
    const q2 = { row: await rowOf('Final PA'), b: await btn('Final PA'), l3d: await page.evaluate(() => JSON.parse(JSON.stringify(layout3d))), cid: await page.evaluate(() => components.rf.find(c => c.Component === 'Final PA')._cid),
      tip: await page.evaluate(() => RRU3D.dbg.tipHtml(RRU3D.dbg.LAY().inst.find(o => o.row.name === 'Final PA'))) };
    ok('按 ⟳ → 整列轉回原方向（長邊沿長度）；存成 layout3d.turn[_cid] = [90,…]（不寫舊的 rot）、⟳ 按下、提示寫「轉回原方向」', q2.row.every(o => !o.rot && o.turn) && q2.b.p === 'true'
      && q2.l3d && q2.l3d.turn && same(q2.l3d.turn[q2.cid], [90, 90, 90, 90]) && !('rot' in q2.l3d) && /（轉回原方向）/.test(q2.tip), q2);
    await clickRot('Final PA'); await idle();
    const q3 = { row: await rowOf('Final PA'), l3d: await page.evaluate(() => layout3d && JSON.parse(JSON.stringify(layout3d))) };
    ok('再按一次 → 回到預設（轉 90°），layout3d 不留 turn', q3.row.every(o => o.rot && !o.turn) && !(q3.l3d && q3.l3d.turn), q3);
    // 單顆：選取 → R
    await page.evaluate(() => { RRU3D.dbg.select('c:Driver PA#1'); RRU3D.dbg.rotateSel(); }); await idle();
    const q4 = await rowOf('Driver PA');
    ok('選一顆 Driver 按 R → 只有那一顆轉回原方向，其他照預設', q4.every((o, i) => i === 1 ? !o.rot && o.turn : o.rot && !o.turn), q4.map(o => [o.rot, o.turn]));
    await page.evaluate(() => { RRU3D.dbg.select('c:Driver PA#1'); RRU3D.dbg.rotateSel(); RRU3D.dbg.select(null); }); await idle();
    // 舊資料：layout3d.rot（絕對角度，0＝原方向，一列裡沒動過的也補 0）
    const mig = await page.evaluate(() => { const rf = components.rf, pa = rf.find(c => c.Component === 'Final PA'), cr = rf.find(c => c.Component === 'Circulator');
      layout3d = { rot: { [pa._cid]: [90, 0, 0, 0], [cr._cid]: [0, 90, 0, 0] } }; renderTab3(true); return { pa: pa._cid, cr: cr._cid }; });
    await idle();
    const q5 = { pa: await rowOf('Final PA'), cr: await rowOf('Circulator') };
    ok('舊資料轉換：PA 的舊 rot 一律回到新的預設（舊的 90＝現在的預設、0＝沒動過）；環形器的舊 90 照舊（變成 turn）', q5.pa.every(o => o.rot && !o.turn) && q5.cr.every((o, i) => i === 1 ? o.rot && o.turn : !o.rot && !o.turn), q5);
    await page.evaluate(() => RRU3D.dbg.saveEdit()); await idle();
    const q6 = await page.evaluate(ids => ({ l3d: JSON.parse(JSON.stringify(layout3d)), ids }), mig);
    ok('轉換後一有調整就寫成新格式：layout3d.turn 只有環形器那一列、舊的 rot 不再寫', q6.l3d.turn && same(Object.keys(q6.l3d.turn), [mig.cr]) && same(q6.l3d.turn[mig.cr], [0, 90, 0, 0]) && !('rot' in q6.l3d), q6);
    await page.evaluate(() => { layout3d = null; renderTab3(true); }); await idle();
  }

  ok('沒有 JS 錯誤', errors.length === 0, errors);
  await browser.close();

  console.log('\n[K] 瀏覽器沒有 WebGL：工具照常可用、Tab3 顯示原因、沒有未攔截的錯誤');
  const b2 = await chromium.launch(Object.assign(EXEC ? { executablePath: EXEC } : {}, { args: ['--disable-webgl', '--disable-webgl2', '--disable-3d-apis', '--disable-gpu'] }));
  const p2 = await (await b2.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  await p2.route('**', r => {
    const u = r.request().url(), m = u.match(/cdn\.jsdelivr\.net\/npm\/three@0\.170\.0\/(build|examples\/jsm)\/(.+)$/);
    if (m && THREE_DIR) return r.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(path.join(THREE_DIR, m[1] === 'build' ? 'build' : 'jsm', m[2])) });
    if (m || u.startsWith(root)) return r.continue();
    return r.abort();
  });
  await p2.addInitScript(() => {
    window.Plotly = { newPlot(){}, Plots:{resize(){}}, relayout(){}, purge(){}, toImage: async()=>'' };
    window.msal = { PublicClientApplication: class { async initialize(){} async handleRedirectPromise(){return null} getAllAccounts(){return []} } };
    window.alert = () => {}; window.__load = false; window.addEventListener('load', () => { window.__load = true; });
  });
  const err2 = [];
  p2.on('pageerror', e => err2.push(String(e)));
  await p2.goto(BASE, { waitUntil: 'domcontentloaded' });
  await p2.fill('#login-pw', 'tedus');
  await p2.click('#login-page button');
  await p2.waitForFunction(() => typeof calcResults !== 'undefined' && calcResults && calcResults.rows.length > 0);
  await p2.waitForFunction(() => !!window.__rru3dFail, null, { timeout: 60000 });
  await p2.evaluate(() => switchTab(3));
  await p2.waitForTimeout(300);
  const j = await p2.evaluate(() => ({ fail: window.__rru3dFail, api: !!window.RRU3D, load: window.__load, V: calcResults.Volume_L,
    msg: document.getElementById('tab3-msg').textContent, msgHidden: document.getElementById('tab3-msg').hidden, box: document.getElementById('tab3-3d').hidden }));
  ok('沒有 WebGL → Tab3 顯示原因、3D 視窗收起來；頁面照常載入、體積照算', j.fail === 'webgl' && !j.api && /WebGL/.test(j.msg) && !j.msgHidden && j.box && j.load && j.V > 0, j);
  ok('沒有未攔截的錯誤（模組停在 WebGL 那一步，不丟例外）', err2.length === 0, err2);
  await b2.close();

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
