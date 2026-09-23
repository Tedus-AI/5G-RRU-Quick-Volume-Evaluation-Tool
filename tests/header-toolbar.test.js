/*
 * 表頭底色 ＋ 專案工具列重新設計 —— headless 驗證
 * ---------------------------------------------------------------------------
 * 驗證情境：
 *   [A] 表頭一眼看得出是表頭：深底白字、與白色表身有足夠對比，三張表共用同一組色票，
 *       且原本的置中契約沒有被改掉。
 *   [B] 專案工具列：排列順序 匯入/匯出/儲存/載入/複製 → 資料庫保護；所有控制項高度
 *       一致；按鈕底色不透明（不融入 header 漸層）；文字對比足夠（原本白字透明底，
 *       在青藍漸層上讀不清）；每顆按鈕仍接到正確的函式。
 *       ⚠ 專案名稱輸入框已移除 → 整排按鈕要往右靠齊補上空出來的位置（換行時也要）。
 *   [C] 頂端專案名稱：顯示在 header 最上排、版本徽章與右側按鈕之間，
 *       純文字**不可有外框/底色/外筆畫**，顏色對「實際量到的背景像素」對比 ≥ 4.5，
 *       空間不夠時只有它會縮（ellipsis）且永遠不與兩邊重疊；
 *       點一下可改名，載入／複製專案會自動帶入，取消改名不動原值。
 *
 * 執行：
 *   npx http-server . -p 8123 -c-1 &      # 於 repo 根目錄
 *   node tests/header-toolbar.test.js     # 可用 TEST_URL 指定網址
 */

let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const zlib = require('zlib');
const BASE = process.env.TEST_URL || 'http://127.0.0.1:8123/index.html';

/* 量「文字實際壓在什麼顏色上」：header 是漸層，用端點色算對比會失真
   （#007CF0 端 3.4:1、#00DFD8 端 9.3:1，差很多）→ 直接把該點截 1×1 的圖讀像素。
   1×1 沒有左/上鄰居，任何 PNG filter 都等於原值，所以取 filter byte 之後那幾個 byte 即可。 */
