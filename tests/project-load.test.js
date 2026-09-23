/*
 * 專案識別與參數載入 —— headless 驗證
 * ---------------------------------------------------------------------------
 * 修正三件事（code review 第二批）：
 *   1. 存檔寫回「載入時的 id」，不再由名稱推 docId。原本 id≠名稱的專案（AI-Thermal 建的、
 *      或在 AI-Thermal 改過名的）每存一次就另建一份分身，原專案永遠收不到修改。
 *   2. 換專案時參數控制台先退回出廠預設再套專案值。原本只覆寫專案有存的 key，
 *      有輸入框的參數會沿用上一個專案留在畫面上的值（AI-Thermal 建的專案 34 個全部沿用）。
 *   3. 複製專案／複製元件的規格書標 _from；匯入本機檔不沿用雲端專案的身分；
 *      載入的專案深拷貝（畫面上的試改不會改到 DB 快取）。
 *
 * 驗證情境：
 *   [A] 載入 id≠名稱推導值的專案 → 存檔寫回同一個 id，不另建文件、不跳「已存在」確認。
 *   [B] 改名 → 存檔只改 project_name（id 不變）；新名稱與別的專案重複 → 擋下、不寫入。
 *   [C] 新專案（沒有 id）→ 由名稱推 id；撞到既有專案要確認，取消就不寫。
 *   [D] 匯入本機 JSON → 清掉雲端專案身分，存檔建立新專案，不會蓋掉前一個開著的專案。
 *   [E] 複製專案 → 新 id；規格書（單一物件／陣列）逐份標 _from，已有的來源保留；原專案不動。
 *   [F] 📋 複製元件 → 深拷貝＋規格書標 _from，原元件不受影響。
 *   [G] 刪除目前這個專案 → 身分清空。
 *   [H] 換專案：沒存過的參數退回出廠預設（含勾選框與下拉），不沿用上一個專案；橫幅列出。
 *   [I] 板厚推不出來 → 用出廠預設（不是 0）。
 *   [J] 載入的專案深拷貝：載入時的轉型與畫面上的試改不會改到 DB 快取；缺哪一類就是空的。
 *
 * 執行：
 *   npx http-server . -p 8123 -c-1 &      # 於 repo 根目錄
 *   node tests/project-load.test.js
 */
let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const BASE = process.env.TEST_URL || 'http://127.0.0.1:8123/index.html';
const EXEC = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}

const FULL = (name, extra) => Object.assign({ Component: name, Qty: 1, 'Power(W)': 10, 'Height(mm)': 300, Pad_L: 8, Pad_W: 8,
  Board_Type: 'Thermal Via', 'Limit(C)': 125, R_jc: 0.5, TIM_Type: 'None' }, extra || {});

