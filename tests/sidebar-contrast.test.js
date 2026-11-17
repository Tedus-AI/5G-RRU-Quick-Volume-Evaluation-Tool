/*
 * 參數控制台的文字要看得清楚 —— headless 逐一量對比
 * ---------------------------------------------------------------------------
 * 使用者回報：參數控制台改成白底後過亮，上面很多淺色小字（原本為深色底寫的行內色）看不清楚；
 * 流阻比卡片底下的說明小字在深色卡片上也看不清。改成深台達藍底之後，每一段文字都量過：
 *   [A] 底色是有顏色的深色（不是白／淺灰），標題列捲動時同色
 *   [B] 每一個看得到的文字節點（標籤、說明小字、讀值卡、按鈕、輸入框的值與 placeholder、下拉）
 *       對「它實際的底色」（往上找到第一個不透明的背景）對比 ≥ 4.5:1，字級 ≥ 11px
 *   [C] 各種狀態都量：Embedded／勾自訂係數、Die-casting（＋衍生參數卡）、流阻比 良好／不佳／過高、
 *       h_conv 過低、PCB 板厚來源提示
 *   [D] 流阻比／h 的狀態色由 class 決定（is-ok／is-poor／is-bad、is-low），沒有行內色
 *   [E] 側欄裡沒有任何行內的 color／background（換底色時才不會漏改）
 *
 * 執行：
 *   npx http-server . -p 8123 -c-1 &      # 於 repo 根目錄
 *   node tests/sidebar-contrast.test.js
 */
let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const BASE = process.env.TEST_URL || 'http://127.0.0.1:8123/index.html';
const EXEC = process.env.CHROMIUM_PATH || undefined;
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 900) : '')); }
}

/* 在頁面裡量：回傳 { bg, worst:[{text, ratio, size, fg, bg}], n } */
const AUDIT = () => {
  const parse = (c) => { const m = /rgba?\(([^)]+)\)/.exec(c); if (!m) return null; const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p[3] === undefined ? 1 : p[3] }; };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const over = (top, bot) => ({ r: top.r * top.a + bot.r * (1 - top.a), g: top.g * top.a + bot.g * (1 - top.a), b: top.b * top.a + bot.b * (1 - top.a), a: 1 });
  const bgOf = (el) => {           // 往上疊：把半透明的背景一層層疊到第一個不透明的背景上
    const stack = [];
    for (let e = el; e; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (/gradient/.test(cs.backgroundImage)) {           // 漸層：取第一個色標當代表
        const m = /rgba?\([^)]+\)/.exec(cs.backgroundImage); if (m) { stack.push(parse(m[0])); if (parse(m[0]).a >= 1) break; }
      }
      const c = parse(cs.backgroundColor);
      if (c && c.a > 0) { stack.push(c); if (c.a >= 1) break; }
    }
    let out = { r: 255, g: 255, b: 255, a: 1 };
    for (let i = stack.length - 1; i >= 0; i--) out = over(stack[i], out);
    return out;
  };
  const ratio = (fg, bg) => { const f = over(fg, bg); const a = lum(f), b = lum(bg); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); };
  const vis = (el) => { if (!el.getClientRects().length) return false; const cs = getComputedStyle(el); return cs.visibility !== 'hidden' && cs.display !== 'none' && parseFloat(cs.opacity) > 0; };
  const sb = document.querySelector('.sidebar');
  const rows = [];
  const push = (el, text, colorCss, sizeCss) => {
    const fg = parse(colorCss), bg = bgOf(el);
    if (!fg) return;
    rows.push({ text: text.slice(0, 28), ratio: +ratio(fg, bg).toFixed(2), size: parseFloat(sizeCss), fg: colorCss, bg: 'rgb(' + [bg.r, bg.g, bg.b].map(Math.round).join(',') + ')' });
  };
  const tw = document.createTreeWalker(sb, NodeFilter.SHOW_TEXT);
  for (let n = tw.nextNode(); n; n = tw.nextNode()) {
    const t = n.nodeValue.replace(/\s+/g, ' ').trim();
    if (!t || !/[A-Za-z0-9一-鿿]/.test(t)) continue;         // 只有符號／emoji 的不量
    const el = n.parentElement;
    if (!vis(el) || el.closest('option')) continue;
    let hidden = false; for (let e = el; e && e !== sb; e = e.parentElement) if (!vis(e) || (e.classList.contains('section-body') && e.classList.contains('collapsed'))) hidden = true;
    if (hidden) continue;
    const cs = getComputedStyle(el);
    // 上下標（K_eff 的 eff）本來就比本文小一號：字級看它所在的那一行
    const sizeEl = el.closest('sub, sup') ? el.closest('sub, sup').parentElement : el;
    push(el, t, cs.color, getComputedStyle(sizeEl).fontSize);
  }
  sb.querySelectorAll('input[type=number], select').forEach(el => {
    if (!vis(el)) return; const cs = getComputedStyle(el);
    push(el, '[' + el.id + '=' + el.value + ']', cs.color, cs.fontSize);
    if (el.placeholder) push(el, '[placeholder ' + el.placeholder + ']', getComputedStyle(el, '::placeholder').color, cs.fontSize);
  });
  const sbBg = parse(getComputedStyle(sb).backgroundColor);
  const h2 = parse(getComputedStyle(sb.querySelector('h2')).backgroundColor);
  return { sbBg, sbLum: +lum(sbBg).toFixed(3), h2Same: JSON.stringify(sbBg) === JSON.stringify(h2), n: rows.length,
    bad: rows.filter(r => r.ratio < 4.5 || r.size < 11).sort((a, b) => a.ratio - b.ratio).slice(0, 12),
    min: rows.reduce((m, r) => Math.min(m, r.ratio), 99),
    inline: [...sb.querySelectorAll('[style]')].filter(e => /(^|;)\s*(color|background(-color)?)\s*:/.test(e.getAttribute('style'))).map(e => (e.id || e.className || e.tagName) + ': ' + e.getAttribute('style')).slice(0, 8) };
};