function pngPixel(buf) {
  let off = 8, colorType = 6; const idat = [];
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off), type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.slice(off + 8, off + 8 + len);
    if (type === 'IHDR') colorType = data[9];
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  if (colorType === 0) return { r: raw[1], g: raw[1], b: raw[1] };   // 灰階
  return { r: raw[1], g: raw[2], b: raw[3] };
}
const LUM = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
const CONTRAST = (a, b) => { const l1 = LUM(a), l2 = LUM(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
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
  ok('排列順序：匯入 → 匯出 → 儲存 → 載入 → 複製 → 資料庫保護',
     JSON.stringify(order) === JSON.stringify(['匯入專案','匯出專案','儲存專案','載入專案','複製專案','資料庫保護：啟用']),
     order);
  ok('專案名稱輸入框已從工具列移除（改成頂排的純文字顯示）',
     (await page.$('#cloudProjectName')) === null);
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

  // 拿掉輸入框後空出來的位置，要由整排按鈕往右補上（同一行與換行兩種情況都要靠右）
  const align = [];
  for (const w of [1600, 1500, 1280]) {
    await page.setViewportSize({ width: w, height: 950 });
    await page.waitForTimeout(120);
    align.push(await page.evaluate(vw => {
      const io = document.querySelector('.header .project-io').getBoundingClientRect();
      const hd = document.querySelector('.header').getBoundingClientRect();
      const pad = parseFloat(getComputedStyle(document.querySelector('.header')).paddingRight);
      return { vw, gapRight: Math.round(hd.right - pad - io.right),
               freeLeft: Math.round(io.left - (hd.left + pad)),
               wrapped: Math.round(io.top) > Math.round(hd.top + 60) };
    }, w));
  }
  ok('工具列靠右：右緣貼齊 header 內距（換行時也一樣）',
     align.every(a => Math.abs(a.gapRight) <= 1), align);
  ok('按鈕整排往右移動，左邊空出位置（不再貼著 header 左緣）',
     align.every(a => a.freeLeft > 40), align);
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.waitForTimeout(120);

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
  ok('分成「檔案」「資料庫」「寫入保護」三組', b4.groups === 3, b4);
  ok('組間留白明顯大於組內留白（不用豎線也看得出分組）', b4.between >= b4.inner * 2, b4);
  ok('隱藏的檔案輸入不夾在兩組中間', b4.fileInputOutside, b4);
  ok('仍可換行、沒有超出畫面（小螢幕不重疊）', b4.wrap === 'wrap' && b4.right <= b4.vw, b4);

  console.log('\n[C] 頂端專案名稱');
  await page.evaluate(() => {
    // 模擬 production：徽章會烙上完整版本字串（本機是 '—'，寬度差 170px，量位置會失真）
    document.getElementById('vb-ver').textContent = 'v2026.09.22.1530-0c5caea';
    document.getElementById('version-badge').classList.add('is-latest');
    projectNameSet('5G RRU 32T32R B20B28 第二版');
  });
  await page.waitForTimeout(80);

  const c1 = await page.evaluate(() => {
    const box = document.getElementById('projNameBox'), bs = getComputedStyle(box);
    const val = box.querySelector('.pn-value'), vs = getComputedStyle(val);
    const lab = box.querySelector('.pn-label');
    const topbar = document.querySelector('.header .hdr-topbar');
    const r = el => { const b = el.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom }; };
    return {
      label: lab.textContent, text: val.textContent,
      inTopbar: !!box.closest('.hdr-topbar'),
      // DOM 順序：徽章 → 名稱 → 右側按鈕
      domOrder: [...topbar.children].map(e => e.id || e.className),
      border: bs.borderTopWidth + '|' + bs.borderTopStyle + '|' + vs.borderTopWidth + '|' + vs.borderTopStyle,
      bg: bs.backgroundColor + '|' + vs.backgroundColor,
      outline: bs.outlineStyle + '|' + vs.outlineStyle,
      stroke: (vs.webkitTextStrokeWidth || '0px'),
      shadowBox: bs.boxShadow + '|' + vs.boxShadow,
      color: vs.color, weight: vs.fontWeight, size: parseFloat(vs.fontSize),
      cursor: bs.cursor,
      geo: { badge: r(document.getElementById('version-badge')), name: r(box), right: r(document.querySelector('.header .hdr-right')) },
      center: { x: Math.round((r(box).l + r(box).r) / 2), y: Math.round((r(box).t + r(box).b) / 2) },
    };
  });
  ok('顯示在 header 頂排、版本徽章與右側按鈕之間',
     c1.inTopbar && JSON.stringify(c1.domOrder) === JSON.stringify(['version-badge', 'hdr-name-slot', 'hdr-right']), c1.domOrder);
  ok('文字是「專案名稱：<名稱>」', c1.label === '專案名稱：' && c1.text === '5G RRU 32T32R B20B28 第二版', [c1.label, c1.text]);
  ok('位置在兩者中間，且不與任何一邊重疊',
     c1.geo.badge.r < c1.geo.name.l && c1.geo.name.r < c1.geo.right.l, c1.geo);
  ok('沒有外框：border / outline / 文字外筆畫 / box-shadow 全無',
     /^0px\|none\|0px\|none$/.test(c1.border) && c1.outline === 'none|none' &&
     parseFloat(c1.stroke) === 0 && c1.shadowBox === 'none|none', c1);
  ok('沒有底色（純粹是 header 上的文字）', /rgba\(0, 0, 0, 0\)\|rgba\(0, 0, 0, 0\)/.test(c1.bg), c1.bg);
  ok('字體明顯：粗體且比周圍小字大', parseInt(c1.weight, 10) >= 800 && c1.size >= 15, [c1.weight, c1.size]);
  ok('點得下去（游標是 pointer）', c1.cursor === 'pointer', c1.cursor);

  // 對比：量「文字正下方那個像素真正的顏色」，不是拿漸層端點猜
  await page.evaluate(() => { document.getElementById('projNameBox').style.visibility = 'hidden'; });
  const shot = await page.screenshot({ clip: { x: c1.center.x, y: c1.center.y, width: 1, height: 1 } });
  await page.evaluate(() => { document.getElementById('projNameBox').style.visibility = ''; });
  const bgPix = pngPixel(shot);
  const fgc = (() => { const p = c1.color.match(/rgba?\(([^)]+)\)/)[1].split(',').map(parseFloat); return { r: p[0], g: p[1], b: p[2] }; })();
  const cRatio = CONTRAST(fgc, bgPix);
  ok('文字顏色對「實際背景像素」對比 ≥ 4.5（白字在這片青藍上只有 2.7:1）',
     cRatio >= 4.5, { fg: c1.color, bg: bgPix, ratio: +cRatio.toFixed(2) });

  // 空間不夠時只有名稱會縮，兩邊永遠不重疊
  const c2 = [];
  for (const w of [1600, 1440, 1366, 1280]) {
    await page.setViewportSize({ width: w, height: 950 });
    await page.waitForTimeout(120);
    c2.push(await page.evaluate(vw => {
      const b = document.getElementById('version-badge').getBoundingClientRect();
      const n = document.getElementById('projNameBox').getBoundingClientRect();
      const r = document.querySelector('.header .hdr-right').getBoundingClientRect();
      const v = document.querySelector('.proj-name .pn-value');
      return { vw, badgeW: Math.round(b.width), rightW: Math.round(r.width),
               overlapL: b.right > n.left + 0.5, overlapR: n.right > r.left + 0.5,
               clipped: v.scrollWidth > v.clientWidth + 1,
               ellipsis: getComputedStyle(v).textOverflow,
               hscroll: document.documentElement.scrollWidth > vw };
    }, w));
  }
  ok('變窄時徽章與右側按鈕寬度不變（只有名稱讓位）',
     new Set(c2.map(x => x.badgeW)).size === 1 && new Set(c2.map(x => x.rightW)).size === 1, c2);
  ok('四種寬度都不與徽章／右側按鈕重疊', c2.every(x => !x.overlapL && !x.overlapR), c2);
  ok('名稱過長時以 ellipsis 截斷，不撐出橫向捲軸',
     c2[0].ellipsis === 'ellipsis' && c2.every(x => !x.hscroll) && c2[c2.length - 1].clipped, c2);
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.waitForTimeout(120);

  // 改名：欄位拿掉之後這是唯一的手動輸入口
  const c3 = await page.evaluate(async () => {
    const txt = () => document.getElementById('projNameText').textContent;
    const box = document.getElementById('projNameBox');
    const out = {};
    window.prompt = () => '手動命名A';       box.click(); out.named = [txt(), projectNameGet()];
    window.prompt = () => null;              box.click(); out.cancelled = [txt(), projectNameGet()];
    window.__alerts = [];
    window.prompt = () => '   ';             box.click(); out.blank = [txt(), projectNameGet(), window.__alerts.length];
    projectNameSet('');                      out.empty = [txt(), box.classList.contains('is-empty')];
    projectNameSet('有名字了');               out.filled = [txt(), box.classList.contains('is-empty')];
    return out;
  });
  ok('點一下可命名／改名', JSON.stringify(c3.named) === JSON.stringify(['手動命名A', '手動命名A']), c3);
  ok('取消改名不動原值', JSON.stringify(c3.cancelled) === JSON.stringify(['手動命名A', '手動命名A']), c3);
  ok('空白名稱擋下來並維持原值', c3.blank[1] === '手動命名A' && c3.blank[2] === 1, c3);
  ok('沒有專案時顯示「（未命名）」並標 is-empty', JSON.stringify(c3.empty) === JSON.stringify(['（未命名）', true]), c3);
  ok('有名字時取消 is-empty', JSON.stringify(c3.filled) === JSON.stringify(['有名字了', false]), c3);

  // 載入／儲存／複製／刪除都要跟頂排同步（原本是靠輸入框的 value）
  const c4 = await page.evaluate(async () => {
    const txt = () => document.getElementById('projNameText').textContent;
    const out = {}; const writes = [];
    const realGet = dbAdapter.getDoc, realUpd = dbAdapter.updateDoc, realDel = dbAdapter.deleteDoc,
          realList = dbAdapter.getProjectsSorted, realReady = dbAdapter.isReady;
    dbAdapter.isReady = () => true; fbOk = true;
    dbAdapter.getDoc = async (c, id) => (c === 'projects' ? { project_name: '雲端載入的專案', global_params: {}, rf_data: [] } : null);
    dbAdapter.updateDoc = async (c, id, f) => { writes.push([id, f.project_name]); };
    dbAdapter.deleteDoc = async () => {};
    dbAdapter.getProjectsSorted = async () => [];
    _ensureLockBeforeWrite = async () => true;

    await cloudLoadOne('proj_x');                    out.loaded = [txt(), projectNameGet()];
    // 載入的 document 沒有 project_name → 用 docId，不可留上一個專案的名字
    dbAdapter.getDoc = async () => ({ global_params: {}, rf_data: [] });
    await cloudLoadOne('NoNameProj');                out.fallback = txt();

    // 沒命名時按「儲存專案」→ 當場問，存進去的就是問到的名字
    projectNameSet(''); window.prompt = () => '問出來的專案';
    dbAdapter.getDoc = async () => null;
    await cloudSaveProject();                        out.savedAfterPrompt = [writes[writes.length - 1], txt()];
    // 取消命名 → 什麼都不寫
    const before = writes.length; projectNameSet(''); window.prompt = () => null;
    await cloudSaveProject();                        out.cancelWrites = writes.length - before;

    // 複製專案 → 切換到新名稱
    projectNameSet('來源專案'); document.getElementById('copyProjectName').value = '複製出來的';
    await confirmCopyProject();                      out.copied = [txt(), projectNameGet()];
    // 刪掉的正好是目前這個 → 頂排不可留殘值
    // 以 id 判斷是不是目前這個專案（名稱可能重複或改過）→ 傳複本真正的 id
    await cloudDeleteOne(currentProjectId, '複製出來的');  out.afterDelete = txt();
    dbAdapter.getDoc = realGet; dbAdapter.updateDoc = realUpd; dbAdapter.deleteDoc = realDel;
    dbAdapter.getProjectsSorted = realList; dbAdapter.isReady = realReady;
    return out;
  });
  ok('載入專案 → 頂排顯示該專案名稱',
     JSON.stringify(c4.loaded) === JSON.stringify(['雲端載入的專案', '雲端載入的專案']), c4);
  ok('專案沒存 project_name → 退回 docId，不留上一個專案的殘值', c4.fallback === 'NoNameProj', c4);
  ok('沒命名就按儲存 → 當場詢問並以該名稱寫入',
     c4.savedAfterPrompt[0][1] === '問出來的專案' && c4.savedAfterPrompt[1] === '問出來的專案', c4);
  ok('取消命名 → 不寫入任何東西', c4.cancelWrites === 0, c4);
  ok('複製專案 → 頂排切到新名稱', JSON.stringify(c4.copied) === JSON.stringify(['複製出來的', '複製出來的']), c4);
  ok('刪除目前這個專案 → 頂排回到「（未命名）」', c4.afterDelete === '（未命名）', c4);

  ok('頁面無 JS 例外', errors.length === 0, errors.slice(0, 3));

  await browser.close();
  console.log('\n通過 ' + pass + ' 項，失敗 ' + fail + ' 項');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