(async () => {
  const browser = await chromium.launch(EXEC ? { executablePath: EXEC } : {});
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.route('**', r => r.request().url().startsWith(BASE.replace(/index\.html$/, '')) ? r.continue() : r.abort());
  await page.addInitScript(() => {
    window.Plotly = { newPlot(){}, Plots:{resize(){}}, relayout(){}, purge(){}, toImage: async()=>'' };
    window.XLSX = { utils:{book_new:()=>({}),aoa_to_sheet:()=>({}),book_append_sheet(){}}, writeFile(){} };
    window.msal = { PublicClientApplication: class {
      async initialize(){} async handleRedirectPromise(){return null} getAllAccounts(){return []} } };
    window.__alerts = []; window.alert = m => window.__alerts.push(String(m));
    window.__confirms = []; window.__confirmAnswer = true;
    window.confirm = m => { window.__confirms.push(String(m)); return window.__confirmAnswer; };
  });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.fill('#login-pw', 'tedus');
  await page.click('#login-page button');
  await page.waitForFunction(() => typeof cloudLoadOne === 'function' && calcResults && calcResults.rows.length > 0);

  // 模擬共用 DB：getDoc 跟真的後端一樣回「活參照」，才驗得出深拷貝
  const seed = (projects) => page.evaluate((projects) => {
    window.__db = { projects: JSON.parse(JSON.stringify(projects)) };
    window.__writes = [];
    fbOk = true;
    dbAdapter.isReady = () => true;
    dbAdapter.getDoc = async (c, id) => (window.__db[c] || {})[id] || null;
    dbAdapter.getCollection = async (c) => window.__db[c] || {};
    dbAdapter.updateDoc = async (c, id, f) => {
      window.__writes.push({ c, id, f: JSON.parse(JSON.stringify(f)) });
      window.__db[c] = window.__db[c] || {};
      window.__db[c][id] = Object.assign({}, window.__db[c][id] || {}, f);
    };
    dbAdapter.deleteDoc = async (c, id) => { delete (window.__db[c] || {})[id]; };
    dbAdapter.getProjectsSorted = async () => Object.entries(window.__db.projects).map(([id, d]) => Object.assign({ id }, d));
    _ensureLockBeforeWrite = async () => true;
    window.__alerts = []; window.__confirms = []; window.__confirmAnswer = true;
  }, projects);

  const DB = {
    'RRU_5G': { project_name: 'FDD B8B20B28 4T4R 560W', thermal_specs: { PA: { heatDirection: 'IC top' } },
                rf_data: [], digital_data: [], pwr_data: [] },
    'CB-GN-HB-2X2M-2B': { project_name: 'Cygnus-V2-62.5dB', rf_data: [], digital_data: [], pwr_data: [] },
  };
  // A 案：參數與元件都完整（K_Coin 300、自訂鰭片係數、T_amb 55、PCB 500×385）
  const A = { project_name: 'A 案', global_params: { T_amb: 55, K_Coin: 300, L_pcb: 500, W_pcb: 385,
              fin_custom_emb: true, fin_eta_emb: 1.2, fin_kfin_emb: 180, fin_tech_selector_v2: 'Embedded Fin (0.95)',
              t_PCB: 1.6, Coin_T_Setting: 3 },
              rf_data: [FULL('PA', { SpecFile: { path: '/SPEC/A 案/RF/PA__ds.pdf', name: 'ds.pdf' } })],
              digital_data: [FULL('FPGA', { SpecFile: [
                { path: '/SPEC/A 案/Digital/FPGA__ds.pdf', name: 'ds.pdf' },
                { path: '/SPEC/Z/Digital/FPGA__errata.pdf', name: 'errata.pdf', _from: 'Z 案' } ] })],
              pwr_data: [FULL('PSU', { Board_Type: 'None', Pad_L: 0, Pad_W: 0 })] };

  console.log('\n[A] 載入 id≠名稱推導值的專案 → 存檔寫回同一個 id');
  await seed(Object.assign({}, DB, { A: A }));
  const a = await page.evaluate(async () => {
    await cloudLoadOne('RRU_5G');
    window.__confirms = []; window.__writes = [];
    await cloudSaveProject();
    // typeof 守衛：拿改動前的版本跑也能走到斷言（看得到它寫去哪個 id），不會先噴 ReferenceError
    return { id: (typeof currentProjectId !== 'undefined') ? currentProjectId : null,
             writes: window.__writes.map(w => w.id + ':' + w.f.project_name),
             confirms: window.__confirms.slice(), ids: Object.keys(window.__db.projects).sort(),
             keptSpecs: !!window.__db.projects.RRU_5G.thermal_specs };
  });
  ok('寫回 RRU_5G（不是由名稱推出來的 FDD_B8B20B28_4T4R_560W）',
     JSON.stringify(a.writes) === JSON.stringify(['RRU_5G:FDD B8B20B28 4T4R 560W']), a.writes);
  ok('沒有多出任何分身文件', !a.ids.includes('FDD_B8B20B28_4T4R_560W') && a.ids.length === 3, a.ids);
  ok('同一個專案存檔不再跳「已存在，確定要覆蓋？」', a.confirms.length === 0, a.confirms);
  ok('AI-Thermal 寫的欄位（thermal_specs）保留', a.keptSpecs, a);

  console.log('\n[B] 改名只改 project_name；與別的專案重名 → 擋下');
  const b = await page.evaluate(async () => {
    window.prompt = () => '560W 第二版';
    document.getElementById('projNameBox').click();
    window.__writes = [];
    await cloudSaveProject();
    const renamed = { id: currentProjectId, writes: window.__writes.map(w => w.id + ':' + w.f.project_name) };
    window.prompt = () => 'cygnus-v2-62.5DB';          // 與另一個專案同名（不分大小寫）
    document.getElementById('projNameBox').click();
    window.__writes = []; window.__alerts = [];
    await cloudSaveProject();
    return { renamed, dupWrites: window.__writes.length, dupAlert: window.__alerts.join('|') };
  });
  ok('改名後存檔：同一個 id、只換名稱', JSON.stringify(b.renamed.writes) === JSON.stringify(['RRU_5G:560W 第二版']) && b.renamed.id === 'RRU_5G', b.renamed);
  ok('新名稱與其他專案重複（不分大小寫）→ 不寫入並說明原因',
     b.dupWrites === 0 && /已有另一個專案叫/.test(b.dupAlert) && /CB-GN-HB-2X2M-2B/.test(b.dupAlert), b);

  console.log('\n[C] 新專案才由名稱推 id；撞到既有專案要確認');
  const c = await page.evaluate(async () => {
    projectIdentitySet(null, '全新 專案');
    window.__writes = [];
    await cloudSaveProject();
    const fresh = window.__writes.map(w => w.id);
    projectIdentitySet(null, 'A');                    // 推出來的 id 'A' 已存在
    window.__confirmAnswer = false; window.__confirms = []; window.__writes = [];
    await cloudSaveProject();
    const res = { fresh, freshId: null, cancelWrites: window.__writes.length, confirm: window.__confirms.join('|') };
    window.__confirmAnswer = true;
    return res;
  });
  ok('新專案 → id 由名稱推（空白換底線）', JSON.stringify(c.fresh) === JSON.stringify(['全新_專案']), c.fresh);
  ok('推出來的 id 撞到既有專案 → 確認訊息寫出對方的名稱；取消就不寫',
     c.cancelWrites === 0 && /A 案/.test(c.confirm), c);

  console.log('\n[D] 匯入本機 JSON → 不沿用雲端專案的身分');
  await page.evaluate(async () => { await cloudLoadOne('A'); });
  const d = await page.evaluate(async () => {
    const json = JSON.stringify({ project_name: 'B 案（本機檔）', global_params: { T_amb: 40 },
      rf_data: [{ Component: 'LNA', Qty: 2, 'Power(W)': 1, 'Height(mm)': 100, Pad_L: 3, Pad_W: 3,
                  Board_Type: 'IC top', 'Limit(C)': 125, R_jc: 5, TIM_Type: 'None' }] });
    window.__alerts = [];
    handleFileLoad({ target: { files: [new File([json], 'RRU_B.json', { type: 'application/json' })], value: '' } });
    for (let i = 0; i < 50 && !window.__alerts.length; i++) await new Promise(r => setTimeout(r, 20));
    const ident = { id: currentProjectId, name: projectNameGet(), alert: window.__alerts.join('|') };
    window.__writes = [];
    await cloudSaveProject();
    return { ident, writes: window.__writes.map(w => w.id), aStill: window.__db.projects.A.project_name,
             aRf: window.__db.projects.A.rf_data.map(x => x.Component) };
  });
  ok('匯入後沒有雲端 id、名稱取自檔案', d.ident.id === null && d.ident.name === 'B 案（本機檔）', d.ident);
  ok('提示寫明是「未儲存的新專案」', /未儲存的新專案/.test(d.ident.alert), d.ident.alert);
  ok('存檔建立新專案，A 案不被覆蓋',
     d.writes.length === 1 && d.writes[0] !== 'A' && d.aStill === 'A 案' && d.aRf.join() === 'PA', d);

  console.log('\n[E] 複製專案 → 規格書逐份標 _from，原專案不動');
  await page.evaluate(async () => { await cloudLoadOne('A'); });
  const e = await page.evaluate(async () => {
    document.getElementById('copyProjectName').value = 'A 案_copy';
    window.__writes = [];
    await confirmCopyProject();
    const w = window.__writes[0];
    const fpga = w.f.digital_data[0].SpecFile, pa = w.f.rf_data[0].SpecFile;
    const src = window.__db.projects.A;
    return {
      id: w.id, cur: currentProjectId, name: projectNameGet(),
      paFrom: pa._from, fpgaFrom: fpga.map(s => s._from),
      srcClean: !src.rf_data[0].SpecFile._from && !src.digital_data[0].SpecFile[0]._from,
      memFrom: components.rf[0].SpecFile._from,
    };
  });
  ok('複本寫到新 id，之後的存檔也跟著寫新 id', e.id === 'A_案_copy' && e.cur === 'A_案_copy' && e.name === 'A 案_copy', e);
  ok('單一份規格書標 _from＝來源專案名', e.paFrom === 'A 案', e);
  ok('多份規格書逐份標；原本就有來源（Z 案）的保留', JSON.stringify(e.fpgaFrom) === JSON.stringify(['A 案', 'Z 案']), e.fpgaFrom);
  ok('來源專案的資料一個位元都沒被改', e.srcClean, e);
  ok('畫面上的元件（現在代表複本）也帶著標記，之後再存才不會洗掉', e.memFrom === 'A 案', e);
  await page.evaluate(async () => { await cloudLoadOne('A'); });
  const e2 = await page.evaluate(async () => {
    projectNameSet('A 案（改名還沒存）');          // 頂排改了名但沒存 → 資料庫裡仍叫「A 案」
    document.getElementById('copyProjectName').value = 'A 案_copy2';
    window.__writes = [];
    await confirmCopyProject();
    return window.__writes[0].f.rf_data[0].SpecFile._from;
  });
  ok('頂排改名還沒存就複製 → _from 標資料庫裡的原名（規格書實際所在的專案）', e2 === 'A 案', e2);

  console.log('\n[F] 📋 複製元件 → 深拷貝＋規格書標 _from');
  await page.evaluate(async () => { await cloudLoadOne('A'); });
  const f = await page.evaluate(() => {
    copyComp('rf', 0);
    const orig = components.rf[0], cp = components.rf[1];
    cp.SpecFile.name = '改到複本';
    return { cpFrom: cp.SpecFile._from, origFrom: orig.SpecFile._from || null, origName: orig.SpecFile.name };
  });
  ok('複本的規格書標 _from（刪複本的規格書時不會刪到原元件的檔案）', f.cpFrom === 'A 案', f);
  ok('原元件不受影響（沒有共用參照）', f.origFrom === null && f.origName === 'ds.pdf', f);

  console.log('\n[G] 刪除目前這個專案 → 身分清空');
  const g = await page.evaluate(async () => {
    await cloudDeleteOne('A', 'A 案');
    return { id: currentProjectId, text: document.getElementById('projNameText').textContent };
  });
  ok('刪掉目前的專案 → id 清空、頂排回到「（未命名）」', g.id === null && g.text === '（未命名）', g);

  console.log('\n[H] 換專案：沒存過的參數退回出廠預設，不沿用上一個專案');
  await seed(Object.assign({}, DB, { A: A, NOGP: { project_name: '沒有參數的專案', rf_data: [FULL('X')] },
    PART: { project_name: '部分參數', global_params: { T_amb: 50, L_pcb: 450 }, rf_data: [FULL('Y')] } }));
  const h = await page.evaluate(async () => {
    const def = DEFAULT_CONFIG.global_params;
    await cloudLoadOne('A');
    const afterA = { T_amb: G.T_amb, K_Coin: G.K_Coin, emb: document.getElementById('fin_custom_emb').checked };
    await cloudLoadOne('NOGP');
    const nogp = { T_amb: G.T_amb, K_Coin: G.K_Coin, L_pcb: G.L_pcb, emb: G.fin_custom_emb,
                   embBox: document.getElementById('fin_custom_emb').checked,
                   uiT: document.getElementById('T_amb').value, uiK: document.getElementById('K_Coin').value,
                   banner: document.getElementById('globals-default-banner').textContent };
    await cloudLoadOne('PART');
    const part = { T_amb: G.T_amb, L_pcb: G.L_pcb, K_Coin: G.K_Coin, W_pcb: G.W_pcb,
                   banner: document.getElementById('globals-default-banner').textContent };
    return { def: { T_amb: def.T_amb, K_Coin: def.K_Coin, L_pcb: def.L_pcb, W_pcb: def.W_pcb }, afterA, nogp, part };
  });
  ok('先載入 A 案：參數是 A 案的（T_amb 55、K_Coin 300、自訂鰭片係數勾選）',
     h.afterA.T_amb === 55 && h.afterA.K_Coin === 300 && h.afterA.emb === true, h.afterA);
  ok('再載入沒有參數的專案：全部退回出廠預設（不是 A 案的 55／300／勾選）',
     h.nogp.T_amb === h.def.T_amb && h.nogp.K_Coin === h.def.K_Coin && h.nogp.L_pcb === h.def.L_pcb &&
     h.nogp.emb === false && h.nogp.embBox === false, h);
  ok('畫面上的輸入框同步成出廠預設', h.nogp.uiT === String(h.def.T_amb) && h.nogp.uiK === String(h.def.K_Coin), h.nogp);
  ok('橫幅說明「還沒在 5G-RRU 存過參數 → 全部是出廠預設」', /還沒在 5G-RRU 存過參數/.test(h.nogp.banner), h.nogp.banner);
  ok('部分參數的專案：有存的用專案值、沒存的用出廠預設',
     h.part.T_amb === 50 && h.part.L_pcb === 450 && h.part.K_Coin === h.def.K_Coin && h.part.W_pcb === h.def.W_pcb, h.part);
  ok('橫幅列出採用出廠預設的參數（例：K (銅塊)）', /沒有存過以下/.test(h.part.banner) && /K \(銅塊\)/.test(h.part.banner), h.part.banner.slice(0, 160));

  console.log('\n[I] 板厚推不出來 → 用出廠預設，不是 0');
  const i2 = await page.evaluate(async (rf) => {
    window.__db.projects.VIA = { project_name: 'Via 專案', rf_data: rf };  // 元件沒有 Thick(mm)
    await cloudLoadOne('VIA');
    return { t_PCB: G.t_PCB, def: DEFAULT_CONFIG.global_params.t_PCB,
             thick: components.rf.map(r => r['Thick(mm)']),
             banner: document.getElementById('thick-migrate-banner').textContent };
  }, [FULL('V1'), FULL('V2')]);
  ok('t_PCB 用出廠預設（不是 0：0 會讓所有 Via 元件 R_int=0，偏樂觀）', i2.t_PCB === i2.def && i2.t_PCB > 0, i2);
  ok('Via 元件的板厚跟著帶入出廠預設', i2.thick.every(t => t === i2.def), i2.thick);
  ok('橫幅寫明「先用出廠預設」', /先用出廠預設/.test(i2.banner), i2.banner.slice(0, 120));

  console.log('\n[J] 載入的專案深拷貝；缺哪一類就是空的');
  const j = await page.evaluate(async ({ strComp, prevComp }) => {
    window.__db.projects.STR = { project_name: '字串', rf_data: [strComp] };  // 沒有 digital/pwr
    components.digital = [prevComp];
    await cloudLoadOne('STR');
    components.rf[0]['Limit(C)'] = 99;                       // 畫面上的試改
    const raw = window.__db.projects.STR.rf_data[0];
    return { rawQty: raw.Qty, rawPowerKey: 'Power(W)' in raw, rawLimit: raw['Limit(C)'],
             memQty: components.rf[0].Qty, digital: components.digital.length, pwr: components.pwr.length };
  }, { strComp: FULL('S', { Qty: '4', 'Power(W)': '' }), prevComp: FULL('上一個專案的元件') });
  ok('載入時的轉型不會改到 DB 快取（快取仍是字串 "4"、瓦數 \'\' 還在）',
     j.rawQty === '4' && j.rawPowerKey === true && j.memQty === 4, j);
  ok('畫面上的試改不會改到 DB 快取（沒按儲存就不會被釋鎖寫回）', j.rawLimit === 125, j);
  ok('專案沒有 digital／pwr → 清單是空的，不沿用上一個專案的元件', j.digital === 0 && j.pwr === 0, j);

  ok('頁面無 JS 例外', errors.length === 0, errors.slice(0, 3));

  await browser.close();
  console.log('\n通過 ' + pass + ' 項，失敗 ' + fail + ' 項');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
