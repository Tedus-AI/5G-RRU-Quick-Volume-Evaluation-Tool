/*
 * 詳細分析頁（Tab2）：前三名卡片＋分析表＋PDF 同步 —— headless 驗證
 * ---------------------------------------------------------------------------
 * 卡片保留三張，但底色改為「依裕度分級」上色（MARGIN_LEVELS：紅色只給超溫），並用一條
 * 「溫升組成」說明溫度是在哪一段被吃掉的；表格改成依風險排序、數字靠右、表頭帶單位、
 * 熱阻 3 位小數、不適用顯示「—」、裕度依分級上色並標出 Tj／Tc。PDF 報告同一份資料。
 *
 * 驗證情境：
 *   [A] 前三名卡片：#1 就是瓶頸；底色＝裕度分級（不是白底、也不是依名次上色）；Tj／Tc 標籤；數量 × 單顆
 *   [B] 溫升組成：各段加總 ＝ T_ref − T_amb；以 Tc 判定的元件不含 Rjc 段；條上有限溫線
 *   [C] #1 說明：散熱器依這顆設計（安全係數）＋ 只改善這顆能多出幾度；安全係數 1.3 時不寫「未預留餘裕」
 *   [D] 超溫：卡片轉紅＋超出限溫的斜線段＋說明；超溫警告以 Tc 判定的元件寫 Tc（原本一律寫 Tj）
 *   [E] 分析表：風險排序、名次標記取代整列塗色、數字靠右、熱阻 3 位小數、「—」、Tj／Tc、數量 × 單顆、單位
 *   [F] 點欄位標題排序：第一次最差的在上、再點反向、不發熱的元件永遠在後、恢復風險排序、recalc 後保留
 *   [G] 按 👁 排除的元件列在表下，不在表裡、也不進卡片
 *   [H] 欄位勾選：順序固定不跳動；排序中的欄位被隱藏 → 退回風險排序
 *   [I] PDF：卡片與分析表用同一份資料／色值；PDF 字型缺字（全形標點、符號）轉成有的字
 *   [J] 裕度分級門檻（與視覺化報告的溫度裕度圖共用）
 *
 * 執行：
 *   npx http-server . -p 8123 -c-1 &      # 於 repo 根目錄
 *   node tests/tab2-analysis.test.js      # 可用 TEST_URL 指定網址
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
  await page.evaluate(() => switchTab(1));

  console.log('\n[A] 前三名卡片');
  const a = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('#tab1-risk .risk-card'));
    const top = calcResults.rows.filter(r => r.Total_W > 0).sort((x, y) => x.Allowed_dT - y.Allowed_dT).slice(0, 3);
    return {
      n: cards.length,
      names: cards.map(c => c.querySelector('.rc-name').textContent),
      expect: top.map(r => r.Component),
      bottleneck: calcResults.Bottleneck_Name,
      levels: cards.map(c => c.dataset.level),
      expectLevels: top.map(r => marginLevel(r.Tj_Margin).key),
      bgs: cards.map(c => getComputedStyle(c).backgroundColor),
      expectBg: top.map(r => marginLevel(r.Tj_Margin).bg),
      lbls: cards.map(c => c.querySelector('.rc-mg-lbl').textContent),
      pills: cards.map(c => c.querySelector('.rc-pill').textContent),
      pw: cards.map(c => c.querySelector('.rc-pw').textContent),
      roles: cards.map(c => c.querySelector('.rc-rank').textContent + ' ' + c.querySelector('.rc-role').textContent),
    };
  });
  const hex2rgb = h => 'rgb(' + [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)).join(', ') + ')';
  ok('三張卡片，依允許溫升由小到大', a.n === 3 && JSON.stringify(a.names) === JSON.stringify(a.expect), a);
  ok('#1 就是決定散熱器大小的瓶頸', a.names[0] === a.bottleneck && /#1 設計瓶頸/.test(a.roles[0]), a.roles);
  ok('卡片底色＝裕度分級（不是白底、也不是依名次上色）',
     JSON.stringify(a.levels) === JSON.stringify(a.expectLevels) &&
     a.bgs.every((bg, i) => bg === hex2rgb(a.expectBg[i]) && bg !== 'rgb(255, 255, 255)'), { levels: a.levels, bgs: a.bgs });
  ok('裕度標出 Tj／Tc（DDR、PWR 以 Tc 判定）', JSON.stringify(a.lbls) === JSON.stringify(['Tj 裕度', 'Tc 裕度', 'Tc 裕度']), a.lbls);
  ok('狀態不單靠顏色：圖示＋文字', a.pills.every(p => /^[✖▲●✓] (超溫|偏緊|留意|充裕)$/.test(p)), a.pills);
  ok('功耗寫出 數量 × 單顆（單顆不四捨五入成對不上的值）', a.pw[1] === '2 × 0.55 W ＝ 1.1 W' && a.pw[0] === '35 W', a.pw);

  console.log('\n[B] 溫升組成（各段加總 ＝ T_ref − T_amb）');
  const b = await page.evaluate(() => {
    const top = calcResults.rows.filter(r => r.Total_W > 0).sort((x, y) => x.Allowed_dT - y.Allowed_dT).slice(0, 3);
    const all = calcResults.rows.filter(r => r.Total_W > 0).map(r => {
      const bd = tempBudget(r, calcResults, G);
      return { name: r.Component, diff: Math.abs(bd.segs.reduce((s, x) => s + x.v, 0) - (r.T_ref - G.T_amb)), jc: bd.segs.find(x => x.key === 'jc').v, label: r.Temp_Label };
    });
    const cards = Array.from(document.querySelectorAll('#tab1-risk .risk-card'));
    return {
      all,
      segs: cards.map(c => c.querySelectorAll('.rc-seg').length),
      expectSegs: top.map(r => tempBudget(r, calcResults, G).segs.filter(s => s.v > 0.005).length),
      limits: cards.map(c => !!c.querySelector('.rc-limit')),
      overs: cards.map(c => !!c.querySelector('.rc-over')),
      legend0: cards[0].querySelector('.rc-legend').textContent,
      legend1: cards[1].querySelector('.rc-legend').textContent,
      aria: cards[0].querySelector('.rc-bar').getAttribute('aria-label'),
      hsk: tempBudget(top[0], calcResults, G).segs.find(s => s.key === 'hsk').v,
      mda: calcResults.Min_dT_Allowed / G.Margin,
    };
  });
  ok('每一顆發熱元件：各段加總 ＝ T_ref − T_amb', b.all.every(x => x.diff < 1e-9), b.all.filter(x => x.diff >= 1e-9));
  ok('以 Tc 判定的元件不含 Rjc 段', b.all.filter(x => x.label === 'Tc').every(x => x.jc === 0), b.all);
  ok('散熱器段 ＝ 瓶頸允許溫升 ÷ 安全係數', Math.abs(b.hsk - b.mda) < 1e-9, [b.hsk, b.mda]);
  ok('條上畫出每一段＋限溫線，正常狀態沒有超出段', JSON.stringify(b.segs) === JSON.stringify(b.expectSegs) && b.limits.every(Boolean) && !b.overs.some(Boolean), b);
  ok('圖例寫出加總結果與判定溫度', /＝ Tj 100\.0 °C/.test(b.legend0) && /＝ Tc .*以 Tc 判定，不含 Rjc/.test(b.legend1), [b.legend0, b.legend1]);
  ok('溫升條有文字替代（aria-label）', /^溫升組成：/.test(b.aria || ''), b.aria);

  // Power Mod 補上 Rjc：以 Tc 判定 → 溫升組成仍不含 Rjc，加總仍 ＝ Tc − T_amb
  const b2 = await page.evaluate(() => {
    const pm = components.pwr.find(c => c.Component === 'Power Mod'); const old = pm.R_jc; pm.R_jc = 0.5; recalc();
    const r = calcResults.rows.find(x => x.Component === 'Power Mod'); const bd = tempBudget(r, calcResults, G);
    const res = { jc: bd.segs.find(s => s.key === 'jc').v, diff: Math.abs(bd.segs.reduce((s, x) => s + x.v, 0) - (r.Tc - G.T_amb)) };
    pm.R_jc = old; recalc(); return res;
  });
  ok('以 Tc 判定的元件即使 Rjc > 0，溫升組成也不含 Rjc 段、加總 ＝ Tc − T_amb', b2.jc === 0 && b2.diff < 1e-9, b2);

  console.log('\n[C] #1 說明文字');
  const c = await page.evaluate(() => {
    const top = calcResults.rows.filter(r => r.Total_W > 0).sort((x, y) => x.Allowed_dT - y.Allowed_dT).slice(0, 3);
    const foot = i => document.querySelectorAll('#tab1-risk .risk-card .rc-foot')[i].textContent;
    return { f0: foot(0), f1: foot(1), gain: (top[1].Allowed_dT - top[0].Allowed_dT).toFixed(1),
             a1: top[1].Allowed_dT.toFixed(1), d1: (top[1].Allowed_dT - top[0].Allowed_dT).toFixed(1) };
  });
  ok('#1：散熱器依這顆設計、寫出安全係數與「未預留餘裕」', /散熱器依這顆設計/.test(c.f0) && /安全係數 1\.0，未預留餘裕/.test(c.f0), c.f0);
  ok('#1：只改善這顆，散熱器最多多出（#2 − #1）°C', c.f0.includes('只改善這顆，散熱器最多多 ' + c.gain + ' °C 可用'), [c.f0, c.gain]);
  ok('#2：允許溫升與「比 #1 多」', c.f1 === '允許溫升 ' + c.a1 + ' °C，比 #1 多 ' + c.d1 + ' °C', c.f1);
  const c2 = await page.evaluate(() => {
    document.getElementById('Margin').value = '1.3'; recalc();
    const card = document.querySelector('#tab1-risk .risk-card');
    const r = { foot: card.querySelector('.rc-foot').textContent, level: card.dataset.level,
                m: calcResults.rows.find(x => x.Component === calcResults.Bottleneck_Name).Tj_Margin,
                expect: calcResults.Min_dT_Allowed * (1 - 1 / 1.3) };
    r.expectLevel = marginLevel(r.m).key;
    document.getElementById('Margin').value = '1'; recalc();
    return r;
  });
  ok('安全係數 1.3：寫出 1.3、不寫「未預留餘裕」、#1 裕度 ＝ 允許溫升 × (1 − 1/1.3)',
     /安全係數 1\.3/.test(c2.foot) && !/未預留餘裕/.test(c2.foot) && Math.abs(c2.m - c2.expect) < 1e-9 && c2.level === c2.expectLevel, c2);

  console.log('\n[D] 超溫');
  const d = await page.evaluate(() => {
    const fp = components.rf.find(x => x.Component === 'Final PA'); fp.R_jc = 3.6; recalc();
    const card = document.querySelector('#tab1-risk .risk-card');
    const res = { name: card.querySelector('.rc-name').textContent, level: card.dataset.level,
                  over: !!card.querySelector('.rc-over'), warn: (card.querySelector('.rc-warn') || {}).textContent || '',
                  alert: document.getElementById('tab1-alerts').textContent };
    fp.R_jc = 1.5;
    const ddr = components.digital.find(x => x.Component === '16G DDR'); ddr['Limit(C)'] = 40; recalc();
    res.alertTc = document.getElementById('tab1-alerts').textContent;
    ddr['Limit(C)'] = 95; recalc();
    res.normalRed = Array.from(document.querySelectorAll('#tab1 [style*="--st-fg:#a61b1b"]')).filter(el => !el.closest('.an-legend')).length;
    return res;
  });
  ok('允許溫升為負 → #1 卡片轉紅（超溫）', d.name === 'Final PA' && d.level === 'over', d);
  ok('溫升條畫出超出限溫的那一段', d.over === true, d);
  ok('說明寫出「散熱器壓到環溫也救不了」與改善方向', /散熱器壓到環溫也救不了/.test(d.warn) && /Rjc／TIM／基板/.test(d.warn), d.warn);
  ok('超溫警告：以 Tj 判定的寫 Tj', /Final PA 超溫 [\d.]+°C \(Tj=/.test(d.alert), d.alert);
  ok('超溫警告：以 Tc 判定的元件寫 Tc（原本一律寫 Tj）', /16G DDR 超溫 [\d.]+°C \(Tc=/.test(d.alertTc) && /限溫=40/.test(d.alertTc), d.alertTc);
  ok('沒有超溫時畫面上不出現紅色（紅色只給超溫）', d.normalRed === 0, d.normalRed);

  console.log('\n[E] 分析表');
  const e = await page.evaluate(() => {
    const trs = Array.from(document.querySelectorAll('#tab1-table tbody tr'));
    const cell = (tr, c) => tr.querySelector('td[data-col="' + c + '"]');
    const byName = n => trs.find(tr => cell(tr, 'Component').textContent.replace(/^#\d/, '').replace('不發熱', '') === n);
    const ths = Array.from(document.querySelectorAll('#tab1-table thead th'));
    const rNums = trs.flatMap(tr => ['R_jc', 'R_int', 'R_TIM'].map(c => cell(tr, c).textContent.replace(/[◆⚠]/g, '')));
    const final = byName('Final PA'), cpu = byName('CPU (FPGA)'), ddr = byName('16G DDR'), circ = byName('Circulator'), si = byName('Si5518');
    return {
      order: trs.map(tr => cell(tr, 'Component').textContent.replace(/^#\d/, '')),
      expect: calcResults.rows.slice().sort((x, y) => x.Allowed_dT - y.Allowed_dT).map(r => r.Component),
      ranks: trs.map(tr => (tr.querySelector('.an-rank') || {}).textContent || ''),
      rowStyles: trs.filter(tr => tr.getAttribute('style')).length,
      align: getComputedStyle(cell(final, 'Tj')).textAlign, nameAlign: getComputedStyle(cell(final, 'Component')).textAlign,
      tabular: getComputedStyle(cell(final, 'Tj')).fontVariantNumeric,
      rNums, cpuRint: cell(cpu, 'R_int').textContent, cpuRintTip: cell(cpu, 'R_int').title,
      circRtim: cell(circ, 'R_TIM').textContent, circRtimTip: cell(circ, 'R_TIM').title, siRint: cell(si, 'R_int').textContent,
      cpuRjc: cell(cpu, 'R_jc').textContent,
      ddrTag: cell(ddr, 'Tj_Margin').querySelector('.an-reftag').textContent, cpuTag: cell(cpu, 'Tj_Margin').querySelector('.an-reftag').textContent,
      ddrTc: cell(ddr, 'Tc').className, ddrTj: cell(ddr, 'Tj').className, cpuTj: cell(cpu, 'Tj').className,
      mgIcon: cell(cpu, 'Tj_Margin').querySelector('.an-mg i').textContent,
      finalW: cell(final, 'Total_W').textContent, cpuWSub: !!cell(cpu, 'Total_W').querySelector('.an-sub'),
      units: ths.map(th => (th.querySelector('.an-unit') || {}).textContent),
      sortAttr: ths.map(th => th.dataset.col + ':' + th.getAttribute('aria-sort')).filter(x => !/none$/.test(x)),
      buttons: ths.every(th => th.querySelector('button.an-sort')),
      nan: /NaN/.test(document.getElementById('tab1-table').textContent),
      cap: document.querySelector('#tab1-table .an-cap').textContent,
    };
  });
  ok('預設依風險排序（允許溫升由小到大）', JSON.stringify(e.order) === JSON.stringify(e.expect), e.order);
  ok('前三名標名次（#1～#3，與卡片同序），其餘沒有', JSON.stringify(e.ranks) === JSON.stringify(['#1', '#2', '#3'].concat(Array(e.ranks.length - 3).fill(''))), e.ranks);
  ok('不再依名次整列塗色', e.rowStyles === 0, e.rowStyles);
  ok('數字靠右、等寬數字；名稱靠左', e.align === 'right' && /tabular-nums/.test(e.tabular) && e.nameAlign === 'left', [e.align, e.tabular, e.nameAlign]);
  ok('熱阻一律 3 位小數或「—」', e.rNums.every(t => /^\d+\.\d{3}$/.test(t) || t === '—'), e.rNums.filter(t => !/^\d+\.\d{3}$/.test(t) && t !== '—'));
  ok('Rjc 0.16 顯示 0.160（原本 1 位小數顯示成 0.2）', e.cpuRjc === '0.160', e.cpuRjc);
  ok('不適用顯示「—」並說明：導熱方式 None 的基板熱阻、介面材料 None 的介面熱阻',
     e.cpuRint === '—' && /不穿板/.test(e.cpuRintTip) && e.circRtim === '—' && /介面材料 None/.test(e.circRtimTip) && e.siRint === '0.813', e);
  ok('裕度格標 Tj／Tc＋分級圖示', e.ddrTag === 'Tc' && e.cpuTag === 'Tj' && /^[✖▲●✓]$/.test(e.mgIcon), [e.ddrTag, e.cpuTag, e.mgIcon]);
  ok('判定用的溫度粗體、另一個淡色', /an-ref/.test(e.ddrTc) && /an-side/.test(e.ddrTj) && /an-ref/.test(e.cpuTj), [e.ddrTc, e.ddrTj, e.cpuTj]);
  ok('總功耗：數量 > 1 列出「數量 × 單顆」，數量 1 不列', /^212\.0\s*4 × 52\.99$/.test(e.finalW) && !e.cpuWSub, e.finalW);
  ok('表頭帶單位', JSON.stringify(e.units) === JSON.stringify([' ', '°C', '°C', '°C', '°C', 'W', '°C', '°C', '°C/W', '°C/W', '°C/W', '°C']), e.units);
  ok('表頭是可聚焦的排序鈕、aria-sort 標在排序中的欄位', e.buttons && JSON.stringify(e.sortAttr) === JSON.stringify(['Allowed_dT:ascending']), e.sortAttr);
  ok('說明列寫出排序依據與裕度分級', /依風險排序/.test(e.cap) && /DDR、PWR 以 Tc 判定/.test(e.cap) && /超溫 <0/.test(e.cap) && /充裕 ≥20/.test(e.cap), e.cap);
  ok('表格沒有 NaN', e.nan === false);

  console.log('\n[F] 點欄位標題排序');
  const f = await page.evaluate(() => {
    components.pwr.push({ Component: 'Fuse', Qty: 2, 'Power(W)': 0 }); recalc();
    const names = () => Array.from(document.querySelectorAll('#tab1-table tbody tr td[data-col="Component"]')).map(td => td.textContent.replace(/^#\d/, '').replace('不發熱', ''));
    const tj = () => Array.from(document.querySelectorAll('#tab1-table tbody tr')).filter(tr => !tr.classList.contains('an-cold')).map(tr => parseFloat(tr.querySelector('td[data-col="Tj"]').textContent));
    const out = {};
    out.riskLast = names().slice(-1)[0];
    document.querySelector('#tab1-table th[data-col="Tj"] button').click();
    out.desc = tj(); out.descLast = names().slice(-1)[0];
    out.aria1 = document.querySelector('#tab1-table th[data-col="Tj"]').getAttribute('aria-sort');
    out.cap = document.querySelector('#tab1-table .an-cap').textContent;
    recalc(); out.keep = document.querySelector('#tab1-table th[data-col="Tj"]').getAttribute('aria-sort');
    document.querySelector('#tab1-table th[data-col="Tj"] button').click();
    out.asc = tj(); out.aria2 = document.querySelector('#tab1-table th[data-col="Tj"]').getAttribute('aria-sort'); out.ascLast = names().slice(-1)[0];
    document.querySelector('#tab1-table th[data-col="Tj_Margin"] button').click();
    out.mgFirst = names()[0];
    document.querySelector('#tab1-table .an-reset').click();
    out.reset = document.querySelector('#tab1-table th[data-col="Allowed_dT"]').getAttribute('aria-sort');
    out.resetCap = document.querySelector('#tab1-table .an-cap').textContent;
    components.pwr.pop(); recalc();
    return out;
  });
  const sorted = (arr, dir) => arr.every((v, i) => i === 0 || (dir > 0 ? arr[i - 1] <= v : arr[i - 1] >= v));
  ok('第一次點溫度欄 → 大到小（最熱的在上）', sorted(f.desc, -1) && f.aria1 === 'descending', f.desc);
  ok('再點一次 → 反向', sorted(f.asc, 1) && f.aria2 === 'ascending', f.asc);
  ok('不發熱的元件永遠排在後面', f.riskLast === 'Fuse' && f.descLast === 'Fuse' && f.ascLast === 'Fuse', f);
  ok('說明列改寫目前的排序＋「恢復風險排序」鈕', /目前依「Tj」由大到小排序/.test(f.cap) && /恢復風險排序/.test(f.cap), f.cap);
  ok('recalc 後排序保留', f.keep === 'descending', f.keep);
  ok('第一次點裕度欄 → 小到大（最危險的在上）', f.mgFirst === 'CPU (FPGA)', f.mgFirst);
  ok('恢復風險排序', f.reset === 'ascending' && /依風險排序/.test(f.resetCap), f);

  console.log('\n[G] 按 👁 排除的元件');
  const g = await page.evaluate(() => {
    const i = components.digital.findIndex(x => x.Component === '16G DDR');
    toggleComp('digital', i); switchTab(1);
    const res = { ex: (document.querySelector('#tab1-table .an-excluded') || {}).textContent || '',
                  inTable: Array.from(document.querySelectorAll('#tab1-table tbody td[data-col="Component"]')).some(td => /16G DDR/.test(td.textContent)),
                  inCards: Array.from(document.querySelectorAll('#tab1-risk .rc-name')).some(el => el.textContent === '16G DDR') };
    toggleComp('digital', i); switchTab(1);
    res.after = !!document.querySelector('#tab1-table .an-excluded');
    return res;
  });
  ok('表下列出「未計入計算」的元件與分類', /未計入計算 1 顆/.test(g.ex) && /16G DDR/.test(g.ex) && /DIGITAL/.test(g.ex), g.ex);
  ok('排除的元件不在表裡、也不進卡片', !g.inTable && !g.inCards, g);
  ok('重新納入後提示消失', g.after === false, g);

  console.log('\n[H] 欄位勾選');
  const h = await page.evaluate(() => {
    toggleTab1Col('Tj', false); toggleTab1Col('Tj', true);
    const order = Array.from(document.querySelectorAll('#tab1-table thead th')).map(th => th.dataset.col);
    tab1SortBy('Drop'); toggleTab1Col('Drop', false);
    const cap = document.querySelector('#tab1-table .an-cap').textContent;
    const aria = document.querySelector('#tab1-table th[data-col="Allowed_dT"]').getAttribute('aria-sort');
    toggleTab1Col('Drop', true); tab1Sort = { col: 'Allowed_dT', dir: 1 }; renderTab1();
    return { order, expect: ['Component'].concat(ALL_TAB1_COLS), cap, aria };
  });
  ok('取消再勾選：欄位順序固定（不會跑到最後）', JSON.stringify(h.order) === JSON.stringify(h.expect), h.order);
  ok('排序中的欄位被隱藏 → 退回風險排序', /依風險排序/.test(h.cap) && h.aria === 'ascending', h);

  console.log('\n[I] PDF 同步');
  const pdf = await page.evaluate(async () => {
    window.__dd = null;
    ensurePdfmake = async () => {};
    loadCJKFont = async () => true;              // 走 NotoSansTC 那條路（缺字轉換只在這個字型時套用）
    window.pdfMake = { createPdf: dd => ({ download() { window.__dd = dd; } }) };
    await generatePDFReport();
    const dd = window.__dd; if (!dd) return { none: true, alerts: window.__alerts.slice(-2) };
    const content = dd.content;
    const idx = content.findIndex(n => n && n.text === 'Top 3 Thermal Risk / 熱風險排名');
    const cards = content[idx + 1].columns;
    const top = calcResults.rows.filter(r => r.Total_W > 0).sort((x, y) => x.Allowed_dT - y.Allowed_dT).slice(0, 3);
    const flat = n => typeof n === 'string' ? n : Array.isArray(n) ? n.map(flat).join('') : (n && typeof n === 'object') ? flat(n.text || '') : '';
    const detail = content.find(n => n && n.table && n.table.headerRows === 1 && n.table.body[0].length === 12 && /Allowed/.test(flat(n.table.body[0][1])));
    const cols = ['Component'].concat(ALL_TAB1_COLS);
    const body = detail.table.body.slice(1);
    const colOf = k => cols.indexOf(k);
    const names = body.map(row => flat(row[0].text).replace(/^#\d /, '').replace(' (不發熱)', ''));
    const json = JSON.stringify(content, (k, v) => k === 'image' ? undefined : v);
    const cpu = body[names.indexOf('CPU (FPGA)')];
    return {
      ncards: cards.length, head: cards.map(cd => cd.table.body[0][0].fillColor),
      bodyBg: cards.map(cd => cd.table.body[1][0].fillColor), expectBg: top.map(r => marginLevel(r.Tj_Margin).bg),
      cardW: cards.map(cd => Math.round(cd.width)),
      notes: cards.map(cd => flat(cd.table.body[1][0].stack.slice(3).map(x => x.text))),
      screenNotes: top.map((r, i) => pdfSafeText(riskNotes(r, i, top, calcResults, G).map(l => l.runs.map(x => x.t).join('')).join(''))),
      names, expect: tab1SortRows(calcResults.rows, { col: 'Allowed_dT', dir: 1 }).map(r => r.Component),
      rank1: flat(body[0][0].text),
      cpuRint: flat(cpu[colOf('R_int')].text), cpuRjc: flat(cpu[colOf('R_jc')].text),
      cpuMgFill: cpu[colOf('Tj_Margin')].fillColor, cpuMgExpect: marginLevel(calcResults.rows.find(r => r.Component === 'CPU (FPGA)').Tj_Margin).bg,
      numAlign: cpu[colOf('Tj')].alignment,
      bad: (json.match(/[！-～←-⇿≤≥■-➿Ͱ-Ͽ]/g) || []).slice(0, 10),
      legend: ((content.find(n => n && n.table && n.table.body && n.table.body.length === 1 && n.table.body[0].length === MARGIN_LEVELS.length
                                  && /^超溫/.test(flat(n.table.body[0][0].text))) || { table: { body: [[]] } })
                .table.body[0]).map(cell => flat(cell.text)).join(' | '),
    };
  });
  if (pdf.none) ok('PDF 產生（攔截 createPdf）', false, pdf);
  else {
    ok('PDF 前三名卡片：三張、表頭深藍、底色＝裕度分級（與畫面同一份色值）',
       pdf.ncards === 3 && pdf.head.every(x => x === '#1e3a5f') && JSON.stringify(pdf.bodyBg) === JSON.stringify(pdf.expectBg), pdf);
    ok('PDF 卡片 #1 比較寬（與畫面同比例 1.3 : 1 : 1）', pdf.cardW[0] > pdf.cardW[1] && pdf.cardW[1] === pdf.cardW[2], pdf.cardW);
    ok('PDF 卡片說明文字與畫面同一份（riskNotes，只差缺字轉換）',
       pdf.notes.every((t, i) => t === pdf.screenNotes[i]), { pdf: pdf.notes, screen: pdf.screenNotes });
    ok('PDF 分析表依風險排序、前三名標名次', JSON.stringify(pdf.names) === JSON.stringify(pdf.expect) && /^#1 CPU \(FPGA\)$/.test(pdf.rank1), pdf.names);
    ok('PDF 分析表：熱阻 3 位小數、不適用「—」、數字靠右', pdf.cpuRjc === '0.160' && pdf.cpuRint === '—' && pdf.numAlign === 'right', pdf);
    ok('PDF 裕度格底色＝裕度分級', pdf.cpuMgFill === pdf.cpuMgExpect, [pdf.cpuMgFill, pdf.cpuMgExpect]);
    ok('PDF 附裕度分級圖例', /超溫 <0 °C/.test(pdf.legend) && /充裕 >=20 °C/.test(pdf.legend), pdf.legend);
    ok('PDF 內容沒有字型缺的字（全形標點、箭頭、符號、希臘字母）', pdf.bad.length === 0, pdf.bad);
  }
  const u = await page.evaluate(() => ({
    a: pdfSafeText('防水邊距（T/B 加在長、L/R 加在寬）：η=0.85 → ✓ ▲ ≥20 ＝ 1.1 W'),
    b: pdfSafeText('一般文字 45.0 °C × 2 ÷ 3 — ok'),
  }));
  ok('缺字轉換：全形 → 半形、符號改寫或拿掉', u.a === '防水邊距(T/B 加在長、L/R 加在寬): eta=0.85 ->   >=20 = 1.1 W', u.a);
  ok('缺字轉換：字型有的字原樣保留（° × ÷ —）', u.b === '一般文字 45.0 °C × 2 ÷ 3 — ok', u.b);

  console.log('\n[J] 裕度分級門檻');
  const j = await page.evaluate(() => [-0.01, 0, 9.99, 10, 19.99, 20, NaN, Infinity].map(v => { const l = marginLevel(v); return l ? l.key : null; }));
  ok('<0 超溫、0–10 偏緊、10–20 留意、≥20 充裕；算不出 → 不分級',
     JSON.stringify(j) === JSON.stringify(['over', 'tight', 'tight', 'watch', 'watch', 'ok', null, null]), j);

  ok('頁面無 JS 例外', errors.length === 0, errors.slice(0, 3));

  await browser.close();
  console.log('\n通過 ' + pass + ' 項，失敗 ' + fail + ' 項');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
