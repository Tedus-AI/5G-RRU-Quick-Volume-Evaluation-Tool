/*
 * 敏感度分析「① 延伸：機殼加寬（PCB 不動）」＋參數控制台「找最低流阻比的 air gap」—— headless 驗證
 * ---------------------------------------------------------------------------
 * 使用者定義（2026-11）：PCB 由 RF/EE 定好 → 機台長寬跟著固定；① 找不到任何 air gap 能讓流阻比進建議範圍
 * （最低的還高於上限）時，自動試「機殼加寬」：加寬量平均加到左右防水邊距（PCB 不動），每個寬度重跑 ① 的 air gap 掃描。
 *
 *   [A] 沒觸發：① 已經有建議範圍內的 air gap → 不算、不顯示
 *   [B] 觸發（把 PCB 寬度縮到流阻比降不下來）：最少加寬／體積最小 與 computeAll 獨立重算一致；最少加寬前一格（−2 mm）還進不了範圍；
 *       左右邊距各加一半（整數）；PCB 寬度不變
 *   [C] 畫面：① 的答案指到下面；① 延伸在 ① 後面、圖、方案表、套用鈕、讀圖說明
 *   [D] 套用：confirm 後寫回 Left／Right／Gap、流阻比進建議範圍、延伸區塊消失、PCB 寬度不變；confirm 取消 → 不變
 *   [E] 參數控制台「找最低流阻比的 air gap」：結果＝saGapData 的最低值；套用寫回 Air Gap；參數一改結果收起來；擋下計算時給原因
 *   [F] PDF：① 延伸一節（答案、圖、方案表），圖用 Plotly.toImage
 *   [Z]（選用）FDD_FILE=<專案 JSON> → 匯入那個專案，印出加寬試算結果（不依賴備份檔：契約測試只用內建範例）
 *
 * 執行：
 *   npx http-server . -p 8123 -c-1 &      # 於 repo 根目錄
 *   node tests/widen.test.js
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
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.route('**', r => {
    const u = r.request().url();
    if (u.startsWith(BASE.replace(/index\.html$/, ''))) return r.continue();
    return r.abort();
  });
  await page.addInitScript(() => {
    window.__plots = {}; window.__imgs = [];
    window.Plotly = { newPlot(el, data, layout){ window.__plots[typeof el === 'string' ? el : el.id] = {data, layout}; return Promise.resolve(); },
      Plots:{resize(){}}, relayout(){}, purge(){},
      toImage: async (fig, o) => { window.__imgs.push({fig, o}); return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='; } };
    window.XLSX = { utils:{book_new:()=>({}),aoa_to_sheet:()=>({}),book_append_sheet(){}}, writeFile(){} };
    window.msal = { PublicClientApplication: class {
      async initialize(){} async handleRedirectPromise(){return null} getAllAccounts(){return []} } };
    window.__alerts = []; window.alert = m => window.__alerts.push(String(m));
    window.__confirmAns = true; window.__confirms = []; window.confirm = m => { window.__confirms.push(String(m)); return window.__confirmAns; };
  });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.fill('#login-pw', 'tedus');
  await page.click('#login-page button');
  await page.waitForFunction(() => typeof calcResults !== 'undefined' && calcResults && calcResults.rows.length > 0);
  await page.evaluate(() => {
    window.__orig = {};
    ['W_pcb', 'Left', 'Right', 'Gap', 'T_amb'].forEach(k => { __orig[k] = document.getElementById(k).value; });
    window.__reset = () => { Object.keys(__orig).forEach(k => { document.getElementById(k).value = __orig[k]; }); recalc(); };
    // 把 PCB 寬度往下縮，直到 ① 找不到建議範圍內的 air gap（流阻比降不下來）
    window.__narrow = () => {
      for (let w = _num(__orig.W_pcb); w >= 120; w -= 10) {
        document.getElementById('W_pcb').value = w; recalc();
        const st = vrState(calcResults); if (st !== 'ok' && st !== 'drc') continue;
        if (saWidenNeed(saGapData(G, components))) return w;
      }
      return null;
    };
  });

  console.log('\n[A] 沒觸發 → 不算、不顯示');
  const a = await page.evaluate(() => {
    // 先找一個 ① 有建議範圍內 air gap 的寬度（內建範例本身或加寬 PCB）
    let w0 = null;
    for (let w = _num(__orig.W_pcb); w <= _num(__orig.W_pcb) + 300; w += 20) {
      document.getElementById('W_pcb').value = w; recalc();
      if (vrState(calcResults) === 'ok' && saGapData(G, components).best) { w0 = w; break; }
    }
    switchTab(4); renderTab4(true);
    const d = saData(calcResults, G, components);
    return { w0, widen:d.widen, sec:!!document.getElementById('sa-widen-sec'), plot:!!window.__plots['sa-widen'] && false };
  });
  ok('找得到 ① 有建議範圍內 air gap 的情境', a.w0 !== null, a);
  ok('沒觸發：saData 沒有 widen、畫面沒有 ① 延伸', a.widen === null && !a.sec, a);

  console.log('\n[B] 觸發：數字與 computeAll 獨立重算一致');
  const b = await page.evaluate(() => {
    __reset(); window.__plots = {};
    const wNarrow = __narrow(); if (wNarrow === null) return { wNarrow };
    const g = {...G}, d = saData(calcResults, G, components), w = d.widen;
    if (!w) return { wNarrow, none:true };
    const re = (dw, gap) => { const r = computeAll({...g, Left:_num(g.Left) + dw / 2, Right:_num(g.Right) + dw / 2, Gap:gap}, components); return {V:r.Volume_L, AR:r.aspect_ratio, ok:saOk(r), W:r.W_hsk}; };
    const out = { wNarrow, W0:w.W0, W0x:rruFootprint(g).W, dws:w.pts.map(p => p.dw), first:w.pts[0].dw, Wpcb:G.W_pcb };
    if (w.min) {
      const m = w.min, r = re(m.dw, m.best.x);
      out.min = { dw:m.dw, gap:m.best.x, V:m.best.V, AR:m.best.AR, W:m.W, reV:r.V, reAR:r.AR, reOk:r.ok, reW:r.W, inBand:arGood(m.best.AR) };
      // 最少加寬的前一格（−2 mm）：每個 air gap 都進不了建議範圍
      out.prevGood = m.dw >= 2 ? !!saGapData({...g, Left:_num(g.Left) + (m.dw - 2) / 2, Right:_num(g.Right) + (m.dw - 2) / 2}, components).best : false;
    }
    if (w.small) { const s = w.small, r = re(s.dw, s.best.x); out.small = { dw:s.dw, V:s.best.V, reV:r.V, minV:Math.min(...w.pts.filter(p => p.good).map(p => p.best.V)) }; }
    return out;
  });
  ok('縮窄 PCB 後觸發（流阻比降不進建議範圍）', b.wNarrow !== null && !b.none, b);
  ok('掃描從 0 開始、加寬量都是偶數（左右邊距各加整數 mm）、由小到大', b.first === 0 && (b.dws || []).every((x, i, arr) => x % 2 === 0 && (!i || x > arr[i - 1])), b.dws);
  ok('整機寬起點＝rruFootprint', b.W0 === b.W0x, [b.W0, b.W0x]);
  if (b.min) {
    ok('最少加寬：與 computeAll（Left／Right 各 +ΔW/2、Gap）獨立重算的體積、流阻比、整機寬一致', Math.abs(b.min.V - b.min.reV) < 1e-9 && Math.abs(b.min.AR - b.min.reAR) < 1e-9 && b.min.reOk && b.min.W === b.min.reW, b.min);
    ok('最少加寬的流阻比在建議範圍內', b.min.inBand, b.min.AR);
    ok('最少加寬的前一格（−2 mm）還進不了建議範圍', b.prevGood === false, b.prevGood);
  } else ok('有最少加寬的結果', false, b);
  if (b.small) ok('體積最小：與重算一致、是所有進範圍的寬度裡最小的', Math.abs(b.small.V - b.small.reV) < 1e-9 && Math.abs(b.small.V - b.small.minV) < 1e-9, b.small);
  ok('分析本身不改參數控制台（PCB 寬度、邊距不變）', String(b.Wpcb) === String(b.wNarrow), [b.Wpcb, b.wNarrow]);

  console.log('\n[C] 畫面');
  const c = await page.evaluate(() => {
    switchTab(4); renderTab4(true);
    const sec = document.getElementById('sa-widen-sec'), gapSec = document.getElementById('sa-gap-sec');
    if (!sec) return { none:true };
    const d = saData(calcResults, G, components), rows = [...sec.querySelectorAll('#sa-widen-tbl tbody tr')];
    return { after:!!(gapSec && gapSec.compareDocumentPosition(sec) & Node.DOCUMENT_POSITION_FOLLOWING),
      gapAns:gapSec.textContent.includes('下面試算機殼加寬'), title:sec.querySelector('.vr-title').textContent,
      ans:saWidenAns(d).every(x => sec.querySelector('.sa-ans').textContent.includes(saRunsTxt(x.runs))),
      plot:!!window.__plots['sa-widen'], names:(window.__plots['sa-widen'] || {data:[]}).data.map(t => t.name).filter(Boolean),
      rows:rows.length, labels:rows.map(r => r.cells[0].textContent), apply:rows.map(r => !!r.querySelector('.sa-apply')),
      read:/怎麼看/.test(sec.textContent) && /實心鋁/.test(sec.textContent) && /儲存專案/.test(sec.textContent) };
  });
  ok('① 延伸在 ① 後面、標題寫明 PCB 不動', !c.none && c.after && /機殼加寬（PCB 不動）/.test(c.title), c);
  ok('① 的答案指到下面的加寬試算', c.gapAns);
  ok('答案句與 saWidenAns 同一份', c.ans);
  ok('圖：有畫、圖例有最少加寬', c.plot && c.names.includes('最少加寬'), c.names);
  ok('方案表：不加寬（沒有套用鈕）＋最少加寬（有套用鈕）', c.rows >= 2 && c.labels[0].startsWith('不加寬') && c.labels[1] === '最少加寬' && !c.apply[0] && c.apply[1], [c.labels, c.apply]);
  ok('讀圖說明：寫出重量高估、套用後要儲存專案', c.read);

  console.log('\n[D] 套用');
  const dd = await page.evaluate(() => {
    const before = ['Left', 'Right', 'Gap', 'W_pcb'].map(k => document.getElementById(k).value);
    window.__confirmAns = false; document.querySelectorAll('#sa-widen-tbl .sa-apply')[0].click();
    const cancel = ['Left', 'Right', 'Gap', 'W_pcb'].map(k => document.getElementById(k).value);
    const w = saData(calcResults, G, components).widen.min;
    window.__confirmAns = true; window.__confirms = [];
    document.querySelectorAll('#sa-widen-tbl .sa-apply')[0].click();
    const after = ['Left', 'Right', 'Gap', 'W_pcb'].map(k => document.getElementById(k).value);
    return { before, cancel, after, dw:w.dw, gap:w.best.x, conf:window.__confirms[0] || '', AR:calcResults.aspect_ratio, inBand:arGood(calcResults.aspect_ratio), V:calcResults.Volume_L, expV:w.best.V,
      sec:!!document.getElementById('sa-widen-sec') };
  });
  ok('confirm 取消 → 參數不變', JSON.stringify(dd.before) === JSON.stringify(dd.cancel), [dd.before, dd.cancel]);
  ok('confirm 列出左右邊距與 air gap 的變化、提醒要儲存專案', /Left/.test(dd.conf) && /Right/.test(dd.conf) && /Air Gap/.test(dd.conf) && /儲存專案/.test(dd.conf), dd.conf);
  ok('套用：左右邊距各 +ΔW/2、Air Gap＝建議值、PCB 寬度不變',
    +dd.after[0] === +dd.before[0] + dd.dw / 2 && +dd.after[1] === +dd.before[1] + dd.dw / 2 && +dd.after[2] === dd.gap && dd.after[3] === dd.before[3], dd);
  ok('套用後：流阻比在建議範圍、體積＝試算值、① 延伸不再顯示', dd.inBand && Math.abs(dd.V - dd.expV) < 1e-9 && !dd.sec, dd);

  console.log('\n[E] 參數控制台「找最低流阻比的 air gap」');
  const e = await page.evaluate(() => {
    __reset(); __narrow();
    const box = document.getElementById('ar-find-res'), hidden0 = box.hidden;
    document.getElementById('ar-find').click();
    const d = saGapData(G, components), lo = d.lowAR, txt = box.textContent, btn = box.querySelector('button');
    const r = { hidden0, shown:!box.hidden, hasAR:txt.includes(lo.AR.toFixed(2)), hasGap:txt.includes(lo.x + ' mm'), off:/仍高於建議/.test(txt), hint:/機殼加寬/.test(txt), btn:!!btn, lo:lo.x, cur:G.Gap };
    if (btn) { btn.click(); r.gapAfter = document.getElementById('Gap').value; r.AR = calcResults.aspect_ratio; r.loAR = lo.AR; r.applied = /已套用/.test(box.textContent) && /目前的 air gap 就是最低/.test(box.textContent) && !box.hidden; }
    document.getElementById('T_amb').value = _num(document.getElementById('T_amb').value) + 1; recalc();
    r.staleHidden = box.hidden;
    // 擋下計算：Air Gap 清空
    document.getElementById('Gap').value = ''; recalc(); document.getElementById('ar-find').click(); r.blockedTxt = box.textContent;
    __reset();
    return r;
  });
  ok('一開始收起來；按下後顯示最低流阻比與 air gap（＝saGapData）', e.hidden0 && e.shown && e.hasAR && e.hasGap, e);
  ok('高於建議範圍時標出來、指路到機殼加寬', e.off && e.hint, e);
  if (e.lo !== +e.cur) {
    ok('套用：Air Gap 寫回、流阻比＝最低值、顯示「已套用・目前就是最低」', e.btn && +e.gapAfter === e.lo && Math.abs(e.AR - e.loAR) < 1e-9 && e.applied, e);
  } else ok('目前就是最低時沒有套用鈕', !e.btn, e);
  ok('參數一改（環溫）→ 結果收起來（過時）', e.staleHidden, e);
  ok('擋下計算時給原因', /算不出來/.test(e.blockedTxt), e.blockedTxt);

  console.log('\n[F] PDF');
  const f = await page.evaluate(async () => {
    __reset(); __narrow(); switchTab(0); window.__imgs = []; window.__dd = null;
    ensurePdfmake = async () => {}; loadCJKFont = async () => true;
    window.pdfMake = { createPdf: dd => ({ download() { window.__dd = dd; } }) };
    await generatePDFReport();
    const dd = window.__dd; if (!dd) return { none:true, alerts:window.__alerts.slice(-2) };
    const flat = n => typeof n === 'string' ? n : Array.isArray(n) ? n.map(flat).join('') : (n && typeof n === 'object') ? (flat(n.text || '') + flat(n.stack || '') + flat(n.columns || '') + flat(n.ul || '') + (n.table ? flat(n.table.body) : '')) : '';
    const all = flat(dd.content), d = saData(calcResults, G, components);
    const r = { head:/\(1\) 延伸: 機殼加寬|\(1\) 延伸：機殼加寬/.test(all), ans:saWidenAns(d).every(x => all.includes(pdfSafeText(saRunsTxt(x.runs)))),
      table:/最少加寬/.test(all) && /片數 × 鰭片高/.test(all), img:window.__imgs.some(x => x.fig.data.some(t => t.name === '最少加寬')), noApply:!/套用/.test(all.replace(/儲存專案/g, '')) };
    __reset(); return r;
  });
  ok('PDF 有 ① 延伸一節、答案與畫面同一份', !f.none && f.head && f.ans, f);
  ok('PDF 有方案表與加寬圖（Plotly.toImage）、沒有套用鈕', f.table && f.img && f.noApply, f);

  if (process.env.FDD_FILE) {
    console.log('\n[Z] 匯入 ' + process.env.FDD_FILE);
    await page.setInputFiles('#fileInput', process.env.FDD_FILE);
    await page.waitForTimeout(800);
    const z = await page.evaluate(() => {
      recalc(); const d = saData(calcResults, G, components), w = d.widen, gp = d.gap;
      const t = p => p ? ('+' + p.dw + ' mm（W ' + p.W + '）air gap ' + p.pick.x + ' → ' + p.pick.n + ' 片 × ' + p.pick.FH.toFixed(1) + ' mm、AR ' + p.pick.AR.toFixed(2) + '、' + p.pick.V.toFixed(2) + ' L、' + p.pick.W.toFixed(1) + ' kg') : '—';
      return { name:projectNameGet(), st:d.st, V0:d.V0, AR0:calcResults.aspect_ratio, gapLo:gp.lowAR && [gp.lowAR.x, gp.lowAR.AR], widen:!!w,
        pts:w ? w.pts.map(t) : [], min:w && t(w.min), small:w && t(w.small), ans:w ? saWidenAns(d).map(x => saRunsTxt(x.runs)) : [] };
    });
    console.log(JSON.stringify(z, null, 2));
  }

  ok('沒有 JS 錯誤', errors.length === 0, errors);
  console.log(`\n結果：${pass} 通過、${fail} 失敗`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
