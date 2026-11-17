/**
 * 3D 檢視器：重建不可以累積貼圖 —— headless 驗證（需要 WebGL＋three.js，同 viewer3d.test.js）
 *
 * Code review（2026-11）發現：rebuild() 只釋放幾何（disposeTree），PCB 兩面的板面貼圖（最長邊 2400px，兩張合計約 50 MB
 * 顯示記憶體）每重建一次就多佔一份 —— 重算、拖曳放開、改一個欄位都會重建，在 3D 頁調久了越來越慢、甚至掉 WebGL context。
 * 現在這次建模專屬的材質標 userData.own，重建時釋放它的貼圖。
 * ⚠ 第一版連材質也 dispose() → three.js 刪掉著色器程式、每次重建都重新編譯（一次重建 0.17 s → 9.5 s）。[C] 守這一條。
 *
 * 執行：CHROMIUM_PATH=... THREE_DIR=<three@0.170.0> TEST_URL=http://127.0.0.1:8123/index.html node tests/viewer3d-leak.test.js
 */
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const BASE = process.env.TEST_URL || 'http://127.0.0.1:8123/index.html';
const EXEC = process.env.CHROMIUM_PATH || '';
const THREE_DIR = process.env.THREE_DIR || '';
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  ✅ ' + name); } else { fail++; console.log('  ❌ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); } };

(async () => {
  const browser = await chromium.launch(Object.assign(EXEC ? { executablePath: EXEC } : {}, { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] }));
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  const root = BASE.replace(/index\.html$/, '');
  await page.route('**', r => {
    const u = r.request().url(), m = u.match(/cdn\.jsdelivr\.net\/npm\/three@0\.170\.0\/(build|examples\/jsm)\/(.+)$/);
    if (m && THREE_DIR) return r.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(path.join(THREE_DIR, m[1] === 'build' ? 'build' : 'jsm', m[2])) });
    if (m || u.startsWith(root)) return r.continue();
    return r.abort();
  });
  await page.addInitScript(() => {
    window.Plotly = { newPlot(){}, Plots:{resize(){}}, relayout(){}, purge(){}, toImage: async()=>'' };
    window.msal = { PublicClientApplication: class { async initialize(){} async handleRedirectPromise(){return null} getAllAccounts(){return []} } };
    window.alert = () => {}; window.confirm = () => true;
  });
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.fill('#login-pw', 'tedus'); await page.click('#login-page button');
  await page.waitForFunction(() => typeof calcResults !== 'undefined' && calcResults && calcResults.rows.length > 0);
  await page.waitForFunction(() => !!window.RRU3D, null, { timeout: 90000 });
  await page.evaluate(() => switchTab(3));
  await page.waitForFunction(() => window.RRU3D.dbg.P() && window.RRU3D.dbg.LAY() && !document.getElementById('tab3-3d').hidden, null, { timeout: 60000 });
  const frames = async n => { const f0 = await page.evaluate(() => RRU3D.dbg.frames()); await page.waitForFunction(([f, n]) => RRU3D.dbg.frames() >= f + n, [f0, n], { timeout: 60000 }); };
  await frames(3);

  console.log('\n[A] 重建 8 次，貼圖數量不增加');
  const m0 = await page.evaluate(() => RRU3D.dbg.mem());
  const seen = [];
  for (let i = 0; i < 8; i++) { await page.evaluate(() => RRU3D.dbg.rebuild()); await frames(2); seen.push((await page.evaluate(() => RRU3D.dbg.mem())).textures); }
  const m1 = await page.evaluate(() => RRU3D.dbg.mem());
  ok('起始狀態有貼圖（PCB 板面等）', m0.textures >= 2, m0);
  ok('重建 8 次後貼圖數量沒有增加（原本每次 +2）', m1.textures <= m0.textures, { before: m0.textures, after: m1.textures, seen });
  ok('幾何數量也沒有累積', m1.geometries <= m0.geometries + 2, { before: m0.geometries, after: m1.geometries });

  console.log('\n[C] 重建不重新編譯著色器（材質不可 dispose：會刪掉共用的著色器程式）');
  const p0 = m1.programs;
  for (let i = 0; i < 4; i++) { await page.evaluate(() => RRU3D.dbg.rebuild()); await frames(1); }
  const p1 = (await page.evaluate(() => RRU3D.dbg.mem())).programs;
  const gone = p0.filter(id => !p1.includes(id)), added = p1.filter(id => !p0.includes(id));
  ok('重建後沿用同一批著色器程式（沒有被刪掉再重新編譯）', p0.length > 0 && gone.length === 0 && added.length === 0, { before: p0.length, gone, added });

  console.log('\n[B] 重算（改參數）觸發的重建也一樣');
  for (const v of [8, 9, 10, 11.6]) { await page.evaluate(v => { document.getElementById('Gap').value = v; recalc(); }, v); await page.waitForTimeout(300); await frames(2); }
  const m2 = await page.evaluate(() => RRU3D.dbg.mem());
  ok('改 4 次 air gap 後貼圖數量沒有增加', m2.textures <= m0.textures, { before: m0.textures, after: m2.textures });
  const pcbOk = await page.evaluate(() => { const P = RRU3D.dbg.PCB(); let withMap = 0; P.traverse(x => { (Array.isArray(x.material) ? x.material : x.material ? [x.material] : []).forEach(m => { if (m.map && m.map.image && m.map.image.width > 500) withMap++; }); }); return withMap; });
  ok('目前的 PCB 仍然帶著板面貼圖（沒有釋放到正在用的）', pcbOk >= 2, pcbOk);

  ok('沒有 JS 錯誤', errors.length === 0, errors);
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
