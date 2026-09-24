/*
 * 整機長寬：防水邊距的方向 —— headless 驗證
 * ---------------------------------------------------------------------------
 * 使用者回報：PCB 500×385、邊距 Top 8／Bottom 11／Left 8／Right 8，
 * 工具卻算出 516 × 404（應為 519 × 401）。
 *
 * 根因：原本 L = L_pcb + Left + Right、W = W_pcb + Top + Bottom（平面圖「圖面上下」的習慣），
 * 但本工具的鰭片沿「長」延伸（每片鰭片長 = L，片數由 W 決定），自然對流時鰭片必須垂直
 * → L 是吊掛後的上下方向 → Top/Bottom 應加在「長」，Left/Right 加在「寬」。
 * 配反時 Bottom 多出來的那幾 mm 會被加到寬度 → 可能多排一片鰭片 → 鰭片高與體積偏樂觀。
 *
 * 驗證情境：
 *   [A] 使用者截圖的數字：519 × 401，視覺化報告的「外觀尺寸」與參數控制台的即時算式一致。
 *   [B] 四個邊距都不同的值（能分辨配對）：Top/Bottom 只影響長、Left/Right 只影響寬。
 *   [C] 鰭片數由「寬」決定、3D 視圖的鰭片沿「長」延伸（方向與邊距配對一致）。
 *   [D] 單一事實來源：rruFootprint 與 computeAll 的長寬、體積 = L×W×H 一致。
 *
 * 執行：
 *   npx http-server . -p 8123 -c-1 &      # 於 repo 根目錄
 *   node tests/dimensions.test.js         # 可用 TEST_URL 指定網址
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

(async () => {
  const browser = await chromium.launch(EXEC ? { executablePath: EXEC } : {});
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1500, height: 950 });
  await page.route('**', r => {
    const u = r.request().url();
    if (u.startsWith(BASE.replace(/index\.html$/, ''))) return r.continue();
    return r.abort();
  });
  await page.addInitScript(() => {
    // 記下 3D 視圖實際畫出來的幾何（Plotly 在測試環境被 stub 掉）
    window.__plots = {};
    window.Plotly = { newPlot(id, traces) { window.__plots[id] = traces; }, Plots:{resize(){}}, relayout(){}, purge(){}, toImage: async()=>'' };
    window.XLSX = { utils:{book_new:()=>({}),aoa_to_sheet:()=>({}),book_append_sheet(){}}, writeFile(){} };
    window.msal = { PublicClientApplication: class {
      async initialize(){} async handleRedirectPromise(){return null}
      getAllAccounts(){return []} } };
    window.alert = () => {}; window.confirm = () => true;
  });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.fill('#login-pw', 'tedus');
  await page.click('#login-page button');
  await page.waitForFunction(() => typeof calcResults !== 'undefined' && calcResults && calcResults.rows.length > 0)
    .catch(async e => { console.error('page errors:', errors.slice(0, 5)); throw e; });

  // 透過畫面上的輸入框設定（走真實的 onchange → recalc 路徑，不是直接改 G）
  const setInputs = async (vals) => {
    for (const [id, v] of Object.entries(vals)) {
      await page.fill('#' + id, String(v));
      await page.dispatchEvent('#' + id, 'change');
    }
    await page.waitForTimeout(50);
  };
  const read = () => page.evaluate(() => {
    const R = calcResults;
    const kpi = (document.getElementById('vr-dims') || {}).textContent || '';
    return {
      L: R.L_hsk, W: R.W_hsk, H: R.RRU_Height, FH: R.Fin_Height, nf: R.Fin_Count, V: R.Volume_L,
      kpi: (kpi.match(/(\d+)\s*[x×]\s*(\d+)\s*[x×]\s*([\d.]+)/) || []).slice(1),
      ddL: document.getElementById('dd-L') && document.getElementById('dd-L').textContent,
      ddLsum: document.getElementById('dd-L-sum') && document.getElementById('dd-L-sum').textContent,
      ddW: document.getElementById('dd-W') && document.getElementById('dd-W').textContent,
      ddWsum: document.getElementById('dd-W-sum') && document.getElementById('dd-W-sum').textContent,
      rule: document.querySelector('#dim-derive .dd-rule') && document.querySelector('#dim-derive .dd-rule').textContent,
    };
  });

  console.log('\n[A] 使用者截圖的數字（PCB 500×385，Top 8／Bottom 11／Left 8／Right 8）');
  await setInputs({ L_pcb: 500, W_pcb: 385, Top: 8, Btm: 11, Left: 8, Right: 8 });
  const a = await read();
  ok('長 = 500 + Top 8 + Bottom 11 = 519', a.L === 519, a);
  ok('寬 = 385 + Left 8 + Right 8 = 401', a.W === 401, a);
  ok('視覺化報告「外觀尺寸 L × W × H」顯示 519 x 401', a.kpi[0] === '519' && a.kpi[1] === '401', a.kpi);
  ok('參數控制台即時算式：長 519 mm ＝ PCB 500 ＋ Top 8 ＋ Bottom 11',
     a.ddL === '519 mm' && /PCB 500\s*＋\s*Top 8\s*＋\s*Bottom 11/.test(a.ddLsum || ''), [a.ddL, a.ddLsum]);
  ok('參數控制台即時算式：寬 401 mm ＝ PCB 385 ＋ Left 8 ＋ Right 8',
     a.ddW === '401 mm' && /PCB 385\s*＋\s*Left 8\s*＋\s*Right 8/.test(a.ddWsum || ''), [a.ddW, a.ddWsum]);
  ok('有寫明方向（Top/Bottom＝長度方向兩端、Left/Right＝寬度方向兩側）',
     /Top／Bottom＝長度方向/.test(a.rule || '') && /Left／Right＝寬度方向/.test(a.rule || ''), a.rule);

  console.log('\n[B] 四個邊距都不同（能分辨配對）');
  await setInputs({ L_pcb: 300, W_pcb: 200, Top: 5, Btm: 20, Left: 1, Right: 2 });
  const b1 = await read();
  ok('長 = 300 + 5 + 20 = 325、寬 = 200 + 1 + 2 = 203', b1.L === 325 && b1.W === 203, b1);
  await setInputs({ Top: 15 });
  const b2 = await read();
  ok('改 Top 只影響長（+10），寬不動', b2.L === 335 && b2.W === 203, [b1.L, b1.W, b2.L, b2.W]);
  await setInputs({ Right: 12 });
  const b3 = await read();
  ok('改 Right 只影響寬（+10），長不動', b3.L === 335 && b3.W === 213, [b2.L, b2.W, b3.L, b3.W]);

  console.log('\n[C] 鰭片方向與邊距配對一致');
  await setInputs({ L_pcb: 500, W_pcb: 385, Top: 8, Btm: 11, Left: 8, Right: 8 });
  const c = await page.evaluate(() => {
    const R = calcResults;
    const tr = window.__plots['tab3-3d'] || [];
    const fins = tr.filter(t => /fin/i.test(String(t.name || '')) || (t.intensity && t.intensity.length));
    const base = tr.find(t => t.name === 'Heatsink Base');
    return {
      nf: R.Fin_Count, expectNf: calcFinCount(R.W_hsk, G.Gap, G.Fin_t),
      nfIfLengthUsed: calcFinCount(R.L_hsk, G.Gap, G.Fin_t),
      finCount3d: fins.length,
      finsSpanL: fins.length > 0 && fins.every(f => Math.min(...f.x) === 0 && Math.max(...f.x) === R.L_hsk),
      finsWithinW: fins.length > 0 && fins.every(f => Math.max(...f.y) <= R.W_hsk + 1e-9),
      baseLW: base ? [Math.max(...base.x), Math.max(...base.y)] : null, L: R.L_hsk, W: R.W_hsk,
    };
  });
  ok('鰭片數由「寬」決定：Fin_Count = calcFinCount(W, Gap, Fin_t)', c.nf === c.expectNf && c.nf !== c.nfIfLengthUsed, c);
  ok('3D 視圖：每片鰭片沿「長」延伸（x 由 0 到 L）、排在寬度範圍內', c.finsSpanL && c.finsWithinW && c.finCount3d === c.nf, c);
  ok('3D 視圖的底板 = L × W（與 KPI 同一組數字）', c.baseLW && c.baseLW[0] === c.L && c.baseLW[1] === c.W, c);

  console.log('\n[D] 單一事實來源與體積');
  const d = await page.evaluate(() => {
    const R = calcResults, f = rruFootprint(G);
    return { f, L: R.L_hsk, W: R.W_hsk, H: R.RRU_Height, FH: R.Fin_Height, V: R.Volume_L,
             stack: G.H_shield + G.H_filter + G.t_base };
  });
  ok('rruFootprint(G) 與 computeAll 的長寬相同', d.f.L === d.L && d.f.W === d.W, d);
  ok('高 = H_shield + H_filter + t_base + 鰭片高', Math.abs(d.H - (d.stack + d.FH)) < 1e-9, d);
  ok('體積 = L × W × H（公升）', Math.abs(d.V - d.L * d.W * d.H / 1e6) < 1e-9, d);

  ok('頁面無 JS 例外', errors.length === 0, errors.slice(0, 3));

  await browser.close();
  console.log('\n通過 ' + pass + ' 項，失敗 ' + fail + ' 項');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
