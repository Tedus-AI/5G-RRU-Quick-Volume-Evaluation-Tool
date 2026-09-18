/*
 * 表頭底色 ＋ 專案工具列重新設計 —— headless 驗證
 * ---------------------------------------------------------------------------
 * 驗證情境：
 *   [A] 表頭一眼看得出是表頭：深底白字、與白色表身有足夠對比，三張表共用同一組色票，
 *       且原本的置中契約沒有被改掉。
 *   [B] 專案工具列：排列順序 匯入/匯出/儲存/載入/複製 → 專案名稱 → 資料庫保護；
 *       所有控制項高度一致；按鈕底色不透明（不融入 header 漸層）；文字對比足夠
 *       （原本白字透明底，在青藍漸層上讀不清）；每顆按鈕仍接到正確的函式。
 *
 * 執行：
 *   npx http-server . -p 8123 -c-1 &      # 於 repo 根目錄
 *   node tests/header-toolbar.test.js     # 可用 TEST_URL 指定網址
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

/* 在頁面裡用的色彩工具：WCAG 相對亮度與對比度 */
const COLOR_UTILS = () => {
  window.__rgb = (s) => {
    const m = String(s).match(/rgba?\(([^)]+)\)/); if (!m) return null;
    const p = m[1].split(',').map(x => parseFloat(x));
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  window.__lum = (c) => {
    const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  window.__contrast = (c1, c2) => {
    const l1 = window.__lum(c1), l2 = window.__lum(c2);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };
};

(async () => {
  const browser = await chromium.launch(EXEC ? { executablePath: EXEC } : {});
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1600, height: 950 });

  await page.route('**', r => {
    const u = r.request().url();
    if (u.startsWith(BASE.replace(/index\.html$/, ''))) return r.continue();
    return r.abort();
  });
  await page.addInitScript(() => {
    window.Plotly = { newPlot(){}, Plots:{resize(){}}, relayout(){}, purge(){}, toImage: async()=>'' };
    window.XLSX = { utils:{book_new:()=>({}),aoa_to_sheet:()=>({}),book_append_sheet(){}}, writeFile(){} };
    window.msal = { PublicClientApplication: class {
      async initialize(){} async handleRedirectPromise(){return null}
      getAllAccounts(){return []} } };
    window.__alerts = []; window.alert = m => window.__alerts.push(String(m));
    window.confirm = () => true;
  });
  await page.addInitScript(COLOR_UTILS);
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.fill('#login-pw', 'tedus');
  await page.click('#login-page button');
  await page.waitForFunction(() => typeof calcResults !== 'undefined' && calcResults && calcResults.rows.length > 0)
    .catch(async e => { console.error('page errors:', errors.slice(0,5)); throw e; });

  console.log('\n[A] 元件清單表頭底色');
  const a = await page.evaluate(() => {
    const th = document.querySelector('#subtab0 table.comp-table thead th');
    const td = document.querySelector('#subtab0 table.comp-table tbody td');
    const cs = getComputedStyle(th), ct = getComputedStyle(td);
    const bg = window.__rgb(cs.backgroundColor), fg = window.__rgb(cs.color);
    const body = window.__rgb(ct.backgroundColor || 'rgb(255,255,255)');
    const bodyBg = (body && body.a > 0) ? body : { r:255, g:255, b:255, a:1 };
    // 背景用漸層時 backgroundColor 可能是透明 → 取漸層裡的第一個色當代表
    const grad = cs.backgroundImage || '';
    const gradFirst = window.__rgb(grad);
    const eff = (bg && bg.a > 0) ? bg : gradFirst;
    return {
      bgCss: cs.backgroundColor, grad: grad.slice(0, 80), color: cs.color,
      lumBg: eff ? window.__lum(eff) : null,
      lumFg: fg ? window.__lum(fg) : null,
      cText: (eff && fg) ? window.__contrast(eff, fg) : null,
      cBody: eff ? window.__contrast(eff, bodyBg) : null,
      weight: cs.fontWeight, align: cs.textAlign,
      borderBottom: cs.borderBottomWidth + ' ' + cs.borderBottomColor,
    };
  });
  ok('表頭底色是深色（不再是與表身相融的淺灰）', a.lumBg !== null && a.lumBg < 0.25, a);
  ok('表頭文字是淺色', a.lumFg !== null && a.lumFg > 0.7, a);
  ok('表頭文字／底色對比 ≥ 7（AAA）', a.cText >= 7, a.cText);
  ok('表頭與白色表身的對比 ≥ 4.5（區塊一眼分得開）', a.cBody >= 4.5, a.cBody);
  ok('表頭加粗', parseInt(a.weight, 10) >= 700, a.weight);
  ok('表頭底部有強調線', parseFloat(a.borderBottom) >= 2, a.borderBottom);
  ok('置中契約沒被改掉（回歸）', a.align === 'center', a.align);

  const a2 = await page.evaluate(() => {
    const th = document.querySelector('#subtab0 table.comp-table thead th');
    const root = getComputedStyle(document.documentElement);
    // 詳細分析表與型號庫視窗要吃同一組色票
    const mk = (css) => { const d = document.createElement('div'); d.style.cssText = css; document.body.appendChild(d);
      const v = getComputedStyle(d).backgroundImage; d.remove(); return v; };
    return { thGrad: getComputedStyle(th).backgroundImage,
             tok: root.getPropertyValue('--th-bg').trim() + '/' + root.getPropertyValue('--th-fg').trim(),
             detail: mk('background:linear-gradient(180deg,var(--th-bg),var(--th-bg2));'),
             ioH: root.getPropertyValue('--io-h').trim() };
  });
  ok('表頭色值抽成共用色票 --th-bg / --th-fg', /#|rgb/.test(a2.tok), a2.tok);
  ok('詳細分析表／型號庫視窗與元件清單同一組色票', a2.thGrad === a2.detail, a2);

  console.log('\n[B] 專案工具列');
  const b = await page.evaluate(() => {
    const io = document.querySelector('.header .project-io');
    const items = [...io.querySelectorAll('button.io-btn, input[type="text"], .cloud-lock')];
    const rows = items.map(el => {
      const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
      const bg = window.__rgb(cs.backgroundColor), fg = window.__rgb(cs.color);
      return {
        tag: el.tagName.toLowerCase(),
        text: (el.tagName === 'INPUT' ? '[專案名稱]' : el.textContent.trim()),
        onclick: el.getAttribute('onclick') || '',
        left: Math.round(r.left), top: Math.round(r.top), h: Math.round(r.height),
        alpha: bg ? bg.a : null,
        contrast: (bg && fg && bg.a > 0) ? window.__contrast(bg, fg) : null,
      };
    });
    rows.sort((x, y) => (x.top - y.top) || (x.left - y.left));
    return { rows, count: items.length };
  });
  const order = b.rows.map(r => r.text.replace(/^[^一-鿿\[]*/, ''));
  ok('排列順序：匯入 → 匯出 → 儲存 → 載入 → 複製 → 專案名稱 → 資料庫保護',
     JSON.stringify(order) === JSON.stringify(['匯入專案','匯出專案','儲存專案','載入專案','複製專案','[專案名稱]','資料庫保護：啟用']),
     order);
  const heights = [...new Set(b.rows.map(r => r.h))];
  ok('所有控制項高度一致（' + heights.join('/') + 'px）', heights.length === 1 && heights[0] >= 32, b.rows.map(r => [r.text, r.h]));
  ok('按鈕／輸入框底色不透明（不再是融入漸層的透明底）',
     b.rows.every(r => r.alpha === 1), b.rows.map(r => [r.text, r.alpha]));
  ok('每個控制項的文字／自身底色對比 ≥ 4.5（不再是過亮的白字）',
     b.rows.every(r => r.contrast >= 4.5), b.rows.map(r => [r.text, r.contrast && +r.contrast.toFixed(1)]));

  const handlers = b.rows.filter(r => r.tag === 'button' || r.tag === 'span').map(r => [r.text, r.onclick]);
  ok('五顆按鈕仍接到原本的函式',
     /loadProject\(\)/.test(handlers[0][1]) && /saveProject\(\)/.test(handlers[1][1]) &&
     /cloudSaveProject\(\)/.test(handlers[2][1]) && /cloudLoadProject\(\)/.test(handlers[3][1]) &&
     /cloudCopyProject\(\)/.test(handlers[4][1]), handlers);

  const b2 = await page.evaluate(() => {
    const io = document.querySelector('.header .project-io');
    const save = [...io.querySelectorAll('button.io-btn')].find(x => /儲存專案/.test(x.textContent));
    const others = [...io.querySelectorAll('button.io-btn')].filter(x => !/儲存專案/.test(x.textContent));
    const s = window.__rgb(getComputedStyle(save).backgroundColor);
    return { saveLum: window.__lum(s),
             othersLum: others.map(o => window.__lum(window.__rgb(getComputedStyle(o).backgroundColor))),
             saveClass: save.className };
  });
  ok('「儲存專案」是主要動作（深色實心，與其他白色按鈕分出主次）',
     b2.saveLum < 0.2 && b2.othersLum.every(l => l > 0.8), b2);

  // 保護狀態切換：高度與可讀性都要維持
  const b3 = await page.evaluate(() => {
    const el = document.getElementById('cloudLockBtn');
    const read = () => { const cs = getComputedStyle(el), r = el.getBoundingClientRect();
      return { h: Math.round(r.height), text: el.textContent.trim(),
               contrast: window.__contrast(window.__rgb(cs.backgroundColor), window.__rgb(cs.color)) }; };
    const locked = read();
    cloudLocked = false; _applyCloudLockUI();
    const unlocked = read();
    cloudLocked = true; _applyCloudLockUI();
    return { locked, unlocked, back: read().text };
  });
  ok('資料庫保護：解鎖後高度不變', b3.locked.h === b3.unlocked.h, b3);
  ok('資料庫保護：兩種狀態文字都讀得清（對比 ≥ 4.5）',
     b3.locked.contrast >= 4.5 && b3.unlocked.contrast >= 4.5, b3);
  ok('資料庫保護：狀態文字正確且切得回來', /啟用/.test(b3.locked.text) && /關閉/.test(b3.unlocked.text) && /啟用/.test(b3.back), b3);

  // 專案名稱輸入框仍可用（_buildProjectFields 依賴它）
  await page.fill('#cloudProjectName', '測試專案A');
  ok('專案名稱輸入框仍可輸入', (await page.inputValue('#cloudProjectName')) === '測試專案A');

  const b4 = await page.evaluate(() => {
    const io = document.querySelector('.header .project-io');
    const r = io.getBoundingClientRect();
    const gs = [...io.querySelectorAll('.io-group')];
    // 組間留白要明顯大於組內留白，分組才看得出來
    const inner = (g) => { const k = [...g.children]; return k.length > 1
      ? Math.round(k[1].getBoundingClientRect().left - k[0].getBoundingClientRect().right) : null; };
    const between = Math.round(gs[1].getBoundingClientRect().left - gs[0].getBoundingClientRect().right);
    return { wrap: getComputedStyle(io).flexWrap, groups: gs.length,
             insideHeader: !!io.closest('.header'), inner: inner(gs[0]), between,
             right: Math.round(r.right), vw: window.innerWidth,
             fileInputOutside: !io.querySelector('#fileInput') && !!document.getElementById('fileInput') };
  });
  ok('分成「檔案」「資料庫」「專案名稱＋保護」三組', b4.groups === 3, b4);
  ok('組間留白明顯大於組內留白（不用豎線也看得出分組）', b4.between >= b4.inner * 2, b4);
  ok('隱藏的檔案輸入不夾在兩組中間', b4.fileInputOutside, b4);
  ok('仍可換行、沒有超出畫面（小螢幕不重疊）', b4.wrap === 'wrap' && b4.right <= b4.vw, b4);

  ok('頁面無 JS 例外', errors.length === 0, errors.slice(0, 3));

  await browser.close();
  console.log('\n通過 ' + pass + ' 項，失敗 ' + fail + ' 項');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
