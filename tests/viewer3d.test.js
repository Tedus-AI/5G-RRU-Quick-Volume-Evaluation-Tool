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
  await page.waitForTimeout(200);
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
      if (D.state.flip) document.getElementById('r3d-t-flip').click(); if (D.state.upright) document.getElementById('r3d-t-up').click();
      document.querySelector('#tab3 [data-state="asm"]').click(); D.settle(); });
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
    const fl1 = await page.evaluate(() => ({ tags: [...document.querySelectorAll('#r3d-labels .dim.src')].filter(e => e.style.display !== 'none').length,
      titles: [...document.querySelectorAll('#r3d-labels .ptitle')].filter(e => e.style.display !== 'none').map(e => e.textContent) }));
    ok('拆機攤開＋翻轉：四件標題都改成翻面後朝上的那一面，貼在原本那一面上的參數標註收起來', fl0.tags > 0 && fl1.tags === 0 && fl1.titles.length === 4 && fl1.titles.every(t => /翻面/.test(t))
      && fl1.titles.some(t => /鰭片朝上/.test(t)) && fl1.titles.some(t => /濾波器側朝上/.test(t)), [fl0, fl1]);
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
