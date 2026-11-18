/*
 * 3D：分模面螺絲柱的缺口不可讓 PCB／屏蔽罩外形跑出 PCB 範圍 —— headless 驗證
 * ---------------------------------------------------------------------------
 * 使用者回報（2026-11）：敏感度分析「機殼加寬」套用 +16 mm（左右邊距 8 → 16）後，3D 的 PCB 角落貼到外殼、
 * 防水邊距不見、長邊旁出現一塊斜的金色區塊。原因：omegaLoop 繞螺絲柱時用「往內的方向」挑圓弧，
 * 螺絲柱只擦到 PCB 角落（邊距大、孔離 PCB 遠）時內側那段弧很短、不含對角線方向 → 選到外側整圈。
 * 修正：兩段圓弧取「中點在兩條直線內側較深」的那一段。
 *
 *   [A] 左右／上下邊距 3～30 mm：pcb／shd 外形不超出 PCB 範圍、shdIn／fip 不超出外框內緣範圍；boss 不超出外殼
 *   [B] 每一個螺絲缺口都是「往板內凹」：缺口點列的每一點都在 PCB 範圍內（不會繞到外面整圈）
 *   [C] 內建範例原本的邊距：PCB 外形範圍＝PCB 本身
 *   （修正前後的點列逐點比對另外做過：備份 8 個專案＋內建範例，原本的邊距下完全相同）
 *
 * 執行：
 *   npx http-server . -p 8123 -c-1 &      # 於 repo 根目錄
 *   node tests/viewer3d-notch.test.js     # 需要 WebGL（swiftshader）＋three.js（THREE_DIR=<three@0.170.0 本機副本>，沒給就連 CDN）
 */
const fs = require('fs'), path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const BASE = process.env.TEST_URL || 'http://127.0.0.1:8123/index.html';
const EXEC = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const THREE_DIR = process.env.THREE_DIR || '';
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}

(async () => {
  const browser = await chromium.launch(Object.assign(EXEC ? { executablePath: EXEC } : {}, {
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] }));
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const root = BASE.replace(/index\.html$/, '');
  await page.route('**', r => {
    const u = r.request().url(), m = u.match(/cdn\.jsdelivr\.net\/npm\/three@0\.170\.0\/(build|examples\/jsm)\/(.+)$/);
    if (m && THREE_DIR) return r.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(path.join(THREE_DIR, m[1] === 'build' ? 'build' : 'jsm', m[2])) });
    if (m || u.startsWith(root)) return r.continue();
    return r.abort();
  });
  await page.addInitScript(() => {
    window.Plotly = { newPlot(){}, Plots:{resize(){}}, relayout(){}, purge(){}, toImage: async()=>'' };
    window.msal = { PublicClientApplication: class {
      async initialize(){} async handleRedirectPromise(){return null} getAllAccounts(){return []} } };
    window.alert = () => {}; window.confirm = () => true;
  });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.fill('#login-pw', 'tedus');
  await page.click('#login-page button');
  await page.waitForFunction(() => typeof calcResults !== 'undefined' && calcResults && calcResults.rows.length > 0);
  await page.waitForFunction(() => !!window.RRU3D, null, { timeout: 90000 });

  // 改邊距 → 重算 → 3D 重建 → 讀外形
  const loopsAt = (lr, tb) => page.evaluate(async ([lr, tb]) => {
    const set = (id, v) => { if (v != null) document.getElementById(id).value = v; };
    set('Left', lr); set('Right', lr); set('Top', tb); set('Btm', tb);
    recalc(); switchTab(3);
    for (let i = 0; i < 300 && (tab3Stale || !RRU3D.dbg.LAY()); i++) await new Promise(r => setTimeout(r, 100));
    await new Promise(r => setTimeout(r, 300));
    if (calcResults.blocked || calcResults.drc_failed) return { skip:true };
    const P = RRU3D.dbg.P(), g = P.g, L = P.r.L, W = P.r.W, LP = RRU3D.dbg.LAY().loops;
    const box = pts => ({ x0:Math.min(...pts.map(p => p[0])), x1:Math.max(...pts.map(p => p[0])), z0:Math.min(...pts.map(p => p[1])), z1:Math.max(...pts.map(p => p[1])) });
    const area = pts => Math.abs(pts.reduce((s, p, i) => { const q = pts[(i + 1) % pts.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0) / 2);
    const out = { L, W, g:{ Left:+g.Left, Right:+g.Right, Top:+g.Top, Btm:+g.Btm }, rim:RRU3D.dbg.LAY().shd ? RRU3D.dbg.LAY().shd.S.rim : 3 };
    for (const k of ['pcb', 'shd', 'shdIn', 'fip', 'boss']) out[k] = Object.assign(box(LP[k].pts), { n:LP[k].pts.length, a:area(LP[k].pts) });
    out.det = LP.pcb.det.map(d => box(d.pts));
    return out;
  }, [lr, tb]);

  console.log('\n[C] 內建範例原本的邊距：外形不變');
  const base = await loopsAt(null, null);
  const g0 = base.g;
  // 修正前（原本的程式碼）在內建範例記下的值：PCB 外形範圍＝PCB 本身（四邊都是 g 的邊距）
  ok('PCB 外形範圍＝PCB（Btm～L−Top、Left～W−Right）', Math.abs(base.pcb.x0 - g0.Btm) < 0.01 && Math.abs(base.pcb.x1 - (base.L - g0.Top)) < 0.01
     && Math.abs(base.pcb.z0 - g0.Left) < 0.01 && Math.abs(base.pcb.z1 - (base.W - g0.Right)) < 0.01, base);

  console.log('\n[A][B] 邊距 3～30 mm：外形不超出 PCB／外殼範圍、缺口都往板內凹');
  const bad = [], badDet = [];
  for (const lr of [3, 5, 8, 10, 12, 14, 16, 18, 20, 24, 30]) for (const tb of [3, 8, 11, 16, 24]) {
    const r = await loopsAt(lr, tb); if (r.skip) continue;
    const px0 = r.g.Btm, px1 = r.L - r.g.Top, pz0 = r.g.Left, pz1 = r.W - r.g.Right, e = 0.01;
    const inside = (b, d) => b.x0 >= px0 + d - e && b.x1 <= px1 - d + e && b.z0 >= pz0 + d - e && b.z1 <= pz1 - d + e;
    if (!inside(r.pcb, 0)) bad.push(['pcb', lr, tb, r.pcb]);
    if (!inside(r.shd, 0)) bad.push(['shd', lr, tb, r.shd]);
    if (!inside(r.shdIn, r.rim)) bad.push(['shdIn', lr, tb, r.shdIn]);
    if (!inside(r.fip, r.rim / 2)) bad.push(['fip', lr, tb, r.fip]);
    if (r.boss.x0 < -e || r.boss.x1 > r.L + e || r.boss.z0 < -e || r.boss.z1 > r.W + e) bad.push(['boss', lr, tb, r.boss]);
    r.det.forEach(b => { if (!inside(b, 0)) badDet.push([lr, tb, b]); });
  }
  ok('PCB／屏蔽罩外形、外框內緣、FIP 都在 PCB 範圍內；螺絲柱在外殼內', bad.length === 0, bad.slice(0, 4));
  ok('每一個 PCB 缺口都往板內凹（不會繞到外面整圈）', badDet.length === 0, badDet.slice(0, 4));

  ok('沒有 JS 錯誤', errors.length === 0, errors);
  console.log(`\n結果：${pass} 通過、${fail} 失敗`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