(async () => {
  const browser = await chromium.launch(EXEC ? { executablePath: EXEC } : {});
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1536, height: 900 });
  await page.route('**', r => r.request().url().startsWith(BASE.replace(/index\.html$/, '')) ? r.continue() : r.abort());
  await page.addInitScript(() => {
    window.Plotly = { newPlot(){}, Plots:{resize(){}}, relayout(){}, purge(){}, toImage: async()=>'' };
    window.msal = { PublicClientApplication: class { async initialize(){} async handleRedirectPromise(){return null} getAllAccounts(){return []} } };
    window.alert = () => {}; window.confirm = () => true;
  });
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.fill('#login-pw', 'tedus'); await page.click('#login-page button');
  await page.waitForFunction(() => typeof calcResults !== 'undefined' && calcResults && calcResults.rows.length > 0);
  await page.evaluate(() => document.querySelectorAll('.sidebar .section-title.collapsed').forEach(e => e.click()));
  await page.waitForTimeout(400);
  const setVal = (id, v) => page.evaluate(([id, v]) => { const el = document.getElementById(id); if (el.type === 'checkbox') { el.checked = !!v; } else el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); if (typeof recalc === 'function') recalc(); }, [id, v]);

  console.log('\n[A] 底色');
  let a = await page.evaluate(AUDIT);
  ok('參數控制台是有顏色的深色底（相對亮度 < 0.08，不是白／淺灰），且帶藍色調', a.sbLum < 0.08 && a.sbBg.b > a.sbBg.r + 30, a.sbBg);
  ok('標題列（捲動時固定）與側欄同色', a.h2Same);

  console.log('\n[B] 預設狀態（Embedded）每一段文字');
  ok(`量到 ${a.n} 段文字，全部對比 ≥ 4.5:1、字級 ≥ 11px（最低 ${a.min}:1）`, a.n > 40 && a.bad.length === 0, a.bad);

  console.log('\n[C] 各種狀態');
  const emb = await page.evaluate(() => { const c = document.querySelector('#fin-custom-emb input[type=checkbox]'); if (c) { c.click(); } return !!c; });
  await page.waitForTimeout(100);
  a = await page.evaluate(AUDIT);
  ok('勾「自訂 Embedded Fin 係數」（多出自訂欄位與 placeholder）', emb && a.bad.length === 0, a.bad);
  await page.evaluate(() => { const s = document.getElementById('fin_tech_selector_v2'); s.value = [...s.options].find(o => /Die-casting/.test(o.value)).value; s.dispatchEvent(new Event('change', { bubbles: true })); recalc(); });
  await page.evaluate(() => { const c = document.querySelector('#fin-custom-dc input[type=checkbox]'); if (c && !c.checked) c.click(); });
  await page.waitForTimeout(150);
  a = await page.evaluate(AUDIT);
  const dcShown = await page.evaluate(() => document.getElementById('diecast-info').getClientRects().length > 0 && document.getElementById('diecast-params').getClientRects().length > 0);
  ok('Die-casting（拔模角欄位、衍生參數卡、自訂係數）', dcShown && a.bad.length === 0, { dcShown, bad: a.bad });
  await page.evaluate(() => { const s = document.getElementById('fin_tech_selector_v2'); s.value = [...s.options].find(o => /Embedded/.test(o.value)).value; s.dispatchEvent(new Event('change', { bubbles: true })); recalc(); });

  const states = {};
  for (const gap of [11.6, 30, 6, 4, 3]) {
    await setVal('Gap', gap); await page.waitForTimeout(80);
    const st = await page.evaluate(() => { const b = document.getElementById('ar-display'); return (['is-ok', 'is-poor', 'is-bad'].find(c => b.classList.contains(c)) || 'none') + (document.getElementById('h-val').classList.contains('is-low') ? '+low' : ''); });
    const r = await page.evaluate(AUDIT);
    states[st] = (states[st] || 0) + 1;
    ok(`air gap ${gap} mm（流阻比卡：${st}）文字都清楚`, r.bad.length === 0, r.bad);
  }
  ok('量到流阻比至少兩種狀態（良好／不佳／過高）', Object.keys(states).filter(k => /is-/.test(k)).length >= 2, states);
  await setVal('Gap', 11.6);

  console.log('\n[D] 狀態色由 class 決定');
  const d = await page.evaluate(() => {
    const box = document.getElementById('ar-display'), v = document.getElementById('ar-val'), m = document.getElementById('ar-msg'), tip = document.getElementById('ar-tip'), h = document.getElementById('h-val');
    const before = getComputedStyle(v).color;
    box.classList.remove('is-ok', 'is-poor', 'is-bad'); box.classList.add('is-bad');
    const bad = getComputedStyle(v).color; box.classList.remove('is-bad'); if (typeof recalc === 'function') recalc();
    return { inline: [v, m, tip, h].map(e => e.style.color).join('|'), changes: before !== bad, tipSize: parseFloat(getComputedStyle(tip).fontSize), cls: box.className };
  });
  ok('流阻比數值／訊息／說明、h 值都沒有行內色；換 class 顏色跟著換', d.inline === '|||' && d.changes, d);
  ok('流阻比說明小字 ≥ 11.5px（原本 0.65rem 灰字在深色卡片上看不清）', d.tipSize >= 11.5, d);

  console.log('\n[E] 沒有行內顏色');
  a = await page.evaluate(AUDIT);
  ok('側欄裡沒有任何行內的 color／background', a.inline.length === 0, a.inline);

  console.log('\n[F] 窄版排列（預設寬度 227px＝原本 340 的 2/3）：標籤在左、輸入框在右，全部對齊');
  const layout = () => page.evaluate(() => {
    const sb = document.getElementById('sidebar'), vis = e => e.getClientRects().length > 0;
    const ins = [...sb.querySelectorAll('.section-body > input[type=number], .section-body > .row2 input[type=number], #diecast-params > input[type=number]')].filter(vis);
    const R = e => e.getBoundingClientRect();
    const lefts = [...new Set(ins.map(e => Math.round(R(e).left)))], rights = [...new Set(ins.map(e => Math.round(R(e).right)))];
    const rows = ins.map(e => { const l = e.previousElementSibling; return { id: e.id, same: !!l && l.tagName === 'LABEL' && R(l).top < R(e).bottom && R(l).bottom > R(e).top && R(l).right <= R(e).left + 1, lines: l ? Math.round(R(l).height / parseFloat(getComputedStyle(l).lineHeight)) : 0 }; });
    const clipped = [...sb.querySelectorAll('label, .tim-lib-hint, .via-k-hint, .rd-title, .rd-tip, .dd-row, .dd-sum, .h-sub, .fin-eff-now, select')].filter(e => vis(e) && e.scrollWidth > e.clientWidth + 1).map(e => e.textContent.trim().slice(0, 20));
    const phCut = [...sb.querySelectorAll('input[type=number]')].filter(e => vis(e) && !e.value && e.placeholder).filter(e => { const c = document.createElement('canvas').getContext('2d'), cs = getComputedStyle(e, '::placeholder'); c.font = cs.fontSize + ' ' + cs.fontFamily; return c.measureText(e.placeholder).width > e.clientWidth - parseFloat(getComputedStyle(e).paddingLeft) - parseFloat(getComputedStyle(e).paddingRight) + 0.5; }).map(e => e.id + ':' + e.placeholder);
    return { w: Math.round(R(sb).width), n: ins.length, lefts, rights, notSame: rows.filter(r => !r.same).map(r => r.id), twoLine: rows.filter(r => r.lines > 1).map(r => r.id), hScroll: sb.scrollWidth - sb.clientWidth, clipped, phCut,
             hint: [...sb.querySelectorAll('.via-k-hint, .tim-lib-hint')].map(e => ({ t: e.textContent.trim(), len: e.textContent.trim().length, h: Math.round(R(e).height), tip: (e.title || '').length })) };
  });
  await page.evaluate(() => setSidebarWidth(227, false));
  let f = await layout();
  ok('預設寬度 227px、側欄沒有橫向捲動', f.w === 227 && f.hScroll <= 0, f);
  ok(`${f.n} 個參數輸入框的左緣、右緣各自對齊成一直線`, f.n >= 25 && f.lefts.length === 1 && f.rights.length === 1, [f.lefts, f.rights]);
  ok('每個參數一列：標籤在輸入框左邊同一列、標籤都只有一行', f.notSame.length === 0 && f.twoLine.length === 0, [f.notSame, f.twoLine]);
  ok('沒有任何文字或下拉被截掉', f.clipped.length === 0, f.clipped);
  ok('材料參數的說明小字縮成一行（各 ≤ 20 字），完整說明在 tooltip', f.hint.length === 2 && f.hint.every(h => h.len <= 20 && h.h <= 22 && h.tip > 30), f.hint);
  await setVal('fin_tech_selector_v2', 'Die-casting Fin (0.90)');
  await page.evaluate(() => { const c = document.getElementById('fin_custom_dc'); if (!c.checked) c.click(); });
  await page.waitForTimeout(80);
  f = await layout();
  const fc = await page.evaluate(() => { const R = e => e.getBoundingClientRect(); const a = document.getElementById('fin_eta_dc'), b = document.getElementById('fin_kfin_dc'), dp = document.getElementById('Draft_Angle'), t = document.getElementById('T_amb');
    return { custom: [a, b].map(e => { const l = e.previousElementSibling; return R(l).right <= R(e).left + 1 && R(l).top < R(e).bottom && R(l).bottom > R(e).top; }), alignCustom: Math.round(R(a).left) === Math.round(R(b).left), draft: [Math.round(R(dp).left), Math.round(R(t).left), Math.round(R(dp).right), Math.round(R(t).right)],
             dc: [...document.querySelectorAll('#diecast-info .dd-row')].map(r => r.scrollWidth <= r.clientWidth + 1 && r.getBoundingClientRect().height < 26) }; });
  ok('Die-casting：自訂係數兩格也是標籤左／輸入右且對齊；placeholder（預設 0.99／預設 150）沒有被截', fc.custom.every(Boolean) && fc.alignCustom && f.phCut.length === 0, [fc, f.phCut]);
  ok('Die-casting：拔模角與其他參數同一條對齊線；衍生參數三列各一行（名稱左、數值右）', fc.draft[0] === fc.draft[1] && fc.draft[2] === fc.draft[3] && fc.dc.length === 3 && fc.dc.every(Boolean), fc);
  ok('Die-casting 狀態也沒有文字被截、沒有橫向捲動', f.clipped.length === 0 && f.hScroll <= 0, f);
  await page.evaluate(() => { const c = document.getElementById('fin_custom_dc'); if (c.checked) c.click(); });
  await setVal('fin_tech_selector_v2', 'Embedded Fin (0.95)');
  await page.evaluate(() => setSidebarWidth(200, false));
  f = await layout();
  ok('拉到最窄（200px）仍然對齊、沒有橫向捲動', f.w === 200 && f.hScroll <= 0 && f.lefts.length === 1 && f.rights.length === 1 && f.notSame.length === 0, f);
  await page.evaluate(() => setSidebarWidth(227, false));

  ok('沒有 JS 錯誤', errors.length === 0, errors);
  await browser.close();
  console.log(`\n結果：${pass} 通過、${fail} 失敗`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('UNEXPECTED:', e); process.exit(1); });
