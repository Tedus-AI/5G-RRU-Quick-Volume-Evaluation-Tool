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
    const overlays = [...root.querySelectorAll('.tools .tgrp, #r3d-vcube > *, #r3d-hint, #r3d-selbar')].filter(vis).map(R);
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
  await page.evaluate(() => setSidebarCollapsed(false));
  await page.waitForTimeout(900);
  K.open = await measure();
  // 自己縮放過 → 畫面大小再變也不重新對焦（不搶使用者的鏡頭）
  const zm = await page.evaluate(async () => {
    const D = RRU3D.dbg, sl = ms => new Promise(r => setTimeout(r, ms));
    document.getElementById('r3d-cv').dispatchEvent(new WheelEvent('wheel', { deltaY: -240, bubbles: true, cancelable: true })); await sl(700);
    const c0 = D.camera.position.clone(), fs0 = JSON.stringify(D.frameSize());
    setSidebarCollapsed(true); await sl(900);
    return { view: D.curView(), moved: +D.camera.position.distanceTo(c0).toFixed(2), sameFrame: JSON.stringify(D.frameSize()) === fs0, collapsed: document.body.classList.contains('sidebar-collapsed') };
  });
  await page.setViewportSize({ width: 1600, height: 1000 });
  ok('切到 3D 頁時參數控制台自動收合 → 1440×900 也是 3D 畫面＋編輯面板並排（3D ≥ 900 px）', K[1440].collapsed && K[1440].sideBySide && K[1440].stageW >= 900, K[1440]);
  ok('1920×1080：並排，3D 畫面 ≥ 900 px', K[1920].sideBySide && K[1920].stageW >= 900, K[1920]);
  ok('在 3D 頁自己展開參數控制台（1440×900）→ 編輯面板排到下方、3D 仍 ≥ 900 px、外框跟著內容撐高', !K.open.collapsed && K.open.stacked && K.open.stageW >= 900 && K.open.appBottom <= 0, K.open);
  ok('畫面大小變了、還沒動過視角 → 用新的大小重新對焦（仍是等角視角）', K.open.framedAtSize && K.open.view === 'iso', K.open);
  ok('尺寸標註都在 3D 畫面內、不被工具列／視角方塊／平移鍵蓋住（三種情況）', [K[1440], K[1920], K.open].every(k => k.labels >= 3 && !k.hit.length && k.inStage), K);
  ok('自己用滾輪縮放過 → 畫面大小再變也不自動重新對焦', zm.collapsed && zm.view === null && zm.sameFrame && zm.moved < 1, zm);

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
