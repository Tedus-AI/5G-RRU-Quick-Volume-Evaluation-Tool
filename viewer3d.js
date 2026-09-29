/* ═══════════════════════════════════════════════════════════════════════════════════════
   3D 模擬視圖（Tab3）：寫實 3D 模型 —— ES module，由 index.html 以 <script type="module"> 載入
   ───────────────────────────────────────────────────────────────────────────────────────
   - three.js r170（importmap 指到 cdn.jsdelivr.net）；版面與樣式由這個模組自己掛進 #tab3-3d，
     樣式全部限定在 .r3d、id 一律加 r3d- 前綴，不影響工具其他頁面。
   - 模型全部由資料推出來：參數控制台（G）＋ computeAll 的結果（尺寸、鰭片、溫度）＋元件設定
     ＋ AI-Thermal TH/ME 頁的規格（元件本體大小／高度，唯讀）。工具每次 recalc 都呼叫
     RRU3D.update(data, hooks)（見檔尾「工具介面」），這裡不自己算熱。
   - 使用者在這一頁的調整（元件橫向位置、轉向、數位 I/O、天線座、屏蔽罩設定）跟著專案存：
     saveEdit() 交給工具（hooks.onEdit），工具轉成專案的 layout3d（以元件 _cid 為 key）、
     按「💾 儲存專案」才寫進共用資料庫。元件相對高度在這裡改＝寫回元件設定的 Height(mm) 並重算。
   - 看 CLAUDE.md「3D 模擬視圖」一節再改。
   ═══════════════════════════════════════════════════════════════════════════════════════ */
import * as THREE from 'three';
import { TrackballControls } from 'three/addons/controls/TrackballControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

/* 版面與樣式：掛進 index.html 的 #tab3-3d；樣式全部限定在 .r3d、id 一律加 r3d- 前綴（不跟工具其他頁面衝突） */
const R3D_CSS = "\n/* 單一深色工作台（刻意的單一外觀）：深色操作介面＋淺色攝影棚視窗，模擬工業 3D 軟體 */\n  .r3d{color-scheme: dark;\n    --chrome:#0f141a; --chrome2:#151c24; --chrome3:#1b2430; --line:#26323f; --line2:#334255;\n    --ink:#e6ecf2; --ink2:#a3b3c4; --ink3:#71849a;\n    --accent:#1fc6d2; --accent-soft:rgba(31,198,210,0.14); --navy:#1e3a5f; --warn:#f0b43c; --warn-soft:rgba(240,180,60,0.13);\n    --t-param:#5fd4dc; --t-data:#8fb2ff; --t-ait:#c4a8ff; --t-deco:#8796a8; --t-prov:#f0b43c;\n    --ui:\"Barlow\",\"Noto Sans TC\",\"Microsoft JhengHei\",system-ui,sans-serif;\n    --mono:\"IBM Plex Mono\",\"Noto Sans TC\",ui-monospace,Menlo,monospace;}\n.r3d [hidden]{display:none!important;}\n.r3d{margin:0;background:var(--chrome);color:var(--ink);font:14px/1.5 var(--ui);padding:10px 12px;box-sizing:border-box;border-radius:12px;container:r3d / inline-size;text-align:left;}\n.r3d *,.r3d *::before,.r3d *::after{box-sizing:border-box;}\n.r3d h2,.r3d h3,.r3d p,.r3d ul,.r3d ol,.r3d dl{margin-top:0;}\n.r3d button,.r3d input,.r3d select{margin:0;box-shadow:none;text-transform:none;letter-spacing:normal;}\n.r3d input[type=text],.r3d input[type=number]{width:100%;height:auto;}\n.r3d label{display:inline;margin:0;font-weight:inherit;}\n\n.r3d .app{display:grid;grid-template-rows:minmax(0,1fr) auto;gap:10px;height:max(580px,calc(100vh - 340px));}\n.r3d .bar{display:flex;align-items:center;gap:14px;flex-wrap:wrap;}\n.r3d .brand{display:flex;align-items:center;gap:10px;min-width:0;}\n.r3d .mark{width:30px;height:30px;border-radius:7px;background:linear-gradient(135deg,#27d4de,#1e3a5f);display:grid;place-items:center;flex-shrink:0;}\n.r3d .mark i{display:block;width:14px;height:14px;border:2px solid #e9fbfc;border-top-width:5px;border-radius:2px;}\n.r3d .brand .t{font-weight:700;font-size:1.02rem;letter-spacing:0.02em;line-height:1.2;}\n.r3d .brand .s{font-size:0.76rem;color:var(--ink3);}\n.r3d .proto{font-family:var(--mono);font-size:0.68rem;letter-spacing:0.08em;color:var(--warn);border:1px solid rgba(240,180,60,0.45);border-radius:4px;padding:0 6px;margin-left:4px;}\n.r3d .spacer{flex:1;}\n.r3d .seg{display:inline-flex;background:var(--chrome2);border:1px solid var(--line);border-radius:8px;padding:2px;gap:2px;flex-wrap:wrap;}\n.r3d .seg button{appearance:none;border:0;background:transparent;color:var(--ink2);font:600 0.8rem var(--ui);padding:5px 11px;border-radius:6px;cursor:pointer;white-space:nowrap;}\n.r3d .seg button:hover{color:var(--ink);}\n.r3d .seg button[aria-pressed=\"true\"]{background:var(--chrome3);color:var(--ink);box-shadow:inset 0 0 0 1px var(--line2);}\n.r3d .seg button:focus-visible,.r3d .tbtn:focus-visible,.r3d .tree input:focus-visible,.r3d .asm input:focus-visible{outline:2px solid var(--accent);outline-offset:1px;}\n.r3d .work{display:grid;grid-template-columns:minmax(0,1fr) 330px;gap:10px;min-height:0;}\n.r3d .stage{position:relative;min-height:440px;border-radius:10px;overflow:hidden;border:1px solid var(--line);background:#e9edf1;}\n.r3d #r3d-cv{display:block;width:100%;height:100%;touch-action:none;}\n.r3d #r3d-labels{position:absolute;inset:0;pointer-events:none;}\n.r3d .dim{font:600 12px var(--mono);color:#172230;background:rgba(255,255,255,0.88);border:1px solid rgba(23,34,48,0.18);border-radius:4px;padding:1px 6px;white-space:nowrap;}\n.r3d .dim small{font-weight:500;color:#4b5b6e;margin-left:3px;}\n.r3d .dim.src{border-color:rgba(20,120,130,0.45);}\n.r3d .dim.src em{font-style:normal;font-weight:500;color:#0d6b73;margin-left:5px;font-size:11px;}\n.r3d .dim.src.prov{border-color:rgba(214,138,0,0.7);background:rgba(255,248,230,0.94);}\n.r3d .dim.src.prov em{color:#9a5b00;}\n.r3d .ptitle{font:700 13px var(--ui);color:#10202e;background:rgba(255,255,255,0.9);border:1px solid rgba(23,34,48,0.16);border-radius:6px;padding:3px 9px;white-space:nowrap;box-shadow:0 1px 3px rgba(15,25,40,0.12);}\n.r3d .ptitle small{display:block;font:500 11px var(--ui);color:#4b5b6e;}\n.r3d .tools{position:absolute;left:10px;top:10px;right:132px;display:flex;flex-wrap:wrap;gap:8px;pointer-events:none;}\n.r3d .tgrp{pointer-events:auto;display:inline-flex;align-items:center;gap:2px;background:rgba(15,20,26,0.86);backdrop-filter:blur(6px);border:1px solid rgba(255,255,255,0.08);border-radius:9px;padding:3px;}\n.r3d .tgrp .cap{font:600 0.66rem var(--ui);letter-spacing:0.1em;color:var(--ink3);padding:0 6px 0 7px;text-transform:uppercase;}\n.r3d .tbtn{appearance:none;border:0;background:transparent;color:var(--ink2);font:600 0.78rem var(--ui);padding:5px 9px;border-radius:6px;cursor:pointer;white-space:nowrap;}\n.r3d .tbtn:hover{color:var(--ink);background:rgba(255,255,255,0.06);}\n.r3d .tbtn[aria-pressed=\"true\"]{color:#04262a;background:var(--accent);}\n.r3d .tbtn:disabled{opacity:0.35;cursor:not-allowed;}\n.r3d .legend{position:absolute;right:12px;bottom:40px;width:214px;background:rgba(15,20,26,0.9);border:1px solid rgba(255,255,255,0.08);border-radius:9px;padding:10px 12px;color:var(--ink);}\n.r3d .legend h3{margin:0 0 6px;font:700 0.78rem var(--ui);letter-spacing:0.04em;}\n.r3d .lg-bar{position:relative;height:12px;border-radius:3px;}\n.r3d .lg-ticks{position:relative;height:16px;font:500 0.66rem var(--mono);color:var(--ink2);}\n.r3d .lg-ticks span{position:absolute;top:2px;transform:translateX(-50%);white-space:nowrap;}\n.r3d .lg-ticks span.l{transform:none;}\n.r3d .lg-ticks span.r{transform:translateX(-100%);}\n.r3d .lg-mk{position:absolute;top:-3px;width:2px;height:18px;background:#fff;border-radius:1px;}\n.r3d .legend dl{margin:8px 0 0;display:grid;grid-template-columns:auto 1fr;gap:1px 10px;font-size:0.74rem;}\n.r3d .legend dt{color:var(--ink3);}\n.r3d .legend dd{margin:0;text-align:right;font-family:var(--mono);}\n.r3d .legend p{margin:7px 0 0;font-size:0.68rem;color:var(--ink3);line-height:1.45;}\n.r3d .lg-lv{display:grid;grid-template-columns:repeat(4,1fr);gap:3px;margin-top:6px;}\n.r3d .lg-lv span{font-size:0.66rem;text-align:center;border-radius:3px;padding:1px 0;color:#0f141a;font-weight:700;}\n.r3d .hint{position:absolute;left:12px;bottom:10px;font-size:0.72rem;color:#3b4a5c;background:rgba(255,255,255,0.72);border-radius:5px;padding:2px 8px;}\n.r3d .loading{position:absolute;inset:0;display:grid;place-items:center;font:600 0.9rem var(--ui);color:#3b4a5c;background:#e9edf1;}\n.r3d .secbar{position:absolute;left:50%;bottom:12px;transform:translateX(-50%);z-index:4;display:flex;align-items:center;gap:10px;background:rgba(15,20,26,0.9);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:6px 10px;color:var(--ink);max-width:calc(100% - 24px);flex-wrap:wrap;}\n.r3d .secbar .cap{font:600 0.66rem var(--ui);letter-spacing:0.1em;color:var(--ink3);text-transform:uppercase;}\n.r3d .secbar .seg button{font-size:0.74rem;padding:3px 9px;}\n.r3d .secbar input{width:220px;accent-color:var(--accent);}\n.r3d .secbar .val{font:0.74rem var(--mono);color:var(--ink2);min-width:120px;}\n.r3d #r3d-labels{z-index:1;}\n.r3d .tools,.r3d .legend,.r3d .hint{z-index:3;}\n.r3d .stackup{position:absolute;right:136px;top:62px;z-index:3;width:210px;background:rgba(15,20,26,0.92);border:1px solid rgba(255,255,255,0.08);border-radius:9px;padding:9px 11px;color:var(--ink);font-size:0.76rem;}\n.r3d .stackup h3{margin:0 0 6px;font:700 0.76rem var(--ui);letter-spacing:0.04em;}\n.r3d .su-row{display:grid;grid-template-columns:16px 1fr auto;gap:0 8px;align-items:center;padding:3px 0;border-top:1px solid var(--line);}\n.r3d .su-row i{width:14px;height:14px;border-radius:3px;display:block;box-sizing:border-box;}\n.r3d .su-row b{font:500 0.8rem var(--mono);text-align:right;}\n.r3d .su-row em{grid-column:2 / 4;font-style:normal;font-size:0.66rem;line-height:1.2;margin-top:-1px;}\n.r3d .su-row em.param{color:var(--t-param);}\n.r3d .su-row em.prov{color:var(--t-prov);}\n.r3d .su-sum{margin-top:5px;font-size:0.7rem;color:var(--ink2);}\n.r3d .tip{position:absolute;z-index:6;pointer-events:none;width:268px;background:rgba(15,20,26,0.95);border:1px solid rgba(255,255,255,0.1);border-radius:9px;padding:9px 11px;color:var(--ink);font-size:0.76rem;line-height:1.5;box-shadow:0 8px 24px rgba(0,0,0,0.28);}\n.r3d .tip b{font-size:0.84rem;}\n.r3d .tip .row{display:flex;justify-content:space-between;gap:10px;}\n.r3d .tip .row span:first-child{color:var(--ink3);}\n.r3d .tip .row span:last-child{font-family:var(--mono);text-align:right;}\n.r3d .tip .lv{display:inline-block;border-radius:4px;padding:0 6px;font-weight:700;color:#0f141a;margin-left:6px;}\n.r3d .tip .warn{color:var(--warn);margin-top:4px;}\n.r3d .tip hr{border:0;border-top:1px solid var(--line);margin:6px 0;}\n.r3d .side{display:flex;flex-direction:column;gap:10px;min-height:0;overflow:auto;padding-right:2px;}\n.r3d .card{background:var(--chrome2);border:1px solid var(--line);border-radius:10px;padding:10px 12px;}\n.r3d .card h2{margin:0 0 8px;font:700 0.72rem var(--ui);letter-spacing:0.12em;color:var(--ink3);text-transform:uppercase;display:flex;align-items:center;gap:8px;}\n.r3d .card h2 .cnt{font-family:var(--mono);letter-spacing:0;color:var(--warn);text-transform:none;}\n.r3d .tree{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:1px;}\n.r3d .tree li{display:grid;grid-template-columns:auto 1fr auto;gap:0 8px;align-items:start;padding:5px 6px;border-radius:7px;cursor:pointer;}\n.r3d .tree li:hover,.r3d .tree li.sel{background:var(--accent-soft);}\n.r3d .tree input{margin:3px 0 0;accent-color:var(--accent);}\n.r3d .tree .nm{font-weight:600;font-size:0.82rem;line-height:1.35;}\n.r3d .tree .sp{grid-column:2 / 4;font:0.7rem var(--mono);color:var(--ink2);line-height:1.4;}\n.r3d .tag{font:700 0.62rem var(--ui);letter-spacing:0.04em;border-radius:4px;padding:0 5px;border:1px solid currentColor;white-space:nowrap;align-self:center;}\n.r3d .tag.param{color:var(--t-param);}\n.r3d .tag.data{color:var(--t-data);}\n.r3d .tag.ait{color:var(--t-ait);}\n.r3d .tag.deco{color:var(--t-deco);}\n.r3d .tag.prov{color:var(--t-prov);}\n.r3d .srcl{margin:0;display:grid;grid-template-columns:auto 1fr;gap:5px 10px;font-size:0.76rem;}\n.r3d .srcl dt{color:var(--ink2);}\n.r3d .srcl dd{margin:0;text-align:right;}\n.r3d .srcl dd b{font-family:var(--mono);font-weight:500;color:var(--ink);font-variant-numeric:tabular-nums;}\n.r3d .srcl dd span{display:block;font-size:0.68rem;color:var(--ink3);}\n.r3d .asm{display:flex;flex-direction:column;gap:10px;font-size:0.78rem;}\n.r3d .asm .q{border-left:2px solid var(--warn);padding-left:9px;}\n.r3d .asm .q > div:first-child{font-weight:600;color:var(--ink);}\n.r3d .asm .q p{margin:2px 0 0;color:var(--ink2);font-size:0.72rem;line-height:1.5;}\n.r3d .asm .q p b{color:var(--ink);font-weight:600;}\n.r3d .asm .q p.bad{color:var(--warn);}\n.r3d .asm input[type=range]{width:100%;accent-color:var(--warn);margin:6px 0 0;}\n.r3d .asm .rng{display:flex;justify-content:space-between;font:0.66rem var(--mono);color:var(--ink3);}\n.r3d .asm .seg{margin-top:5px;}\n.r3d .asm .seg button{font-size:0.74rem;padding:3px 9px;}\n.r3d .kv{margin:0;display:grid;grid-template-columns:auto 1fr;gap:4px 10px;font-size:0.8rem;}\n.r3d .kv dt{color:var(--ink3);}\n.r3d .kv dd{margin:0;text-align:right;font-family:var(--mono);font-variant-numeric:tabular-nums;}\n.r3d .status{display:flex;flex-wrap:wrap;gap:4px 18px;font:0.76rem var(--mono);color:var(--ink2);padding:2px 2px;}\n.r3d .status b{color:var(--ink);font-weight:500;}\n.r3d .stabs{display:grid;grid-template-columns:repeat(6,auto);gap:2px;background:var(--chrome2);border:1px solid var(--line);border-radius:9px;padding:3px;position:sticky;top:0;z-index:2;}\n.r3d .stabs button{appearance:none;border:0;background:transparent;color:var(--ink2);font:600 0.76rem var(--ui);padding:6px 4px;border-radius:6px;cursor:pointer;white-space:nowrap;}\n.r3d .stabs button:hover{color:var(--ink);}\n.r3d .stabs button[aria-selected=\"true\"]{background:var(--chrome3);color:var(--ink);box-shadow:inset 0 0 0 1px var(--line2);}\n.r3d .stabs button:focus-visible,.r3d .fld:focus-visible,.r3d .ibtn:focus-visible,.r3d .pbtn:focus-visible{outline:2px solid var(--accent);outline-offset:1px;}\n.r3d .stabs .cnt{color:var(--warn);font-family:var(--mono);font-size:0.7rem;margin-left:2px;}\n.r3d .pstack{display:flex;flex-direction:column;gap:10px;}\n.r3d .card h2 .cnt2{font-family:var(--mono);letter-spacing:0;color:var(--ink2);text-transform:none;font-weight:500;}\n.r3d .note{margin:0 0 8px;font-size:0.72rem;color:var(--ink2);line-height:1.5;}\n.r3d .note b{color:var(--ink);font-weight:600;}\n.r3d .note.warn{color:var(--warn);margin:8px 0 0;}\n.r3d .ch,.r3d .cr{display:grid;grid-template-columns:minmax(0,1fr) 54px minmax(0,1fr) 22px 22px;gap:5px;align-items:center;}\n.r3d .ibtn[aria-pressed=\"true\"]{background:var(--accent);color:#04262a;border-color:var(--accent);}\n.r3d .ibtn[aria-pressed=\"mixed\"]{color:var(--accent);border-color:var(--accent);box-shadow:inset 0 -3px 0 var(--accent);}\n.r3d .ch{font-size:0.66rem;color:var(--ink3);letter-spacing:0.04em;padding:0 0 4px;border-bottom:1px solid var(--line);}\n.r3d .cr{padding:5px 2px;border-bottom:1px solid var(--line);border-radius:6px;cursor:pointer;}\n.r3d .cr.sel{background:var(--accent-soft);}\n.r3d .cn{min-width:0;display:grid;grid-template-columns:18px minmax(0,1fr);column-gap:5px;align-items:center;}\n.r3d .cn .eye{grid-row:1 / span 2;width:18px;height:18px;}\n.r3d .cn b,.r3d .cn small{grid-column:2;}\n.r3d .cn b{display:block;font-size:0.78rem;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}\n.r3d .cn small{display:block;font-size:0.66rem;color:var(--ink3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}\n.r3d .fld{width:100%;min-width:0;box-sizing:border-box;background:var(--chrome);border:1px solid var(--line2);border-radius:5px;color:var(--ink);font:0.76rem var(--mono);padding:4px 5px;}\n.r3d select.fld{font-family:var(--ui);padding:4px 3px;}\n.r3d .fld::placeholder{color:var(--ink3);}\n.r3d .fld.chg{border-color:var(--warn);}\n.r3d .fld.bad{border-color:#e05252;}\n.r3d .ibtn{appearance:none;border:1px solid var(--line2);background:var(--chrome3);color:var(--ink2);border-radius:5px;width:22px;height:22px;display:grid;place-items:center;font:600 0.7rem var(--ui);cursor:pointer;padding:0;}\n.r3d .ibtn:hover:not(:disabled){color:var(--ink);border-color:var(--ink3);}\n.r3d .ibtn:disabled{opacity:0.3;cursor:default;}\n.r3d .plist{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:3px;}\n.r3d .plist li{display:grid;grid-template-columns:34px minmax(0,1fr) auto;gap:4px 5px;align-items:center;padding:4px;border-radius:7px;border:1px solid transparent;cursor:pointer;}\n.r3d .plist .pl2{grid-column:1 / 4;display:grid;grid-template-columns:auto 50px 22px 22px 6px auto 50px 22px 22px;gap:3px;align-items:center;font-size:0.66rem;color:var(--ink3);}\n.r3d .plist .pl2 .fld{padding:3px 4px;}\n.r3d .plist li.sel{border-color:var(--accent);background:var(--accent-soft);}\n.r3d .plist .pn{font:600 0.7rem var(--mono);color:var(--ink2);white-space:nowrap;}\n/* 步進器：◀ 數字 ▶（數字直接顯示目前位置；按住連續、越按越快） */\n  .r3d .stp{display:grid;grid-template-columns:20px minmax(0,1fr) 20px;gap:2px;align-items:center;min-width:0;}\n.r3d .stp .ibtn{width:20px;height:24px;}\n.r3d .stp .fld{text-align:center;padding:4px 2px;}\n.r3d .ibtn[data-hold],.r3d .plist .ibtn[data-a=\"l\"],.r3d .plist .ibtn[data-a=\"r\"],.r3d .plist .ibtn[data-a=\"up\"],.r3d .plist .ibtn[data-a=\"dn\"]{touch-action:manipulation;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;}\n.r3d .ibtn.holding{background:var(--accent);color:#04262a;border-color:var(--accent);}\n.r3d .stp .cx{appearance:none;border:1px dashed var(--line2);background:transparent;color:var(--ink2);border-radius:5px;height:24px;min-width:0;padding:0 3px;font:600 0.7rem var(--mono);cursor:pointer;white-space:nowrap;overflow:hidden;}\n.r3d .stp .cx:hover{color:var(--ink);border-color:var(--ink3);}\n.r3d .stp .cx[aria-expanded=\"true\"]{border-style:solid;color:var(--ink);background:var(--chrome3);}\n.r3d .stp .cx.chg{border-color:var(--warn);}\n.r3d .stp .cx:focus-visible{outline:2px solid var(--accent);outline-offset:1px;}\n.r3d .cr.sub{padding:3px 2px 3px 12px;border-bottom:1px dashed var(--line);}\n.r3d .cr.sub .cn b{font:600 0.7rem var(--mono);color:var(--ink2);}\n.r3d .fld.ref{border-color:transparent;background:transparent;color:var(--ink);padding-left:0;cursor:default;}\n.r3d .selbar{position:absolute;left:12px;bottom:10px;z-index:4;display:flex;align-items:center;gap:10px;max-width:calc(100% - 24px);box-sizing:border-box;background:rgba(15,20,26,0.93);border:1px solid var(--accent);border-radius:8px;padding:4px 5px 4px 10px;color:var(--ink);font-size:0.74rem;line-height:1.4;box-shadow:0 6px 18px rgba(0,0,0,0.22);}\n.r3d .selbar span{min-width:0;}\n.r3d .selbar b{color:var(--accent);font-weight:700;}\n.r3d .selbar .pbtn{background:var(--accent);color:#04262a;border-color:var(--accent);padding:3px 12px;flex:none;}\n.r3d .selbar .pbtn.ghost{background:transparent;color:var(--ink);border-color:var(--line2);margin-right:-4px;}\n/* 在 3D 隱藏（👁）：清單上的小眼睛（按下＝藏起來，名稱變淡）；左下提示「已隱藏 N 個 · 全部顯示」 */\n.r3d .eye svg{width:12px;height:12px;display:block;}\n.r3d .eye .e-off{display:none;}\n.r3d .eye[aria-pressed=\"true\"] .e-on{display:none;}\n.r3d .eye[aria-pressed=\"true\"] .e-off{display:block;}\n.r3d .cr.hid .cn b,.r3d .cr.hid .cn small,.r3d .plist li.hid .pn,.r3d .plist li.hid .p-t{opacity:0.5;}\n.r3d .hidebar{position:absolute;left:12px;bottom:44px;z-index:4;display:flex;align-items:center;gap:8px;background:rgba(15,20,26,0.9);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:3px 4px 3px 9px;color:var(--ink2);font-size:0.72rem;line-height:1.4;max-width:calc(100% - 24px);box-sizing:border-box;}\n.r3d .hidebar b{color:var(--ink);font-weight:700;}\n.r3d .hidebar .pbtn{padding:2px 10px;font-size:0.72rem;flex:none;}\n/* 通道配對（FDD）：元件分頁上方的開關＋說明 */\n.r3d .pairbox{background:var(--chrome);border:1px solid var(--line2);border-radius:8px;padding:6px 8px 7px;margin:0 0 8px;}\n.r3d .pairbox .pb-h{display:flex;align-items:center;justify-content:space-between;gap:8px;font:700 0.76rem var(--ui);color:var(--ink);}\n.r3d .pairbox .seg button{padding:2px 12px;font-size:0.72rem;}\n.r3d .pairbox p{margin:5px 0 0;font-size:0.7rem;color:var(--ink2);line-height:1.55;}\n.r3d .pairbox p b{color:var(--ink);font-weight:600;}\n.r3d .status .saved{color:var(--ink3);}\n.r3d .status .saved.err{color:var(--warn);}\n.r3d .pbx{display:flex;gap:2px;}\n.r3d .padd{display:flex;gap:6px;margin-top:8px;align-items:center;flex-wrap:wrap;}\n.r3d .padd select{width:auto;flex:1 1 90px;}\n.r3d .pbtn{appearance:none;border:1px solid var(--line2);background:var(--chrome3);color:var(--ink);border-radius:6px;font:600 0.76rem var(--ui);padding:4px 10px;cursor:pointer;white-space:nowrap;}\n.r3d .pbtn.ghost{background:transparent;color:var(--ink2);}\n.r3d .pbtn:hover{border-color:var(--ink3);}\n/* 輸出 PDF：兩頁預覽＋存檔 */\n  .r3d .pdfdlg{position:fixed;inset:0;z-index:50;background:rgba(8,12,16,0.62);display:grid;place-items:center;padding:16px;}\n.r3d .pdf-card{width:min(1000px,100%);max-height:100%;display:flex;flex-direction:column;background:var(--chrome2);border:1px solid var(--line2);border-radius:12px;box-shadow:0 18px 50px rgba(0,0,0,0.4);overflow:hidden;}\n.r3d .pdf-top,.r3d .pdf-bot{display:flex;align-items:center;gap:12px;padding:10px 12px;}\n.r3d .pdf-top{border-bottom:1px solid var(--line);}\n.r3d .pdf-bot{border-top:1px solid var(--line);}\n.r3d .pdf-top h3{margin:0;font:700 0.9rem var(--ui);color:var(--ink);white-space:nowrap;}\n.r3d .pdf-st{flex:1;min-width:0;font:0.74rem var(--mono);color:var(--ink2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}\n.r3d .pdf-pages{flex:1;min-height:180px;overflow:auto;display:flex;flex-wrap:wrap;gap:14px;justify-content:center;align-content:flex-start;padding:14px;background:#56616d;}\n.r3d .pdf-pages img{width:min(450px,100%);height:auto;background:#fff;box-shadow:0 4px 16px rgba(0,0,0,0.35);}\n.r3d .pdf-note{flex:1;min-width:0;margin:0;font-size:0.74rem;color:var(--ink2);}\n.r3d .pdf-bot .pbtn{background:var(--accent);color:#04262a;border-color:var(--accent);padding:5px 16px;}\n.r3d .pdf-bot .pbtn:disabled{opacity:0.45;cursor:default;}\n.r3d .ptag{font:600 11px var(--mono);color:#10202e;background:rgba(255,255,255,0.92);border:1px solid rgba(23,34,48,0.22);border-radius:4px;padding:0 5px;white-space:nowrap;}\n.r3d .ptag.sel{background:#1fc6d2;color:#04262a;border-color:#0d6b73;}\n.r3d .tag.edit{color:var(--accent);}\n.r3d .su-row em.auto{color:var(--t-data);}\n.r3d .hint.dark{color:#e6ecf2;background:rgba(15,20,26,0.7);}\n.r3d .hint.edit{color:#04262a;background:rgba(31,198,210,0.9);}\n/* 視角方塊（ViewCube）：跟著相機轉；點一面＝那個方向的正視圖（正交投影） */\n  .r3d .vcube{position:absolute;right:12px;top:12px;z-index:4;display:flex;flex-direction:column;align-items:center;gap:8px;pointer-events:none;}\n.r3d .vc-box{--vh:25px;width:calc(var(--vh) * 2);height:calc(var(--vh) * 2);position:relative;margin:8px 8px 12px;}\n.r3d .vc-cube{position:absolute;inset:0;transform-style:preserve-3d;}\n.r3d .vc-f{position:absolute;inset:0;appearance:none;margin:0;padding:0;display:flex;flex-direction:column;align-items:center;justify-content:center;border:1px solid rgba(23,34,48,0.4);border-radius:4px;background:rgba(247,249,251,0.96);color:#142130;font:700 12px var(--ui);line-height:1.05;cursor:pointer;backface-visibility:hidden;-webkit-backface-visibility:hidden;pointer-events:auto;}\n.r3d .vc-f small{font:600 9px var(--ui);color:#4b5b6e;letter-spacing:0.02em;min-height:9px;}\n.r3d .vc-f:hover,.r3d .vc-f:focus-visible,.r3d .vc-f.on{background:#1fc6d2;color:#04262a;outline:none;}\n.r3d .vc-f:hover small,.r3d .vc-f:focus-visible small,.r3d .vc-f.on small{color:#04262a;}\n.r3d .vc-front{transform:translateZ(var(--vh));}\n.r3d .vc-back{transform:rotateY(180deg) translateZ(var(--vh));}\n.r3d .vc-right{transform:rotateY(90deg) translateZ(var(--vh));}\n.r3d .vc-left{transform:rotateY(-90deg) translateZ(var(--vh));}\n.r3d .vc-top{transform:rotateX(90deg) translateZ(var(--vh));}\n.r3d .vc-bottom{transform:rotateX(-90deg) translateZ(var(--vh));}\n.r3d .vc-ctl{display:flex;gap:2px;pointer-events:auto;background:rgba(15,20,26,0.86);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:2px;}\n.r3d .vc-ctl .tbtn{font-size:0.72rem;padding:3px 7px;}\n.r3d .vc-cross,.r3d .vc-pan{display:grid;gap:2px;pointer-events:auto;background:rgba(15,20,26,0.86);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:3px;}\n.r3d .vc-cross{grid-template-areas:\"rl t rr .\" \"l f r b\" \". d . .\";grid-template-columns:repeat(4,26px);grid-auto-rows:21px;}\n.r3d .vc-pan{grid-template-areas:\". u .\" \"l c r\" \". d .\";grid-template-columns:repeat(3,26px);grid-auto-rows:22px;}\n.r3d .vbtn{appearance:none;border:0;border-radius:4px;background:rgba(255,255,255,0.07);color:var(--ink2);font:600 0.72rem var(--ui);cursor:pointer;padding:0;display:grid;place-items:center;}\n.r3d .vbtn:hover{color:var(--ink);background:rgba(255,255,255,0.16);}\n.r3d .vbtn[aria-pressed=\"true\"]{background:var(--accent);color:#04262a;}\n.r3d .vbtn:focus-visible{outline:2px solid var(--accent);outline-offset:1px;}\n.r3d .vbtn svg{width:13px;height:13px;display:block;}\n/* 屏蔽罩面板 */\n  .r3d .shd-form{display:grid;grid-template-columns:minmax(0,1fr) 78px;gap:6px 10px;align-items:center;font-size:0.76rem;margin-bottom:10px;}\n.r3d .shd-form label{color:var(--ink2);}\n.r3d .shd-form .sub{grid-column:1 / 3;margin:-2px 0 0;font-size:0.68rem;color:var(--ink3);line-height:1.45;}\n.r3d .shd-form .seg{justify-self:end;}\n.r3d .shd-form .seg button{font-size:0.72rem;padding:3px 8px;}\n.r3d .rules{margin:0 0 10px;padding-left:18px;font-size:0.72rem;color:var(--ink2);line-height:1.5;display:flex;flex-direction:column;gap:3px;}\n.r3d .rules b{color:var(--ink);font-weight:600;}\n.r3d .cav-h{font-size:0.66rem;color:var(--ink3);letter-spacing:0.04em;padding:0 2px 4px;border-bottom:1px solid var(--line);display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:8px;}\n.r3d .cav{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:2px 8px;font-size:0.74rem;padding:4px 2px;border-bottom:1px solid var(--line);align-items:center;cursor:pointer;border-radius:5px;}\n.r3d .cav:hover,.r3d .cav.sel{background:var(--accent-soft);}\n.r3d .cav b{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}\n.r3d .cav span{font-family:var(--mono);font-size:0.7rem;color:var(--ink2);white-space:nowrap;}\n.r3d .cav .ok{color:#7fd79a;}\n.r3d .cav .ng{color:var(--warn);}\n.r3d .note.est{color:var(--t-data);margin:6px 0 0;}\n@container r3d (max-width:1280px){.r3d .work{grid-template-columns:minmax(0,1fr);}\n.r3d .stage{min-height:64vh;}\n.r3d .app{height:auto;}\n\n  }\n@container r3d (max-width:600px){.r3d .tgrp .cap{display:none;}\n.r3d .tbtn{padding:4px 7px;font-size:0.74rem;}\n.r3d .tools{gap:5px;left:6px;right:74px;top:6px;}\n.r3d .vc-cross,.r3d .vc-pan{display:none;}\n.r3d .stackup{right:12px;top:auto;bottom:60px;}\n.r3d .vc-box{--vh:20px;margin:9px 8px 10px;}\n.r3d .vcube{right:6px;top:6px;}\n.r3d .vc-f{font-size:11px;}\n.r3d .vc-f small{display:none;}\n.r3d .stabs button{font-size:0.72rem;padding:6px 2px;}\n\n  }\n@media (prefers-reduced-motion:reduce){.r3d .tbtn,.r3d .seg button{transition:none;}\n }\n\n\n.r3d .gate{position:absolute;inset:0;z-index:7;display:grid;place-items:center;padding:24px;background:rgba(15,20,26,0.9);color:var(--ink);font-size:0.9rem;text-align:center;}\n.r3d .gate b{color:var(--warn);}\n\n.r3d .ticon{display:inline-flex;align-items:center;justify-content:center;padding:5px 8px;}\n.r3d .ticon svg{width:16px;height:16px;display:block;}\n.r3d .ticon .fs-out{display:none;}\n.r3d .ticon[aria-pressed=\"true\"] .fs-in{display:none;}\n.r3d .ticon[aria-pressed=\"true\"] .fs-out{display:block;}\n.r3d .ticon[aria-busy=\"true\"]{opacity:0.55;cursor:progress;}\n/* 專案名稱：右下角立體字（使用者要求：顏色清楚、字形圓潤，參考 Arial Rounded MT Bold）。字面亮藍、下面疊三層深藍當厚度、上緣一條白色高光；\n   Arial Rounded MT Bold（Windows 有 Office／macOS 內建）→ 沒有就用 Nunito（Google Fonts，工具已載入）；font-synthesis:none 避免在已經是粗體的字上再加粗。\n   選取元件時左下的操作列會拉長 → 讓開 */\n.r3d .pname{position:absolute;right:16px;bottom:8px;z-index:2;max-width:42%;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;pointer-events:none;\n  padding:0 2px 7px;font:800 23px/1.25 \"Arial Rounded MT Bold\",\"Arial Rounded MT\",\"Nunito\",\"Noto Sans TC\",\"Microsoft JhengHei\",sans-serif;font-synthesis:none;letter-spacing:0.02em;color:#1f6fd6;\n  text-shadow:0 -1px 0 rgba(255,255,255,0.65),0 1px 0 #0f4a96,0 2px 0 #0d3f82,0 3px 0 #0b356e,0 5px 6px rgba(10,20,35,0.32);}\n.r3d .selbar:not([hidden]) ~ .pname{display:none;}\n/* 全螢幕：整頁進瀏覽器全螢幕，3D 檢視器蓋滿畫面（工具的對話框 z-index 更高，照樣看得到） */\n.r3d.r3d-fs{position:fixed;inset:0;z-index:3000;border-radius:0;overflow:auto;}\n.r3d.r3d-fs .app{height:calc(100vh - 20px);}\n";
const R3D_HTML = "\n<div class=\"app\">\n\n  <div class=\"work\">\n    <section class=\"stage\" id=\"r3d-stage\" aria-label=\"3D 視窗\">\n      <canvas id=\"r3d-cv\"></canvas>\n      <div id=\"r3d-labels\"></div>\n      <div class=\"tools\">\n        <div class=\"tgrp\" aria-label=\"狀態\"><span class=\"cap\">狀態</span>\n          <button class=\"tbtn\" data-state=\"asm\" aria-pressed=\"true\">組裝</button>\n          <button class=\"tbtn\" data-state=\"exp\" aria-pressed=\"false\">爆炸</button>\n          <button class=\"tbtn\" data-state=\"flat\" aria-pressed=\"false\">拆機攤開</button>\n        </div>\n        <div class=\"tgrp\" aria-label=\"部件\"><span class=\"cap\">部件</span>\n          <button class=\"tbtn\" data-solo=\"\" aria-pressed=\"true\" title=\"四大部件都顯示（清掉複選）\">全部</button>\n          <button class=\"tbtn\" data-solo=\"fil\" aria-pressed=\"false\" title=\"顯示腔體濾波器；可複選，再按一次取消\">濾波器</button>\n          <button class=\"tbtn\" data-solo=\"shd\" aria-pressed=\"false\" title=\"顯示屏蔽罩；可複選，再按一次取消\">屏蔽罩</button>\n          <button class=\"tbtn\" data-solo=\"pcb\" aria-pressed=\"false\" title=\"顯示 PCB（含元件、銅塊）；可複選，再按一次取消\">PCB</button>\n          <button class=\"tbtn\" data-solo=\"hsk\" aria-pressed=\"false\" title=\"顯示散熱器（含 I/O）；可複選，再按一次取消\">HSK</button>\n          <button class=\"tbtn\" id=\"r3d-t-pflip\" aria-pressed=\"false\" title=\"把畫面上顯示的部件沿長邊方向的中心軸翻轉 180°（組裝／爆炸：整組一起翻、相對位置不變；拆機攤開：各自原地翻面）；再按一次翻回\">⇅ 翻轉</button>\n        </div>\n        <div class=\"tgrp\" aria-label=\"顯示\"><span class=\"cap\">顯示</span>\n          <button class=\"tbtn\" data-mode=\"real\" aria-pressed=\"true\">寫實</button>\n          <button class=\"tbtn\" data-mode=\"therm\" aria-pressed=\"false\">熱分佈</button>\n          <button class=\"tbtn\" data-mode=\"xray\" aria-pressed=\"false\">透視</button>\n        </div>\n        <div class=\"tgrp\" aria-label=\"工具\"><span class=\"cap\">工具</span>\n          <button class=\"tbtn\" id=\"r3d-t-dim\" aria-pressed=\"true\">尺寸標註</button>\n          <button class=\"tbtn\" id=\"r3d-t-sec\" aria-pressed=\"false\" title=\"剖開看疊層：濾波器／屏蔽罩／PCB／基板／鰭片\">剖面</button>\n          <button class=\"tbtn\" id=\"r3d-t-flip\" aria-pressed=\"false\" title=\"攤開時把 PCB 翻到濾波器側\">PCB 翻面</button>\n          <button class=\"tbtn\" id=\"r3d-t-up\" aria-pressed=\"false\">直立安裝</button>\n          <button class=\"tbtn\" id=\"r3d-t-shot\" title=\"把 3D 視窗目前的畫面（含尺寸標註）存成 PNG\">📷 下載目前畫面</button>\n          <button class=\"tbtn\" id=\"r3d-t-pdf\" title=\"把 3D 模型整理成兩頁 A4 的 PDF：外觀與三視圖、內部結構與佈局\">輸出 PDF</button>\n        </div>\n        <div class=\"tgrp\" aria-label=\"視窗\">\n          <button class=\"tbtn ticon\" id=\"r3d-t-fs\" aria-pressed=\"false\" aria-label=\"全螢幕\" title=\"全螢幕（只顯示 3D 檢視器；再按一次或 Esc 退出）\"><svg class=\"fs-in\" viewBox=\"0 0 16 16\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\"><path d=\"M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4\"/></svg><svg class=\"fs-out\" viewBox=\"0 0 16 16\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\"><path d=\"M6 2v4H2M14 6h-4V2M10 14v-4h4M2 10h4v4\"/></svg></button>\n          <button class=\"tbtn ticon\" id=\"r3d-t-save\" aria-label=\"儲存專案\" title=\"儲存專案（還沒解除資料庫保護會先請你輸入密碼）\"><svg viewBox=\"0 0 16 16\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linejoin=\"round\"><path d=\"M2.5 2.5h9l2 2v9h-11z\"/><path d=\"M5 2.5v3.5h5V2.5M4.5 13.5V9.5h7v4\"/></svg></button>\n        </div>\n        <div class=\"tgrp\" aria-label=\"編輯\"><span class=\"cap\">編輯</span>\n          <button class=\"tbtn\" id=\"r3d-t-edit\" aria-pressed=\"false\" title=\"拖曳元件（長度＋橫向）、I/O、天線座；方向鍵微調\">移動</button>\n        </div>\n      </div>\n      <div class=\"vcube\" id=\"r3d-vcube\">\n        <div class=\"vc-box\"><div class=\"vc-cube\" id=\"r3d-vc-cube\">\n          <button type=\"button\" class=\"vc-f vc-front\" data-std=\"front\">前<small></small></button>\n          <button type=\"button\" class=\"vc-f vc-back\" data-std=\"back\">後<small></small></button>\n          <button type=\"button\" class=\"vc-f vc-right\" data-std=\"right\">右<small></small></button>\n          <button type=\"button\" class=\"vc-f vc-left\" data-std=\"left\">左<small></small></button>\n          <button type=\"button\" class=\"vc-f vc-top\" data-std=\"top\">上<small></small></button>\n          <button type=\"button\" class=\"vc-f vc-bottom\" data-std=\"bottom\">下<small></small></button>\n        </div></div>\n        <div class=\"vc-ctl\"><button type=\"button\" class=\"tbtn\" id=\"r3d-vc-home\" data-view=\"iso\" title=\"3D 等角視圖（透視，回到預設角度）\">等角</button><button type=\"button\" class=\"tbtn\" data-view=\"io\" title=\"從 I/O 端斜看（透視）\">I/O</button><button type=\"button\" class=\"tbtn\" id=\"r3d-t-ortho\" aria-pressed=\"false\" title=\"正交投影：沒有透視變形，看尺寸與對齊用。點方塊的面會自動切成正交\">正交</button></div>\n        <div class=\"vc-cross\" role=\"group\" aria-label=\"六個正視圖、左旋／右旋 90°\">\n          <button type=\"button\" class=\"vbtn\" data-roll=\"-1\" style=\"grid-area:rl\" title=\"左旋 90°：畫面逆時針轉（正視圖再按一次＝回到原本方向）\" aria-label=\"左旋 90°\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.4\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><polyline points=\"1 4 1 10 7 10\"/><path d=\"M3.51 15a9 9 0 1 0 2.13-9.36L1 10\"/></svg></button>\n          <button type=\"button\" class=\"vbtn\" data-roll=\"1\" style=\"grid-area:rr\" title=\"右旋 90°：畫面順時針轉（正視圖再按一次＝回到原本方向）\" aria-label=\"右旋 90°\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.4\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><polyline points=\"23 4 23 10 17 10\"/><path d=\"M20.49 15a9 9 0 1 1-2.12-9.36L23 10\"/></svg></button>\n          <button type=\"button\" class=\"vbtn\" data-std=\"top\" style=\"grid-area:t\">上</button>\n          <button type=\"button\" class=\"vbtn\" data-std=\"left\" style=\"grid-area:l\">左</button>\n          <button type=\"button\" class=\"vbtn\" data-std=\"front\" style=\"grid-area:f\">前</button>\n          <button type=\"button\" class=\"vbtn\" data-std=\"right\" style=\"grid-area:r\">右</button>\n          <button type=\"button\" class=\"vbtn\" data-std=\"back\" style=\"grid-area:b\">後</button>\n          <button type=\"button\" class=\"vbtn\" data-std=\"bottom\" style=\"grid-area:d\">下</button>\n        </div>\n        <div class=\"vc-pan\" role=\"group\" aria-label=\"平移畫面\">\n          <button type=\"button\" class=\"vbtn\" data-pan=\"0,1\" style=\"grid-area:u\" title=\"畫面往上（也可以 Shift＋左鍵拖曳、右鍵拖曳）\" aria-label=\"畫面往上\">▲</button>\n          <button type=\"button\" class=\"vbtn\" data-pan=\"-1,0\" style=\"grid-area:l\" title=\"畫面往左\" aria-label=\"畫面往左\">◀</button>\n          <button type=\"button\" class=\"vbtn\" data-pan=\"c\" style=\"grid-area:c\" title=\"回到中心（不改角度與遠近）\" aria-label=\"畫面置中\">◎</button>\n          <button type=\"button\" class=\"vbtn\" data-pan=\"1,0\" style=\"grid-area:r\" title=\"畫面往右\" aria-label=\"畫面往右\">▶</button>\n          <button type=\"button\" class=\"vbtn\" data-pan=\"0,-1\" style=\"grid-area:d\" title=\"畫面往下\" aria-label=\"畫面往下\">▼</button>\n        </div>\n      </div>\n      <div class=\"legend\" id=\"r3d-legend\" hidden>\n        <h3 title=\"基板溫度沿長度方向依 0.03 °C/mm 上升（與工具「元件相對高度」同一條公式）；鰭片沿高度依 1D 鰭片方程式（cosh）遞減。\">溫度 °C <span style=\"font-weight:500;color:var(--ink3)\">· 散熱器與鰭片</span></h3>\n        <div class=\"lg-bar\" id=\"r3d-lg-bar\"></div>\n        <div class=\"lg-ticks\" id=\"r3d-lg-ticks\"></div>\n        <dl id=\"r3d-lg-kv\"></dl>\n        <h3 style=\"margin-top:8px\">元件 · 裕度分級</h3>\n        <div class=\"lg-lv\" id=\"r3d-lg-lv\"></div>\n        <p>灰色＝不在計算模型內（PCB、屏蔽罩、濾波器）</p>\n      </div>\n      <div class=\"tip\" id=\"r3d-tip\" hidden></div>\n      <div class=\"stackup\" id=\"r3d-stackup\" hidden></div>\n      <div class=\"secbar\" id=\"r3d-secbar\" hidden>\n        <span class=\"cap\">剖面</span>\n        <div class=\"seg\" role=\"group\" aria-label=\"剖切方向\"><button type=\"button\" data-sax=\"x\" aria-pressed=\"true\">橫剖（看鰭片截面）</button><button type=\"button\" data-sax=\"z\" aria-pressed=\"false\">縱剖（沿長度）</button></div>\n        <input type=\"range\" id=\"r3d-sec-pos\" min=\"0\" max=\"100\" step=\"0.5\" aria-label=\"剖切位置\">\n        <span class=\"val\" id=\"r3d-sec-val\"></span>\n        <button type=\"button\" class=\"tbtn\" id=\"r3d-sec-bn\" title=\"剖面移到瓶頸元件的位置\">到瓶頸元件</button>\n      </div>\n      <div class=\"hidebar\" id=\"r3d-hidebar\" hidden><span id=\"r3d-hidebar-t\"></span><button type=\"button\" class=\"pbtn\" id=\"r3d-hidebar-all\" title=\"個別隱藏的元件、I/O、天線座全部顯示回來\">全部顯示</button></div>\n      <div class=\"selbar\" id=\"r3d-selbar\" hidden><span id=\"r3d-selbar-t\"></span><button type=\"button\" class=\"pbtn ghost\" id=\"r3d-selbar-hide\" title=\"在 3D 隱藏選取的這一個（H）；清單上的 👁 或左下「全部顯示」可以再顯示\">隱藏</button><button type=\"button\" class=\"pbtn\" id=\"r3d-selbar-done\" title=\"取消選取（Esc 或點 3D 空白處也可以）\">完成</button></div>\n      <div class=\"hint\" id=\"r3d-hint\">左鍵旋轉 · 右鍵或 Shift＋左鍵平移 · 滾輪縮放 · 右上方塊／十字鈕切正視（⟲⟳ 轉 90°）· 游標停在元件上看數據</div>\n      <div class=\"pname\" id=\"r3d-pname\" aria-hidden=\"true\"></div>\n      <div class=\"loading\" id=\"r3d-loading\">載入 3D 引擎…</div>\n      <div class=\"gate\" id=\"r3d-gate\" hidden></div>\n    </section>\n\n    <aside class=\"side\">\n      <div class=\"stabs\" role=\"tablist\" aria-label=\"側欄分頁\">\n        <button type=\"button\" role=\"tab\" id=\"r3d-tab-comp\" data-tab=\"comp\" aria-selected=\"true\" aria-controls=\"r3d-pn-comp\">元件</button>\n        <button type=\"button\" role=\"tab\" id=\"r3d-tab-io\" data-tab=\"io\" aria-selected=\"false\" aria-controls=\"r3d-pn-io\">I/O</button>\n        <button type=\"button\" role=\"tab\" id=\"r3d-tab-ant\" data-tab=\"ant\" aria-selected=\"false\" aria-controls=\"r3d-pn-ant\">天線座</button>\n        <button type=\"button\" role=\"tab\" id=\"r3d-tab-shd\" data-tab=\"shd\" aria-selected=\"false\" aria-controls=\"r3d-pn-shd\">屏蔽罩<span class=\"cnt\" id=\"r3d-shd-tcnt\"></span></button>\n        <button type=\"button\" role=\"tab\" id=\"r3d-tab-asm\" data-tab=\"asm\" aria-selected=\"false\" aria-controls=\"r3d-pn-asm\">假設<span class=\"cnt\" id=\"r3d-asm-cnt\"></span></button>\n        <button type=\"button\" role=\"tab\" id=\"r3d-tab-model\" data-tab=\"model\" aria-selected=\"false\" aria-controls=\"r3d-pn-model\">模型</button>\n      </div>\n      <section class=\"card\" id=\"r3d-pn-comp\" role=\"tabpanel\" aria-labelledby=\"r3d-tab-comp\">\n        <h2>元件位置 <span class=\"cnt2\" id=\"r3d-comp-cnt\"></span></h2>\n        <p class=\"note\"><b>元件相對高度</b>＝元件設定的同一格：在這裡改會寫回去、重算溫度（整列共用，多顆一起動）。<b>橫向</b>＝元件中心距 PCB 左緣，只影響 3D：◀ ▶ 按住連續移動（Shift＝10 mm），也可以直接打數字，清空＝回到自動。多顆的列點「×4」展開，每一顆各自調。<b>⟳</b>＝水平轉 90°。開「移動」可以直接在 3D 上拖。<b>👁</b>＝只在 3D 隱藏（不影響計算、不存檔）。</p>\n        <div class=\"pairbox\" id=\"r3d-pair\" hidden>\n          <div class=\"pb-h\"><span>通道配對（FDD）</span><div class=\"seg\" role=\"group\" aria-label=\"通道配對（FDD）\"><button type=\"button\" data-pair=\"1\" aria-pressed=\"true\">開</button><button type=\"button\" data-pair=\"0\" aria-pressed=\"false\">關</button></div></div>\n          <p id=\"r3d-pair-t\"></p>\n        </div>\n        <div class=\"ctab\" id=\"r3d-ctab\"></div>\n        <p class=\"note warn\" id=\"r3d-comp-warn\" hidden></p>\n        <p class=\"note est\" id=\"r3d-comp-est\" hidden></p>\n      </section>\n      <section class=\"card\" id=\"r3d-pn-io\" role=\"tabpanel\" aria-labelledby=\"r3d-tab-io\" hidden>\n        <h2>數位 I/O <span class=\"cnt2\" id=\"r3d-io-cnt\"></span></h2>\n        <p class=\"note\">橫向＝接頭中心距外殼左側（從 I/O 端往內看，由左到右）；高度＝接頭中心距分模面。◀ ▶ ▼ ▲ 按住連續移動（Shift＝10 mm），也可以直接打數字，清空＝回到自動。<b>SFP 光口跟 PCB 上的 SFP 籠綁在一起</b>：左右一起動，高度固定對齊籠子。接頭框超出端牆就自動補肉。</p>\n        <ol class=\"plist\" id=\"r3d-io-list\"></ol>\n        <div class=\"padd\"><select class=\"fld\" id=\"r3d-io-add-t\" aria-label=\"要新增的 I/O 類型\"></select><button type=\"button\" class=\"pbtn\" id=\"r3d-io-add\">＋ 新增</button><button type=\"button\" class=\"pbtn ghost\" id=\"r3d-io-reset\">重設</button></div>\n        <p class=\"note warn\" id=\"r3d-io-warn\" hidden></p>\n        <p class=\"note est\" id=\"r3d-io-note\" hidden></p>\n      </section>\n      <section class=\"card\" id=\"r3d-pn-ant\" role=\"tabpanel\" aria-labelledby=\"r3d-tab-ant\" hidden>\n        <h2>天線座 <span class=\"cnt2\" id=\"r3d-ant-cnt\"></span></h2>\n        <p class=\"note\">預設數量＝Final PA 數量。位置＝天線座中心距外殼左側：◀ ▶ 按住連續移動，也可以直接打數字，清空＝依順序自動等分。</p>\n        <ol class=\"plist\" id=\"r3d-ant-list\"></ol>\n        <div class=\"padd\"><select class=\"fld\" id=\"r3d-ant-add-t\" aria-label=\"要新增的天線座類型\"></select><button type=\"button\" class=\"pbtn\" id=\"r3d-ant-add\">＋ 新增</button><button type=\"button\" class=\"pbtn ghost\" id=\"r3d-ant-reset\">依 Final PA 數量重設</button></div>\n        <p class=\"note warn\" id=\"r3d-ant-warn\" hidden></p>\n      </section>\n      <section class=\"card\" id=\"r3d-pn-shd\" role=\"tabpanel\" aria-labelledby=\"r3d-tab-shd\" hidden>\n        <h2>屏蔽罩 <span class=\"cnt2\" id=\"r3d-shd-cnt\"></span></h2>\n        <p class=\"note\">只在 3D 顯示、不影響溫度計算。罩住 PCB 的濾波器側：長寬＝PCB，高＝分模面到 PCB（H_shield − 板厚），不會把整機撐大。腔體依下面的 RF 隔離規則自動排，元件移動就跟著變。</p>\n        <div class=\"shd-form\" id=\"r3d-shd-form\"></div>\n        <ol class=\"rules\" id=\"r3d-shd-rules\"></ol>\n        <div id=\"r3d-shd-list\"></div>\n        <p class=\"note warn\" id=\"r3d-shd-warn\" hidden></p>\n        <p class=\"note\" id=\"r3d-shd-kg\"></p>\n      </section>\n      <section class=\"card\" id=\"r3d-pn-asm\" role=\"tabpanel\" aria-labelledby=\"r3d-tab-asm\" hidden><h2>構圖規則與假設</h2><div class=\"asm\" id=\"r3d-asm\"></div></section>\n      <div class=\"pstack\" id=\"r3d-pn-model\" role=\"tabpanel\" aria-labelledby=\"r3d-tab-model\" hidden>\n        <section class=\"card\"><h2>模型樹</h2><ul class=\"tree\" id=\"r3d-tree\"></ul></section>\n        <section class=\"card\"><h2>構圖依據</h2><dl class=\"srcl\" id=\"r3d-src\"></dl></section>\n        <section class=\"card\"><h2>設計數據</h2><dl class=\"kv\" id=\"r3d-kv\"></dl></section>\n      </div>\n    </aside>\n  </div>\n\n  <footer class=\"status\" id=\"r3d-status\"></footer>\n  <div class=\"pdfdlg\" id=\"r3d-pdfdlg\" hidden role=\"dialog\" aria-modal=\"true\" aria-labelledby=\"r3d-pdf-h\">\n    <div class=\"pdf-card\">\n      <div class=\"pdf-top\"><h3 id=\"r3d-pdf-h\">輸出 PDF</h3><span class=\"pdf-st\" id=\"r3d-pdf-st\" role=\"status\"></span><button type=\"button\" class=\"ibtn\" id=\"r3d-pdf-x\" aria-label=\"關閉\">✕</button></div>\n      <div class=\"pdf-pages\" id=\"r3d-pdf-pages\"></div>\n      <div class=\"pdf-bot\"><p class=\"pdf-note\" id=\"r3d-pdf-note\"></p><button type=\"button\" class=\"pbtn\" id=\"r3d-pdf-save\" disabled>存成 PDF</button></div>\n    </div>\n  </div>\n</div>\n\n\n";
const MOUNT = document.getElementById('tab3-3d');
const ROOT = document.createElement('div');
ROOT.className = 'r3d'; ROOT.innerHTML = R3D_HTML; MOUNT.appendChild(ROOT);
{ const st = document.createElement('style'); st.id = 'r3d-css'; st.textContent = R3D_CSS; document.head.appendChild(st); }
// 3D 頁不在畫面上（切到別頁：祖先 display:none → 沒有 client rect）→ 不處理按鍵、不重畫。
// ⚠ 不可用 offsetParent：全螢幕時 .r3d 是 position:fixed，offsetParent 永遠是 null → 整個停止重畫
const onScreen = () => ROOT.isConnected && ROOT.getClientRects().length > 0;

/* 資料由工具餵（RRU3D.update）：P＝{ key, name, g, r, rows }（computeAll 的結果＋參數控制台），
   rows[].spec ＝ AI-Thermal TH/ME 頁的規格（唯讀參考）；DB_SPECS ＝ 資料庫裡所有有規格的元件（同名查詢用）。 */
let DB_SPECS = {};

const $ = id => document.getElementById('r3d-' + id);
const stage = $('stage'), canvas = $('cv');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const f1 = v => (Math.round(v * 10) / 10).toString(), f2 = v => (Math.round(v * 100) / 100).toString();
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
} catch (e) {
  $('loading').textContent = '這台電腦的瀏覽器無法啟用 WebGL，3D 視窗無法顯示。';
  window.__rru3dFail = 'webgl'; window.dispatchEvent(new Event('rru3d-fail'));
  console.warn('[3D] WebGL 無法啟用：', e);
  await new Promise(() => {});   // 停在這裡：模組其餘部分不執行（不丟出未攔截的錯誤；工具 Tab3 已顯示原因）
}
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.75));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;   // Khronos PBR Neutral：產品渲染用，白色不會被壓灰
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.42;

function studioBackground(dark) {
  const c = document.createElement('canvas'); c.width = 16; c.height = 512;
  const g = c.getContext('2d'), grd = g.createLinearGradient(0, 0, 0, 512);
  if (dark) { grd.addColorStop(0, '#3a4452'); grd.addColorStop(1, '#1b222b'); }
  else { grd.addColorStop(0, '#f3f5f7'); grd.addColorStop(0.55, '#e3e7ec'); grd.addColorStop(1, '#c9d0d8'); }
  g.fillStyle = grd; g.fillRect(0, 0, 16, 512);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const bgLight = studioBackground(false), bgDark = studioBackground(true);
scene.background = bgLight;

const camera = new THREE.PerspectiveCamera(28, 1, 10, 40000);
/* 自由旋轉（跟一般 3D／CAD 軟體一樣可以往任何方向轉 360°，不會卡在正上方或地面）：左鍵旋轉、右鍵平移、滾輪縮放 */
const controls = new TrackballControls(camera, canvas);
controls.rotateSpeed = 2.2; controls.zoomSpeed = 1.0; controls.panSpeed = 0.6;
controls.staticMoving = true;                        // 放開滑鼠就停（CAD 習慣，不會自己一直轉）
controls.minDistance = 80; controls.maxDistance = 20000;
controls.keys = [null, null, null];                  // 不用 A/S/D 切換模式（避免在輸入框打字時被攔截）
/* 正交投影（正視圖用）：正交相機每一格跟著主相機走（同方向、同焦點），畫面比例＝焦點平面上的透視比例 → 切換時大小不跳 */
const ocam = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 40000);
let ORTHO = false;
const acam = () => ORTHO ? ocam : camera;
function syncOrtho() {
  const t = controls.target, d = camera.position.distanceTo(t), hh = d * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)), hw = hh * camera.aspect;
  ocam.left = -hw; ocam.right = hw; ocam.top = hh; ocam.bottom = -hh;
  const back = Math.max(radius * 5, d);
  ocam.position.copy(camera.position).sub(t).normalize().multiplyScalar(back).add(t);
  ocam.quaternion.copy(camera.quaternion); ocam.up.copy(camera.up);
  ocam.near = 1; ocam.far = back + radius * 6; ocam.updateProjectionMatrix(); ocam.updateMatrixWorld(true);
}

/* 燈光：環境光（HDR 攝影棚）＋主光（柔和陰影）＋兩盞背光勾出邊緣 */
const key = new THREE.DirectionalLight(0xfffaf2, 3.4);
key.castShadow = true;
key.shadow.mapSize.set(4096, 4096);
key.shadow.bias = -0.0004; key.shadow.normalBias = 0.6;
scene.add(key, key.target);
const rimA = new THREE.DirectionalLight(0xe8f1ff, 2.2), rimB = new THREE.DirectionalLight(0xf2f6ff, 1.4);
scene.add(rimA, rimB);
scene.add(new THREE.HemisphereLight(0xffffff, 0xb8c0ca, 0.25));

const floor = new THREE.Mesh(new THREE.PlaneGeometry(20000, 20000), new THREE.ShadowMaterial({ opacity: 0.28 }));
floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
function contactShadowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
  const grd = g.createRadialGradient(128, 128, 10, 128, 128, 128);
  grd.addColorStop(0, 'rgba(20,26,34,0.7)'); grd.addColorStop(0.5, 'rgba(20,26,34,0.32)'); grd.addColorStop(1, 'rgba(20,26,34,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const contactTex = contactShadowTexture();
const contacts = [0, 1, 2, 3].map(() => { const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: contactTex, transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.position.y = 0.2; scene.add(m); return m; });

/* ── 材質 ── */
function noiseNormal(amp, rep) {           // 程式產生的細紋法線貼圖（粉體烤漆橘皮、壓鑄面），不需要外部貼圖檔
  const s = 256, c = document.createElement('canvas'); c.width = c.height = s;
  const x = c.getContext('2d'), img = x.createImageData(s, s);
  for (let i = 0; i < s * s; i++) {
    img.data[i * 4] = 128 + (Math.random() - 0.5) * amp; img.data[i * 4 + 1] = 128 + (Math.random() - 0.5) * amp;
    img.data[i * 4 + 2] = 255; img.data[i * 4 + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep, rep); return t;
}
const powderN = noiseNormal(22, 10), castN = noiseNormal(40, 5);
const MAT = {
  powder: new THREE.MeshPhysicalMaterial({ color: 0xe6e8e7, roughness: 0.5, metalness: 0, clearcoat: 0.22, clearcoatRoughness: 0.5, normalMap: powderN, normalScale: new THREE.Vector2(0.18, 0.18) }),
  alRaw:  new THREE.MeshStandardMaterial({ color: 0x7f868e, metalness: 0.35, roughness: 0.7, normalMap: castN, normalScale: new THREE.Vector2(0.4, 0.4) }),
  alMach: new THREE.MeshStandardMaterial({ color: 0xaab1b9, metalness: 0.8, roughness: 0.3 }),
  chromate: new THREE.MeshStandardMaterial({ color: 0xd8cd9c, metalness: 0.45, roughness: 0.42 }),
  gasket: new THREE.MeshStandardMaterial({ color: 0xf0ede4, roughness: 0.7 }),
  lid:    new THREE.MeshStandardMaterial({ color: 0xc6cacf, metalness: 0.9, roughness: 0.34 }),
  metal:  new THREE.MeshStandardMaterial({ color: 0xd4d7dc, metalness: 1, roughness: 0.26 }),
  steel:  new THREE.MeshStandardMaterial({ color: 0xb9bdc3, metalness: 1, roughness: 0.38 }),
  plastic:new THREE.MeshStandardMaterial({ color: 0x2c3036, roughness: 0.55 }),
  hole:   new THREE.MeshStandardMaterial({ color: 0x0b0c0e, roughness: 0.95 }),
  ptfe:   new THREE.MeshStandardMaterial({ color: 0xf1eee4, roughness: 0.45 }),
  mask:   new THREE.MeshPhysicalMaterial({ color: 0x1b5a3a, roughness: 0.42, clearcoat: 0.35, clearcoatRoughness: 0.35 }),
  fr4:    new THREE.MeshStandardMaterial({ color: 0xb8ae86, roughness: 0.8 }),
  copper: new THREE.MeshStandardMaterial({ color: 0xc57b46, metalness: 1, roughness: 0.3 }),
  gold:   new THREE.MeshStandardMaterial({ color: 0xd9b35f, metalness: 1, roughness: 0.26 }),
  tin:    new THREE.MeshStandardMaterial({ color: 0xd9dde0, metalness: 0.9, roughness: 0.32 }),
  mold:   new THREE.MeshStandardMaterial({ color: 0x1c1e22, roughness: 0.5 }),
  moldLite: new THREE.MeshStandardMaterial({ color: 0x31353b, roughness: 0.55 }),
  substrate: new THREE.MeshStandardMaterial({ color: 0x3a4a33, roughness: 0.55 }),
  putty:  new THREE.MeshStandardMaterial({ color: 0xb591da, roughness: 0.88 }),
  padTim: new THREE.MeshStandardMaterial({ color: 0x9db4c9, roughness: 0.82 }),
  grease: new THREE.MeshStandardMaterial({ color: 0x8e959d, roughness: 0.3, metalness: 0.2 }),
  glue:   new THREE.MeshStandardMaterial({ color: 0x1d5fd8, roughness: 0.22 }),
  pocket: new THREE.MeshStandardMaterial({ color: 0x6b727a, roughness: 0.9, metalness: 0.4 }),
  ghost:  new THREE.MeshStandardMaterial({ color: 0xfff6df, roughness: 0.6, transparent: true, opacity: 0.4, depthWrite: false }),
  therm:  new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0 }),
  grey:   new THREE.MeshStandardMaterial({ color: 0x9aa3ad, roughness: 0.75 }),
  greyDk: new THREE.MeshStandardMaterial({ color: 0x5c646e, roughness: 0.75 }),
  hl:     new THREE.MeshStandardMaterial({ color: 0x9fe8ee, roughness: 0.5, emissive: 0x0b6b74, emissiveIntensity: 0.55 }),
};
MAT.powderFin = MAT.powder.clone(); MAT.powderFin.normalScale = new THREE.Vector2(0.06, 0.06);
MAT.shd = new THREE.MeshStandardMaterial({ color: 0xdfe3e8, metalness: 0.62, roughness: 0.3 });        // 屏蔽罩：CNC 鋁件（化學鎳，亮銀）
MAT.shdFloor = new THREE.MeshStandardMaterial({ color: 0xd2d7dd, metalness: 0.55, roughness: 0.4 });
MAT.fip = new THREE.MeshStandardMaterial({ color: 0x50555b, roughness: 0.78 });                     // FIP 點膠導電膠條
const EDGE_MAT = new THREE.LineBasicMaterial({ color: 0xd68a00, transparent: true, opacity: 0.9 });

/* 裕度分級（與工具的 MARGIN_LEVELS 同一組色值：紅色只給超溫） */
const MARGIN_LEVELS = [
  { lt: 0, label: '超溫', mk: '#d03b3b' }, { lt: 10, label: '偏緊', mk: '#ec835a' },
  { lt: 20, label: '留意', mk: '#fab219' }, { lt: Infinity, label: '充裕', mk: '#0ca30c' }];
const marginLevel = m => (typeof m === 'number' && isFinite(m)) ? MARGIN_LEVELS.find(l => m < l.lt) : null;
const LV_MAT = MARGIN_LEVELS.map(l => new THREE.MeshStandardMaterial({ color: l.mk, roughness: 0.55 }));

/* 熱分佈色階：感知均勻的暗→亮（亮度單調遞增），不用彩虹 */
const RAMP = ['#1b1036', '#4b1a6f', '#8f2a6b', '#d2473f', '#f08b1f', '#f6d54b'].map(c => new THREE.Color(c));
function rampColor(t) {
  t = Math.max(0, Math.min(1, t)); const f = t * (RAMP.length - 1), i = Math.min(Math.floor(f), RAMP.length - 2);
  return RAMP[i].clone().lerp(RAMP[i + 1], f - i);
}
function rampCss() { return 'linear-gradient(90deg,' + RAMP.map((c, i) => '#' + c.getHexString() + ' ' + (i / (RAMP.length - 1) * 100).toFixed(0) + '%').join(',') + ')'; }

let P = null;                                  // 目前的專案
/* 散熱器基板溫度：工具的 T_hsk_eff = T_hsk_base + 元件相對高度 × Slope → 沿長度方向線性上升（只在 PCB 範圍內有定義） */
function rootT(x) { const g = P.g; return P.r.T_base + Math.min(Math.max(x - g.Btm, 0), g.L_pcb) * g.Slope; }
/* 1D 鰭片方程式：θ(s)/θb = cosh(m(Lc−s)) / cosh(m·Lc)，m = √(2h / (k·t)) */
/* 鰭片規格文字（元件清單、PDF 共用）：Die-casting 寫出鰭尖→根部厚度、拔模角與根部間隙（跟 computeAll 的 T_root／G_root 同一組） */
function finSpecTxt() {
  const g = P.g, r = P.r;
  if (r.isDC && r.T_root > g.Fin_t) return '厚 ' + g.Fin_t + '→' + f2(r.T_root) + '（尖→根，拔模 ' + g.Draft + '°）· 間距 ' + g.Gap + '（根部 ' + f2(r.G_root) + '）';
  return '厚 ' + g.Fin_t + ' · 間距 ' + g.Gap;
}
function finT(x, s) {
  const tf = P.r.isDC && P.r.T_root > P.g.Fin_t ? (P.g.Fin_t + P.r.T_root) / 2 : P.g.Fin_t;   // Die-casting：跟 computeAll 算 η_fin 一樣用平均厚度
  const m = Math.sqrt(2 * P.r.h / (P.r.k_fin * tf / 1000)), Lc = (P.r.FH + tf / 2) / 1000;
  return P.g.T_amb + (rootT(x) - P.g.T_amb) * Math.cosh(m * (Lc - s / 1000)) / Math.cosh(m * Lc);
}
let T_LO = 45, T_HI = 100;
const tN = T => (T - T_LO) / (T_HI - T_LO);
function paintX(geo) {                          // 依 x（長度方向）上色：基板／側牆／凸台
  const pos = geo.attributes.position, c = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) { const col = rampColor(tN(rootT(pos.getX(i)))); c[i * 3] = col.r; c[i * 3 + 1] = col.g; c[i * 3 + 2] = col.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3)); return geo;
}

/* ── 元件資料 → 3D 排列 ── */
const specKey = n => String(n || '').replace(/ /g, '_').replace(/\//g, '-');
function parseLW(s) {
  if (!s) return null; const m = String(s).split(/[×xX*]/).map(v => parseFloat(v));
  if (m.length === 1 && m[0] > 0) return [m[0], m[0]];
  return (m.length >= 2 && m[0] > 0 && m[1] > 0) ? [m[0], m[1]] : null;
}
function roleOf(r) {
  const s = (r.type || '') + ' ' + r.name;
  if (/sfp|光模組/i.test(s)) return 'sfp';
  if (/filter/i.test(s) && !(r.padL > 0)) return 'filter';
  if (/pre.?driver/i.test(s)) return 'pre';
  if (/driver/i.test(s)) return 'drv';
  if (/circulator|(^|\s)cr(\s|$)/i.test(s)) return 'circ';
  if (/final|(^|[^a-z])pa([^a-z]|$)/i.test(s)) return 'pa';
  if (/fpga|cpu|xczu|soc|baseband/i.test(s)) return 'fpga';
  if (/ddr/i.test(s)) return 'ddr';
  if (/si55|clk|clock/i.test(s)) return 'clk';
  if (/power ?mod/i.test(s)) return 'pmod';
  return 'ic';
}
/* 沒有本體高度時，參考資料庫裡同類元件的 AI-Thermal 規格（暫定，畫面上標出來） */
const ROLE_REF_CACHE = new Map();
function roleRef(role) {                       // 資料庫裡同角色、有本體高度的元件（依名稱排序取第一個，結果固定）
  if (ROLE_REF_CACHE.has(role)) return ROLE_REF_CACHE.get(role);
  const k = Object.keys(DB_SPECS).sort().find(n => parseFloat(DB_SPECS[n].h) > 0 && roleOf({ name: n.replace(/_/g, ' '), type: '', padL: 1 }) === role) || null;
  ROLE_REF_CACHE.set(role, k); return k;
}
const GHOST_H = 1.5;
function bodyOf(r, role) {
  const own = r.spec || null, same = DB_SPECS[specKey(r.name)];
  let size, sizeSrc, sizeK, h = null, hSrc, hK;
  const ownSz = own && parseLW(own.size), sameSz = same && parseLW(same.size);
  if (ownSz) { size = ownSz; sizeSrc = 'AI-Thermal 規格'; sizeK = 'ait'; }
  else if (sameSz) { size = sameSz; sizeSrc = 'AI-Thermal 同名元件（' + same.proj + '）'; sizeK = 'ait'; }
  else { size = [r.padL, r.padW]; sizeSrc = '元件表 E-Pad'; sizeK = 'data'; }
  if (r.padL > 0 && r.padW > 0 && (r.padL >= r.padW) !== (size[0] >= size[1])) size = [size[1], size[0]];   // 長邊方向跟 E-Pad 一致
  const refK = roleRef(role), ownH = own && parseFloat(own.h), sameH = same && parseFloat(same.h), ref = refK ? DB_SPECS[refK] : null;
  if (ownH > 0) { h = ownH; hSrc = 'AI-Thermal 規格'; hK = 'ait'; }
  else if (sameH > 0) { h = sameH; hSrc = 'AI-Thermal 同名元件（' + same.proj + '）'; hK = 'ait'; }
  else if (role === 'sfp') { h = 9.8; hSrc = 'SFP 籠標準高度（MSA）'; hK = 'data'; }
  else if (ref && parseFloat(ref.h) > 0) { h = parseFloat(ref.h); hSrc = '暫定：同類元件 ' + refK + '（' + ref.proj + '）'; hK = 'prov'; }
  else { hSrc = '未知（以 ' + GHOST_H + ' mm 薄片示意）'; hK = 'prov'; }
  if (role === 'sfp' && size[0] < size[1]) size = [size[1], size[0]];    // SFP 插口一定朝 I/O 端 → 長邊沿長度方向
  return { L: size[0], W: size[1], h, sizeSrc, sizeK, hSrc, hK };
}
/* 凸台接觸面＝工具算 R_TIM 用的同一個面積 */
function contactOf(r) {
  const g = P.g;
  if (r.bt === 'Copper Coin') return { L: g.Coin_L, W: g.Coin_W, kind: 'coin', label: '銅塊 ' + g.Coin_L + '×' + g.Coin_W };
  if (r.bt === 'Thermal Via') {
    const L = r.baseL > 0 ? r.baseL : r.padL, W = r.baseW > 0 ? r.baseW : r.padW;
    return { L, W, kind: 'via', label: '(E-Pad＋板厚) ' + f2(L) + '×' + f2(W) };
  }
  return { L: r.padL, W: r.padW, kind: 'top', label: '元件上表面 ' + f2(r.padL) + '×' + f2(r.padW) };
}

const A = { ref: 'center' };          // 元件相對高度量到元件中心（跟工具的「元件相對高度」同一個意思）
let LAY = null;
/* 使用者在 3D 頁的調整（跟著專案存：工具把它轉成專案的 layout3d，以元件 _cid 為 key；這裡用元件名稱當 key）：
   posW＝元件橫向位置（元件中心距 PCB 左緣，每顆一個值，null＝自動）、rot＝元件水平旋轉（每顆 0 或 90）、
   io／ant＝數位 I/O 與天線座清單（null＝預設；I/O 另有高度 y）、shd＝屏蔽罩設定（沒改的用預設值）；
   hgt＝元件相對高度：只是「還沒寫回」的暫存 → saveEdit 時由工具寫回元件設定並重算，寫回後就清空。 */
const HOST = { E: null, onEdit: null, onSave: null };
let SKIP_REBUILD = false, REFRAME = false;
const normEdit = v => Object.assign({ posW: {}, hgt: {}, rot: {}, io: null, ant: null, shd: {} }, v || {});
function ed() { if (!HOST.E) HOST.E = normEdit(null); return HOST.E; }
function saveEdit() {
  const E = ed(); ioList(); antList();                     // 預設清單在第一次改的時候才落地（改別的東西也一併存，內容相同）
  SAVED.at = new Date(); SAVED.pending = true; const el = $('saved'); if (el) savedPaint(el);
  if (!HOST.onEdit) return;
  const seq = UPD_SEQ;
  HOST.onEdit(E);
  if (UPD_SEQ !== seq) { SKIP_REBUILD = true; queueMicrotask(() => { SKIP_REBUILD = false; }); }   // 工具已經重算並更新畫面
}
/* 狀態列：3D 的調整跟專案一起存 → 提醒按「💾 儲存專案」 */
const SAVED = { at: null, pending: false };
function savedPaint(el) {
  const t = SAVED.at ? SAVED.at.toTimeString().slice(0, 8) : '';
  el.classList.toggle('err', false);
  el.textContent = SAVED.pending ? '已調整 ' + t + ' · 按「💾 儲存專案」才會存進專案' : '3D 調整跟著專案存（💾 儲存專案）';
  el.title = '元件橫向位置、轉向、I/O、天線座與屏蔽罩設定存在專案裡（共用資料庫）；元件相對高度直接寫回元件設定。';
}
/* 疊層規則（使用者定義）：PCB 的 HSK 側板面直接貼在基板內側；HSK 側凸出的元件在基板挖凹槽，凹槽底到鰭片側不到 T_MIN 就補肉 */
const T_MIN = 3.0, BOSS_WALL = 3.0;          // 凹槽底到鰭片側至少 3 mm；補肉四周肉厚 3 mm（壓鑄肉厚一致）
const SCREW_REC = 6.5;                 // 濾波器上蓋凹入：調諧螺絲整組收在 H_filter 以內（不會頂到屏蔽罩）
const SHD_DEF = { on: true, roof: 2.5, wall: 2.0, rim: 3.0, fmax: 3.8 };   // 屏蔽罩：頂板、隔牆、外框（mm）、工作頻段上限（GHz）
const shdCfg = () => Object.assign({}, SHD_DEF, ed().shd || {});
/* 元件相對高度：3D 上改＝寫回元件設定的同一格（整列共用），放開後工具重算；拖曳／按住的過程中先估這一顆的溫度變化 */
const hgtOf = r => typeof ed().hgt[r.name] === 'number' ? ed().hgt[r.name] : r.hgt;
const dHgt = r => hgtOf(r) - r.hgt;
const dTemp = r => r.W > 0 ? dHgt(r) * P.g.Slope : 0;                       // 局部環溫＋散熱器溫度都是 Height × Slope
const estMargin = r => typeof r.margin === 'number' ? r.margin - dTemp(r) : r.margin;
/* 會不會變成瓶頸：允許溫升 ＝ 裕度 ＋ MDA／安全係數；散熱器是照最小的允許溫升（MDA）設計的 */
function bnRiskAt(r, h) {
  const dh = h - r.hgt; if (!(r.W > 0) || Math.abs(dh) < 0.01) return null;
  if (r.name === P.r.bn) return dh > 0 ? 'up' : 'down';
  return r.margin + P.r.MDA / (P.g.Margin || 1) - dh * P.g.Slope < P.r.MDA - 0.05 ? 'new' : null;
}
const bnRisk = r => bnRiskAt(r, hgtOf(r));
function riskHtml(r, h) {
  const k = bnRiskAt(r, h);
  return k === 'new' ? '<div class="warn">⚠ 允許溫升會低於目前瓶頸（' + esc(P.r.bn) + '）→ 變成新的瓶頸，散熱器要加大；放開後重算體積</div>'
    : k === 'up' ? '<div class="warn">⚠ 這顆就是瓶頸：往上移 → 散熱器要加大</div>'
    : k === 'down' ? '<div style="color:var(--t-data);font-size:0.72rem">這顆是瓶頸：往下移 → 散熱器可以縮小（放開後重算）</div>' : '';
}
let UID = 1;
const uid = p => p + (UID++) + Math.random().toString(36).slice(2, 6);
/* 數位 I/O 分三大類（使用者定義）：SFP／電源（白色凸台＋黑色開口，電源跟 SFP 光口同一種外觀）、Signal（圓形防水座：RJ45 等，AISG 也算訊號）、
   Debug port（金屬框＋黑色開口）；接地歸「其他」。key 不變（舊專案存的 layout3d.io 照樣讀得懂）：rj45＝Signal、dbg＝Debug port */
const IO_CLASS = [['sfp', 'SFP／電源'], ['sig', 'Signal'], ['dbg', 'Debug port'], ['etc', '其他']];
const IO_TYPES = { sfp: { n: 'SFP 光口', s: 'SFP', w: 19, c: 'sfp' }, pwr: { n: '電源', s: '電源', w: 19, c: 'sfp' },
                   rj45: { n: 'Signal 訊號口', s: 'SIG', w: 21, c: 'sig' }, aisg: { n: 'AISG', s: 'AISG', w: 22, c: 'sig' },
                   dbg: { n: 'Debug port', s: 'DBG', w: 28, c: 'dbg' }, gnd: { n: '接地', s: '接地', w: 14, c: 'etc' } };
const ioClassOf = t => (IO_CLASS.find(c => c[0] === ((IO_TYPES[t] || {}).c || 'etc')) || IO_CLASS[3])[1];
const ANT_TYPES = { '4310': { n: '4.3-10', w: 22 }, n: { n: 'N 型', w: 26 } };
const PORT_MARGIN = 16;
function sfpQty() { return P.rows.filter(r => roleOf(r) === 'sfp').reduce((s, r) => s + (r.qty || 0), 0); }
function laneCount() {
  const rf = P.rows.filter(r => r.cat === 'RF' && r.qty >= 2 && roleOf(r) !== 'filter').sort((a, b) => b.W - a.W);
  return rf.length ? rf[0].qty : 0;
}
/* 通道配對（FDD）：
   - 數量是通道數整數倍（k × N，k ≥ 2）的 RF 元件 → 平均分到 N 路，每一路 k 顆並排（那一路在寬度上再等分成 k 格；第 i 顆 → 第 ⌊i/k⌋ 路的第 i mod k 格）。
   - 兩種以上的 Final PA 各 N 顆＝FDD（例：B8、B20B28 各 4 顆，共用的 Driver／Pre-driver／環形器各 8 顆）：每一種 PA 是一組，
     每一路的第 j 格＝第 j 組；屏蔽罩腔體、盲插接頭、走線缺口都照「每一路每一組一條發射鏈」排。
   - 元件都在自己的「元件相對高度」上（跟溫度計算同一個位置），只有橫向分到各路 —— 不另外捏造高度。
   預設開；關掉（E.pair = false → 專案的 layout3d.pair = false）＝舊排法：這些元件由板子中線往兩側排、每一路共用一組腔體與盲插接頭 */
function pairPlan(N) {
  const rf = P.rows.filter(r => r.qty > 0 && r.cat === 'RF');
  const multi = N >= 2 ? rf.filter(r => r.qty > N && r.qty % N === 0 && !['filter', 'sfp'].includes(roleOf(r))) : [];
  const pas = N >= 2 ? rf.filter(r => roleOf(r) === 'pa' && r.qty === N) : [];
  const avail = multi.length > 0 || pas.length >= 2;
  return { N, multi, pas, avail, on: avail && ed().pair !== false, fdd: pas.length >= 2 };
}
/* 頻段代號：元件名稱結尾的 B8、B20B28、B1…；組名＝那一種 Final PA 的頻段（沒有就 G1、G2…） */
const bandOf = n => { const m = String(n || '').match(/(?:^|[^A-Za-z0-9])(B\d+(?:[\/+&]?B\d+)*)\s*\)?\s*$/i); return m ? m[1].toUpperCase() : ''; };
function grpLabel(g) { const pa = LAY && LAY.pair && LAY.pair.pas[g]; return (pa && bandOf(pa.name)) || 'G' + (g + 1); }
function defaultIO() {
  const n = Math.max(1, sfpQty());
  return [...Array.from({ length: n }, () => ({ id: uid('io'), type: 'sfp', pos: null })),
    { id: uid('io'), type: 'rj45', pos: null }, { id: uid('io'), type: 'pwr', pos: null }, { id: uid('io'), type: 'dbg', pos: null }];
}
function defaultAnt() { return Array.from({ length: laneCount() || 2 }, () => ({ id: uid('ant'), type: '4310', pos: null })); }
const DEF_PORTS = new Map();
function defPorts(kind) { const k = kind + '|' + P.key + '|' + sfpQty() + '|' + laneCount(); if (!DEF_PORTS.has(k)) DEF_PORTS.set(k, kind === 'io' ? defaultIO() : defaultAnt()); return DEF_PORTS.get(k); }
function ioList() { const E = ed(); if (!E.io) E.io = defPorts('io'); return E.io; }
function antList() { const E = ed(); if (!E.ant) E.ant = defPorts('ant'); return E.ant; }
/* 接頭位置＝中心距外殼左側（從 I/O 端往內看由左到右）；留白＝在整個寬度上依順序等分 */
function portsLayout(list, types) {
  const W = P.r.W, n = list.length;
  return list.map((it, i) => ({ it, i, z: typeof it.pos === 'number' ? it.pos : PORT_MARGIN + (W - 2 * PORT_MARGIN) * (i + 0.5) / n,
    auto: typeof it.pos !== 'number', w: (types[it.type] || { w: 20 }).w }));
}
function portWarnings(lay, label) {
  const W = P.r.W, out = [], s = lay.slice().sort((a, b) => a.z - b.z);
  s.forEach(p => { if (p.z - p.w / 2 < 3 || p.z + p.w / 2 > W - 3) out.push(label(p.i) + ' 超出外殼寬度'); });
  for (let k = 1; k < s.length; k++) if (s[k].z - s[k - 1].z < (s[k].w + s[k - 1].w) / 2 + 2) out.push(label(s[k - 1].i) + ' 與 ' + label(s[k].i) + ' 重疊');
  return out;
}
const ioLabel = i => { const it = ioList()[i]; if (!it) return ''; const t = IO_TYPES[it.type] || { s: String(it.type) }; const k = ioList().slice(0, i + 1).filter(x => x.type === it.type).length;   // 不認得的類型照原字顯示（不當掉）
  return t.s + (ioList().filter(x => x.type === it.type).length > 1 ? k : ''); };
const antLabel = i => 'ANT' + (i + 1);

function layout() {
  const g = P.g, x0 = g.Btm, z0 = g.Left, Lp = g.L_pcb, Wp = g.W_pcb, tP = g.t_PCB || 2, E = ed();
  const rows = P.rows.filter(r => r.qty > 0);
  const N = laneCount(), laneW = N ? Wp / N : 0, PR = pairPlan(N);
  const G = PR.on && PR.fdd ? PR.pas.length : 0;                 // FDD：幾組（幾種 Final PA）
  const bandG = r => { const b = bandOf(r.name); return b ? PR.pas.findIndex(p => bandOf(p.name) === b) : -1; };   // 每一路一顆、名稱帶頻段的列（例：Driver-B8）→ 那一組
  const inst = [];
  rows.forEach(r => {
    const role = roleOf(r); if (role === 'filter') return;
    const body = bodyOf(r, role), ct = contactOf(r);
    const side = (r.bt === 'Copper Coin' || r.bt === 'Thermal Via') ? 'filter' : 'hsk';
    const mz = E.posW[r.name] || [], mr = (E.rot && E.rot[r.name]) || [];
    const k = PR.on && PR.multi.includes(r) ? r.qty / N : 0;      // 通道配對：這一列每一路 k 顆
    const gRow = !G || r.cat !== 'RF' ? -1 : PR.pas.includes(r) ? PR.pas.indexOf(r) : r.qty === N ? bandG(r) : -1;
    for (let i = 0; i < r.qty; i++) {
      const rot = role !== 'sfp' && mr[i] === 90;         // SFP 插口一定朝 I/O 端，不能轉
      const bL = rot ? body.W : body.L, bW = rot ? body.L : body.W, cL = rot ? ct.W : ct.L, cW = rot ? ct.L : ct.W;
      inst.push({ row: r, role, body, ct, side, rot, bL, bW, cL, cW, fpL: Math.max(bL, cL), fpW: Math.max(bW, cW), i, key: r.name + '#' + i,
        lane: (N && r.cat === 'RF' && r.qty === N) ? i : k ? Math.floor(i / k) : -1, sub: k ? i % k : -1, subN: k || 1, grp: k && G ? i % k : gRow,
        manualZ: typeof mz[i] === 'number' ? mz[i] : null });
    }
  });
  // SFP 籠跟 I/O 清單的 SFP 光口綁在一起（第 k 顆對第 k 個光口），橫向只存在光口上。舊資料存在籠子上的橫向 → 搬到光口
  const sfpPorts = ioList().filter(it => it.type === 'sfp'), sfpI = inst.filter(o => o.role === 'sfp');
  let sfpMig = false;
  sfpI.forEach((o, k) => {
    o.port = sfpPorts[k] || null;
    if (o.port && o.manualZ != null) {
      o.port.pos = z0 + o.manualZ; o.manualZ = null; sfpMig = true;
      const a = E.posW[o.row.name]; if (a) { a[o.i] = null; if (a.every(v => typeof v !== 'number')) delete E.posW[o.row.name]; }
    }
  });
  if (sfpMig) saveEdit();
  // 長度方向：元件相對高度（距 PCB 底部；3D 上改＝寫回元件設定）；超出板邊的夾回板內
  inst.forEach(o => {
    const h = hgtOf(o.row); o.hgt = h;
    const xc = x0 + (A.ref === 'bottom' ? h + o.fpL / 2 : h);
    const lo = x0 + o.fpL / 2 + 1, hi = x0 + Lp - o.fpL / 2 - 1, x = Math.min(Math.max(xc, lo), hi);
    o.x = x; o.clampD = Math.abs(x - xc) > 0.5 ? x - xc : 0; o.shift = o.clampD;
  });
  const placed = [], CLR = 2.5, RIB = 2;
  const zClamp = (o, z) => Math.min(Math.max(z, z0 + o.fpW / 2 + 0.5), z0 + Wp - o.fpW / 2 - 0.5);
  const hit = (o, x, z) => placed.some(q => q !== o && Math.abs(q.x - x) < (q.fpL + o.fpL) / 2 + CLR && Math.abs(q.z - z) < (q.fpW + o.fpW) / 2 + CLR);
  // ① 手動橫向位置（元件表的「橫向位置」或 3D 拖曳）
  inst.filter(o => o.manualZ != null).forEach(o => { o.z = zClamp(o, z0 + o.manualZ); o.src = 'manual'; o.overlap = hit(o, o.x, o.z); placed.push(o); });
  // ② SFP 籠對齊它的 SFP 光口（兩邊綁在一起：元件表、I/O 清單、3D 拖曳改哪一邊都會一起動）
  const sfpZ = new Map(portsLayout(ioList(), IO_TYPES).filter(p => p.it.type === 'sfp').map(p => [p.it, p.z]));
  sfpI.filter(o => o.port && sfpZ.has(o.port)).forEach(o => { o.z = zClamp(o, sfpZ.get(o.port)); o.src = 'io'; o.overlap = hit(o, o.x, o.z); placed.push(o); });
  // ③ 多通道（數量＝Final PA）：每一路一個通道，沿寬度等分；通道配對的列（k × 通道數）在那一路裡再等分成 k 格
  inst.filter(o => o.lane >= 0 && !placed.includes(o)).sort((a, b) => b.fpL * b.fpW - a.fpL * a.fpW).forEach(o => {
    const sw = laneW / o.subN, zc = z0 + laneW * o.lane + sw * (Math.max(0, o.sub) + 0.5), half = Math.max(0, sw / 2 - RIB / 2 - 1.5 - o.fpW / 2);
    let z = null;
    const scan = x => { for (let d = 0; d <= half + 1e-6 && z === null; d += 0.5) for (const s of [1, -1]) { const zz = zc + s * d; if (!hit(o, x, zz)) { z = zz; break; } } };
    scan(o.x);
    for (let dx = 2; dx <= 80 && z === null; dx += 2) for (const sx of [1, -1]) {        // 通道寬度不夠 → 沿長度方向挪（每一路挪法相同）
      const x = o.x + sx * dx; if (x < x0 + o.fpL / 2 + 1 || x > x0 + Lp - o.fpL / 2 - 1) continue;
      scan(x); if (z !== null) { o.shift += x - o.x; o.x = x; break; }
    }
    o.z = z === null ? zc : z; o.overlap = z === null; o.src = 'auto'; placed.push(o);
  });
  // ④ 其餘元件：由板子中線往兩側排；同一列的多顆並排
  const zMid = z0 + Wp / 2, free = inst.filter(o => !placed.includes(o));
  const rowOrder = [...new Set(free.map(o => o.row))].sort((a, b) => { const fa = free.find(o => o.row === a), fb = free.find(o => o.row === b); return fb.fpL * fb.fpW - fa.fpL * fa.fpW; });
  rowOrder.forEach(r => {
    let prev = null;
    free.filter(o => o.row === r).forEach(o => {
      const zlo = z0 + o.fpW / 2 + 1, zhi = z0 + Wp - o.fpW / 2 - 1, zt = prev ? prev.z + (prev.fpW + o.fpW) / 2 + CLR : zMid;
      let z = null;
      const scan = x => { for (let d = 0; d <= Wp && z === null; d += 1) for (const s of [1, -1]) { const zz = zt + s * d; if (zz < zlo || zz > zhi) continue; if (!hit(o, x, zz)) { z = zz; break; } } };
      scan(o.x);
      for (let dx = 3; dx <= 60 && z === null; dx += 3) for (const sx of [1, -1]) {       // 同一個高度放不下 → 沿長度方向挪一點
        const x = o.x + sx * dx; if (x < x0 + o.fpL / 2 + 1 || x > x0 + Lp - o.fpL / 2 - 1) continue;
        scan(x); if (z !== null) { o.shift += x - o.x; o.x = x; break; }
      }
      o.z = z === null ? zMid : z; o.overlap = z === null; o.src = 'auto'; placed.push(o); prev = o;
    });
  });
  // PCB 鎖附孔（示意）：四角＋長邊中點，避開元件
  const holes = [];
  [[x0 + 6, z0 + 6], [x0 + Lp - 6, z0 + 6], [x0 + 6, z0 + Wp - 6], [x0 + Lp - 6, z0 + Wp - 6], [x0 + Lp / 2, z0 + 6], [x0 + Lp / 2, z0 + Wp - 6]]
    .forEach(([x, z]) => { if (!placed.some(q => Math.abs(q.x - x) < q.fpL / 2 + 5 && Math.abs(q.z - z) < q.fpW / 2 + 5)) holes.push([x, z]); });
  // 疊層：PCB 的 HSK 側板面直接貼在基板內側（距分模面 H_shield）→ 濾波器側到分模面＝H_shield − 板厚＝屏蔽罩高度
  const S = shdCfg(), D = g.H_shield, df = Math.max(0, D - tP), yTop = g.H_shield + g.t_base, tb = g.t_base;
  const bh = o => o.body.h != null ? o.body.h : GHOST_H;
  const hasCoin = inst.some(o => o.ct.kind === 'coin');
  const maxDown = Math.max(0, ...inst.filter(o => o.side === 'filter').map(bh));
  const maxUp = Math.max(0, hasCoin ? (g.Coin_T || 0) : 0, ...inst.filter(o => o.side === 'hsk').map(bh));
  const cavD = S.on ? df - S.roof : df;                  // 濾波器側元件能用的高度（有屏蔽罩＝腔體深度）
  inst.forEach(o => {
    const h = bh(o), hot = o.row.W > 0;
    o.clash = o.side === 'filter' && h + 0.5 > cavD ? h + 0.5 - cavD : 0;
    let prot = 0, gap = 0, L2 = 0, W2 = 0;
    if (o.side === 'hsk') { prot = h; gap = hot ? (o.row.timT || 0) : 0.5; L2 = o.bL + 1; W2 = o.bW + 1; }                        // 元件本體＋TIM（不發熱的留 0.5 mm 空氣）
    else if (o.ct.kind === 'coin') { prot = g.Coin_T || 0; gap = hot ? (o.row.timT || 0) : 0; L2 = o.cL + 0.4; W2 = o.cW + 0.4; }   // 銅塊底板（PCB 背面起算 Coin_T）＋TIM
    else { gap = hot ? (o.row.timT || 0) : 0; L2 = o.cL; W2 = o.cW; }                                                              // Via：PCB 貼平；有 TIM 才挖 TIM 厚的淺槽
    const depth = prot + gap;
    o.pocket = depth > 0.04 && L2 > 0 && W2 > 0 ? { depth, prot, gap, L: L2, W: W2, air: o.side === 'hsk' && !hot } : null;
    if (o.pocket) o.pocket.boss = Math.max(0, depth - (tb - T_MIN));        // 凹槽底到鰭片側不到 T_MIN → 補肉的高度
  });
  const byK = k => inst.filter(o => o.body.hK === k).length;
  LAY = { inst, N, laneW, pair: PR, G, holes, D, df, yTop, tb, cavD, maxDown, maxUp,
          clash: inst.filter(o => o.clash).length,
          clamped: inst.filter(o => Math.abs(o.clampD) > 0.5), moved: inst.filter(o => Math.abs(o.shift - o.clampD) > 0.5),
          overlaps: inst.filter(o => o.overlap).length, src: { ait: byK('ait'), data: byK('data'), prov: byK('prov') } };
  LAY.conns = connsNow();
  LAY.bosses = bossesNow();
  shieldLayout();
  LAY.screws = screwSpots();             // 分模面螺絲：避開元件、接頭、PCB 孔、屏蔽罩牆
  LAY.loops = loopsNow();                // 膠條、螺絲柱、PCB／屏蔽罩外形
  return LAY;
}
/* 發射鏈：每一路一條；FDD（通道配對開著）每一路每一組（每一種 Final PA）一條。
   chainPick＝那一條鏈上某一級的元件（那一組沒有這一級 → 用那一路共用的） */
function chainsOf() {
  const out = [];
  for (let i = 0; i < (LAY.N || 0); i++) (LAY.G ? Array.from({ length: LAY.G }, (_, g) => g) : [-1]).forEach(g => out.push({ lane: i, grp: g }));
  return out;
}
function chainPick(lane, grp, role) {
  return LAY.inst.find(o => o.lane === lane && o.role === role && o.grp === grp) || (grp >= 0 && LAY.inst.find(o => o.lane === lane && o.role === role && o.grp < 0)) || null;
}
/* 盲插接頭（濾波器 → PCB）：每一條發射鏈一個，跟著環形器（沒有環形器就跟 PA） */
function connsNow() {
  const g = P.g, out = [], seen = new Set();
  chainsOf().forEach(({ lane, grp }) => {
    const ref = chainPick(lane, grp, 'circ') || chainPick(lane, grp, 'pa'); if (!ref || seen.has(ref)) return; seen.add(ref);
    out.push({ x: Math.min(ref.x + ref.fpL / 2 + 8, g.Btm + g.L_pcb - 8), z: ref.z, ref, lane, grp });
  });
  return out;
}
/* SFP 光口：橫向＝I/O 清單的位置，高度＝對應 SFP 籠在 PCB 上的高度（HSK 側：從 PCB 板面往上） */
/* 數位 I/O：橫向 z（清單位置或自動等分）、高度 y（接頭中心距分模面）、端面上接頭框的高 fh／寬 fw。
   SFP 的高度固定對齊 PCB 上的 SFP 籠；其他接頭可以上下調（留白＝端牆中間） */
const IO_FH = { rj45: 21, pwr: 14, aisg: 21, dbg: 14, gnd: 12 };
function ioLayout() {
  const list = ioList(), sfpInst = LAY.inst.filter(o => o.role === 'sfp'), yT = LAY.yTop;
  const yDef = Math.min(Math.max(yT / 2, 10.5), Math.max(yT - 10.5, yT / 2));
  return portsLayout(list, IO_TYPES).map(p => {
    const t = p.it.type;
    if (t === 'sfp') {
      const k = list.slice(0, p.i).filter(it => it.type === 'sfp').length, o = sfpInst[k], ch = o && o.body.h ? o.body.h : 9.8;
      return Object.assign(p, { y: !o || o.side === 'hsk' ? LAY.D + ch / 2 : LAY.df - ch / 2, fh: ch + 4, fw: p.w, ch, o, yAuto: true, lock: true });
    }
    const fh = IO_FH[t] || 14, yAuto = typeof p.it.y !== 'number', y = Math.min(Math.max(yAuto ? yDef : p.it.y, fh / 2 + 1), yT + 15);
    return Object.assign(p, { y, fh, fw: p.w, ch: null, o: null, yAuto, lock: false });
  });
}
/* 補肉：凹槽穿出基板（或 I/O 接頭的框超出端牆頂）→ 在鰭片側加高，四周留 BOSS_WALL 肉厚；重疊的合併 */
function bossesNow() {
  const g = P.g, L = P.r.L, W = P.r.W, out = [];
  LAY.inst.forEach(o => { const pk = o.pocket; if (!pk || !(pk.boss > 0)) return;
    out.push({ x0: o.x - pk.L / 2 - BOSS_WALL, x1: o.x + pk.L / 2 + BOSS_WALL, z0: o.z - pk.W / 2 - BOSS_WALL, z1: o.z + pk.W / 2 + BOSS_WALL, h: pk.boss, insts: [o], ports: [] }); });
  ioLayout().forEach(sp => { const top = sp.y + sp.fh / 2 + BOSS_WALL; if (top > LAY.yTop + 0.01)
    out.push({ x0: 0, x1: g.Btm + BOSS_WALL, z0: sp.z - sp.fw / 2 - BOSS_WALL, z1: sp.z + sp.fw / 2 + BOSS_WALL, h: top - LAY.yTop, insts: [], ports: [sp] }); });
  for (let again = true; again;) {
    again = false;
    outer: for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) {
      const a = out[i], b = out[j];
      if (a.x0 < b.x1 + 0.5 && b.x0 < a.x1 + 0.5 && a.z0 < b.z1 + 0.5 && b.z0 < a.z1 + 0.5) {
        out[i] = { x0: Math.min(a.x0, b.x0), x1: Math.max(a.x1, b.x1), z0: Math.min(a.z0, b.z0), z1: Math.max(a.z1, b.z1), h: Math.max(a.h, b.h), insts: a.insts.concat(b.insts), ports: a.ports.concat(b.ports) };
        out.splice(j, 1); again = true; break outer;
      }
    }
  }
  out.forEach(b => { b.x0 = Math.max(0, b.x0); b.x1 = Math.min(L, b.x1); b.z0 = Math.max(0, b.z0); b.z1 = Math.min(W, b.z1); });
  return out;
}

/* ── 屏蔽罩腔體（RF 隔離）：只替濾波器側的元件做腔體，其他地方開放 ──
   腔體＝元件本體＋匹配電路／走線空間（牆中線）；同一路依級別分組（Pre-driver／Driver／Final PA／環形器）。
   兩個腔體靠得很近（< SHD_SNAP）就共用一道牆，靠近外框的直接用外框當牆，不留很窄的夾縫。 */
const SHD_MARGIN = { pa: [6, 4], drv: [4, 3], pre: [3, 3], circ: [3, 3], clk: [3, 3] }, SHD_MARGIN_DEF = [3, 3];   // [沿長度, 沿寬度] mm
const ROLE_NAME = { pa: 'Final PA', drv: 'Driver', pre: 'Pre-driver', circ: '環形器', clk: '時脈 IC', fpga: 'FPGA', ddr: 'DDR', pmod: '電源模組', sfp: 'SFP', ic: 'IC' };
const SHD_SNAP = 12;
function shieldLayout() {
  const g = P.g, S = shdCfg(), w = S.wall, x0 = g.Btm, z0 = g.Left, Lp = g.L_pcb, Wp = g.W_pcb;
  const Rf = { x0: x0 + S.rim - w / 2, x1: x0 + Lp - S.rim + w / 2, z0: z0 + S.rim - w / 2, z1: z0 + Wp - S.rim + w / 2 };   // 牆中線可以壓在外框上（共用外框）
  const groups = new Map();
  LAY.inst.filter(o => o.side === 'filter').forEach(o => {
    const k = o.lane >= 0 ? 'L' + o.lane + (o.grp >= 0 ? 'g' + o.grp : o.sub >= 0 ? 's' + o.sub : '') + ':' + o.role : 'I:' + o.key;   // 同一路同一級一格（FDD：每一組各一格）
    if (!groups.has(k)) groups.set(k, []); groups.get(k).push(o);
  });
  let keeps = [];
  groups.forEach(list => {
    const o0 = list[0], [mx, mz] = SHD_MARGIN[o0.role] || SHD_MARGIN_DEF;
    const k = { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity, insts: list, roles: [o0.role], lane: o0.lane, grp: o0.grp };
    list.forEach(o => { k.x0 = Math.min(k.x0, o.x - o.bL / 2 - mx - w / 2); k.x1 = Math.max(k.x1, o.x + o.bL / 2 + mx + w / 2);
                        k.z0 = Math.min(k.z0, o.z - o.bW / 2 - mz - w / 2); k.z1 = Math.max(k.z1, o.z + o.bW / 2 + mz + w / 2); });
    LAY.conns.filter(c => list.includes(c.ref)).forEach(c => {          // 盲插接頭（天線輸出）包在它那一格裡
      k.x0 = Math.min(k.x0, c.x - 6 - w / 2); k.x1 = Math.max(k.x1, c.x + 6 + w / 2); k.z0 = Math.min(k.z0, c.z - 6 - w / 2); k.z1 = Math.max(k.z1, c.z + 6 + w / 2); k.conn = true; });
    keeps.push(k);
  });
  const clampK = () => keeps.forEach(k => { k.x0 = Math.max(k.x0, Rf.x0); k.x1 = Math.min(k.x1, Rf.x1); k.z0 = Math.max(k.z0, Rf.z0); k.z1 = Math.min(k.z1, Rf.z1); });
  const mergeK = () => { for (let again = true; again;) {                  // 重疊 → 放不下牆，合成一格
    again = false;
    outer: for (let i = 0; i < keeps.length; i++) for (let j = i + 1; j < keeps.length; j++) {
      const a = keeps[i], b = keeps[j];
      if (a.x0 < b.x1 - 0.01 && b.x0 < a.x1 - 0.01 && a.z0 < b.z1 - 0.01 && b.z0 < a.z1 - 0.01) { keeps[i] = keepMerge(a, b); keeps.splice(j, 1); again = true; break outer; }
    } } };
  clampK(); mergeK();
  const ov = (a0, a1, b0, b1) => a0 < b1 - 0.01 && b0 < a1 - 0.01;
  for (let it = 0; it < 3; it++) keeps.forEach(a => keeps.forEach(b => {    // 很近的兩格共用一道牆
    if (a === b) return;
    if (ov(a.z0, a.z1, b.z0, b.z1)) { const gx = b.x0 - a.x1; if (gx > 0.01 && gx < SHD_SNAP) { const m = (a.x1 + b.x0) / 2; a.x1 = m; b.x0 = m; } }
    if (ov(a.x0, a.x1, b.x0, b.x1)) { const gz = b.z0 - a.z1; if (gz > 0.01 && gz < SHD_SNAP) { const m = (a.z1 + b.z0) / 2; a.z1 = m; b.z0 = m; } }
  }));
  keeps.forEach(k => { if (k.x0 - Rf.x0 < SHD_SNAP) k.x0 = Rf.x0; if (Rf.x1 - k.x1 < SHD_SNAP) k.x1 = Rf.x1; if (k.z0 - Rf.z0 < SHD_SNAP) k.z0 = Rf.z0; if (Rf.z1 - k.z1 < SHD_SNAP) k.z1 = Rf.z1; });
  mergeK();
  const depth = LAY.df - S.roof;
  const cells = keeps.map((k, i) => {
    const a = k.x1 - k.x0 - w, b = k.z1 - k.z0 - w, f = 150 * Math.sqrt(1 / (a * a) + 1 / (b * b));   // 最低共振（TM110）：f ＝ c/2 · √(1/a² ＋ 1/b²)
    k.label = keepLabel(k);
    return { id: i, x0: k.x0, x1: k.x1, z0: k.z0, z1: k.z1, a, b, f, keep: k, warn: f < 1.2 * S.fmax };
  });
  // 牆：每個腔體四邊（中線）；壓在外框上的不另外做；共線重疊的合併成一道
  const onRim = q => q.axis === 'x' ? Math.abs(q.pos - Rf.x0) < 0.01 || Math.abs(q.pos - Rf.x1) < 0.01 : Math.abs(q.pos - Rf.z0) < 0.01 || Math.abs(q.pos - Rf.z1) < 0.01;
  const raw = [];
  cells.forEach(c => raw.push({ axis: 'x', pos: c.x0, a: c.z0, b: c.z1 }, { axis: 'x', pos: c.x1, a: c.z0, b: c.z1 }, { axis: 'z', pos: c.z0, a: c.x0, b: c.x1 }, { axis: 'z', pos: c.z1, a: c.x0, b: c.x1 }));
  const walls = [];
  raw.filter(q => !onRim(q)).sort((p, q) => p.axis.localeCompare(q.axis) || p.pos - q.pos || p.a - q.a).forEach(q => {
    const last = walls[walls.length - 1];
    if (last && last.axis === q.axis && Math.abs(last.pos - q.pos) < 0.01 && q.a <= last.b + 0.01) last.b = Math.max(last.b, q.b); else walls.push({ ...q });
  });
  // 走線缺口：同一路相鄰兩級之間，訊號線穿過的每一道牆開一個小缺口
  const notches = [];
  chainsOf().forEach(({ lane, grp }) => {
    const chain = ['pre', 'drv', 'pa', 'circ'].map(r => chainPick(lane, grp, r)).filter(Boolean).sort((a, b) => a.x - b.x);
    for (let k = 1; k < chain.length; k++) {
      const a = chain[k - 1], b = chain[k], zs = b.z;
      walls.filter(q => q.axis === 'x' && q.pos > a.x && q.pos < b.x && zs > q.a && zs < q.b).forEach(q => notches.push({ x: q.pos, z: zs }));
    }
  });
  LAY.shd = { S, cells, walls, depth, Rf, notches, keeps };
}
function keepMerge(a, b) {
  return { x0: Math.min(a.x0, b.x0), x1: Math.max(a.x1, b.x1), z0: Math.min(a.z0, b.z0), z1: Math.max(a.z1, b.z1),
           insts: a.insts.concat(b.insts), roles: [...new Set(a.roles.concat(b.roles))], lane: a.lane === b.lane ? a.lane : -1, grp: a.grp === b.grp ? a.grp : -1, conn: a.conn || b.conn, merged: true };
}
function keepLabel(k) {
  const ch = k.lane >= 0 ? 'CH' + (k.lane + 1) + (LAY.G && k.grp >= 0 ? ' ' + grpLabel(k.grp) : '') + ' · ' : '';
  if (k.insts.every(o => o.lane >= 0)) return ch + k.roles.map(r => ROLE_NAME[r] || r).join('＋');
  return ch + [...new Set(k.insts.map(o => o.row.name))].join('＋');
}
/* 目前位置的凹槽矩形（互相重疊的合併成一個），建模與拖曳即時更新共用 */
function pocketRects() {
  const g = P.g, bx0 = g.Btm + 0.3, bz0 = g.Left + 0.3, bx1 = g.Btm + g.L_pcb - 0.3, bz1 = g.Left + g.W_pcb - 0.3;
  const list = LAY.inst.filter(o => o.pocket).map(o => ({ x0: Math.max(bx0, o.x - o.pocket.L / 2), x1: Math.min(bx1, o.x + o.pocket.L / 2),
    z0: Math.max(bz0, o.z - o.pocket.W / 2), z1: Math.min(bz1, o.z + o.pocket.W / 2), depth: o.pocket.depth, insts: [o] })).filter(q => q.x1 - q.x0 > 0.2 && q.z1 - q.z0 > 0.2);
  for (let again = true; again;) {
    again = false;
    outer: for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      if (a.x0 < b.x1 + 0.6 && b.x0 < a.x1 + 0.6 && a.z0 < b.z1 + 0.6 && b.z0 < a.z1 + 0.6) {
        list[i] = { x0: Math.min(a.x0, b.x0), x1: Math.max(a.x1, b.x1), z0: Math.min(a.z0, b.z0), z1: Math.max(a.z1, b.z1), depth: Math.max(a.depth, b.depth), insts: a.insts.concat(b.insts), merged: true };
        list.splice(j, 1); again = true; break outer;
      }
    }
  }
  LAY.merged = list.filter(q => q.merged).flatMap(q => q.insts);
  return list;
}

/* ── 建模工具 ── */
function mesh(geo, mat, kind) { const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true; m.userData.kind = kind || ''; m.userData.mat = mat; return m; }
function box(w, h, d, mat, kind, x, y, z) { const m = mesh(new THREE.BoxGeometry(w, h, d), mat, kind); m.position.set(x, y, z); return m; }
/* 平面圓角矩形（x 為長度、z 為寬度；Shape 的 Y＝−z，再用 rotateX(−π/2) 立起來） */
function rr(path, x0, z0, x1, z1, r) {
  const X0 = x0, X1 = x1, Y0 = -z1, Y1 = -z0;
  path.moveTo(X0 + r, Y0);
  path.lineTo(X1 - r, Y0); path.absarc(X1 - r, Y0 + r, r, -Math.PI / 2, 0, false);
  path.lineTo(X1, Y1 - r); path.absarc(X1 - r, Y1 - r, r, 0, Math.PI / 2, false);
  path.lineTo(X0 + r, Y1); path.absarc(X0 + r, Y1 - r, r, Math.PI / 2, Math.PI, false);
  path.lineTo(X0, Y0 + r); path.absarc(X0 + r, Y0 + r, r, Math.PI, Math.PI * 1.5, false);
  return path;
}
function slab(outer, holes, y0, thick, bevel = 0.8) {   // 擠出：outer=[x0,z0,x1,z1,r] 或點列 [[x,z],…]；holes 同格式；厚度沿 +y
  const sh = Array.isArray(outer[0]) ? ptsShape(outer) : rr(new THREE.Shape(), ...outer);
  (holes || []).forEach(h => sh.holes.push(Array.isArray(h[0]) ? ptsShape(h, true) : rr(new THREE.Path(), ...h)));
  const b = Math.min(bevel, thick / 3);
  const geo = new THREE.ExtrudeGeometry(sh, { depth: Math.max(0.01, thick - 2 * b), bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelOffset: -b, bevelSegments: 2, curveSegments: 8 });
  geo.rotateX(-Math.PI / 2); geo.translate(0, y0 + b, 0);
  return geo;
}
/* 把擠出件的三角形依位置分到不同材質群組（例：牆的外側烤漆、內側裸鋁） */
function regroup(geo, classify) {
  const pos = geo.attributes.position, nor = geo.attributes.normal, uv = geo.attributes.uv, buckets = [[], [], []];
  for (let i = 0; i < pos.count; i += 3) {
    const cx = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3, cy = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3, cz = (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3;
    buckets[classify(cx, cy, cz, nor.getY(i))].push(i);
  }
  const n = pos.count, Pp = new Float32Array(n * 3), Nn = new Float32Array(n * 3), Uu = new Float32Array(n * 2), out = new THREE.BufferGeometry();
  let k = 0;
  buckets.forEach((b, mi) => {
    const st = k;
    b.forEach(i => { for (let j = 0; j < 3; j++) { const s = i + j; Pp.set([pos.getX(s), pos.getY(s), pos.getZ(s)], k * 3); Nn.set([nor.getX(s), nor.getY(s), nor.getZ(s)], k * 3); Uu.set([uv.getX(s), uv.getY(s)], k * 2); k++; } });
    if (k > st) out.addGroup(st, k - st, mi);
  });
  out.setAttribute('position', new THREE.BufferAttribute(Pp, 3)); out.setAttribute('normal', new THREE.BufferAttribute(Nn, 3)); out.setAttribute('uv', new THREE.BufferAttribute(Uu, 2));
  return out;
}

/* I/O 端子（示意，依參考照片）。全部是 (group, yc, zc)：在 x=0 的端面往 −x 長出來 */
function cylX(r1, r2, h, seg, mat, x, yc, zc) { const m = mesh(new THREE.CylinderGeometry(r1, r2, h, seg), mat, 'deco'); m.rotation.z = Math.PI / 2; m.position.set(x, yc, zc); return m; }
function buildRF(group, yc, zc) {              // 天線座 4.3-10：方形法蘭＋4 顆螺絲＋本體＋六角螺帽＋絕緣子
  const f = mesh(new RoundedBoxGeometry(2, 22, 22, 2, 0.8), MAT.metal, 'deco'); f.position.set(-1, yc, zc); group.add(f);
  for (const [dy, dz] of [[-7.5, -7.5], [-7.5, 7.5], [7.5, -7.5], [7.5, 7.5]]) group.add(cylX(1.7, 1.7, 1.6, 16, MAT.steel, -2.8, yc + dy, zc + dz));
  group.add(cylX(7.2, 7.2, 12, 40, MAT.metal, -8, yc, zc), cylX(9.2, 9.2, 5, 6, MAT.metal, -5.5, yc, zc),
            cylX(4.2, 4.2, 0.6, 32, MAT.ptfe, -14, yc, zc), cylX(1, 1, 1.4, 16, MAT.metal, -14.4, yc, zc));
  const ring = mesh(new THREE.TorusGeometry(5.6, 0.7, 10, 36), MAT.steel, 'deco'); ring.rotation.y = Math.PI / 2; ring.position.set(-14.1, yc, zc); group.add(ring);
}
function buildN(group, yc, zc) {               // 天線座 N 型：圓法蘭＋本體＋螺帽＋絕緣子
  group.add(cylX(12.7, 12.7, 2, 48, MAT.metal, -1, yc, zc), cylX(8.2, 8.2, 13, 40, MAT.metal, -8.5, yc, zc), cylX(10.6, 10.6, 5, 6, MAT.metal, -5.2, yc, zc),
            cylX(5.2, 5.2, 0.6, 32, MAT.ptfe, -15.1, yc, zc), cylX(1.1, 1.1, 1.5, 16, MAT.metal, -15.5, yc, zc));
  for (let a = 0; a < 4; a++) group.add(cylX(1.6, 1.6, 1.4, 14, MAT.steel, -2.5, yc + Math.cos(a * Math.PI / 2 + Math.PI / 4) * 9.5, zc + Math.sin(a * Math.PI / 2 + Math.PI / 4) * 9.5));
}
function buildSFPPort(group, yc, zc, ch = 9.8) {  // SFP 光口：白色凸台＋金屬籠＋黑色開口（開口高＝SFP 籠高）
  const a = mesh(new RoundedBoxGeometry(5, ch + 4, 19, 3, 1.6), MAT.powder, 'deco'); a.position.set(-2.4, yc, zc);
  group.add(a, box(0.6, ch + 1.6, 15, MAT.steel, 'deco', -5.05, yc, zc), box(0.4, ch - 0.2, 13, MAT.hole, 'deco', -5.3, yc, zc));
}
function buildRJ45(group, yc, zc) {            // Signal 訊號口（RJ45 等）：圓形防水螺紋座＋方形插孔
  group.add(cylX(9.5, 10.5, 5, 48, MAT.powder, -2.5, yc, zc), cylX(7.8, 7.8, 4, 48, MAT.plastic, -6.5, yc, zc), box(0.5, 7, 8.5, MAT.hole, 'deco', -8.6, yc, zc));
}
function buildPower(group, yc, zc) {           // 電源口：跟 SFP 光口同一類外觀（白色凸台＋金屬框＋黑色開口）
  buildSFPPort(group, yc, zc, IO_FH.pwr - 4);
}
function buildAISG(group, yc, zc) {            // AISG（圓形 8 pin）：座＋六角螺帽＋本體＋黑色插面
  group.add(cylX(10, 10.5, 3, 48, MAT.powder, -1.5, yc, zc), cylX(9, 9, 4.5, 6, MAT.metal, -5.2, yc, zc), cylX(6.6, 6.6, 8, 40, MAT.metal, -10.5, yc, zc),
            cylX(5, 5, 0.4, 32, MAT.plastic, -14.6, yc, zc));
}
function buildDebug(group, yc, zc) {           // Debug port：金屬框＋黑色開口
  const fr = mesh(new RoundedBoxGeometry(2, 14, 28, 2, 1.2), MAT.steel, 'deco'); fr.position.set(-1, yc, zc);
  group.add(fr, box(0.4, 9.5, 23, MAT.hole, 'deco', -2.1, yc, zc));
}
function buildGnd(group, yc, zc) {             // 接地：墊片＋螺柱＋螺帽
  const pad = mesh(new RoundedBoxGeometry(2, 12, 12, 2, 1), MAT.metal, 'deco'); pad.position.set(-1, yc, zc);
  group.add(pad, cylX(2.5, 2.5, 10, 20, MAT.steel, -6.5, yc, zc), cylX(4.2, 4.2, 3, 6, MAT.metal, -4.5, yc, zc));
}
const PORT_BUILD = { sfp: buildSFPPort, rj45: buildRJ45, pwr: buildPower, aisg: buildAISG, dbg: buildDebug, gnd: buildGnd, '4310': buildRF, n: buildN };

let parts = {};
function reg(k, ...objs) { (parts[k] = parts[k] || []).push(...objs); }

/* 帶凹槽的實心塊（封閉網格，剖面切面要用）。openTop=false：凹槽從底面 yB 往上挖（HSK 基板、補肉）；true：從頂面 yT 往下挖（屏蔽罩）。
   凹槽比塊還深＝貫穿（兩面都開孔、沒有底）。rad＝凹槽圓角（銑刀半徑）。群組：0 開口面、1 凹槽側壁、2 凹槽底、3 另一面、4 四周 */
function blockGeo(bx0, bz0, bx1, bz1, yB, yT, pockets, openTop, rad = 0) {
  const G = [[], [], [], [], []];
  const uvOf = (p, n) => Math.abs(n.y) > 0.5 ? [p.x / 40, p.z / 40] : Math.abs(n.x) > 0.5 ? [p.z / 40, p.y / 40] : [p.x / 40, p.y / 40];
  const put = (gi, p, n) => { const uv = uvOf(p, n); G[gi].push(p.x, p.y, p.z, n.x, n.y, n.z, uv[0], uv[1]); };
  const t1 = new THREE.Vector3(), t2 = new THREE.Vector3();
  const tri = (gi, a, b, c, want) => { const n = t1.subVectors(b, a).cross(t2.subVectors(c, a)); if (n.dot(want) >= 0) { put(gi, a, want); put(gi, b, want); put(gi, c, want); } else { put(gi, a, want); put(gi, c, want); put(gi, b, want); } };
  const quad = (gi, a, b, c, d, want) => { tri(gi, a, b, c, want); tri(gi, a, c, d, want); };
  const H = yT - yB, yO = openTop ? yT : yB, yC = openTop ? yB : yT, sgn = openTop ? -1 : 1;
  const nO = V(0, openTop ? 1 : -1, 0), nC = nO.clone().negate();
  const outline = q => {
    const r = Math.max(0, Math.min(rad, (q.x1 - q.x0) / 2 - 0.05, (q.z1 - q.z0) / 2 - 0.05)), p = new THREE.Path();
    if (r > 0.05) {
      p.moveTo(q.x0 + r, q.z0); p.lineTo(q.x1 - r, q.z0); p.absarc(q.x1 - r, q.z0 + r, r, -Math.PI / 2, 0, false);
      p.lineTo(q.x1, q.z1 - r); p.absarc(q.x1 - r, q.z1 - r, r, 0, Math.PI / 2, false);
      p.lineTo(q.x0 + r, q.z1); p.absarc(q.x0 + r, q.z1 - r, r, Math.PI / 2, Math.PI, false);
      p.lineTo(q.x0, q.z0 + r); p.absarc(q.x0 + r, q.z0 + r, r, Math.PI, Math.PI * 1.5, false);
    } else { p.moveTo(q.x0, q.z0); p.lineTo(q.x1, q.z0); p.lineTo(q.x1, q.z1); p.lineTo(q.x0, q.z1); }
    const pts = p.getPoints(3);
    for (let i = pts.length - 1; i > 0; i--) if (pts[i].distanceTo(pts[i - 1]) < 1e-5) pts.splice(i, 1);
    if (pts.length > 2 && pts[0].distanceTo(pts[pts.length - 1]) < 1e-5) pts.pop();
    return pts;
  };
  const flat = (gi, y, n, shape) => {
    const fg = new THREE.ShapeGeometry(shape).toNonIndexed(), fp = fg.attributes.position;
    for (let i = 0; i < fp.count; i += 3) tri(gi, V(fp.getX(i), y, fp.getY(i)), V(fp.getX(i + 1), y, fp.getY(i + 1)), V(fp.getX(i + 2), y, fp.getY(i + 2)), n);
    fg.dispose();
  };
  const faceWithHoles = (gi, y, n, holes) => {
    const sh = new THREE.Shape(); sh.moveTo(bx0, bz0); sh.lineTo(bx1, bz0); sh.lineTo(bx1, bz1); sh.lineTo(bx0, bz1); sh.closePath();
    holes.forEach(pts => sh.holes.push(new THREE.Path(pts)));
    flat(gi, y, n, sh);
  };
  const PK = pockets.filter(q => q.x1 - q.x0 > 0.2 && q.z1 - q.z0 > 0.2 && q.depth > 0.02).map(q => ({ q, pts: outline(q), thru: q.depth >= H - 0.01 }));
  faceWithHoles(0, yO, nO, PK.map(k => k.pts));
  faceWithHoles(3, yC, nC, PK.filter(k => k.thru).map(k => k.pts));
  PK.forEach(({ q, pts, thru }) => {
    const yb = thru ? yC : yO + sgn * Math.min(q.depth, H - 0.3), cx = (q.x0 + q.x1) / 2, cz = (q.z0 + q.z1) / 2;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length], mx = (a.x + b.x) / 2, mz = (a.y + b.y) / 2;
      let nx = -(b.y - a.y), nz = b.x - a.x; if (nx * (cx - mx) + nz * (cz - mz) < 0) { nx = -nx; nz = -nz; }
      const len = Math.hypot(nx, nz); if (len < 1e-9) continue;
      quad(1, V(a.x, yO, a.y), V(b.x, yO, b.y), V(b.x, yb, b.y), V(a.x, yb, a.y), V(nx / len, 0, nz / len));
    }
    if (!thru) flat(2, yb, nO, new THREE.Shape(pts));
  });
  quad(4, V(bx0, yB, bz0), V(bx0, yT, bz0), V(bx0, yT, bz1), V(bx0, yB, bz1), V(-1, 0, 0));
  quad(4, V(bx1, yB, bz0), V(bx1, yT, bz0), V(bx1, yT, bz1), V(bx1, yB, bz1), V(1, 0, 0));
  quad(4, V(bx0, yB, bz0), V(bx1, yB, bz0), V(bx1, yT, bz0), V(bx0, yT, bz0), V(0, 0, -1));
  quad(4, V(bx0, yB, bz1), V(bx1, yB, bz1), V(bx1, yT, bz1), V(bx0, yT, bz1), V(0, 0, 1));
  const n = G.reduce((s, a) => s + a.length / 8, 0), P3 = new Float32Array(n * 3), N3 = new Float32Array(n * 3), U2 = new Float32Array(n * 2);
  const geo = new THREE.BufferGeometry(); let k = 0;
  G.forEach((arr, gi) => {
    const st = k;
    for (let i = 0; i < arr.length; i += 8, k++) { P3[k * 3] = arr[i]; P3[k * 3 + 1] = arr[i + 1]; P3[k * 3 + 2] = arr[i + 2]; N3[k * 3] = arr[i + 3]; N3[k * 3 + 1] = arr[i + 4]; N3[k * 3 + 2] = arr[i + 5]; U2[k * 2] = arr[i + 6]; U2[k * 2 + 1] = arr[i + 7]; }
    if (k > st) geo.addGroup(st, k - st, gi);
  });
  geo.setAttribute('position', new THREE.BufferAttribute(P3, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(N3, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(U2, 2));
  return geo;
}
function coreGeoNow() { const g = P.g; return paintX(blockGeo(g.Btm, g.Left, g.Btm + g.L_pcb, g.Left + g.W_pcb, LAY.D, LAY.yTop, pocketRects(), false, 1.0)); }
/* TIM 留在凹槽底（跟實拍照片一樣）：Putty 紫色膏、Pad 淺藍片、Grease 灰色薄膜；None 沒有 */
function timMesh(o) {
  const pk = o.pocket, tim = o.row.tim;
  if (!pk || pk.air || !(pk.gap > 0) || !(tim === 'Putty' || tim === 'Pad' || tim === 'Grease')) return null;
  const yb = LAY.D + pk.depth, th = Math.max(0.15, pk.gap);
  let cl = pk.L, cw = pk.W;
  if (o.side === 'hsk') {                         // HSK 側：TIM＝接觸面（E-Pad），方向跟著本體（例：SFP 長邊固定沿長度方向）
    cl = o.ct.L; cw = o.ct.W; if ((cl >= cw) !== (o.bL >= o.bW)) [cl, cw] = [cw, cl];
    cl = Math.min(cl, pk.L); cw = Math.min(cw, pk.W);
  }
  const k = tim === 'Putty' ? 0.86 : 0.98;
  const geo = tim === 'Putty' ? new RoundedBoxGeometry(cl * k, th, cw * k, 2, Math.min(th / 2.1, 0.8)) : new THREE.BoxGeometry(cl * k, th, cw * k);
  const m = mesh(geo, tim === 'Putty' ? MAT.putty : tim === 'Pad' ? MAT.padTim : MAT.grease, 'tim');
  m.position.set(o.x, yb - th / 2 - 0.02, o.z); m.userData.inst = o; m.userData.what = 'pocket';
  return m;
}
/* 補肉：在鰭片側加高的實心塊，穿出來的凹槽延伸進去（外側烤漆） */
function buildFins(fg) {
  fg.children.slice().forEach(c => { fg.remove(c); if (c.geometry) c.geometry.dispose(); });
  parts.fins = [];
  const g = P.g, r = P.r, L = r.L, W = r.W, FH = r.FH, yTop = LAY.yTop, t = g.Fin_t, n = r.n, gap = g.Gap, isDC = r.isDC && r.T_root > t;
  // 節距＝鰭尖厚＋間距（跟 computeAll 同一個定義：Die-casting 的 G_root＝節距 − T_root）；根部總寬＝(n−1)×節距＋根厚，置中
  const tr = isDC ? r.T_root : t, pitch = t + gap, tfw = (n - 1) * pitch + tr, zf0 = (W - tfw) / 2;
  const geoOf = (xa, xb, s0, sharp) => {             // x 從 xa 到 xb、從高度 s0 長到鰭尖；頂點色＝1D 鰭片方程式的溫度（分段的用平切面，接縫才不會出現溝）
    const len = xb - xa, h = FH - s0; let geo;
    if (isDC) {
      const b0 = tr - (tr - t) * s0 / FH, sh = new THREE.Shape(); sh.moveTo(-b0 / 2, 0); sh.lineTo(b0 / 2, 0); sh.lineTo(t / 2, h); sh.lineTo(-t / 2, h); sh.closePath();
      geo = new THREE.ExtrudeGeometry(sh, { depth: len, bevelEnabled: false }); geo.rotateY(Math.PI / 2); geo.translate(xa, s0, 0);
    } else { geo = sharp ? new THREE.BoxGeometry(len, h, t) : new RoundedBoxGeometry(len, h, t, 2, Math.min(0.45, t * 0.4)); geo.translate(xa + len / 2, s0 + h / 2, 0); }
    const cols = [], pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) { const c = rampColor(tN(finT(pos.getX(i), pos.getY(i)))); cols.push(c.r, c.g, c.b); }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    return geo;
  };
  // 鰭片一律從基板完整長到鰭尖；補肉是疊上去的實心塊，跟鰭片干涉就直接呈現干涉（使用者要求）。
  // ⚠ 不要改回「碰到補肉的鰭片整段從補肉頂面才長」：鰭片只有一部分厚度壓在補肉上時（跨在補肉邊緣），
  //   露在補肉外面的那半片根部也被截掉，看起來整片鰭片被挖空。
  // 唯一要讓開的是「凹槽」穿出基板頂面、伸進補肉裡的那一段（元件本體在裡面，從 PCB 側看進凹槽不能看到鰭片）：
  // 那一段從凹槽頂往上長 —— 凹槽四周有 BOSS_WALL、頂上有 T_MIN 的補肉包著，從外面看不到這個切口
  const zs = Array.from({ length: n }, (_, i) => zf0 + i * pitch + tr / 2), holes = [];
  (LAY.bosses || []).forEach(b => b.insts.forEach(o => { const pk = o.pocket; if (!pk) return; const top = pk.depth - LAY.tb;   // 凹槽頂離基板頂面的高度
    if (top > 0) holes.push({ x0: o.x - pk.L / 2, x1: o.x + pk.L / 2, z0: o.z - pk.W / 2, z1: o.z + pk.W / 2, s0: Math.min(top + 0.05, FH - 1) }); }));
  const hitB = z => holes.filter(h => z + tr / 2 > h.z0 && z - tr / 2 < h.z1).sort((a, b) => a.x0 - b.x0);
  const plain = zs.filter(z => !hitB(z).length);
  if (plain.length) {
    const im = new THREE.InstancedMesh(geoOf(0, L, 0), MAT.powderFin, plain.length); im.castShadow = im.receiveShadow = true;
    im.userData = { kind: 'fin', mat: MAT.powderFin, sec: 'al' };
    const m4 = new THREE.Matrix4(); plain.forEach((z, i) => { m4.makeTranslation(0, yTop, z); im.setMatrixAt(i, m4); });
    fg.add(im); reg('fins', im);
  }
  zs.filter(z => hitB(z).length).forEach(z => {
    const segs = []; let x = 0;
    hitB(z).forEach(h => { if (h.x0 > x) segs.push([x, h.x0, 0]); if (h.x1 > x) segs.push([Math.max(x, h.x0), h.x1, h.s0]); x = Math.max(x, h.x1); });
    if (x < L) segs.push([x, L, 0]);
    segs.forEach(([xa, xb, s0]) => { if (xb - xa < 0.5) return; const m = mesh(geoOf(xa, xb, s0, true), MAT.powderFin, 'fin'); m.userData.sec = 'al'; m.position.set(0, yTop, z); fg.add(m); reg('fins', m); });
  });
}
function buildBosses(bg) {
  const mats = [MAT.alRaw, MAT.alRaw, MAT.alMach, MAT.powder, MAT.powder];
  (LAY.bosses || []).forEach(b => {
    const pk = b.insts.filter(o => o.pocket).map(o => ({ x0: Math.max(b.x0 + 0.3, o.x - o.pocket.L / 2), x1: Math.min(b.x1 - 0.3, o.x + o.pocket.L / 2),
      z0: Math.max(b.z0 + 0.3, o.z - o.pocket.W / 2), z1: Math.min(b.z1 - 0.3, o.z + o.pocket.W / 2), depth: o.pocket.depth - LAY.tb }));
    const m = mesh(paintX(blockGeo(b.x0, b.z0, b.x1, b.z1, LAY.yTop, LAY.yTop + b.h, pk, false, 1.0)), mats, 'shell');
    m.userData.mat = mats; m.userData.therm = 'x'; m.userData.sec = 'al'; m.userData.what = 'boss'; m.userData.boss = b;
    bg.add(m); reg('boss', m);
  });
}
/* ── 散熱器（HSK）：分模面 y=0；PCB 的 HSK 側板面貼在基板內側 y=D＝H_shield；鰭片根部 y=H_shield+t_base ── */
function buildHSK() {
  const g = P.g, r = P.r, L = r.L, W = r.W, tb = g.t_base, FH = r.FH, x0 = g.Btm, z0 = g.Left, Lp = g.L_pcb, Wp = g.W_pcb;
  const yTop = LAY.yTop, D = LAY.D;
  const grp = new THREE.Group(); grp.name = 'hsk';
  const R = 6, cav = [x0, z0, x0 + Lp, z0 + Wp, 2.5];
  // 外框：牆厚＝防水邊距（上 Top、下 Bottom、左 Left、右 Right），從分模面到鰭片根部；外側烤漆、內側裸鋁
  const wallRaw = slab([0, 0, L, W, R], [cav], 0, yTop);
  const inside = (x, z) => x > x0 - 1 && x < x0 + Lp + 1 && z > z0 - 1 && z < z0 + Wp + 1;
  const wallGeo = regroup(wallRaw, (x, y, z, ny) => Math.abs(ny) > 0.9 ? 0 : (inside(x, z) ? 1 : 0));
  paintX(wallGeo);
  const wall = mesh(wallGeo, [MAT.powder, MAT.alRaw], 'shell'); wall.userData.mat = [MAT.powder, MAT.alRaw]; wall.userData.therm = 'x'; wall.userData.sec = 'al';
  // 基板：PCB 的 HSK 側板面直接貼上來；HSK 側凸出的元件、銅塊底板在對應位置挖凹槽（深＝本體高或銅塊厚＋TIM）
  const coreMats = [MAT.alRaw, MAT.alRaw, MAT.alMach, MAT.powder, MAT.alRaw];
  const core = mesh(coreGeoNow(), coreMats, 'shell'); core.userData.mat = coreMats; core.userData.therm = 'x'; core.userData.sec = 'al'; core.userData.what = 'core';
  grp.add(wall, core); reg('hsk', wall); reg('pocket', core); grp.userData.core = core;
  LAY.inst.forEach(o => { const m = timMesh(o); if (m) { grp.add(m); reg('pocket', m); } });
  // 補肉：凹槽穿出基板（或 SFP 光口的框超出端牆）的地方，在鰭片側加高
  const bg = new THREE.Group(); bg.name = 'boss'; grp.add(bg); grp.userData.boss = bg; buildBosses(bg);
  // 鰭片：片數、厚度、間距照計算結果（Die-casting 畫成根厚尖薄的梯形）；一律從基板長到鰭尖，補肉疊在上面（只讓開凹槽，見 buildFins）
  const fg = new THREE.Group(); fg.name = 'fins'; grp.add(fg); grp.userData.fins = fg; buildFins(fg);
  // PCB 鎖在 HSK 上的螺絲孔、分模面鎖附孔（示意）
  LAY.holes.forEach(([x, z]) => { const h = mesh(new THREE.CylinderGeometry(1.6, 1.6, 0.3, 16), MAT.hole, 'hole'); h.position.set(x, D - 0.1, z); grp.add(h); reg('rib', h); });
  buildScrewsHSK(grp);                                    // 牆往內凸的螺絲柱＋牙孔
  // 數位 I/O（側欄清單）：在 I/O 端的端面上
  const io = buildIO(); grp.add(io); grp.userData.io = io; reg('io', io);
  return grp;
}
function portTag(pg, text, pos) {
  const el = document.createElement('div'); el.className = 'ptag'; el.textContent = text;
  const o = new CSS2DObject(el); o.position.copy(pos); o.userData.portTag = true; pg.add(o); return o;
}
function buildIO() {
  const io = new THREE.Group(); io.name = 'io';
  ioLayout().forEach(p => {
    const pg = new THREE.Group(); pg.userData = { selKey: 'io:' + p.it.id, port: p, portKind: 'io' };
    (PORT_BUILD[p.it.type] || buildDebug)(pg, p.y, p.z, p.ch || undefined);
    portTag(pg, ioLabel(p.i), V(-18, p.y + p.fh / 2 + 6, p.z));
    io.add(pg);
  });
  return io;
}
function buildAnt() {
  const hf = P.g.H_filter, grp = new THREE.Group(); grp.name = 'ant';
  portsLayout(antList(), ANT_TYPES).forEach(p => {
    const pg = new THREE.Group(); pg.userData = { selKey: 'ant:' + p.it.id, port: p, portKind: 'ant' };
    (PORT_BUILD[p.it.type] || buildRF)(pg, -hf / 2, p.z);
    portTag(pg, antLabel(p.i), V(-20, -hf / 2 - 17, p.z));
    grp.add(pg);
  });
  return grp;
}

/* 分模面螺絲（照實機拆機照）：外框是直的、不凸出；螺絲孔在牆的內側，牆在孔位往內鼓成螺絲柱，
   防水膠條走到螺絲就往內繞半圈（Ω 形）→ 孔在膠條外側、膠條整圈不斷。PCB、屏蔽罩外框／頂板、濾波器上蓋
   在螺絲柱的地方開缺口。螺絲（M3）從濾波器背面鎖進 HSK 牆的牙孔：鰭片側被鰭片蓋住，工具伸不進去。
   四角各一支＋每邊依間距 ≤ SC_PITCH 平均分佈；避開 I/O 接頭、天線座、靠板邊的元件、盲插接頭、PCB 鎖附孔、接到外框的屏蔽罩牆。 */
const SC_PITCH = 90, SC_IN = 2.5, SC_HOLE = 1.7, SC_TAP = 1.25, SC_HEAD = 2.75;   // 孔心距牆內面 SC_IN；M3 過孔 Ø3.4、牙孔 Ø2.5、頭 Ø5.5
const GK_W = 1.8, GK_R = 4.5, GK_F = 2;          // 膠條寬、繞孔半徑（膠條中線，孔心起算）、跟直線接合的圓角
const BOSS_R = 7, BOSS_F = 1.5, NOTCH_C = 0.5;   // 螺絲柱半徑（孔心起算）、跟牆面接合的圓角；PCB 缺口跟螺絲柱的間隙
/* 四邊（依序繞一圈）：0＝左側 z=0、1＝上端 x=L、2＝右側 z=W、3＝I/O 端 x=0。M＝牆厚（防水邊距）、e＝孔心距外緣、m＝膠條直線距外緣 */
function wallSides() {
  const g = P.g;
  return [g.Left, g.Top, g.Right, g.Btm].map(M => ({ M, e: Math.max(SC_HEAD + 1.5, M - SC_IN), m: Math.max(GK_W / 2 + 1.2, Math.min(M * 0.4, M - SC_IN - 2)) }));
}
function sideXZ(k, u, v) { const L = P.r.L, W = P.r.W; return k === 0 ? [u, v] : k === 1 ? [L - v, u] : k === 2 ? [u, W - v] : [v, u]; }   // 沿第 k 邊 u、距外緣 v → (x, z)
function screwSpots() {
  const L = P.r.L, W = P.r.W, sd = wallSides(), out = [], Rn = BOSS_R + NOTCH_C;
  const hwOf = s => Math.sqrt(Math.max(0, (Rn + 1) ** 2 - (1 + s.M - s.e) ** 2)) + 0.5;          // 缺口在 PCB 邊上的半寬
  const boxOf = (k, u) => { const s = sd[k], hw = hwOf(s), a = sideXZ(k, u - hw, s.M), b = sideXZ(k, u + hw, s.e + Rn);
    return { x0: Math.min(a[0], b[0]), x1: Math.max(a[0], b[0]), z0: Math.min(a[1], b[1]), z1: Math.max(a[1], b[1]) }; };
  const ov = (p, q, c) => p.x0 < q.x1 + c && q.x0 < p.x1 + c && p.z0 < q.z1 + c && q.z0 < p.z1 + c;
  const obst = LAY.inst.map(o => ({ n: o.row.name, x0: o.x - o.fpL / 2, x1: o.x + o.fpL / 2, z0: o.z - o.fpW / 2, z1: o.z + o.fpW / 2 }))
    .concat((LAY.conns || []).map(c => ({ n: '盲插接頭', x0: c.x - 5.2, x1: c.x + 5.2, z0: c.z - 5.2, z1: c.z + 5.2 })));
  const hitList = bx => [...new Set(obst.filter(q => ov(bx, q, 1)).map(q => q.n))];
  const holeHit = bx => LAY.holes.some(([x, z]) => ov(bx, { x0: x - 3.2, x1: x + 3.2, z0: z - 3.2, z1: z + 3.2 }, 0.5));
  const ports = portsLayout(ioList(), IO_TYPES).concat(portsLayout(antList(), ANT_TYPES));
  const SH = LAY.shd, sw = SH ? SH.S.wall : 2;
  const wallsTo = k => {                         // 接到第 k 邊外框的屏蔽罩牆（沿邊位置）
    if (!SH || !SH.S.on) return [];
    const R = SH.Rf, ax = k === 0 || k === 2 ? 'x' : 'z';
    return SH.walls.filter(q => q.axis === ax && (k === 0 ? q.a <= R.z0 + 0.01 : k === 1 ? q.b >= R.x1 - 0.01 : k === 2 ? q.b >= R.z1 - 0.01 : q.a <= R.x0 + 0.01)).map(q => q.pos);
  };
  // 四角：固定在兩邊的孔位交點（碰到元件只能提醒）
  [[sd[3].e, sd[0].e], [L - sd[1].e, sd[0].e], [L - sd[1].e, W - sd[2].e], [sd[3].e, W - sd[2].e]].forEach(([x, z], c) =>
    out.push({ x, z, k: c, corner: true, conf: hitList({ x0: x - Rn, x1: x + Rn, z0: z - Rn, z1: z + Rn }) }));
  // 每一邊：在兩個角落螺絲之間平均分佈；碰到東西就在 ±40 mm 內找空位
  [0, 1, 2, 3].forEach(k => {
    const s = sd[k], hw = hwOf(s), uLo = k % 2 ? sd[0].e : sd[3].e, uHi = k % 2 ? W - sd[2].e : L - sd[1].e;
    const lo = uLo + 26, hi = uHi - 26, n = Math.max(0, Math.ceil((uHi - uLo) / SC_PITCH) - 1), walls = wallsTo(k), mine = [];
    const why = u => {
      const bx = boxOf(k, u), r = hitList(bx);
      if (k === 3 && ports.some(p => Math.abs(p.z - u) < p.w * 0.36 + SC_HOLE + 2)) r.push('#port');   // 穿牆的接頭本體（≈ 法蘭寬 × 0.72）＋孔徑＋餘量：可以夾在兩個接頭中間
      if (holeHit(bx)) r.push('#hole');
      if (walls.some(p => Math.abs(p - u) < hw + sw / 2 + 1)) r.push('#wall');
      if (mine.some(v => Math.abs(v - u) < 26)) r.push('#near');
      return r;
    };
    for (let i = 1; i <= n; i++) {
      const u0 = uLo + (uHi - uLo) * i / (n + 1);
      let u = null;
      for (let d = 0; d <= 40 && u == null; d += 0.5) for (const sg of d ? [1, -1] : [1]) { const t = u0 + sg * d; if (t >= lo && t <= hi && !why(t).length) { u = t; break; } }
      let conf = [];
      if (u == null) {                           // 沒有完全空的位置：先讓開接頭與別支螺絲，碰到元件就照放、提醒（膠條不能空太長）；連接頭都讓不開才不放
        let best = null;
        for (let d = 0; d <= 40; d += 0.5) for (const sg of d ? [1, -1] : [1]) {
          const t = u0 + sg * d; if (t < lo || t > hi) continue;
          const r = why(t); if (r.includes('#port') || r.includes('#near')) continue;
          const sc = r.filter(x => x[0] !== '#').length * 10 + r.filter(x => x[0] === '#').length;
          if (!best || sc < best.sc) best = { t, sc, r };
        }
        if (!best) continue;
        u = best.t; conf = best.r.filter(x => x[0] !== '#');
      }
      const [x, z] = sideXZ(k, u, s.e); out.push({ x, z, k, corner: false, u, conf }); mine.push(u);
    }
  });
  return out;
}
/* 沿外框內側的一圈（分模面上的平面曲線）：四邊各一條直線（距外緣 off[k]），每支螺絲往內繞一個圓（半徑 R），
   跟直線用圓角 rf 接起來（Ω 形）；四角的螺絲直接當轉角。膠條中線、螺絲柱（牆內面）、PCB 外形、屏蔽罩外框共用這一支。
   回傳 { pts: [[x, z], …], det: [{ spot, pts, corner }] }（det＝每支螺絲繞的那一段；角落的附上兩條直線的交點，螺絲柱用） */
function omegaLoop(off, R, rf) {
  const L = P.r.L, W = P.r.W, SP = LAY.screws || [];
  const lines = [{ P: [0, off[0]], d: [1, 0], n: [0, 1] }, { P: [L - off[1], 0], d: [0, 1], n: [-1, 0] },
                 { P: [L, W - off[2]], d: [-1, 0], n: [0, -1] }, { P: [off[3], W], d: [0, -1], n: [1, 0] }];
  const cornerPt = c => [c === 0 || c === 3 ? off[3] : L - off[1], c < 2 ? off[0] : W - off[2]];
  const rel = (ln, C) => { const dx = C[0] - ln.P[0], dz = C[1] - ln.P[1]; return [dx * ln.d[0] + dz * ln.d[1], dx * ln.n[0] + dz * ln.n[1]]; };
  const at = (ln, s, v) => [ln.P[0] + ln.d[0] * s + ln.n[0] * v, ln.P[1] + ln.d[1] * s + ln.n[1] * v];
  const fil = (ln, C, sg) => {                   // 圓角：貼著直線內側、跟主圓外切；sg＝−1 進、＋1 出
    const [cu, cv] = rel(ln, C), q = (R + rf) ** 2 - (rf - cv) ** 2; if (q <= 0 || cv + R < 0.05) return null;
    const s = cu + sg * Math.sqrt(q), F = at(ln, s, rf), k = rf / (R + rf);
    return { s, F, Q: at(ln, s, 0), T: [F[0] + (C[0] - F[0]) * k, F[1] + (C[1] - F[1]) * k] };
  };
  const TAU = Math.PI * 2, md = x => ((x % TAU) + TAU) % TAU, ang = (C, p) => Math.atan2(p[1] - C[1], p[0] - C[0]);
  const short = (a0, a1) => { const s = md(a1 - a0); return s > Math.PI ? s - TAU : s; };
  const arc = (o, C, r, a0, sw) => { const n = Math.max(2, Math.ceil(Math.abs(sw) * Math.max(r, 1) / 0.7), Math.ceil(Math.abs(sw) / 0.2));
    for (let i = 1; i <= n; i++) { const a = a0 + sw * i / n; o.push([C[0] + r * Math.cos(a), C[1] + r * Math.sin(a)]); } };
  const detour = (lnA, lnB, C, dir) => {
    const e1 = fil(lnA, C, -1), e2 = fil(lnB, C, 1); if (!e1 || !e2) return null;
    const o = [e1.Q];
    arc(o, e1.F, rf, ang(e1.F, e1.Q), short(ang(e1.F, e1.Q), ang(e1.F, e1.T)));
    const a0 = ang(C, e1.T), ccw = md(ang(C, e2.T) - a0);
    arc(o, C, R, a0, md(Math.atan2(dir[1], dir[0]) - a0) < ccw ? ccw : ccw - TAU);        // 從內側繞過去
    arc(o, e2.F, rf, ang(e2.F, e2.T), short(ang(e2.F, e2.T), ang(e2.F, e2.Q)));
    return { o, s1: e1.s, s2: e2.s };
  };
  const pts = [], det = [];
  for (let k = 0; k < 4; k++) {
    const lp = lines[(k + 3) % 4], ln = lines[k], cs = SP.find(s => s.corner && s.k === k);
    const cd = cs ? detour(lp, ln, [cs.x, cs.z], [lp.n[0] + ln.n[0], lp.n[1] + ln.n[1]]) : null;
    let last = -Infinity;
    if (cd) { pts.push(...cd.o); det.push({ spot: cs, pts: cd.o, corner: cornerPt(k) }); last = cd.s2; } else pts.push(cornerPt(k));
    const nc = SP.find(s => s.corner && s.k === (k + 1) % 4), ncE = nc ? fil(ln, [nc.x, nc.z], -1) : null, lim = ncE ? ncE.s : Infinity;
    SP.filter(s => !s.corner && s.k === k).map(s => ({ s, cu: rel(ln, [s.x, s.z])[0] })).sort((a, b) => a.cu - b.cu).forEach(({ s }) => {
      const d = detour(ln, ln, [s.x, s.z], ln.n);
      if (!d || d.s1 < last + 0.3 || d.s2 > lim - 0.3) return;                                // 跟前後重疊就不繞（不會發生：擺位時已經留間距）
      pts.push(...d.o); det.push({ spot: s, pts: d.o }); last = d.s2;
    });
  }
  for (let i = pts.length - 1; i > 0; i--) if (Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]) < 1e-4) pts.splice(i, 1);
  return { pts, det };
}
function loopsNow() {
  const sd = wallSides(), rim = (LAY.shd ? LAY.shd.S : shdCfg()).rim, Rn = BOSS_R + NOTCH_C, o = f => sd.map(f);
  return {
    gasket: omegaLoop(o(s => s.m), GK_R, GK_F),                     // 防水膠條中線
    boss: omegaLoop(o(s => s.M), BOSS_R, BOSS_F),                   // 牆內面（含螺絲柱）＝濾波器外框的內緣、上蓋外形
    pcb: omegaLoop(o(s => s.M), Rn, 1),                             // PCB 外形（缺口）＝屏蔽罩外緣
    shdIn: omegaLoop(o(s => s.M + rim), Rn + rim, 0.6),             // 屏蔽罩外框內緣
    fip: omegaLoop(o(s => s.M + rim / 2), Rn + rim / 2, 0.8),       // 屏蔽罩外框上的 FIP 導電膠條
  };
}
/* 封閉點列往外（d>0）或往內（d<0）平移：每個點沿兩側線段法線的角平分線移動 */
function offsetLoop(pts, d) {
  const n = pts.length; let area = 0;
  for (let i = 0; i < n; i++) { const p = pts[i], q = pts[(i + 1) % n]; area += p[0] * q[1] - q[0] * p[1]; }
  const sg = area > 0 ? 1 : -1, nrm = (a, b) => { const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1; return [sg * dz / l, -sg * dx / l]; };
  return pts.map((p, i) => {
    const n1 = nrm(pts[(i + n - 1) % n], p), n2 = nrm(p, pts[(i + 1) % n]);
    let mx = n1[0] + n2[0], mz = n1[1] + n2[1]; const ml = Math.hypot(mx, mz) || 1; mx /= ml; mz /= ml;
    const k = d / Math.max(0.5, mx * n1[0] + mz * n1[1]);
    return [p[0] + mx * k, p[1] + mz * k];
  });
}
function ptsShape(pts, asPath) { const s = asPath ? new THREE.Path() : new THREE.Shape(); pts.forEach(([x, z], i) => i ? s.lineTo(x, -z) : s.moveTo(x, -z)); return s; }
/* 沿封閉曲線的一條帶子（膠條、FIP）：寬 2hw、厚 h，從 y0 往上 */
function bandGeo(pts, hw, y0, h, bev = 0) {
  const sh = ptsShape(offsetLoop(pts, hw)); sh.holes.push(ptsShape(offsetLoop(pts, -hw), true));
  const b = Math.min(bev, h / 3, hw / 2);
  const geo = new THREE.ExtrudeGeometry(sh, { depth: Math.max(0.01, h - 2 * b), bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelOffset: -b, bevelSegments: 2 });
  geo.rotateX(-Math.PI / 2); geo.translate(0, y0 + b, 0);
  return geo;
}
/* HSK：牆往內凸的螺絲柱（分模面到 PCB 板面，上面接基板）＋分模面上的牙孔 */
function buildScrewsHSK(grp) {
  const D = LAY.D, mats = [MAT.powder, MAT.alRaw];
  LAY.loops.boss.det.forEach(d => {
    const poly = d.corner ? d.pts.concat([d.corner]) : d.pts;
    const geo = regroup(slab(poly, null, 0.02, D - 0.04, 0), (x, y, z, ny) => Math.abs(ny) > 0.9 ? 0 : 1); paintX(geo);
    const m = mesh(geo, mats, 'shell'); m.userData.mat = mats; m.userData.therm = 'x'; m.userData.sec = 'al'; m.userData.what = 'screwBoss';
    grp.add(m); reg('hsk', m);
  });
  (LAY.screws || []).forEach(e => { const h = mesh(new THREE.CylinderGeometry(SC_TAP, SC_TAP, 0.3, 18), MAT.hole, 'hole'); h.position.set(e.x, -0.1, e.z); grp.add(h); reg('rib', h); });
}
/* 濾波器：分模面上的過孔（膠條繞開）＋背面的沉頭孔與螺絲頭 */
function buildScrewsFil(grp, hf) {
  (LAY.screws || []).forEach(e => {
    const hole = mesh(new THREE.CylinderGeometry(SC_HOLE, SC_HOLE, 0.3, 20), MAT.hole, 'hole'); hole.position.set(e.x, 0.1, e.z);
    const cb = mesh(new THREE.CylinderGeometry(SC_HEAD + 0.5, SC_HEAD + 0.5, 2, 24), MAT.hole, 'hole'); cb.position.set(e.x, -hf + 0.9, e.z);
    const head = mesh(new THREE.CylinderGeometry(SC_HEAD, SC_HEAD, 1.6, 24), MAT.steel, 'deco'); head.position.set(e.x, -hf + 0.6, e.z);
    const sock = mesh(new THREE.CylinderGeometry(1.3, 1.3, 0.3, 6), MAT.hole, 'deco'); sock.position.set(e.x, -hf - 0.3, e.z);
    grp.add(hole, cb, head, sock); reg('rib', hole, cb, head, sock);
  });
}

/* PCB 板面貼圖：綠漆＋過孔點（示意）＋絲印外框與元件名稱（元件表）。
   BoxGeometry 的上面 v=1 在 z 最小、下面 v=1 在 z 最大；文字轉 90° 讓攤開俯視時正著讀 */
function boardTexture(face) {
  const g = P.g, Lp = g.L_pcb, Wp = g.W_pcb, x0 = g.Btm, z0 = g.Left, s = Math.min(5, 2400 / Math.max(Lp, Wp));
  const c = document.createElement('canvas'); c.width = Math.round(Lp * s); c.height = Math.round(Wp * s);
  const x = c.getContext('2d'), top = face === 'hsk';
  const px = (mx, mz) => [(mx - x0) * s, top ? (mz - z0) * s : (z0 + Wp - mz) * s];
  x.fillStyle = '#1d5c3c'; x.fillRect(0, 0, c.width, c.height);
  let seed = top ? 11 : 29; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  x.fillStyle = 'rgba(190,215,190,0.13)';
  for (let i = 0; i < Lp * Wp / 40; i++) { x.beginPath(); x.arc(rnd() * c.width, rnd() * c.height, 0.45 * s, 0, 6.3); x.fill(); }
  const ink = 'rgba(238,244,238,0.94)';
  x.strokeStyle = ink; x.fillStyle = ink; x.lineWidth = Math.max(1, 0.3 * s);
  const label = (text, mx, mz, size, bold) => {
    const [a, b] = px(mx, mz); x.save(); x.translate(a, b); x.rotate(top ? Math.PI / 2 : Math.PI / 2);
    x.font = (bold ? '700 ' : '600 ') + Math.round(size * s) + 'px "IBM Plex Mono", monospace'; x.textBaseline = 'middle'; x.textAlign = 'left';
    x.fillText(text, 0, 0); x.restore();
  };
  const onFace = LAY.inst.filter(o => o.side === face);
  onFace.forEach(o => {
    const [cx, cz] = px(o.x, o.z), w = (o.bL + 1.6) * s, h = (o.bW + 1.6) * s;
    x.strokeRect(cx - w / 2, cz - h / 2, w, h);
    x.beginPath(); x.arc(cx + w / 2 - 1.2 * s, cz - h / 2 + 1.2 * s, 0.5 * s, 0, 6.3); x.fill();   // pin 1
  });
  if (!top) {
    x.save(); x.strokeStyle = '#d2ad52'; x.lineWidth = Math.max(1.5, 0.6 * s);
    LAY.inst.filter(o => o.ct.kind === 'coin').forEach(o => { const [cx, cz] = px(o.x, o.z), w = (o.bL + 0.9) * s, h = (o.bW + 0.9) * s;
      x.beginPath(); x.roundRect(cx - w / 2, cz - h / 2, w, h, 1.5 * s); x.stroke(); });
    x.restore();
  }
  const short = n => n.length > 18 ? n.slice(0, 17) + '…' : n;
  [...new Set(onFace.map(o => o.row))].forEach(r => {
    const list = onFace.filter(o => o.row === r), o = list.reduce((a, b) => (a.z > b.z ? a : b));
    label(short(r.name) + (r.qty > 1 ? ' ×' + r.qty : ''), o.x, o.z + (top ? 1 : -1) * (o.bW / 2 + 2), 2.4);
  });
  if (!top && LAY.N >= 2) for (let i = 0; i < LAY.N; i++) label('CH' + (i + 1), g.Btm + g.L_pcb - 10, z0 + LAY.laneW * (i + 0.5) + 6, 4.2, true);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return t;
}

/* ── PCB：濾波器側的板面 y=0，HSK 側的板面 y=t_PCB ── */
function buildPCB() {
  const g = P.g, tP = g.t_PCB || 2, x0 = g.Btm, z0 = g.Left, Lp = g.L_pcb, Wp = g.W_pcb;
  const grp = new THREE.Group(); grp.name = 'pcb';
  const texTop = boardTexture('hsk'), texBot = boardTexture('filter');
  const mTop = new THREE.MeshPhysicalMaterial({ map: texTop, roughness: 0.42, clearcoat: 0.35, clearcoatRoughness: 0.35 });
  const mBot = new THREE.MeshPhysicalMaterial({ map: texBot, roughness: 0.42, clearcoat: 0.35, clearcoatRoughness: 0.35 });
  // 銅塊的凸台穿過 PCB：開孔≈PA 本體大小（圓角）
  const cut = LAY.inst.filter(o => o.ct.kind === 'coin').map(o => { const hl = o.bL + 0.3, hw = o.bW + 0.3;
    return [o.x - hl / 2, o.z - hw / 2, o.x + hl / 2, o.z + hw / 2, Math.min(1.2, hl / 4, hw / 4)]; });
  const geo = regroup(slab(LAY.loops.pcb.pts, cut, 0, tP, 0.12), (x, y, z, ny) => ny > 0.9 ? 0 : ny < -0.9 ? 1 : 2);   // 外形＝PCB 缺口
  pcbUV(geo, x0, z0, Lp, Wp);
  const bm = [mTop, mBot, MAT.fr4];
  const board = mesh(geo, bm, 'pcb'); board.userData.mat = bm; board.userData.sec = 'pcb'; grp.add(board); reg('pcb', board);
  LAY.holes.forEach(([x, z]) => {
    [tP + 0.075, -0.075].forEach(y => { const ring = mesh(new THREE.CylinderGeometry(3.2, 3.2, 0.15, 28), MAT.gold, 'deco'); ring.position.set(x, y, z); grp.add(ring); });
    const h = mesh(new THREE.CylinderGeometry(1.6, 1.6, tP + 0.4, 20), MAT.hole, 'hole'); h.position.set(x, tP / 2, z); grp.add(h);
  });
  LAY.inst.forEach(o => {
    const c = new THREE.Group(); c.position.set(o.x, 0, o.z); c.rotation.y = o.rot ? Math.PI / 2 : 0; c.userData.inst = o; c.userData.kind = 'compGrp'; c.userData.selKey = 'c:' + o.key;
    buildBody(c, o, tP); grp.add(c); reg('comp', c);
  });
  return grp;
}
/* 板面貼圖座標：上面（HSK 側）v=1 在 z 最小、下面（濾波器側）v=1 在 z 最大（跟 boardTexture 的畫法一致） */
function pcbUV(geo, x0, z0, Lp, Wp) {
  const pos = geo.attributes.position, uv = geo.attributes.uv;
  geo.groups.forEach(gr => { if (gr.materialIndex > 1) return;
    for (let i = gr.start; i < gr.start + gr.count; i++) { const x = pos.getX(i), z = pos.getZ(i); uv.setXY(i, (x - x0) / Lp, gr.materialIndex === 0 ? 1 - (z - z0) / Wp : (z - z0) / Wp); } });
  uv.needsUpdate = true;
}
function buildBody(c, o, tP) {
  const up = o.side === 'hsk', s = up ? 1 : -1, y0 = up ? tP : 0, ghost = o.body.h == null;
  const h = ghost ? GHOST_H : o.body.h, bl = o.body.L, bw = o.body.W;
  const Y = d => y0 + s * d;                         // 離板面 d 的 y 座標
  const add = (m, kind = 'comp') => { m.userData.kind = kind; m.userData.inst = o; if (kind === 'comp') m.userData.sec = 'comp'; c.add(m); return m; };
  const bx = (w, hh, d, mat, x, dy, z, kind) => add(box(w, hh, d, mat, 'comp', x, Y(dy + hh / 2) - (s < 0 ? 0 : 0), z), kind);
  // 導熱路徑：銅塊＝底板＋凸台。底板在 HSK 側，厚 Coin_T（從 PCB 背面往 HSK 算＝參數控制台的「銅塊厚度」）；
  // 凸台≈PA 本體大小，穿過 PCB 開孔、頂面跟濾波器側板面齊平，PA 直接焊在凸台上。散熱孔區＝HSK 側鍍金方塊
  if (o.ct.kind === 'coin') {
    const ct = Math.max(0.1, P.g.Coin_T || 2.5);
    const plate = add(mesh(new RoundedBoxGeometry(o.ct.L, ct, o.ct.W, 2, Math.min(0.8, ct / 3)), MAT.copper, 'comp'), 'path'); plate.position.set(0, tP + ct / 2, 0); plate.userData.sec = 'cu';
    const ped = add(box(o.body.L, tP + 0.02, o.body.W, MAT.copper, 'comp', 0, tP / 2, 0), 'path'); ped.userData.sec = 'cu';
  } else if (o.ct.kind === 'via') {
    const m = add(box(o.ct.L, 0.15, o.ct.W, MAT.gold, 'comp', 0, tP + 0.075, 0), 'path'); m.castShadow = false;
  }
  if (ghost) {                                       // 本體高度未知：半透明薄片＋琥珀色外框
    const m = bx(bl, h, bw, MAT.ghost, 0, 0, 0, 'ghost'); m.castShadow = false;
    const e = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), EDGE_MAT); e.position.copy(m.position); c.add(e);
    return;
  }
  switch (o.role) {
    case 'fpga': {
      const sub = Math.min(1.2, h * 0.35);
      bx(bl, sub, bw, MAT.substrate, 0, 0, 0);
      bx(bl * 0.84, h - sub, bw * 0.84, MAT.alMach, 0, sub, 0);
      break;
    }
    case 'pmod': {
      const pl = Math.min(1.6, h * 0.2);
      bx(bl, h - pl, bw, MAT.moldLite, 0, 0, 0);
      bx(bl - 0.8, pl, bw - 0.8, MAT.alMach, 0, h - pl, 0);
      break;
    }
    case 'sfp': {
      bx(bl, h, bw, MAT.steel, 0, 0, 0);
      bx(0.4, h * 0.72, bw * 0.82, MAT.hole, -bl / 2 - 0.2, h * 0.14, 0);
      break;
    }
    case 'pa': {
      bx(bl, h, bw, MAT.moldLite, 0, 0, 0);
      bx(bl * 0.7, 0.2, bw * 0.7, MAT.ptfe, 0, h, 0);
      [-1, 1].forEach(k => bx(5, 0.25, bw * 0.7, MAT.gold, k * (bl / 2 + 2.5), 0.1, 0));
      break;
    }
    case 'circ': {
      const rad = Math.min(bl, bw) / 2, cy = add(mesh(new THREE.CylinderGeometry(rad, rad, h, 40), MAT.metal, 'comp'));
      cy.position.set(0, Y(h / 2), 0);
      const top = add(mesh(new THREE.CylinderGeometry(rad * 0.62, rad * 0.62, 0.3, 32), MAT.steel, 'comp')); top.position.set(0, Y(h + 0.15), 0);
      [0, 2.094, 4.189].forEach(a => bx(3.2, 0.25, 1.8, MAT.gold, Math.cos(a) * (rad + 1.2), 0.1, Math.sin(a) * (rad + 1.2)));
      break;
    }
    default: {
      const m = add(mesh(new RoundedBoxGeometry(bl, h, bw, 2, Math.min(0.35, h / 3)), MAT.mold, 'comp')); m.position.set(0, Y(h / 2), 0);
    }
  }
}

/* ── 腔體濾波器：分模面 y=0，本體往下 −H_filter。上蓋凹入 SCREW_REC，調諧螺絲整組收在 H_filter 以內（不頂到屏蔽罩） ── */
function buildFilter() {
  const g = P.g, r = P.r, L = r.L, W = r.W, hf = g.H_filter, x0 = g.Btm, z0 = g.Left, Lp = g.L_pcb, Wp = g.W_pcb, df = LAY.df;
  const rec = Math.min(SCREW_REC, hf / 3), lidTop = -rec + 0.8;
  const grp = new THREE.Group(); grp.name = 'filter';
  const body = mesh(new RoundedBoxGeometry(L, hf - rec, W, 5, 5), MAT.powder, 'shellF'); body.position.set(L / 2, -hf + (hf - rec) / 2, W / 2); body.userData.sec = 'fil';
  // 外框：凹入那一圈牆（寬＝防水邊距，跟 HSK 側牆對上）；頂面＝分模面的密封面（鉻酸鹽）＋矽膠條
  const LP = LAY.loops;
  const frame = mesh(slab([0, 0, L, W, 6], [LP.boss.pts], -rec - 0.5, rec + 0.2, 0.4), MAT.powder, 'shellF'); frame.userData.sec = 'fil';
  const rim = mesh(slab([0, 0, L, W, 6], [LP.boss.pts], -0.3, 0.3, 0.1), MAT.chromate, 'shellF'); rim.userData.sec = 'fil';
  // 防水膠條：整圈不斷，走到螺絲就往內繞開（Ω）→ 孔在膠條外側
  const gasket = mesh(bandGeo(LP.gasket.pts, GK_W / 2, 0, 0.6, 0.2), MAT.gasket, 'deco');
  const lid = mesh(slab(LP.boss.pts, null, -rec, 0.8, 0.1), MAT.lid, 'shellF'); lid.userData.sec = 'fil';
  grp.add(body, frame, rim, gasket, lid); reg('filter', body, frame, rim, gasket, lid);
  // 盲插接頭（數量＝通道數）：從上蓋往上，穿過屏蔽罩頂板，頂到 PCB 濾波器側板面
  const conns = LAY.conns, lanes = LAY.N || 0;
  const barH = Math.max(1, df - lidTop - 1.4 - 0.2);
  conns.forEach(({ x, z }) => {
    const fl = mesh(new THREE.CylinderGeometry(5.2, 5.2, 1.4, 6), MAT.gold, 'deco'); fl.position.set(x, lidTop + 0.7, z);
    const bar = mesh(new THREE.CylinderGeometry(3.1, 3.1, barH, 28), MAT.gold, 'deco'); bar.position.set(x, lidTop + 1.4 + barH / 2, z);
    const ins = mesh(new THREE.CylinderGeometry(2.1, 2.1, 0.25, 24), MAT.ptfe, 'deco'); ins.position.set(x, lidTop + 1.4 + barH + 0.1, z);
    grp.add(fl, bar, ins); reg('rfc', fl, bar, ins);
  });
  // 天線座（側欄清單）在 I/O 端
  const ant = buildAnt(); grp.add(ant); grp.userData.ant = ant; reg('rfc', ant);
  // 調諧螺絲（示意）：每一路一條濾波器，諧振桿交錯排列＋點藍色螺絲膠；蓋板螺絲沿隔腔。最高到分模面下 0.3 mm
  const res = [], cpl = [], fix = [];
  const laneN = Math.max(1, lanes || 4), lw = Wp / laneN, xa = x0 + 30, xb = x0 + Lp - 10;
  const nearC = (x, z, d) => conns.some(c => Math.hypot(c.x - x, c.z - z) < d);
  for (let i = 0; i < laneN; i++) {
    const zc = z0 + lw * (i + 0.5), off = Math.min(lw * 0.2, 12);
    for (let x = xa, k = 0; x <= xb; x += 16.5, k++) {
      const z = zc + (k % 2 ? off : -off);
      if (!nearC(x, z, 10)) res.push([x, z, (i * 31 + k * 17) % 10 < 7]);
      if (k > 0 && !nearC(x - 8.2, zc, 8)) cpl.push([x - 8.2, zc]);
    }
    if (i > 0) for (let x = xa - 6; x <= xb + 4; x += 12) { const z = z0 + lw * i; if (!nearC(x, z, 9)) fix.push([x, z]); }
  }
  for (let x = xa - 10; x <= xb + 6; x += 12) { fix.push([x, z0 + 5]); fix.push([x, z0 + Wp - 5]); }
  const offSc = q => !(LAY.screws || []).some(e => Math.hypot(e.x - q[0], e.z - q[1]) < BOSS_R + 3);   // 蓋板螺絲讓開螺絲柱
  fix.splice(0, fix.length, ...fix.filter(offSc));
  const inst = (geo, mat, list, y) => {
    const im = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length)); im.count = list.length; im.castShadow = true; im.receiveShadow = true;
    im.userData = { kind: 'deco', mat };
    const m4 = new THREE.Matrix4(); list.forEach((q, i) => { m4.makeTranslation(q[0], y, q[1]); im.setMatrixAt(i, m4); });
    grp.add(im); reg('tune', im); return im;
  };
  inst(new THREE.CylinderGeometry(3.3, 3.3, 2.2, 6), MAT.steel, res, lidTop + 1.1);
  inst(new THREE.CylinderGeometry(1.5, 1.5, 3.2, 14), MAT.metal, res, lidTop + 3.8);
  const glue = inst(new THREE.SphereGeometry(3.4, 18, 10).scale(1, 0.32, 1), MAT.glue, res.filter(q => q[2]), lidTop + 0.5);
  inst(new THREE.CylinderGeometry(2.3, 2.3, 1.5, 6), MAT.steel, cpl, lidTop + 0.75);
  inst(new THREE.CylinderGeometry(1.05, 1.05, 2.3, 12), MAT.metal, cpl, lidTop + 2.6);
  inst(new THREE.CylinderGeometry(2.1, 2.1, 0.9, 16), MAT.steel, fix, lidTop + 0.45);
  buildScrewsFil(grp, hf);
  return grp;
}

/* ── 屏蔽罩：分模面 y=0 到 PCB 濾波器側板面 y=df；頂板（朝濾波器）厚 roof，腔體朝 PCB 開口 ── */
function buildShield() { const grp = new THREE.Group(); grp.name = 'shield'; const body = new THREE.Group(); grp.add(body); grp.userData.body = body; fillShield(grp); return grp; }
function fillShield(grp) {
  const body = grp.userData.body;
  body.children.slice().forEach(c => { body.remove(c); disposeTree(c); });
  parts.shield = [];
  const SH = LAY.shd, S = SH.S; if (!S.on) return;
  const g = P.g, df = LAY.df, w = S.wall, x0 = g.Btm, z0 = g.Left, Lp = g.L_pcb, Wp = g.W_pcb, H = Math.max(0.5, df - S.roof);
  const put = (m, mat) => { m.userData.mat = mat; m.userData.sec = 'shd'; m.userData.what = 'shield'; body.add(m); return m; };
  // 頂板（朝濾波器那面）＋外框
  const LP = LAY.loops;                                      // 外形＝PCB（螺絲柱處缺口）
  put(mesh(slab(LP.pcb.pts, null, 0, S.roof, 0.05), MAT.shdFloor, 'shield'), MAT.shdFloor);
  put(mesh(slab(LP.pcb.pts, [LP.shdIn.pts], S.roof, H, 0.3), MAT.shd, 'shield'), MAT.shd);
  // 腔體牆：一道牆一個方塊（兩端各多半個牆厚，轉角才會接起來），合成一個網格
  if (SH.walls.length) {
    const P3 = [], N3 = [], U2 = [];
    SH.walls.forEach(q => {
      const len = q.b - q.a + w, bg = q.axis === 'x' ? new THREE.BoxGeometry(w, H, len) : new THREE.BoxGeometry(len, H, w);
      bg.translate(q.axis === 'x' ? q.pos : (q.a + q.b) / 2, S.roof + H / 2, q.axis === 'x' ? (q.a + q.b) / 2 : q.pos);
      const ng = bg.toNonIndexed(); P3.push(...ng.attributes.position.array); N3.push(...ng.attributes.normal.array); U2.push(...ng.attributes.uv.array); bg.dispose(); ng.dispose();
    });
    const wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.Float32BufferAttribute(P3, 3)); wg.setAttribute('normal', new THREE.Float32BufferAttribute(N3, 3)); wg.setAttribute('uv', new THREE.Float32BufferAttribute(U2, 2));
    put(mesh(wg, MAT.shd, 'shield'), MAT.shd);
  }
  // FIP 導電膠條：外框中線＋每一道腔體牆的中線，壓在 PCB 的地上
  const rimC = S.rim / 2, segs = [], fh = 0.6, fw = Math.min(0.9, w * 0.5);
  const fipRim = mesh(bandGeo(LP.fip.pts, fw / 2, df, fh), MAT.fip, 'deco'); fipRim.userData.what = 'shield'; body.add(fipRim);   // 外框：沿缺口走
  SH.walls.forEach(q => segs.push(q.axis === 'x' ? ['z', q.pos, q.a, q.b] : ['x', q.pos, q.a, q.b]));
  const bead = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), MAT.fip, Math.max(1, segs.length)); bead.count = segs.length;
  const m4 = new THREE.Matrix4(), qq = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3();
  segs.forEach(([ax, pos, a, b], i) => {
    if (ax === 'x') { v.set((a + b) / 2, df + fh / 2, pos); sc.set(b - a, fh, fw); } else { v.set(pos, df + fh / 2, (a + b) / 2); sc.set(fw, fh, b - a); }
    m4.compose(v, qq, sc); bead.setMatrixAt(i, m4);
  });
  bead.castShadow = true; bead.userData = { kind: 'deco', mat: MAT.fip, what: 'shield' }; body.add(bead);
  // 鎖附孔：外框每 ~55 mm 一個
  const holes = [], along = (a, b, f, ax) => { const n = Math.max(1, Math.round((b - a) / 55)); for (let i = 0; i <= n; i++) { const t = a + (b - a) * i / n; holes.push(ax === 'x' ? [t, f] : [f, t]); } };
  along(x0 + 8, x0 + Lp - 8, z0 + rimC, 'x'); along(x0 + 8, x0 + Lp - 8, z0 + Wp - rimC, 'x'); along(z0 + 30, z0 + Wp - 30, x0 + rimC, 'z'); along(z0 + 30, z0 + Wp - 30, x0 + Lp - rimC, 'z');
  const hr = Math.min(1.1, S.rim * 0.36);
  holes.filter(([x, z]) => !(LAY.screws || []).some(e => Math.hypot(e.x - x, e.z - z) < BOSS_R + NOTCH_C + S.rim + 1.5))   // 讓開螺絲柱缺口
    .forEach(([x, z]) => { const h = mesh(new THREE.CylinderGeometry(hr, hr, 0.3, 16), MAT.hole, 'hole'); h.position.set(x, df + 0.02, z); body.add(h); });
  // 走線缺口（訊號線穿牆的地方）、盲插接頭穿過頂板的孔
  SH.notches.forEach(n => { const k = box(w + 0.3, 1.0, 3.0, MAT.hole, 'hole', n.x, df - 0.48, n.z); body.add(k); });
  LAY.conns.forEach(c => { [-0.01, S.roof + 0.02].forEach(y => { const h = mesh(new THREE.CylinderGeometry(3.6, 3.6, 0.04, 28), MAT.hole, 'hole'); h.position.set(c.x, y, c.z); body.add(h); }); });
  body.children.forEach(o => reg('shield', o));
}
/* ── 尺寸標註 ── */
const DIMC = 0x223044;
function dimLine(g0, a, b, html, ext, cls) {
  const mat = new THREE.LineBasicMaterial({ color: DIMC }), g = new THREE.Group();
  g.userData.dimDir = b.clone().sub(a).normalize(); g0.add(g);
  g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), mat));
  (ext || []).forEach(([u, v]) => g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([u, v]), mat)));
  const d = b.clone().sub(a), n = d.clone().normalize();
  [[b.clone().addScaledVector(n, -3), n], [a.clone().addScaledVector(n, 3), n.clone().negate()]].forEach(([p, dir]) => {
    const c = new THREE.Mesh(new THREE.ConeGeometry(1.8, 6, 12), new THREE.MeshBasicMaterial({ color: DIMC }));
    c.position.copy(p); c.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir); g.add(c);
  });
  const el = document.createElement('div'); el.className = 'dim' + (cls ? ' ' + cls : ''); el.innerHTML = html;
  const lbl = new CSS2DObject(el); lbl.position.copy(a.clone().add(b).multiplyScalar(0.5)); g.add(lbl);
  return g;
}
function tagAt(g, pos, html, cls) {
  const el = document.createElement('div'); el.className = cls || 'dim src'; el.innerHTML = html;
  const o = new CSS2DObject(el); o.position.copy(pos); g.add(o); return o;
}
const V = (x, y, z) => new THREE.Vector3(x, y, z);
function dimsAssembled() {
  const g = new THREE.Group(), G = P.g, R = P.r, L = R.L, W = R.W, H = G.H_filter + G.H_shield + G.t_base + R.FH, off = 26;
  dimLine(g, V(0, 0, W + off), V(L, 0, W + off), 'L ' + L + '<small>mm</small>', [[V(0, 0, W + 4), V(0, 0, W + off + 6)], [V(L, 0, W + 4), V(L, 0, W + off + 6)]]);
  dimLine(g, V(-48, 0, 0), V(-48, 0, W), 'W ' + W + '<small>mm</small>', [[V(-4, 0, 0), V(-54, 0, 0)], [V(-4, 0, W), V(-54, 0, W)]]);
  dimLine(g, V(L + off, 0, W + off), V(L + off, H, W + off), 'H ' + f1(H) + '<small>mm</small>', [[V(L, H, W), V(L + off + 6, H, W + off + 6)]]);
  const yb = G.H_filter + G.H_shield + G.t_base, o2 = off * 2.3;
  const fin = dimLine(g, V(L + o2, yb, W + o2), V(L + o2, yb + R.FH, W + o2), '鰭片 ' + f1(R.FH) + '<small>mm</small>', [[V(L, yb, W), V(L + o2 + 6, yb, W + o2 + 6)], [V(L, yb + R.FH, W), V(L + o2 + 6, yb + R.FH, W + o2 + 6)]]);
  fin.userData.yb = yb; fin.userData.fh = R.FH; g.userData.fin = fin;
  return g;
}
/* 整台翻過來（組裝＋全部＋翻轉）時鰭片在下面 → 「鰭片」那一條標註移到翻過去的高度（長／寬／高的外框不變，不用動） */
function finDimPlace(st, T0) {
  const f = dimsA && dimsA.userData.fin; if (!f) return;
  const c = state.pflip && st === 'asm' ? flipPivot(T0) : null;
  f.position.y = c ? 2 * c.y - 2 * f.userData.yb - f.userData.fh : 0;
}
/* 攤開時：直接在零件上標出「這個尺寸是哪個參數」 */
function dimsHSK() {
  const g = new THREE.Group(), G = P.g, L = P.r.L, W = P.r.W, hs = G.H_shield, x0 = G.Btm, z0 = G.Left;
  tagAt(g, V(L - G.Top / 2, -1, W * 0.72), '上 ' + G.Top + '<em>Top</em>');
  tagAt(g, V(G.Btm / 2, -1, W * 0.72), '下 ' + G.Btm + '<em>Bottom</em>');
  tagAt(g, V(L * 0.3, -1, G.Left / 2), '左 ' + G.Left + '<em>Left</em>');
  tagAt(g, V(L * 0.3, -1, W - G.Right / 2), '右 ' + G.Right + '<em>Right</em>');
  tagAt(g, V(x0 + G.L_pcb * 0.5, LAY.D - 1, z0 + 14), '基板內側貼 PCB · 距分模面 ' + f1(LAY.D) + '<em>H_shield</em>');
  return g;
}
function dimsPCB() {
  const g = new THREE.Group(), G = P.g, tP = G.t_PCB || 2;
  tagAt(g, V(G.Btm + G.L_pcb * 0.46, tP + 1, G.Left + G.W_pcb * 0.5), 'PCB ' + G.L_pcb + '×' + G.W_pcb + '×' + tP + '<em>L_pcb×W_pcb×板厚</em>');
  return g;
}
function dimsFilter() {
  const g = new THREE.Group(), G = P.g;
  tagAt(g, V(G.Btm + G.L_pcb * 0.08, 1, G.Left + G.W_pcb * 0.5), '濾波器 厚 ' + G.H_filter + '<em>H_filter · 調諧螺絲在內</em>');
  return g;
}
function dimsShield() {
  const g = new THREE.Group(), G = P.g, S = LAY.shd.S;
  if (S.on) tagAt(g, V(G.Btm + G.L_pcb * 0.3, LAY.df + 1, G.Left + G.W_pcb * 0.5), '屏蔽罩 ' + G.L_pcb + '×' + G.W_pcb + '×' + f1(LAY.df) + '<em>頂板 ' + S.roof + ' · 腔深 ' + f1(LAY.shd.depth) + '</em>');
  return g;
}

/* ── 場景組裝 ── */
const holder = new THREE.Group(); scene.add(holder);
let rru = null, HSK = null, PCB = null, SHD = null, FIL = null, dimsA = null, dimsF = [], titles = [];
let bbox = new THREE.Box3(), center = new THREE.Vector3(), radius = 300;
const state = { mode: 'real', dims: true, st: 'asm', flip: false, upright: false, edit: false, solo: null, pflip: false };   // solo：null＝全部，否則是要顯示的部件陣列（可複選）；pflip：顯示中的部件沿長邊中心軸翻 180°（見 withFlips）
const HIDE = {};                                   // 模型樹取消勾選的零件（重建後照樣藏）
const HIDEI = new Set();                           // 個別隱藏的零件（選取鍵：c:元件#i、io:id、ant:id）；只在這次檢視、不存檔，換專案清掉

function disposeTree(o) { o.traverse(x => { if (x.geometry) x.geometry.dispose(); if (x.element) x.element.remove(); }); }
function rebuild(projKey, keepView) {
  const newProj = !!projKey;
  if (!P) return;
  if (!projKey && SKIP_REBUILD) { SKIP_REBUILD = false; return; }   // 工具剛在 saveEdit 裡重算並更新過（元件相對高度寫回）→ 不重做一次
  if (rru) { holder.remove(rru); disposeTree(rru); }
  if (dimsA) { holder.remove(dimsA); disposeTree(dimsA); }
  parts = {}; PBOX = {}; if (newProj) { state.pflip = false; HIDEI.clear(); }
  T_LO = P.g.T_amb; T_HI = P.r.T_base + P.g.L_pcb * P.g.Slope;
  layout();
  rru = new THREE.Group();
  HSK = buildHSK(); PCB = buildPCB(); SHD = buildShield(); FIL = buildFilter();
  dimsF = [dimsHSK(), dimsPCB(), dimsShield(), dimsFilter()];
  HSK.add(dimsF[0]); PCB.add(dimsF[1]); SHD.add(dimsF[2]); FIL.add(dimsF[3]); dimsF.forEach(d => { d.userData.noCenter = true; });
  titles = [   // 由左到右＝組裝順序（由下往上）：濾波器 → 屏蔽罩 → PCB → 散熱器；userData.txt＝[原本朝上的那一面, 翻面後]（PCB 另外看「PCB 翻面」，見 updateVis）
    tagAt(FIL, V(P.r.L + 50, 0, P.r.W / 2), '', 'ptitle'),
    tagAt(SHD, V(P.r.L + 50, 0, P.g.Left + P.g.W_pcb / 2), '', 'ptitle'),
    tagAt(PCB, V(P.r.L + 50, 0, P.g.Left + P.g.W_pcb / 2), '', 'ptitle'),
    tagAt(HSK, V(P.r.L + 50, 0, P.r.W / 2), '', 'ptitle')];
  titles[0].userData.txt = ['① 腔體濾波器<small>上蓋凹入 · 調諧螺絲不超過 ' + P.g.H_filter + ' mm</small>', '① 腔體濾波器<small>翻面 · 底面（機殼外側）朝上</small>'];
  titles[1].userData.txt = ['② 屏蔽罩<small>腔體朝上 · RF 隔離</small>', '② 屏蔽罩<small>翻面 · 頂板朝上（貼濾波器那面）</small>'];
  titles[3].userData.txt = ['④ 散熱器 HSK<small>內側朝上 · 基板凹槽＋補肉</small>', '④ 散熱器 HSK<small>翻面 · 鰭片朝上</small>'];
  rru.add(HSK, PCB, SHD, FIL);
  dimsA = dimsAssembled();
  holder.add(rru, dimsA);
  applyState(state.st, true);
  applyMode(); applyHide(); applySolo();
  if (newProj) renderPanels(); else refreshPanels();
  if (SEC.on) secBuild();
  selectRefresh();
  if (!keepView) frame(state.st === 'flat' ? 'flat' : 'iso', true);
}

/* 部件翻轉 180°（部件組的「⇅ 翻轉」）：沿長邊（x）方向的軸轉半圈，看另一面。只有一個開關 state.pflip，翻的是「畫面上顯示的部件」：
   - 組裝／爆炸：部件疊在一起 → 顯示中的部件整組一起翻，軸穿過它們合起來的外框中心 —— 部件之間的相對位置不變、不會互相穿插；
     沒顯示的部件也套同一個剛體變換（再顯示出來時已經在對的位置）
   - 拆機攤開：部件各自攤在地上 → 各自繞自己的長邊中心軸原地翻面（整組翻的話，薄的部件會被翻到半空中）
   ⚠ 不要改回「每一件各自繞自己的中心翻」：組裝時外殼互相套著，各自翻會互相穿插（使用者回報過）。
   中心一律用部件的幾何外框（不含尺寸標註、剖面輔助），而且用「沒翻之前」的位置算 → 翻完外框不變，地面、陰影、鏡頭範圍都不必動。
   換部件組合時照樣翻著（新的組合重新算中心）；關掉就全部回原位 —— 不會留下哪一件還翻著。 */
const QX = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI), ONE = new THREE.Vector3(1, 1, 1);
let PBOX = {};                     // 部件自己座標系裡的幾何外框（重建模型時清掉）
function partBox(k) {
  if (PBOX[k]) return PBOX[k];
  const o = PARTS()[k], b = new THREE.Box3(); if (!o) return b;
  o.updateWorldMatrix(true, true);
  const inv = o.matrixWorld.clone().invert(), bb = new THREE.Box3();
  const walk = x => {
    if (x.userData && (x.userData.noCenter || x.userData.secHelper)) return;
    if (x.isMesh) {
      if (x.isInstancedMesh) { x.computeBoundingBox(); bb.copy(x.boundingBox); } else { if (!x.geometry.boundingBox) x.geometry.computeBoundingBox(); bb.copy(x.geometry.boundingBox); }
      if (!bb.isEmpty()) b.union(bb.applyMatrix4(x.matrixWorld).applyMatrix4(inv));
    }
    x.children.forEach(walk);
  };
  walk(o);
  return (PBOX[k] = b);
}
function partCenter(k) { return partBox(k).getCenter(new THREE.Vector3()); }
const shownParts = () => Object.keys(PARTS()).filter(k => PARTS()[k] && (!state.solo || state.solo.includes(k)));
/* 整組翻的轉軸中心（rru 座標）：顯示中的部件在沒翻之前的位置、合起來的幾何外框中心 */
function flipPivot(T0) {
  const u = new THREE.Box3(), m = new THREE.Matrix4();
  shownParts().forEach(k => { const b = partBox(k); if (T0[k] && !b.isEmpty()) u.union(b.clone().applyMatrix4(m.compose(T0[k][0], T0[k][1], ONE))); });
  return u.isEmpty() ? null : u.getCenter(new THREE.Vector3());
}
function withFlips(T0, st) {
  if (!state.pflip) return T0;
  const T = {};
  if (st === 'flat') {               // 各自原地翻：部件座標的 x 軸、穿過自己的中心 → p' = p + q·(0, 2c.y, 2c.z)、q' = q·Rx(180°)
    Object.keys(T0).forEach(k => { const [p, q] = T0[k], c = partCenter(k); T[k] = [p.clone().add(V(0, 2 * c.y, 2 * c.z).applyQuaternion(q)), q.clone().multiply(QX)]; });
    return T;
  }
  const c = flipPivot(T0); if (!c) return T0;
  Object.keys(T0).forEach(k => { const [p, q] = T0[k]; T[k] = [c.clone().add(p.clone().sub(c).applyQuaternion(QX)), QX.clone().multiply(q)]; });   // 整組：繞穿過 c 的 x 軸轉 180°
  return T;
}
function targets(st) { return withFlips(targets0(st), st); }
/* 三種狀態的零件位置 */
function targets0(st) {
  const g = P.g, r = P.r, W = r.W, hf = g.H_filter, tP = g.t_PCB || 2, q0 = new THREE.Quaternion(), qx = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
  const zc = g.Left + g.W_pcb / 2;
  if (st === 'exp') {
    const E = Math.max(70, 0.3 * Math.max(r.L, W));
    return { hsk: [V(0, hf + E * 1.25, 0), q0], pcb: [V(0, hf + LAY.df + E * 0.75, 0), q0], shd: [V(0, hf + E * 0.25, 0), q0], fil: [V(0, hf - E * 0.7, 0), q0] };
  }
  if (st === 'flat') {
    const pcb = state.flip ? [V(0, tP + LAY.maxUp + 0.6, 2 * zc), qx] : [V(0, LAY.maxDown + 0.6, 0), q0];
    const yH = LAY.yTop + r.FH;
    if (portrait()) {                  // 直式視窗（手機）：四件沿長度方向上下排，HSK 在上、濾波器在下
      const gap = Math.round(0.1 * r.L + 30);
      return { hsk: [V(r.L + gap, yH, W), qx], pcb, shd: [V(-(r.L + gap), 0, 0), q0], fil: [V(-2 * (r.L + gap), hf, 0), q0] };
    }
    const gap = Math.round(0.12 * W + 26);
    return { hsk: [V(0, yH, 2 * W + gap), qx], pcb, shd: [V(0, 0, -(W + gap)), q0], fil: [V(0, hf, -2 * (W + gap)), q0] };
  }
  return { hsk: [V(0, hf, 0), q0], pcb: [V(0, hf + LAY.df, 0), q0], shd: [V(0, hf, 0), q0], fil: [V(0, hf, 0), q0] };
}
let tween = null, camTween = null;
const portrait = () => stage.clientHeight > stage.clientWidth * 1.1;
const VIEWS_UP = {                     // 直立安裝（長度朝上、鰭片朝 −x、I/O 端朝下）時的觀看方向
  iso: V(-1.25, 0.42, 0.95), exp: V(-0.6, 0.35, 1.3), front: V(-1, 0.12, 0.02), io: V(-0.7, -0.05, 0.9), top: V(-0.5, 0.3, 1),
};
let applied = { st: null, flip: false };   // 上一次套用的狀態：用來判斷這次是不是「只切換翻轉」
function applyState(st, instant) {
  state.st = st;
  if (st === 'flat' && state.upright) { state.upright = false; $('t-up').setAttribute('aria-pressed', 'false'); }
  const T0 = targets0(st), T = withFlips(T0, st), objs = { hsk: HSK, pcb: PCB, shd: SHD, fil: FIL };
  const from = {}; Object.keys(objs).forEach(k => from[k] = [objs[k].position.clone(), objs[k].quaternion.clone()]);
  // 地面、陰影、鏡頭範圍一律用「沒翻之前」的位置算（翻完外框不變 → 翻轉不會讓整台浮起來或沉下去）
  Object.keys(objs).forEach(k => { objs[k].position.copy(T0[k][0]); objs[k].quaternion.copy(T0[k][1]); });
  finDimPlace(st, T0);
  const hp = placement();
  Object.keys(objs).forEach(k => { objs[k].position.copy(T[k][0]); objs[k].quaternion.copy(T[k][1]); });
  if (instant || reduceMotion) { holder.position.copy(hp); tween = null; }   // 直接到位：還在跑的動畫一起停掉（不然會把零件拉回舊的目標）
  else {
    Object.keys(objs).forEach(k => { objs[k].position.copy(from[k][0]); objs[k].quaternion.copy(from[k][1]); });
    // 組裝／爆炸「只切換翻轉」→ 每一件都繞同一個整組中心轉（轉的途中也不會互相穿插）；其他（換狀態、換部件組合）→ 各自的中心
    const turn = st !== 'flat' && st === applied.st && !!state.pflip !== applied.flip, pv = turn ? flipPivot(T0) : null;
    const cen = {}; Object.keys(objs).forEach(k => { cen[k] = pv ? pv.clone().sub(from[k][0]).applyQuaternion(from[k][1].clone().invert()) : partCenter(k); });
    tween = { t0: performance.now(), dur: 900, objs, from, to: T, cen, h0: holder.position.clone(), h1: hp };
  }
  applied = { st, flip: !!state.pflip };
  ROOT.querySelectorAll('[data-state]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.state === st)));
  $('t-flip').disabled = st !== 'flat'; $('t-up').disabled = st === 'flat'; $('t-sec').disabled = st === 'flat';
  if (st === 'flat' && SEC.on) secToggle(false);
  updateVis();
}
/* 目前（目標）狀態的外框 → holder 位置、地面接觸陰影、主光陰影範圍 */
const lastHP = new THREE.Vector3();
const PARTS = () => ({ fil: FIL, shd: SHD, pcb: PCB, hsk: HSK });
/* 只看一個部件：其他三件藏起來；鏡頭對焦用的是這一件在目前狀態（組裝／爆炸／攤開）的最終位置 */
function applySolo() {
  const m = PARTS(), objs = [HSK, PCB, SHD, FIL];
  Object.keys(m).forEach(k => { if (m[k]) m[k].visible = !state.solo || state.solo.includes(k); });
  contacts.forEach((c, i) => { if (c.userData.base != null) c.visible = c.userData.base && !!objs[i] && objs[i].visible; });
  ROOT.querySelectorAll('[data-solo]').forEach(b => { const k = b.dataset.solo; b.setAttribute('aria-pressed', String(k ? !!state.solo && state.solo.includes(k) : !state.solo)); });
  pflipPaint(); updateVis();
}
function soloBox() {
  if (!state.solo || !rru) return null;
  const m = PARTS(), T = targets(state.st), hp0 = holder.position.clone(), saved = [];
  holder.position.copy(lastHP);
  state.solo.forEach(k => { const o = m[k]; if (!o || !T[k]) return; saved.push([o, o.position.clone(), o.quaternion.clone()]); o.position.copy(T[k][0]); o.quaternion.copy(T[k][1]); });
  holder.updateMatrixWorld(true);
  const b = new THREE.Box3(); saved.forEach(([o]) => b.expandByObject(o));      // 複選 → 選到的部件合起來的外框
  holder.position.copy(hp0); saved.forEach(([o, p, q]) => { o.position.copy(p); o.quaternion.copy(q); }); holder.updateMatrixWorld(true);
  return b.isEmpty() ? null : b;
}
function placement() {
  holder.rotation.set(0, 0, state.upright ? Math.PI / 2 : 0);
  const hp0 = holder.position.clone(); holder.position.set(0, 0, 0); holder.updateMatrixWorld(true);
  const dv = dimsA.visible; dimsA.visible = false;
  const b = new THREE.Box3(); [HSK, PCB, SHD, FIL].forEach(o => b.expandByObject(o));
  dimsA.visible = dv;
  const hp = V(-(b.min.x + b.max.x) / 2, -b.min.y + (state.upright ? 24 : 0), -(b.min.z + b.max.z) / 2);
  if (dimsA) dimsA.children.forEach(g => { g.userData.box = new THREE.Box3().setFromObject(g).translate(hp); });
  b.translate(hp); bbox.copy(b); bbox.getCenter(center); radius = bbox.getSize(new THREE.Vector3()).length() / 2;
  holder.position.copy(hp0);
  const objs = [HSK, PCB, SHD, FIL];
  contacts.forEach((c, i) => {
    const bb = new THREE.Box3().expandByObject(objs[i]).translate(hp);   // 物件世界座標是在 holder 歸零時算的 → 加上最終位置
    if (bb.isEmpty()) { c.visible = false; return; }
    const s = bb.getSize(new THREE.Vector3()), low = bb.min.y < 6 + (state.upright ? 24 : 0);
    c.visible = state.st === 'flat' ? true : i === 0;
    c.userData.base = null;
    if (state.st !== 'flat' && i === 0) { const s2 = bbox.getSize(new THREE.Vector3()); c.scale.set(s2.x * 1.5, s2.z * 1.5, 1); c.position.set(center.x, 0.2, center.z); }
    else { c.scale.set(s.x * 1.35, s.z * 1.35, 1); c.position.set((bb.min.x + bb.max.x) / 2, 0.2, (bb.min.z + bb.max.z) / 2); c.visible = c.visible && low; }
    c.userData.base = c.visible; c.visible = c.visible && objs[i].visible;
  });
  const d = radius * 3;
  key.position.set(center.x + d * 0.7, center.y + d * 1.25, center.z + d * 0.55); key.target.position.copy(center);
  const sc = key.shadow.camera; sc.left = sc.bottom = -radius * 1.25; sc.right = sc.top = radius * 1.25; sc.near = 1; sc.far = d * 4; sc.updateProjectionMatrix();
  rimA.position.set(center.x - d * 0.3, center.y + d * 0.55, center.z - d);
  rimB.position.set(center.x - d, center.y + d * 0.35, center.z - d * 0.2);
  lastHP.copy(hp);
  return hp;
}
function updateVis() {
  if (!dimsA) return;
  dimsA.visible = state.dims && state.st === 'asm' && !state.upright && !SEC.on && !state.solo;
  $('stackup').hidden = !SEC.on; if (SEC.on) fillStackup();
  dimsF.forEach(d => d.visible = state.dims && state.st === 'flat' && stage.clientWidth >= 640 && !state.pflip);   // 翻面後，標註貼的那一面朝下 → 不顯示
  titles.forEach(t => { t.visible = state.st === 'flat'; const x = t.userData.txt; if (x) t.element.innerHTML = x[state.pflip ? 1 : 0]; });
  if (titles[2]) titles[2].element.innerHTML = '③ PCB<small>' + (state.pflip ? '翻面 · ' : '') + (state.flip !== !!state.pflip ? '濾波器側朝上 · 射頻元件（銅塊凸台）' : 'HSK 側朝上 · 貼在基板內側的那一面') + '</small>';
  vcLabels();
  updateTags();
  hidebarPlace();
}

const VIEWS = {
  iso:   { d: V(-0.95, 0.95, 1.25) },
  io:    { d: V(-1, 0.32, 0.12) },
  flat:  { d: V(-0.5, 1, 0.02) },
  exp:   { d: V(-1.05, 0.62, 1.3) },
  secz:  { d: V(0.18, 0.2, 1) },
  secx:  { d: V(1, 0.2, -0.18) },
  // 正視（跟一般 CAD 一樣：世界座標的六個方向，正交投影）。前＝長邊側面，左＝I/O 端，上＝鰭片側
  front: { d: V(0, 0, 1), std: 1 }, back: { d: V(0, 0, -1), std: 1 },
  left:  { d: V(-1, 0, 0), std: 1 }, right: { d: V(1, 0, 0), std: 1 },
  top:   { d: V(0, 1, 0), up: V(0, 0, -1), std: 1 }, bottom: { d: V(0, -1, 0), up: V(0, 0, 1), std: 1 },
};
let curView = 'iso', frameSize = null;               // frameSize＝上次對焦時的畫面大小（畫面變大／變小時據此重新對焦）
let viewRoll = 0;                                    // 正視圖轉了幾個 90°（順時針，畫面上看）：只在正視圖有意義；換視角、自己轉過／平移／縮放就歸零
function fitDist(dir, tgt, box, fill = 0.8) {       // 依視窗長寬比，把外框的 8 個角都放進畫面（fill＝佔畫面比例）
  const cam = camera.clone(); cam.aspect = camera.aspect; cam.up.set(0, 1, 0); cam.updateProjectionMatrix();
  const pts = []; for (let i = 0; i < 8; i++) pts.push(V(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z));
  let d = radius * 3;
  for (let it = 0; it < 6; it++) {
    cam.position.copy(tgt).addScaledVector(dir, d); cam.lookAt(tgt); cam.updateMatrixWorld(true);
    let m = 0.05; pts.forEach(p => { const q = p.clone().project(cam); m = Math.max(m, Math.abs(q.x), Math.abs(q.y)); });
    d *= Math.pow(m / fill, 0.9);
  }
  return d;
}
/* 畫面上被工具列（上）、視角方塊（右）、提示列（下）蓋住的寬度（px）：正交對焦時把模型放在剩下那塊的正中間。視窗太小就不避 */
function safeInsets() {
  const sr = stage.getBoundingClientRect(), o = { t: 0, r: 0, b: 0, W: sr.width, H: sr.height };
  ROOT.querySelectorAll('.tools .tgrp').forEach(e => { const q = e.getBoundingClientRect(); if (q.height) o.t = Math.max(o.t, q.bottom - sr.top + 6); });
  const v = $('vcube').getBoundingClientRect(); if (v.width) o.r = Math.max(0, sr.right - v.left + 6);
  ['hint', 'selbar', 'pname', 'hidebar'].forEach(id => { const h = $(id); if (!h.hidden) { const q = h.getBoundingClientRect(); if (q.height) o.b = Math.max(o.b, sr.bottom - q.top + 4); } });
  if (o.W - o.r < o.W * 0.6) o.r = 0;
  if (o.H - o.t - o.b < o.H * 0.6) o.t = o.b = 0;
  return o;
}
/* 透視：一樣把外框放進「沒被面板蓋住」的那塊正中間（工具放進工具的分頁後畫面變窄，右側視角方塊會蓋到尺寸標註） */
function fitPersp(dir, up, box, ctr, fill = 0.8) {
  const s = safeInsets();
  if (!s.W || !s.H || !(s.r || s.t || s.b)) return { d: fitDist(dir, ctr, box, fill), tgt: ctr.clone() };
  const fx = (s.W - s.r) / s.W, fy = (s.H - s.t - s.b) / s.H;
  const cam = camera.clone(); cam.aspect = camera.aspect; cam.up.copy(up); cam.updateProjectionMatrix();
  const pts = []; for (let i = 0; i < 8; i++) pts.push(V(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z));
  let d = radius * 3;
  for (let it = 0; it < 6; it++) {
    cam.position.copy(ctr).addScaledVector(dir, d); cam.lookAt(ctr); cam.updateMatrixWorld(true);
    let m = 0.05; pts.forEach(p => { const q = p.clone().project(cam); m = Math.max(m, Math.abs(q.x) / fx, Math.abs(q.y) / fy); });
    d *= Math.pow(m / fill, 0.9);
  }
  const f = dir.clone().negate(), r = new THREE.Vector3().crossVectors(f, up).normalize(), u = new THREE.Vector3().crossVectors(r, f).normalize();
  const wpp = 2 * d * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / s.H;
  return { d, tgt: ctr.clone().addScaledVector(r, s.r / 2 * wpp).addScaledVector(u, (s.t - s.b) / 2 * wpp) };
}
/* 正交：外框投影到畫面左右／上下的半寬 → 每像素幾 mm → 主相機距離（正交畫面＝焦點平面大小）；看的點往避開面板的方向挪 */
function fitOrtho(dir, up, box, ctr, fill = 0.9) {
  const f = dir.clone().negate(), r = new THREE.Vector3().crossVectors(f, up).normalize(), u = new THREE.Vector3().crossVectors(r, f).normalize();
  let ex = 1, ey = 1;
  for (let i = 0; i < 8; i++) { const p = V(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).sub(ctr); ex = Math.max(ex, Math.abs(p.dot(r))); ey = Math.max(ey, Math.abs(p.dot(u))); }
  const tn = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)), s = safeInsets();
  if (!s.W || !s.H) return { d: Math.max(ey, ex / camera.aspect) / fill / tn, tgt: ctr.clone() };
  const wpp = Math.max(2 * ey / (fill * (s.H - s.t - s.b)), 2 * ex / (fill * (s.W - s.r)));
  return { d: wpp * s.H / (2 * tn), tgt: ctr.clone().addScaledVector(r, s.r / 2 * wpp).addScaledVector(u, (s.t - s.b) / 2 * wpp) };
}
function frame(view, instant, dur) {
  const v = VIEWS[view] || VIEWS.iso, std = !!v.std;
  const dir = (!std && state.upright ? (VIEWS_UP[view] || VIEWS_UP.iso) : v.d).clone().normalize(), up = (v.up || V(0, 1, 0)).clone();
  if (!std) viewRoll = 0; else if (viewRoll) up.applyAxisAngle(dir, viewRoll * Math.PI / 2);   // 右旋一次＝上方向繞視線（朝向相機）轉 +90° → 畫面順時針轉
  if (std && !ORTHO) setProjection(true);                                  // 正視＝正交
  else if ((view === 'iso' || view === 'io') && ORTHO) setProjection(false);  // 回到透視的預設視角
  const box = soloBox() || ((std || portrait()) && dimsBox(dir)) || bbox, ctr = box.getCenter(new THREE.Vector3());   // 只看一個部件 → 對焦那一件；正視或直式畫面 → 連尺寸標註一起放進畫面
  const fo = ORTHO ? fitOrtho(dir, up, box, ctr, std ? 0.9 : 0.8) : fitPersp(dir, up, box, ctr, /^sec/.test(view) ? 0.9 : 0.8);
  const toPos = fo.tgt.clone().addScaledVector(dir, fo.d), toTgt = fo.tgt.clone();
  curView = view; markViews(); frameSize = [stage.clientWidth, stage.clientHeight];
  if (instant || reduceMotion) { camera.position.copy(toPos); camera.up.copy(up); controls.target.copy(toTgt); controls.update(); return; }
  camTween = { t0: performance.now(), dur: dur || 900, p0: camera.position.clone(), t0v: controls.target.clone(), p1: toPos, t1: toTgt, u0: camera.up.clone(), u1: up };
}
/* 左旋／右旋 90°（q＝−1 逆時針、＋1 順時針，畫面上看）：
   正視圖＝記住轉向（viewRoll）、依轉過去的方向重新對焦（畫面大小變了照樣保持）；再按一次同一個正視圖按鈕＝回到原本方向。
   其他視角（等角、自己轉過／平移過）＝原地繞視線轉，不重新對焦；轉過就不是那個預設視角了（跟平移一樣，按鈕不再亮） */
function rollView(q) {
  if (!rru) return;
  if (curView && VIEWS[curView] && VIEWS[curView].std) { viewRoll = (viewRoll + q + 4) % 4; frame(curView, false, 450); return; }
  const tw = camTween, p = tw ? tw.p1 : camera.position, t = tw ? tw.t1 : controls.target, u = tw ? tw.u1 : camera.up;
  const u1 = u.clone().applyAxisAngle(p.clone().sub(t).normalize(), q * Math.PI / 2);
  if (curView) { curView = null; viewRoll = 0; markViews(); }
  if (reduceMotion) { camTween = null; camera.position.copy(p); controls.target.copy(t); camera.up.copy(u1); controls.update(); return; }
  camTween = { t0: performance.now(), dur: 450, p0: camera.position.clone(), t0v: controls.target.clone(), p1: p.clone(), t1: t.clone(), u0: camera.up.clone(), u1 };
}
/* 組裝狀態顯示尺寸時：機體外框＋這個方向看得到的尺寸線（跟視線平行的會縮成一個點，不算、也不顯示） */
const DIM_EDGE = 0.85;
function dimsBox(dir) {
  if (!dimsA || !(state.dims && state.st === 'asm' && !state.upright && !SEC.on && !state.solo)) return null;
  const b = bbox.clone();
  dimsA.children.forEach(g => { if (g.userData.box && Math.abs(g.userData.dimDir.dot(dir)) < DIM_EDGE) b.union(g.userData.box); });
  return b;
}
function dimsFacing() {
  if (!dimsA || !dimsA.visible) return;
  const d = camera.position.clone().sub(controls.target).normalize().applyQuaternion(holder.quaternion.clone().invert());
  dimsA.children.forEach(g => { if (g.userData.dimDir) g.visible = Math.abs(g.userData.dimDir.dot(d)) < DIM_EDGE; });
}
function markViews() {
  ROOT.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === curView)));
  ROOT.querySelectorAll('.vc-f').forEach(b => b.classList.toggle('on', b.dataset.std === curView));
  ROOT.querySelectorAll('.vc-cross [data-std]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.std === curView)));
}
/* 平移：畫面往箭頭方向移（相機反方向移動），一次移可視高度的 12%；◎＝回到中心（角度與遠近不變） */
function panView(dx, dy) {
  const t = controls.target, d = camera.position.distanceTo(t), h = 2 * d * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const mv = V(1, 0, 0).applyQuaternion(camera.quaternion).multiplyScalar(-dx * 0.12 * h).add(V(0, 1, 0).applyQuaternion(camera.quaternion).multiplyScalar(-dy * 0.12 * h));
  camTween = null; camera.position.add(mv); t.add(mv); controls.update();
  if (curView) { curView = null; viewRoll = 0; markViews(); }        // 平移過就不是預設視角了
}
function recenter() {
  const dir = camera.position.clone().sub(controls.target).normalize(), box = soloBox() || (ORTHO && dimsBox(dir)) || bbox;   // 跟對焦同一套：正交才把尺寸標註算進去
  let aim = box.getCenter(new THREE.Vector3());
  {                                                       // 跟對焦同一套：避開工具列與視角方塊
    const s = safeInsets(), wpp = 2 * camera.position.distanceTo(controls.target) * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / (s.H || 1);
    aim.addScaledVector(V(1, 0, 0).applyQuaternion(camera.quaternion), s.r / 2 * wpp).addScaledVector(V(0, 1, 0).applyQuaternion(camera.quaternion), (s.t - s.b) / 2 * wpp);
  }
  const mv = aim.sub(controls.target);
  camTween = null; camera.position.add(mv); controls.target.add(mv); controls.update();
}

/* ── 顯示模式 ── */
let XR = null;
function xrMats() {
  if (XR) return XR;
  const xr = MAT.powder.clone(); xr.transparent = true; xr.opacity = 0.12; xr.depthWrite = false; xr.side = THREE.DoubleSide;
  const xrRaw = MAT.alRaw.clone(); xrRaw.transparent = true; xrRaw.opacity = 0.12; xrRaw.depthWrite = false; xrRaw.side = THREE.DoubleSide;
  const xf = MAT.powderFin.clone(); xf.transparent = true; xf.opacity = 0.26; xf.depthWrite = false;
  const xs = MAT.shd.clone(); xs.transparent = true; xs.opacity = 0.16; xs.depthWrite = false; xs.side = THREE.DoubleSide;
  return (XR = { xr, xrRaw, xf, xs });
}
function applyModeTo(root) {
  const m = state.mode, { xr, xrRaw, xf, xs } = xrMats();
  root.traverse(o => {
    if ((!o.isMesh && !o.isInstancedMesh) || o.userData.secHelper) return;
    const u = o.userData, k = u.kind, real = u.mat || o.material;
    let mat = real;
    if (m === 'therm') {
      if (k === 'fin' || u.therm === 'x') mat = MAT.therm;
      else if (k === 'comp' || k === 'ghost') { const lv = marginLevel(u.inst && u.inst.row.margin); mat = lv ? LV_MAT[MARGIN_LEVELS.indexOf(lv)] : MAT.grey; }
      else if (k === 'pcb') mat = MAT.greyDk;
      else if (k === 'tim') mat = real;
      else mat = MAT.grey;
    } else if (m === 'xray') {
      if (k === 'shell') mat = Array.isArray(real) ? real.map(x => x === MAT.powder ? xr : xrRaw) : xr;
      else if (k === 'shellF') mat = xr;
      else if (k === 'shield') mat = Array.isArray(real) ? real.map(() => xs) : xs;
      else if (k === 'fin') mat = xf;
    }
    o.material = mat;
    if (k === 'hole') o.visible = m !== 'xray';
  });
}
function applyMode() {
  const m = state.mode;
  scene.background = m === 'therm' ? bgDark : bgLight;
  floor.material.opacity = m === 'therm' ? 0.4 : 0.28;
  applyModeTo(rru);
  ROOT.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === m)));
  $('legend').hidden = m !== 'therm';
  if (m === 'therm') fillLegend();
  $('hint').classList.toggle('dark', m === 'therm');
  gtao.blendIntensity = m === 'xray' ? 0.35 : 1;
}
function fillLegend() {
  const g = P.g, lo = T_LO, hi = T_HI, tip = finT(g.Btm, P.r.FH), x = v => ((v - lo) / (hi - lo) * 100).toFixed(1) + '%';
  $('lg-bar').style.background = rampCss();
  $('lg-bar').innerHTML = '<i class="lg-mk" style="left:' + x(P.r.T_base) + '" title="基板（PCB 底部）"></i><i class="lg-mk" style="left:' + x(tip) + '" title="鰭尖（底部）"></i>';
  $('lg-ticks').innerHTML = '<span class="l" style="left:0">' + lo.toFixed(0) + ' °C</span><span style="left:50%">' + ((lo + hi) / 2).toFixed(0) + '</span><span class="r" style="left:100%">' + hi.toFixed(1) + '</span>';
  $('lg-kv').innerHTML = '<dt>基板 底→頂</dt><dd>' + P.r.T_base.toFixed(1) + ' → ' + hi.toFixed(1) + '</dd><dt>鰭尖（底部）</dt><dd>' + tip.toFixed(1) + '</dd>';
  $('lg-lv').innerHTML = MARGIN_LEVELS.map(l => '<span style="background:' + l.mk + '">' + l.label + '</span>').join('');
}

/* ── 剖面（CAD 式剖切：模板緩衝補出實心切面＋疊層） ── */
const SEC = { on: false, axis: 'x', pos: null, helpers: [], caps: [] };
const secLocal = new THREE.Plane(), secWorld = new THREE.Plane();
function stencilMat(side, op) {
  return new THREE.MeshBasicMaterial({ depthWrite: false, depthTest: false, colorWrite: false, stencilWrite: true, stencilFunc: THREE.AlwaysStencilFunc, side, stencilFail: op, stencilZFail: op, stencilZPass: op });
}
const ST_BACK = stencilMat(THREE.BackSide, THREE.IncrementWrapStencilOp), ST_FRONT = stencilMat(THREE.FrontSide, THREE.DecrementWrapStencilOp);
function hatchTex(bg, fg) {
  const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
  x.fillStyle = bg; x.fillRect(0, 0, 64, 64); x.strokeStyle = fg; x.lineWidth = 4;
  for (let i = -64; i < 128; i += 16) { x.beginPath(); x.moveTo(i, 64); x.lineTo(i + 64, 0); x.stroke(); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; return t;
}
const SEC_GROUPS = [   // 依序畫，後畫的蓋住先畫的（銅塊蓋在 PCB 上、元件蓋在最上）
  { k: 'fil', bg: '#ece8dc', fg: '#d6d0bf' }, { k: 'shd', bg: '#dfe6ee', fg: '#bfcad6' }, { k: 'al', bg: '#bcc3cb', fg: '#a2abb5' },
  { k: 'pcb', bg: '#2f7a52', fg: '#27694a' }, { k: 'cu', bg: '#d08b56', fg: '#bb7646' }, { k: 'comp', bg: '#40444b', fg: '#33363c' }];
const CAP = 4000, capMats = {};
SEC_GROUPS.forEach(gp => { const t = hatchTex(gp.bg, gp.fg); t.repeat.set(CAP / 20, CAP / 20);
  capMats[gp.k] = new THREE.MeshBasicMaterial({ map: t, side: THREE.DoubleSide, stencilWrite: true, stencilRef: 0, stencilFunc: THREE.NotEqualStencilFunc,
    stencilFail: THREE.ReplaceStencilOp, stencilZFail: THREE.ReplaceStencilOp, stencilZPass: THREE.ReplaceStencilOp }); });
function secClear() {
  SEC.helpers.forEach(h => h.parent && h.parent.remove(h)); SEC.helpers = [];
  SEC.caps.forEach(c => { holder.remove(c); c.geometry.dispose(); }); SEC.caps = [];
}
function secBuild() {
  secClear();
  let order = -100;
  SEC_GROUPS.forEach(gp => {
    const ms = []; rru.traverse(o => { if ((o.isMesh || o.isInstancedMesh) && o.userData.sec === gp.k && !o.userData.secHelper) ms.push(o); });
    ms.forEach(m => [ST_BACK, ST_FRONT].forEach(mat => {
      let h;
      if (m.isInstancedMesh) { h = new THREE.InstancedMesh(m.geometry, mat, m.count); h.instanceMatrix = m.instanceMatrix; }
      else h = new THREE.Mesh(m.geometry, mat);
      h.renderOrder = order; h.userData = { secHelper: true }; h.raycast = () => {};
      m.add(h); SEC.helpers.push(h);
    }));
    const cap = new THREE.Mesh(new THREE.PlaneGeometry(CAP, CAP), capMats[gp.k]);
    cap.renderOrder = order + 1; cap.userData = { secHelper: true }; cap.raycast = () => {};
    cap.onAfterRender = r => r.clearStencil();
    holder.add(cap); SEC.caps.push(cap);
    order += 2;
  });
  fillStackup();
  secPlace();
}
function secDefault() {
  const o = LAY.inst.find(q => q.row.name === P.r.bn) || null;
  return o ? (SEC.axis === 'z' ? o.z : o.x) : (SEC.axis === 'z' ? P.r.W / 2 : P.r.L / 2);
}
function secPlace() {
  const max = SEC.axis === 'z' ? P.r.W : P.r.L;
  if (SEC.pos == null || SEC.pos <= 0 || SEC.pos >= max) SEC.pos = secDefault();
  const c = SEC.pos;
  if (SEC.axis === 'z') secLocal.set(V(0, 0, -1), c); else secLocal.set(V(-1, 0, 0), c);
  SEC.caps.forEach(cap => { cap.rotation.set(0, SEC.axis === 'z' ? 0 : Math.PI / 2, 0);
    if (SEC.axis === 'z') cap.position.set(P.r.L / 2, 0, c - 0.05); else cap.position.set(c - 0.05, 0, P.r.W / 2); });
  if (SEC.on) { holder.updateMatrixWorld(true); secWorld.copy(secLocal).applyMatrix4(holder.matrixWorld); renderer.clippingPlanes = [secWorld]; }
  const inp = $('sec-pos'); inp.max = max; inp.value = c;
  const near = LAY.inst.filter(o => Math.abs((SEC.axis === 'z' ? o.z : o.x) - c) < (SEC.axis === 'z' ? o.fpW : o.fpL) / 2).map(o => o.row.name);
  $('sec-val').textContent = (SEC.axis === 'z' ? '距左側 ' : '距底端 ') + f1(c) + ' mm' + (near.length ? ' · 切過 ' + [...new Set(near)].slice(0, 2).join('、') : '');
  ROOT.querySelectorAll('[data-sax]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.sax === SEC.axis)));
  updateVis();
}
/* 疊層（由上到下）：剖面旁的 2D 面板，色塊＝切面的斜線顏色；寫出每一段的來源 */
function fillStackup() {
  const g = P.g, r = P.r, tP = g.t_PCB || 2, H = g.H_filter + g.H_shield + g.t_base + r.FH, L = LAY, S = L.shd.S;
  const hatch = k => { const gp = SEC_GROUPS.find(q => q.k === k); return gp ? 'repeating-linear-gradient(135deg,' + gp.bg + ' 0 4px,' + gp.fg + ' 4px 6px)' : 'transparent'; };
  const rows = [
    ['al', '鰭片', f1(r.FH), '計算結果', 'param'],
    ['al', '基板（凹槽＋補肉）', g.t_base, 't_base' + (L.bosses.length ? ' · 補肉 ' + L.bosses.length + ' 處' : ''), 'param'],
    ['pcb', 'PCB（貼基板）', tP, '板厚', 'param'],
    [S.on ? 'shd' : '', S.on ? '屏蔽罩' : '濾波器側空間', f1(L.df), 'H_shield − 板厚' + (S.on ? ' · 頂板 ' + S.roof : ''), 'auto'],
    ['fil', '濾波器（含調諧螺絲）', g.H_filter, 'H_filter', 'param']];
  if (state.pflip) rows.reverse();   // 翻轉中（剖面只在組裝／爆炸）：整組上下顛倒 → 清單也照畫面由上往下
  $('stackup').innerHTML = '<h3>疊層（上 → 下' + (state.pflip ? '，翻轉中' : '') + '）</h3>' + rows.map(([k, n, v, src, t]) =>
    '<div class="su-row"><i style="background:' + (k ? hatch(k) : 'transparent') + (k ? '' : ';border:1px dashed var(--t-prov)') + '"></i><span>' + n + '</span><b>' + v + '</b><em class="' + t + '">' + src + '</em></div>').join('') +
    '<div class="su-sum">內腔 H_shield ' + g.H_shield + ' ＝ ' + (S.on ? '屏蔽罩 ' : '') + f1(L.df) + ' ＋ PCB ' + tP + '</div><div class="su-sum">整機高 H ' + f1(H) + ' mm</div>';
}
function secToggle(on) {
  if (on && state.st === 'flat') applyState('asm');
  SEC.on = on; $('t-sec').setAttribute('aria-pressed', String(on)); $('secbar').hidden = !on;
  if (on) { secBuild(); gtao.enabled = false; frame(SEC.axis === 'z' ? 'secz' : 'secx'); }
  else { secClear(); renderer.clippingPlanes = []; gtao.enabled = true; }
  floor.visible = !on; contacts.forEach(c => { c.material.opacity = on ? 0 : 1; });
  updateVis();
}

/* ── 側欄 ── */
const TAGS = { param: '參數', data: '元件表', ait: 'AI-Thermal', deco: '示意', prov: '暫定', edit: '可編輯' };
const tg = k => '<span class="tag ' + k + '">' + TAGS[k] + '</span>';
let TAB = 'comp';
function setTab(t) {
  TAB = t;
  ROOT.querySelectorAll('[data-tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === t)));
  ['comp', 'io', 'ant', 'shd', 'asm', 'model'].forEach(k => { $('pn-' + k).hidden = k !== t; });
  updateTags();
}
function renderPanels() { renderComp(); renderPorts('io'); renderPorts('ant'); renderShd(); renderAsm(); refreshPanels(); }
function refreshPanels() {
  if (compSig() !== COMP_SIG) renderComp();
  ['io', 'ant'].forEach(k => { if (portSig(k) !== PORT_SIG[k]) renderPorts(k); });
  refreshComp(); refreshPorts('io'); refreshPorts('ant'); refreshShd(); refreshAsm(); buildTree(); fillPanels();
}
/* 清單的列不一樣才重畫（只改數值不重畫，輸入中不跳）：
   元件（名稱×數量）—— 同一個專案在工具裡新增／刪除／改名／改數量後回到 3D 頁；
   I/O、天線座（id＋類型、順序）—— 例：資料庫的專案被別人改過、重新載入同一個專案 */
let COMP_SIG = '';
const PORT_SIG = { io: '', ant: '' };
const compSig = () => LAY ? [...new Set(LAY.inst.map(o => o.row))].map(r => r.name + '×' + r.qty).join('|') : '';
const portSig = kind => (kind === 'io' ? ioList() : antList()).map(it => it.id + ':' + it.type).join('|');

/* 元件位置表：元件相對高度＝元件設定的同一格（寫回、會重算；整列共用）；橫向＝元件中心距 PCB 左緣（只影響 3D）。
   橫向用 ◀ ▶ 調（按住連續、越按越快；Shift＝一步 10 mm），數字直接填目前位置（自動排的也填好），也可以直接打字、清空＝回到自動。
   多顆的列：◀ ▶ 整列一起平移；點「×4」展開，每一顆各自調、各自轉 */
const CEXP = new Set();
/* 👁：只在 3D 隱藏（不影響計算、不存檔）。按下（aria-pressed）＝藏起來 */
const EYE = '<svg class="e-on" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1.5 8s2.4-4.3 6.5-4.3S14.5 8 14.5 8s-2.4 4.3-6.5 4.3S1.5 8 1.5 8z"/><circle cx="8" cy="8" r="1.9"/></svg>' +
  '<svg class="e-off" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.8 5.6C2 6.6 1.5 8 1.5 8s2.4 4.3 6.5 4.3c1.1 0 2.1-.3 2.9-.8M6.2 3.9c.6-.1 1.2-.2 1.8-.2 4.1 0 6.5 4.3 6.5 4.3s-.5 1-1.4 2"/><path d="M2 2l12 12"/></svg>';
const eyeBtn = (cls, lab) => '<button type="button" class="ibtn eye ' + cls + '" aria-pressed="false" aria-label="在 3D 隱藏 ' + lab + '">' + EYE + '</button>';
function stepHtml(key, lab) {
  return '<div class="stp" data-key="' + esc(key) + '">' +
    '<button type="button" class="ibtn" data-hold="-1" title="往左（按住連續，Shift＝10 mm）" aria-label="' + lab + ' 往左">◀</button>' +
    '<input class="fld c-w" type="text" inputmode="decimal" autocomplete="off" aria-label="' + lab + ' 橫向位置 (mm，距 PCB 左緣)">' +
    '<button type="button" class="ibtn" data-hold="1" title="往右（按住連續，Shift＝10 mm）" aria-label="' + lab + ' 往右">▶</button></div>';
}
function renderComp() {
  const rows = [...new Set(LAY.inst.map(o => o.row))]; COMP_SIG = compSig();
  $('ctab').innerHTML = '<div class="ch"><span>元件</span><span title="＝元件設定的「元件相對高度」">相對高度</span><span>橫向（距左緣）</span><span></span><span></span></div>' + rows.map(r => {
    const n = esc(r.name), multi = r.qty > 1;
    return '<div class="cr" data-row="' + n + '"><span class="cn">' + eyeBtn('c-eye', n) + '<b title="' + n + '">' + n + '</b><small></small></span>' +
      '<input class="fld c-h" type="number" step="1" inputmode="decimal" aria-label="' + n + ' 元件相對高度 (mm)，寫回元件設定">' +
      (multi ? '<div class="stp" data-row-all="' + n + '">' +
          '<button type="button" class="ibtn" data-hold="-1" title="' + r.qty + ' 顆一起往左（按住連續，Shift＝10 mm）" aria-label="' + n + ' 整列往左">◀</button>' +
          '<button type="button" class="cx" aria-expanded="false" aria-label="' + n + ' 展開每一顆">×' + r.qty + ' ▾</button>' +
          '<button type="button" class="ibtn" data-hold="1" title="' + r.qty + ' 顆一起往右（按住連續，Shift＝10 mm）" aria-label="' + n + ' 整列往右">▶</button></div>'
        : stepHtml(r.name + '#0', n)) +
      '<button type="button" class="ibtn c-rot" aria-pressed="false" aria-label="' + n + ' 水平轉 90°">⟳</button>' +
      '<button type="button" class="ibtn c-r" title="橫向回到自動、元件相對高度回到原值、取消旋轉" aria-label="重設 ' + n + '">↺</button></div>' +
      (multi ? Array.from({ length: r.qty }, (_, i) => '<div class="cr sub" data-row="' + n + '" data-i="' + i + '" hidden><span class="cn">' + eyeBtn('c-eye1', n + ' 第 ' + (i + 1) + ' 顆') + '<b>#' + (i + 1) + '</b><small class="c-ch"></small></span><span></span>' +
        stepHtml(r.name + '#' + i, n + ' 第 ' + (i + 1) + ' 顆') +
        '<button type="button" class="ibtn c-rot1" aria-pressed="false" aria-label="' + n + ' 第 ' + (i + 1) + ' 顆水平轉 90°">⟳</button>' +
        '<button type="button" class="ibtn c-r1" title="這一顆：橫向回到自動、取消旋轉" aria-label="重設 ' + n + ' 第 ' + (i + 1) + ' 顆">↺</button></div>').join('') : '');
  }).join('');
}
function compRowInsts(name) { return LAY.inst.filter(o => o.row.name === name); }
function refreshComp() {
  const E = ed(), z0 = P.g.Left, warn = [];
  $('comp-cnt').textContent = LAY.inst.length + ' 顆';
  refreshPair();
  $('ctab').querySelectorAll('.cr:not(.sub)').forEach(row => {
    const name = row.dataset.row, list = compRowInsts(name); if (!list.length) return;
    const r = list[0].row, ih = row.querySelector('.c-h');
    const hChg = typeof E.hgt[name] === 'number', side = list[0].side, dt = dTemp(r), risk = bnRisk(r);
    if (document.activeElement !== ih) ih.value = hChg ? E.hgt[name] : r.hgt;
    ih.classList.toggle('chg', hChg);
    ih.title = (hChg ? '已改（原值 ' + r.hgt + ' mm）。' : '') + '＝元件設定的「元件相對高度」：改這格會寫回去並重算溫度' + (r.qty > 1 ? '（' + r.qty + ' 顆一起動）' : '');
    row.querySelector('.cn small').textContent = r.cat + ' ×' + r.qty + ' · ' + (side === 'hsk' ? 'HSK 側' : '濾波器側') +
      (hChg && r.W > 0 ? ' · 估 ' + (dt >= 0 ? '+' : '') + f1(dt) + ' °C' + (risk === 'new' ? ' · 會變瓶頸' : '') : '');
    const manN = list.filter(isManualZ).length, rotN = list.filter(o => o.rot).length, rb = row.querySelector('.c-rot'), isSfp = list[0].role === 'sfp';
    rb.disabled = isSfp; rb.setAttribute('aria-pressed', rotN && rotN === list.length ? 'true' : rotN ? 'mixed' : 'false');
    rb.title = isSfp ? 'SFP 插口一定朝 I/O 端，不能轉' : rotN === list.length ? '已轉 90°（再按一下轉回）' : rotN ? rotN + '/' + list.length + ' 顆已轉 · 按一下整列轉 90°' : '水平轉 90°（整列一起；展開後可以一顆一顆轉，或選一顆按 R）';
    row.querySelector('.c-r').disabled = !hChg && !manN && !rotN;
    const hidN = list.filter(o => HIDEI.has('c:' + o.key)).length, eye = row.querySelector('.c-eye');
    eye.setAttribute('aria-pressed', hidN && hidN === list.length ? 'true' : hidN ? 'mixed' : 'false'); row.classList.toggle('hid', hidN > 0 && hidN === list.length);
    eye.title = hidN === list.length ? '已在 3D 隱藏（再按一下顯示）' : hidN ? hidN + '/' + list.length + ' 顆已隱藏 · 按一下整列隱藏'
      : '在 3D 隱藏' + (list.length > 1 ? '（整列 ' + list.length + ' 顆；展開後可以一顆一顆藏）' : '') + '，不影響計算；選取後按 H 也可以';
    const multi = r.qty > 1, open = multi && CEXP.has(name);
    if (multi) {
      const cx = row.querySelector('.cx'); cx.setAttribute('aria-expanded', String(open)); cx.classList.toggle('chg', manN > 0);
      cx.title = (open ? '收合' : '展開，每一顆各自調') + '：' + list.map(o => '#' + (o.i + 1) + ' ' + f1(o.z - z0)).join('、') + ' mm';
    }
    row.classList.toggle('sel', !!SELK && SELK.startsWith('c:' + name + '#') && !open);
    $('ctab').querySelectorAll('.cr.sub[data-row="' + CSS.escape(name) + '"]').forEach(sr => {
      sr.hidden = !open; const o = list[+sr.dataset.i]; if (!o) return;
      const r1 = sr.querySelector('.c-rot1'); r1.disabled = isSfp; r1.setAttribute('aria-pressed', String(!!o.rot));
      r1.title = isSfp ? 'SFP 插口一定朝 I/O 端，不能轉' : o.rot ? '已轉 90°（再按一下轉回）' : '只轉這一顆 90°';
      sr.querySelector('.c-r1').disabled = !isManualZ(o) && !o.rot;
      sr.classList.toggle('sel', SELK === 'c:' + o.key);
      const hid1 = HIDEI.has('c:' + o.key), e1 = sr.querySelector('.c-eye1');
      e1.setAttribute('aria-pressed', String(hid1)); e1.title = hid1 ? '已在 3D 隱藏（再按一下顯示）' : '在 3D 隱藏這一顆'; sr.classList.toggle('hid', hid1);
      sr.querySelector('.c-ch').textContent = o.lane >= 0 ? 'CH' + (o.lane + 1) + (LAY.G && o.grp >= 0 ? ' ' + grpLabel(o.grp) : o.subN > 1 ? ' · ' + (o.sub + 1) + '/' + o.subN : '') : '';
    });
    if (list.some(o => o.src === 'manual' && o.overlap)) warn.push(name + ' 跟其他元件重疊');
  });
  // 橫向數字：自動排的也直接填好；手動改過的框線標出來
  $('ctab').querySelectorAll('.stp[data-key]').forEach(sp => {
    const o = LAY.inst.find(q => q.key === sp.dataset.key), inp = sp.querySelector('input'); if (!o || !inp) return;
    if (document.activeElement !== inp) { inp.value = f1(o.z - z0); inp.classList.remove('bad'); }
    const man = isManualZ(o); inp.classList.toggle('chg', man);
    inp.title = '元件中心距 PCB 左緣（mm）' + (o.port ? '。跟 ' + ioLabel(ioList().indexOf(o.port)) + ' 光口綁在一起：這裡改，I/O 端的光口一起動（光口距外殼左側 ' + f1(o.z) + '）'
      : man ? '。手動（清空或按 ↺ 回到自動）' : '。自動排（沿通道或板子中線）') + '。◀ ▶ 按住連續移動，Shift＝10 mm';
  });
  const scc = [...new Set((LAY.screws || []).flatMap(q => q.conf || []))];
  if (scc.length) warn.push(scc.join('、') + ' 太靠板邊，碰到螺絲柱的 PCB 缺口（往板內移一點）');
  const w = $('comp-warn'); w.hidden = !warn.length; w.textContent = warn.length ? '⚠ ' + warn.join('；') : '';
  const chg = P.rows.filter(r => typeof E.hgt[r.name] === 'number' && r.W > 0), est = $('comp-est');
  est.hidden = !chg.length;
  est.textContent = chg.length ? '溫度是估計值：只算改動那一列的局部溫度（元件相對高度 × ' + P.g.Slope + ' °C/mm）。放開後會完整重算；' +
    (chg.some(r => bnRisk(r)) ? '有元件會影響瓶頸 → 散熱器與體積也會跟著變。' : '瓶頸不變，體積不變。') : '';
}
function wireComp() {
  $('ctab').addEventListener('change', e => {
    const row = e.target.closest('.cr'); if (!row) return;
    const name = row.dataset.row, list = compRowInsts(name), r = list[0].row, E = ed();
    if (e.target.classList.contains('c-h')) {
      const v = parseFloat(e.target.value);
      if (!isFinite(v)) { e.target.value = typeof E.hgt[name] === 'number' ? E.hgt[name] : r.hgt; return; }
      if (Math.abs(v - r.hgt) < 1e-9) delete E.hgt[name]; else E.hgt[name] = v;
    } else if (e.target.classList.contains('c-w')) {           // 直接打數字（mm，距 PCB 左緣）；清空＝回到自動
      const key = e.target.closest('.stp').dataset.key, o = LAY.inst.find(q => q.key === key), t = selTarget('c:' + key), txt = e.target.value.trim(), v = parseFloat(txt);
      if (!o || !t) return;
      if (txt === '' || /^(自動|auto)$/i.test(txt)) lateralAuto(o);
      else if (!isFinite(v)) { e.target.classList.add('bad'); e.target.title = '請輸入數字（mm）：元件中心距 PCB 左緣；清空＝回到自動'; return; }
      else t.commit(t.clamp(P.g.Left + v), null);
      saveEdit(); rebuild(null, true);
      const o2 = LAY.inst.find(q => q.key === key); if (o2) { e.target.value = f1(o2.z - P.g.Left); e.target.classList.remove('bad'); }
      return;
    } else return;
    saveEdit(); rebuild(null, true);
  });
  $('ctab').addEventListener('pointerdown', e => {            // ◀ ▶ 按住連續（第一下立刻動）
    const b = e.target.closest('[data-hold]'); if (!b || e.button !== 0 || b.disabled) return;
    e.preventDefault();
    const sp = b.closest('.stp'), sign = +b.dataset.hold;
    if (sp.dataset.key) { select('c:' + sp.dataset.key, true); holdStart(b, e, selJob('c:' + sp.dataset.key, 'z', sign)); }
    else holdStart(b, e, rowJob(sp.dataset.rowAll, sign));
  });
  $('ctab').addEventListener('click', e => {
    const row = e.target.closest('.cr'); if (!row || !row.dataset.row) return;
    const name = row.dataset.row, E = ed(), list = compRowInsts(name); if (!list.length) return;
    if (e.target.closest('.eye')) {                           // 👁 在 3D 隱藏／顯示（整列或這一顆）
      const one = row.classList.contains('sub') ? list[+row.dataset.i] : null, ks = (one ? [one] : list).map(o => 'c:' + o.key);
      hideSet(ks, !ks.every(k => HIDEI.has(k))); return;
    }
    const hb = e.target.closest('[data-hold]');
    if (hb) {                                                 // 滑鼠／觸控由上面的「按住」處理；鍵盤（Enter、空白鍵）在這裡走一步
      if (e.detail === 0) { const sp = hb.closest('.stp'), sign = +hb.dataset.hold, j = sp.dataset.key ? selJob('c:' + sp.dataset.key, 'z', sign) : rowJob(sp.dataset.rowAll, sign); if (j) { j.step(e.shiftKey ? 10 : 1); j.done(); } }
      return;
    }
    if (e.target.closest('.cx')) { if (CEXP.has(name)) CEXP.delete(name); else CEXP.add(name); refreshComp(); return; }
    if (e.target.classList.contains('c-rot')) {             // 整列轉 90°（全部已轉 → 轉回）
      const all = list.every(o => o.rot); E.rot = Object.assign({}, E.rot);
      if (all) delete E.rot[name]; else E.rot[name] = Array.from({ length: list[0].row.qty }, () => 90);
      saveEdit(); rebuild(null, true); return;
    }
    if (e.target.classList.contains('c-r')) { delete E.posW[name]; delete E.hgt[name]; if (E.rot) delete E.rot[name]; list.forEach(o => { if (o.port) o.port.pos = null; }); saveEdit(); rebuild(null, true); return; }
    const sub = row.classList.contains('sub') ? list[+row.dataset.i] : null;
    if (sub && e.target.classList.contains('c-rot1')) { rotateKey('c:' + sub.key); return; }
    if (sub && e.target.classList.contains('c-r1')) {
      lateralAuto(sub);
      if (sub.rot) { const a = (E.rot[name] || []).slice(); a[sub.i] = 0; E.rot = Object.assign({}, E.rot, { [name]: a }); if (a.every(v => v !== 90)) delete E.rot[name]; }
      saveEdit(); rebuild(null, true); return;
    }
    if (e.target.closest('button') || e.target.tagName === 'INPUT') return;
    select('c:' + (sub ? sub.key : list[0].key));
  });
  ROOT.querySelectorAll('[data-pair]').forEach(b => b.addEventListener('click', () => {   // 通道配對開／關（關＝跟著專案存 layout3d.pair = false）
    const E = ed(), on = b.dataset.pair === '1'; if (on === (E.pair !== false)) return;
    if (on) delete E.pair; else E.pair = false;
    saveEdit(); rebuild(null, true);
  }));
}
/* 通道配對（FDD）的開關與說明：數量是通道數整數倍的 RF 元件、兩種以上的 Final PA 才出現 */
function refreshPair() {
  const PR = LAY.pair, box = $('pair'); box.hidden = !PR.avail; if (!PR.avail) return;
  ROOT.querySelectorAll('[data-pair]').forEach(b => b.setAttribute('aria-pressed', String((b.dataset.pair === '1') === PR.on)));
  const N = LAY.N, out = [];
  out.push(PR.fdd ? '偵測到 FDD：' + PR.pas.length + ' 種 Final PA（' + PR.pas.map(r => '<b>' + esc(bandOf(r.name) || r.name) + '</b>').join('、') + '）各 ' + N + ' 顆 → ' + N + ' 路。'
    : '通道數 ' + N + '（Final PA 數量）。');
  if (PR.multi.length) out.push(PR.multi.map(r => '<b>' + esc(r.name) + '</b> ×' + r.qty).join('、') + ' 是 ' + N + ' 路的整數倍 → ' +
    (PR.on ? '平均分到每一路，每一路 ' + [...new Set(PR.multi.map(r => r.qty / N))].join('／') + ' 顆並排' +
      (PR.fdd ? '（由左到右＝' + PR.pas.map((r, g) => esc(grpLabel(g))).join('、') + ' 那一組）' : '') + '；元件都在自己的「元件相對高度」上（跟溫度計算同一個位置）。'
      : '由板子中線往兩側排（通道配對已關閉）。'));
  if (PR.fdd) out.push(PR.on ? '每一種 PA 自成一條發射鏈：屏蔽罩腔體、往濾波器的盲插接頭每一路各 ' + PR.pas.length + ' 組。' : '屏蔽罩腔體、盲插接頭每一路一組（通道配對已關閉）。');
  $('pair-t').innerHTML = out.join('<br>');
}

/* 數位 I/O／天線座清單：類型、位置（距外殼左側）、◀▶ 微調、↑↓ 排序、✕ 刪除、＋新增 */
/* 類型下拉：I/O 依大類分組（SFP／電源、Signal、Debug port、其他）；存的類型不認得 → 補一個「（未知）」選項，不靜默改掉 */
function typeOpts(kind, sel) {
  const io = kind === 'io', types = io ? IO_TYPES : ANT_TYPES, opt = ([k, t]) => '<option value="' + k + '"' + (k === sel ? ' selected' : '') + '>' + t.n + '</option>';
  const unk = sel && !types[sel] ? '<option value="' + esc(sel) + '" selected>' + esc(sel) + '（未知）</option>' : '';
  return unk + (io ? IO_CLASS.map(([c, cn]) => '<optgroup label="' + cn + '">' + Object.entries(types).filter(([, t]) => t.c === c).map(opt).join('') + '</optgroup>').join('')
    : Object.entries(types).map(opt).join(''));
}
function renderPorts(kind) {
  const io = kind === 'io', list = io ? ioList() : antList(); PORT_SIG[kind] = portSig(kind);
  $(kind + '-list').innerHTML = list.map((it, i) => '<li data-i="' + i + '"><span class="pn"></span>' +
    '<select class="fld p-t" aria-label="第 ' + (i + 1) + ' 個的類型">' + typeOpts(kind, it.type) + '</select>' +
    '<span class="pbx"><button type="button" class="ibtn eye" data-a="h" aria-pressed="false" aria-label="在 3D 隱藏第 ' + (i + 1) + ' 個">' + EYE + '</button><button type="button" class="ibtn" data-a="u" title="順序往前" aria-label="順序往前"' + (i ? '' : ' disabled') + '>↑</button><button type="button" class="ibtn" data-a="d" title="順序往後" aria-label="順序往後"' + (i < list.length - 1 ? '' : ' disabled') + '>↓</button>' +
    '<button type="button" class="ibtn" data-a="x" title="刪除" aria-label="刪除">✕</button></span>' +
    '<div class="pl2"><span>橫向</span><input class="fld p-z" type="text" inputmode="decimal" autocomplete="off" aria-label="第 ' + (i + 1) + ' 個的橫向位置 (mm)">' +
    '<button type="button" class="ibtn" data-a="l" title="往左（按住連續，Shift＝10 mm）" aria-label="往左">◀</button><button type="button" class="ibtn" data-a="r" title="往右（按住連續，Shift＝10 mm）" aria-label="往右">▶</button>' +
    (io ? '<span></span><span>高度</span><input class="fld p-y" type="text" inputmode="decimal" autocomplete="off" aria-label="第 ' + (i + 1) + ' 個的高度 (mm)">' +
      '<button type="button" class="ibtn" data-a="dn" title="往下（按住連續，Shift＝10 mm）" aria-label="往下">▼</button><button type="button" class="ibtn" data-a="up" title="往上（按住連續，Shift＝10 mm）" aria-label="往上">▲</button>' : '') +
    '</div></li>').join('');
  $(kind + '-add-t').innerHTML = typeOpts(kind, null);
}
function refreshPorts(kind) {
  const io = kind === 'io', list = io ? ioList() : antList(), types = io ? IO_TYPES : ANT_TYPES, lab = io ? ioLabel : antLabel, lay = io ? ioLayout() : portsLayout(list, types);
  $(kind + '-cnt').textContent = list.length + ' 個';
  $(kind + '-list').querySelectorAll('li').forEach(li => {
    const p = lay[+li.dataset.i]; if (!p) return;
    li.querySelector('.pn').textContent = lab(p.i);
    const inp = li.querySelector('.p-z');
    if (document.activeElement !== inp) { inp.value = f1(p.z); inp.classList.remove('bad'); }
    inp.classList.toggle('chg', !p.auto);
    inp.title = '中心距外殼左側（mm）：' + (p.auto ? '自動等分' : '手動（清空＝回到自動）') + (io && p.it.type === 'sfp' && LAY.inst.some(o => o.port === p.it) ? '。PCB 上的 SFP 籠一起動' : '') + '。◀ ▶ 按住連續，Shift＝10 mm';
    if (io) {
      const iy = li.querySelector('.p-y');
      if (document.activeElement !== iy) { iy.value = p.lock ? f1(p.y) + ' 對齊籠' : f1(p.y); iy.classList.remove('bad'); }
      iy.readOnly = p.lock; iy.tabIndex = p.lock ? -1 : 0; iy.classList.toggle('ref', p.lock); iy.style.gridColumn = p.lock ? 'span 3' : '';
      iy.classList.toggle('chg', !p.lock && !p.yAuto);
      iy.title = p.lock ? 'SFP 光口的高度固定對齊 PCB 上的 SFP 籠（籠子多高，光口就在哪）' : '接頭中心距分模面（mm）：' + (p.yAuto ? '自動（端牆中間）' : '手動（清空＝回到自動）') + '；框超出端牆就自動補肉。▼ ▲ 按住連續，Shift＝10 mm';
      li.querySelectorAll('[data-a="dn"],[data-a="up"]').forEach(b => { b.hidden = p.lock; });
    }
    li.classList.toggle('sel', SELK === kind + ':' + p.it.id);
    const hid = HIDEI.has(kind + ':' + p.it.id), eb = li.querySelector('.eye');
    eb.setAttribute('aria-pressed', String(hid)); eb.title = hid ? '已在 3D 隱藏（再按一下顯示）' : '在 3D 隱藏這一個（不影響計算）'; li.classList.toggle('hid', hid);
  });
  const w = portWarnings(lay, lab), el = $(kind + '-warn');
  el.hidden = !w.length; el.textContent = w.length ? '⚠ ' + w.join('；') : '';
  if (io) {
    const nb = (LAY.bosses || []).filter(b => b.ports.length), note = $('io-note');
    note.hidden = !nb.length;
    note.textContent = nb.length ? '補肉：' + nb.map(b => { const q = bossSrc(b); return q.ports.join('、') + ' 的框超出端牆 → 端牆加高 ' + f1(b.h) + ' mm' + (q.comps.length ? '（跟 ' + q.comps.join('、') + ' 的補肉連成一塊）' : ''); }).join('；') : '';
  }
}
function wirePorts(kind) {
  const L = () => kind === 'io' ? ioList() : antList(), types = kind === 'io' ? IO_TYPES : ANT_TYPES;
  const done = (structural) => { saveEdit(); if (structural) renderPorts(kind); rebuild(null, true); };
  const fillBack = (inp, i, ax) => { const q = (kind === 'io' ? ioLayout() : portsLayout(L(), types))[i]; if (q) { inp.value = f1(ax === 'z' ? q.z : q.y); inp.classList.remove('bad'); } };   // 送出後填回目前的值
  $(kind + '-list').addEventListener('change', e => {
    const li = e.target.closest('li'); if (!li) return; const i = +li.dataset.i, it = L()[i];
    if (e.target.classList.contains('p-t')) { it.type = e.target.value; PORT_SIG[kind] = portSig(kind); done(false); }   // 下拉本身已經是新值 → 不重畫（鍵盤選的焦點不跳）
    else if (e.target.classList.contains('p-z')) {             // 直接打數字；清空＝回到自動
      const s = e.target.value.trim(), v = parseFloat(s), t = selTarget(kind + ':' + it.id);
      if (s === '' || /^(自動|auto)$/i.test(s)) it.pos = null; else if (isFinite(v)) it.pos = Math.round((t ? t.clamp(v) : v) * 2) / 2; else { e.target.classList.add('bad'); return; }
      done(false); fillBack(e.target, i, 'z');
    } else if (e.target.classList.contains('p-y')) {
      const s = e.target.value.trim(), v = parseFloat(s), t = selTarget(kind + ':' + it.id);
      if (s === '' || /^(自動|auto)$/i.test(s)) delete it.y; else if (isFinite(v)) it.y = Math.round((t && t.clampY ? t.clampY(v) : v) * 2) / 2; else { e.target.classList.add('bad'); return; }
      done(false); fillBack(e.target, i, 'y');
    }
  });
  $(kind + '-list').addEventListener('click', e => {
    const li = e.target.closest('li'); if (!li) return; const i = +li.dataset.i, list = L(), it = list[i];
    const a = e.target.closest('[data-a]') && e.target.closest('[data-a]').dataset.a;
    if (!a) { if (!/INPUT|SELECT/.test(e.target.tagName)) select(kind + ':' + it.id); return; }
    if (a === 'l' || a === 'r' || a === 'up' || a === 'dn') {   // 滑鼠／觸控由「按住連續」處理；鍵盤（Enter、空白鍵）在這裡走一步
      if (e.detail === 0) { const k = kind + ':' + it.id, j = selJob(k, a === 'l' || a === 'r' ? 'z' : 'v', a === 'r' || a === 'up' ? 1 : -1); if (j) { select(k, true); j.step(e.shiftKey ? 10 : 1); j.done(); } }
      return;
    }
    if (a === 'h') { const k = kind + ':' + it.id; hideSet([k], !HIDEI.has(k)); return; }
    if (a === 'u' && i > 0) { [list[i - 1], list[i]] = [list[i], list[i - 1]]; done(true); }
    else if (a === 'd' && i < list.length - 1) { [list[i + 1], list[i]] = [list[i], list[i + 1]]; done(true); }
    else if (a === 'x') { list.splice(i, 1); if (SELK === kind + ':' + it.id) SELK = null; done(true); }
  });
  $(kind + '-list').addEventListener('pointerdown', e => {    // ◀ ▶ ▼ ▲ 按住連續（第一下立刻動）
    const b = e.target.closest('[data-a]'); if (!b || e.button !== 0 || b.disabled || !/^(l|r|up|dn)$/.test(b.dataset.a)) return;
    const li = b.closest('li'), it = L()[+li.dataset.i]; if (!it) return;
    e.preventDefault();
    const k = kind + ':' + it.id, a = b.dataset.a; select(k, true);
    holdStart(b, e, selJob(k, a === 'l' || a === 'r' ? 'z' : 'v', a === 'r' || a === 'up' ? 1 : -1));
  });
  $(kind + '-add').addEventListener('click', () => { const it = { id: uid(kind), type: $(kind + '-add-t').value, pos: null }; L().push(it); SELK = kind + ':' + it.id; done(true); });
  $(kind + '-reset').addEventListener('click', () => { const E = ed(); if (kind === 'io') E.io = null; else E.ant = null; SELK = null; done(true); });
}

/* 構圖規則與假設：PCB 位置（固定）、Height 參考點、本體高度來源、補肉、調諧螺絲 */
function renderAsm() {
  $('asm').innerHTML =
    '<div class="q"><div>① PCB 位置</div><p id="r3d-a-pcb-t"></p></div>' +
    '<div class="q"><div>② 「元件相對高度」量到元件中心</div><p id="r3d-a-ref-t"></p></div>' +
    '<div class="q"><div>③ 元件本體高度</div><p id="r3d-a-body-t"></p></div>' +
    '<div class="q"><div>④ 基板凹槽與補肉</div><p id="r3d-a-boss-t"></p></div>' +
    '<div class="q"><div>⑤ 銅塊（Copper Coin）</div><p id="r3d-a-coin-t"></p></div>' +
    '<div class="q"><div>⑥ 濾波器調諧螺絲</div><p id="r3d-a-screw-t"></p></div>';
}
function refreshAsm() {
  const g = P.g, L = LAY;
  $('a-pcb-t').innerHTML = 'PCB 的 HSK 側板面貼在基板內側：距分模面 <b>' + f1(L.D) + ' mm</b>（H_shield）。濾波器側到分模面 <b>' + f1(L.df) + ' mm</b>，就是屏蔽罩的高度。';
  const clamped = [...new Set(L.clamped.map(o => o.row.name))];
  $('a-ref-t').innerHTML = '跟元件設定的「元件相對高度」同一個值（距 PCB I/O 端邊緣，量到元件中心）。' + (clamped.length ? '超出 PCB 的夾回板內：<b>' + esc(clamped.join('、')) + '</b>。' : '所有元件都在板內。');
  const provNames = [...new Set(L.inst.filter(o => o.body.hK === 'prov').map(o => o.row.name))];
  $('a-body-t').innerHTML = provNames.length ? '沒有 AI-Thermal 規格：<b>' + esc(provNames.join('、')) + '</b> → 暫用同類元件的規格（或 ' + GHOST_H + ' mm 薄片）。凹槽深度跟著它。' : '全部取自 AI-Thermal 規格或標準件。';
  const bossTxt = L.bosses.map(b => bossNames(b, '＋') + ' 補 ' + f1(b.h) + ' mm');
  $('a-boss-t').innerHTML = '基板 ' + g.t_base + ' mm；凹槽底到鰭片側至少留 ' + T_MIN + ' mm，不夠就在鰭片側補肉（四周肉厚 ' + BOSS_WALL + ' mm）。I/O 接頭（含 SFP 光口）的框超出端牆一樣補肉。' +
    (bossTxt.length ? '<br>補肉：<b>' + esc(bossTxt.join('；')) + '</b>' : '<br>沒有元件穿出基板。');
  const hasCoin = L.inst.some(o => o.ct.kind === 'coin');
  $('a-coin-t').innerHTML = hasCoin ? '底板 ' + g.Coin_L + '×' + g.Coin_W + '，厚 <b>' + g.Coin_T + ' mm</b>（參數控制台的銅塊厚度，從 PCB 背面往 HSK 算）；凸台≈PA 本體大小，穿過 PCB 開孔（' + (g.t_PCB || 2) + ' mm），PA 焊在凸台上。' : '這個專案沒有 Copper Coin 元件。';
  $('a-screw-t').innerHTML = '上蓋凹入 ' + Math.min(SCREW_REC, g.H_filter / 3) + ' mm，螺絲最高到分模面下 0.3 mm → 不超過濾波器高度 ' + g.H_filter + ' mm，也不會頂到屏蔽罩。';
  $('asm-cnt').textContent = L.clash ? '⚠' : '';
}
/* 屏蔽罩：設定（頂板、隔牆、外框、工作頻段上限）＋ RF 隔離規則 ＋ 腔體清單（最低共振） */
const SHD_RULES = [
  '<b>只替濾波器側的元件做腔體</b>（元件本體＋匹配電路／走線空間），其他地方是開放區',
  '<b>同一路內 Pre-driver／Driver／Final PA／環形器各一格</b>：整條發射鏈增益約 40–50 dB，輸出漏回輸入就會自激，級與級之間要隔開',
  '<b>環形器那一格包住往濾波器的盲插接頭</b>（天線輸出），大功率輸出與諧波不外漏',
  '<b>時脈 IC 獨立一格</b>（相位雜訊、突波源）',
  '兩格靠很近（&lt; ' + SHD_SNAP + ' mm）就共用一道牆；靠近外框的直接用外框當牆',
  '<b>腔體別太大</b>：最低共振要高於 1.2 × f_max',
  '牆頂 FIP 導電膠條壓在 PCB 的地上；走線穿牆的地方開小缺口'];
const SHD_FIELDS = [['roof', '頂板厚（mm）', 0.1, 0.5, 6], ['wall', '隔牆厚（mm）', 0.1, 0.8, 5], ['rim', '外框厚（mm）', 0.1, 1, 8], ['fmax', '工作頻段上限 f_max（GHz）', 0.1, 0.4, 8]];
function renderShd() {
  $('shd-form').innerHTML = '<label>屏蔽罩</label><div class="seg" role="group" aria-label="屏蔽罩顯示"><button type="button" data-shon="1">顯示</button><button type="button" data-shon="0">隱藏</button></div>' +
    SHD_FIELDS.map(([k, n, st, lo, hi]) => '<label for="r3d-shd-' + k + '">' + n + '</label><input class="fld" id="r3d-shd-' + k + '" data-k="' + k + '" type="number" step="' + st + '" min="' + lo + '" max="' + hi + '" inputmode="decimal">').join('') +
    '<p class="sub" id="r3d-shd-lam"></p><span></span><button type="button" class="pbtn ghost" id="r3d-shd-reset" style="justify-self:end">回預設值</button>';
  $('shd-rules').innerHTML = SHD_RULES.map(t => '<li>' + t + '</li>').join('');
  ROOT.querySelectorAll('[data-shon]').forEach(b => b.addEventListener('click', () => { const E = ed(); E.shd = Object.assign({}, E.shd, { on: b.dataset.shon === '1' }); saveEdit(); rebuild(null, true); }));
  $('shd-form').addEventListener('change', e => {
    const k = e.target.dataset && e.target.dataset.k; if (!k) return;
    const f = SHD_FIELDS.find(q => q[0] === k), v = parseFloat(e.target.value), E = ed();
    if (!isFinite(v) || v < f[3] || v > f[4]) { e.target.classList.add('bad'); e.target.title = '請輸入 ' + f[3] + '–' + f[4]; return; }
    e.target.classList.remove('bad'); e.target.title = '';
    E.shd = Object.assign({}, E.shd); if (Math.abs(v - SHD_DEF[k]) < 1e-9) delete E.shd[k]; else E.shd[k] = v;
    saveEdit(); rebuild(null, true);
  });
  $('shd-reset').addEventListener('click', () => { ed().shd = {}; saveEdit(); rebuild(null, true); });
  $('shd-list').addEventListener('click', e => { const it = e.target.closest('[data-cell]'); if (it) shdFlash(+it.dataset.cell); });
}
function refreshShd() {
  const SH = LAY.shd, S = SH.S, E = ed();
  ROOT.querySelectorAll('[data-shon]').forEach(b => b.setAttribute('aria-pressed', String((b.dataset.shon === '1') === !!S.on)));
  SHD_FIELDS.forEach(([k]) => { const el = $('shd-' + k); if (document.activeElement !== el) { el.value = S[k]; el.classList.remove('bad'); } el.classList.toggle('chg', E.shd && typeof E.shd[k] === 'number'); el.disabled = !S.on; });
  $('shd-lam').textContent = '腔體最低共振要 ≥ 1.2 × f_max ＝ ' + f2(1.2 * S.fmax) + ' GHz。腔深 ' + f1(SH.depth) + ' mm ＝ 高 ' + f1(LAY.df) + ' − 頂板 ' + S.roof + '。';
  const bad = SH.cells.filter(c => c.warn);
  $('shd-cnt').textContent = S.on ? SH.cells.length + ' 個腔體' : '已隱藏';
  $('shd-tcnt').textContent = S.on && (bad.length || LAY.clash) ? '⚠' : '';
  $('shd-list').innerHTML = !S.on ? '' : !SH.cells.length ? '<p class="note">濾波器側沒有元件，所以沒有腔體（只有頂板＋外框）。</p>' :
    '<div class="cav-h"><span>腔體（點一下在 3D 標出）</span><span>內尺寸</span><span>最低共振</span></div>' +
    SH.cells.map(c => '<div class="cav" data-cell="' + c.id + '" title="' + esc(c.keep.insts.map(o => o.row.name + ' #' + (o.i + 1)).join('、')) + '"><b>' + esc(c.keep.label) + '</b><span>' + f1(c.a) + '×' + f1(c.b) + '</span><span class="' + (c.warn ? 'ng' : 'ok') + '">' + f1(c.f) + ' GHz ' + (c.warn ? '⚠' : '✓') + '</span></div>').join('');
  const w = [];
  if (bad.length) w.push(bad.map(c => c.keep.label).join('、') + ' 腔體太大，共振落在 ' + f2(1.2 * S.fmax) + ' GHz 以下：加一道牆或貼吸波材');
  if (LAY.clash) w.push([...new Set(LAY.inst.filter(o => o.clash).map(o => o.row.name))].join('、') + ' 比腔深還高，會頂到屏蔽罩頂板');
  $('shd-warn').hidden = !w.length || !S.on; $('shd-warn').textContent = w.length ? '⚠ ' + w.join('；') + '。' : '';
  // 重量：頂板＋外框＋腔體牆 × 鋁密度，對照工具重量模型的 Shielding 項（PCB 面積 × 1.2 cm × 1.5 g/cm³，工具預設）
  const g = P.g, H = LAY.df - S.roof, vol = g.L_pcb * g.W_pcb * S.roof + (g.L_pcb * g.W_pcb - (g.L_pcb - 2 * S.rim) * (g.W_pcb - 2 * S.rim)) * H + SH.walls.reduce((a, q) => a + (q.b - q.a + S.wall) * S.wall * H, 0);
  const kg = vol * 2.7e-6, tool = g.L_pcb * g.W_pcb / 100 * 1.2 * 1.5 / 1000;
  $('shd-kg').textContent = S.on ? '3D 模型估重 ' + kg.toFixed(2) + ' kg（鋁 2.7 g/cm³）；工具的重量模型本來就有一項 Shielding ≈ ' + tool.toFixed(2) + ' kg，所以加了屏蔽罩計算不變。' : '';
}
let flashObj = null;
function shdFlash(id) {
  const c = LAY.shd.cells.find(q => q.id === id); if (!c || !SHD) return;
  if (flashObj) { flashObj.parent && flashObj.parent.remove(flashObj); flashObj.geometry.dispose(); flashObj = null; }
  const w = LAY.shd.S.wall, g = new THREE.BoxGeometry(c.x1 - c.x0 - w, LAY.shd.depth, c.z1 - c.z0 - w);
  flashObj = new THREE.LineSegments(new THREE.EdgesGeometry(g), new THREE.LineBasicMaterial({ color: 0x0fb5c2, depthTest: false }));
  g.dispose(); flashObj.renderOrder = 11; flashObj.position.set((c.x0 + c.x1) / 2, LAY.df - LAY.shd.depth / 2, (c.z0 + c.z1) / 2); SHD.add(flashObj);
  ROOT.querySelectorAll('#r3d-shd-list .cav').forEach(el => el.classList.toggle('sel', +el.dataset.cell === id));
  const o = flashObj; setTimeout(() => { if (flashObj === o) { o.parent && o.parent.remove(o); o.geometry.dispose(); flashObj = null; ROOT.querySelectorAll('#r3d-shd-list .cav.sel').forEach(el => el.classList.remove('sel')); } }, 2600);
}
let rbTimer = null;
function scheduleRebuild() { clearTimeout(rbTimer); rbTimer = setTimeout(() => rebuild(null, true), 60); }

function treeItems() {
  const g = P.g, r = P.r, L = LAY, pk = L.inst.filter(o => o.pocket).length, SH = L.shd, coin = L.inst.filter(o => o.ct.kind === 'coin').length;
  return [
    { key: 'fins', tag: 'param', name: '散熱鰭片 × ' + r.n, spec: f1(r.FH) + ' 高 · ' + finSpecTxt() + ' mm' },
    { key: 'hsk', tag: 'param', name: '散熱器殼體', spec: '牆厚 上' + g.Top + '/下' + g.Btm + '/左' + g.Left + '/右' + g.Right + ' · 基板 ' + g.t_base + '（PCB 貼在內側）' },
    { key: 'pocket', tag: 'data', name: '基板凹槽 × ' + pk + '＋TIM', spec: 'HSK 側元件：本體高＋TIM；銅塊：底板 ' + g.Coin_T + '＋TIM；Via：有 TIM 才挖' },
    { key: 'boss', tag: 'data', name: '補肉 × ' + L.bosses.length, spec: '凹槽底不到 ' + T_MIN + ' mm 或 SFP 光口超出端牆 → 鰭片側加高' },
    { key: 'rib', tag: 'deco', name: '螺絲 · 鎖附孔', spec: '分模面螺絲 M3 × ' + (L.screws || []).length + '（牆往內凸成螺絲柱、膠條繞孔、PCB 在那裡缺口；從濾波器背面鎖進 HSK 牙孔，外殼不凸出）· PCB 鎖 HSK 的螺絲孔' },
    { key: 'pcb', tag: 'param', name: 'PCB', spec: g.L_pcb + ' × ' + g.W_pcb + ' × ' + (g.t_PCB || 2) + ' mm' + (coin ? ' · 銅塊開孔 × ' + coin : '') },
    { key: 'comp', tag: 'data', name: '元件 × ' + L.inst.length + hidTxt('c'), spec: 'AI-Thermal ' + L.src.ait + ' · 元件表 ' + L.src.data + ' · 暫定高度 ' + L.src.prov + (L.G ? ' · FDD ' + L.N + ' 路 × ' + L.G + ' 組' : '') },
    { key: 'shield', tag: 'edit', name: '屏蔽罩 · ' + (SH.S.on ? SH.cells.length + ' 個腔體' : '隱藏'), spec: SH.S.on ? f1(L.df) + ' 高 · 頂板 ' + SH.S.roof + ' · 隔牆 ' + SH.S.wall + ' · RF 腔體 ' + SH.cells.filter(c => c.keep).length : '在「屏蔽罩」分頁打開' },
    { key: 'filter', tag: 'param', name: '腔體濾波器', spec: r.L + ' × ' + r.W + ' × ' + g.H_filter + ' mm · 上蓋凹入，調諧螺絲在 H_filter 內' },
    { key: 'tune', tag: 'deco', name: '調諧螺絲・蓋板螺絲', spec: '每路一條濾波器（排列示意）' },
    { key: 'rfc', tag: 'edit', name: '天線座 × ' + antList().length + hidTxt('ant') + ' · 盲插 × ' + (L.conns ? L.conns.length : 0), spec: '天線座在「天線座」分頁編輯；盲插跟著環形器（每一條發射鏈一個）、穿過屏蔽罩頂板' },
    { key: 'io', tag: 'edit', name: '數位 I/O × ' + ioList().length + hidTxt('io'), spec: IO_CLASS.map(([c, n]) => [n, ioList().filter(it => ((IO_TYPES[it.type] || {}).c || 'etc') === c).length]).filter(q => q[1]).map(q => q[0] + ' ' + q[1]).join(' · ') + '；在「I/O」分頁編輯，SFP 元件與光口對齊' },
  ];
}
function buildTree() {
  $('tree').innerHTML = treeItems().map(t => '<li data-part="' + t.key + '"><input type="checkbox" id="r3d-vis-' + t.key + '"' + (HIDE[t.key] ? '' : ' checked') + ' aria-label="顯示' + esc(t.name) + '">' +
    '<span class="nm">' + esc(t.name) + '</span>' + tg(t.tag) + '<span class="sp">' + esc(t.spec) + '</span></li>').join('');
}
/* 顯示／隱藏：模型樹的整類（HIDE）＋個別隱藏（HIDEI：元件一顆一顆、每一個 I/O、每一個天線座；元件的 TIM 跟著元件） */
function applyHide() {
  Object.keys(parts).forEach(k => (parts[k] || []).forEach(o => { const u = o.userData || {};
    o.visible = !HIDE[k] && !(u.selKey && HIDEI.has(u.selKey)) && !(u.kind === 'tim' && u.inst && HIDEI.has('c:' + u.inst.key)); }));
  [HSK && HSK.userData.io, FIL && FIL.userData.ant].forEach(g => g && g.children.forEach(pg => { if (pg.userData.selKey) pg.visible = !HIDEI.has(pg.userData.selKey); }));
  hidePaint();
}
/* 個別隱藏的數量（只算還在的：元件刪掉、數量變少、接頭刪掉的不算） */
function hidKeys() {
  const n = { c: 0, io: 0, ant: 0 }; if (!LAY || !P) return n;
  const has = { c: new Set(LAY.inst.map(o => 'c:' + o.key)), io: new Set(ioList().map(it => 'io:' + it.id)), ant: new Set(antList().map(it => 'ant:' + it.id)) };
  HIDEI.forEach(k => { const t = k.startsWith('c:') ? 'c' : k.startsWith('io:') ? 'io' : 'ant'; if (has[t].has(k)) n[t]++; });
  return n;
}
const hidTxt = t => { const n = hidKeys()[t]; return n ? '（個別隱藏 ' + n + '）' : ''; };
/* 隱藏（on＝true）／顯示：選取中的那一個被藏起來就取消選取；清單的 👁、模型樹、畫面左下的提示一起更新 */
function hideSet(keys, on) {
  keys.forEach(k => { if (on) HIDEI.add(k); else HIDEI.delete(k); });
  if (on && SELK && keys.includes(SELK)) select(null);
  applyHide(); refreshComp(); refreshPorts('io'); refreshPorts('ant'); buildTree(); selbarPaint();
}
function hidePaint() {
  const bar = $('hidebar'); if (!bar) return;
  const n = hidKeys(), tot = n.c + n.io + n.ant;
  bar.hidden = !tot; if (!tot) return;
  $('hidebar-t').innerHTML = '已隱藏 ' + [['元件', n.c], ['I/O', n.io], ['天線座', n.ant]].filter(q => q[1]).map(q => q[0] + ' <b>' + q[1] + '</b>').join(' · ');
  hidebarPlace();
}
function hidebarPlace() {       // 疊在左下的操作提示／選取列（剖面時是剖面工具列）上面
  const bar = $('hidebar'); if (!bar || bar.hidden) return;
  const sr = stage.getBoundingClientRect(); let b = 10;
  ['hint', 'selbar', 'secbar'].forEach(id => { const el = $(id); if (!el || el.hidden) return; const q = el.getBoundingClientRect(); if (q.height) b = Math.max(b, sr.bottom - q.top + 6); });
  bar.style.bottom = Math.round(b) + 'px';
}
let flashBack = [];
function flash(k) {
  flashBack.forEach(([o, m]) => { o.material = m; }); flashBack = [];
  ROOT.querySelectorAll('#r3d-tree li').forEach(li => li.classList.toggle('sel', li.dataset.part === k));
  if (!k || state.mode !== 'real') return;
  (parts[k] || []).forEach(o => o.traverse(x => { if ((x.isMesh || x.isInstancedMesh) && !x.userData.secHelper) { flashBack.push([x, x.material]); x.material = MAT.hl; } }));
  setTimeout(() => { flashBack.forEach(([o, m]) => { o.material = m; }); flashBack = []; ROOT.querySelectorAll('#r3d-tree li.sel').forEach(li => li.classList.remove('sel')); }, 1400);
}
function fillPanels() {
  const g = P.g, r = P.r, H = g.H_filter + g.H_shield + g.t_base + r.FH;
  $('src').innerHTML = [
    ['整機長 L', r.L + '', g.L_pcb + ' + 上 ' + g.Top + ' + 下 ' + g.Btm],
    ['整機寬 W', r.W + '', g.W_pcb + ' + 左 ' + g.Left + ' + 右 ' + g.Right],
    ['整機高 H', f1(H), '濾波器 ' + g.H_filter + ' + 內腔 ' + g.H_shield + ' + 基板 ' + g.t_base + ' + 鰭片 ' + f1(r.FH)],
    ['PCB 位置', '貼基板內側', '距分模面 ' + f1(LAY.D) + '（H_shield）；濾波器側 ' + f1(LAY.df) + '＝屏蔽罩高'],
    ['屏蔽罩', g.L_pcb + '×' + g.W_pcb + '×' + f1(LAY.df), '長寬＝PCB；高＝H_shield − 板厚；頂板 ' + LAY.shd.S.roof],
    ['銅塊', g.Coin_L + '×' + g.Coin_W + '×' + g.Coin_T, '底板厚從 PCB 背面起算；凸台≈PA 穿過 PCB'],
    ['元件位置', '高度＋橫向', '長度＝元件相對高度（寫回元件設定）；橫向＝距 PCB 左緣'],
    ['凹槽底面積', 'R_TIM 面積', '銅塊 Coin_L×W／Via (E-Pad＋板厚)²／IC top E-Pad'],
    ['通道數', (LAY.N || '—') + (LAY.G ? ' 路 × ' + LAY.G + ' 組' : ''), 'Final PA 數量 → 預設天線座數' + (LAY.G ? '；FDD：' + LAY.G + ' 種 Final PA，每一路每一組一個盲插' : '、盲插')],
  ].map(([k, v, s]) => '<dt>' + k + '</dt><dd><b>' + esc(v) + '</b><span>' + esc(s) + '</span></dd>').join('');
  $('kv').innerHTML = [['外觀 L × W × H', r.L + ' × ' + r.W + ' × ' + f1(H) + ' mm'], ['整機體積', r.V.toFixed(2) + ' L'], ['整機重量', r.kg.toFixed(1) + ' kg'],
    ['熱負載（實際）', r.Q.toFixed(1) + ' W'], ['瓶頸元件', r.bn], ['基板溫度（PCB 底部）', r.T_base.toFixed(1) + ' °C'], ['鰭片製程', g.tech]]
    .map(([k, v]) => '<dt>' + k + '</dt><dd>' + esc(v) + '</dd>').join('');
  $('status').innerHTML = '<span>專案 <b>' + esc(P.name) + '</b></span><span>鰭片 <b>' + r.n + '</b> 片</span><span>體積 <b>' + r.V.toFixed(2) + ' L</b></span>' +
    '<span>重量 <b>' + r.kg.toFixed(1) + ' kg</b></span><span>基板 <b>' + r.T_base.toFixed(1) + ' °C</b></span><span>η <b>' + r.eta.toFixed(3) + '</b></span>' +
    '<span>WebGL2 · ' + (renderer.capabilities.isWebGL2 ? '硬體加速' : '相容模式') + '</span><span class="saved" id="r3d-saved"></span>';
  savedPaint($('saved'));
}

/* ── 選取與編輯：點選；拖曳元件＝在板面上 2D 移動（長度＝元件相對高度、整列共用；橫向＝這一顆）；接頭左右；方向鍵微調 ── */
let SELK = null, selBox = null, drag = null;
function findSel(k) { let f = null; if (k && rru) rru.traverse(o => { if (!f && o.userData && o.userData.selKey === k) f = o; }); return f; }
function selectRefresh() {
  if (selBox) { scene.remove(selBox); selBox.geometry.dispose(); selBox = null; }
  const o = findSel(SELK);
  if (SELK && !o) SELK = null;
  if (o) { holder.updateMatrixWorld(true); selBox = new THREE.BoxHelper(o, 0x0fb5c2); selBox.material.depthTest = false; selBox.renderOrder = 10; scene.add(selBox); }
  if (SELK && SELK.startsWith('c:')) { const q = LAY.inst.find(x => 'c:' + x.key === SELK); if (q && q.row.qty > 1) CEXP.add(q.row.name); }   // 多顆的列：選到哪一顆就展開、標出那一顆
  refreshComp(); refreshPorts('io'); refreshPorts('ant'); updateTags(); selbarPaint();
}
function select(k, keepTab) {
  SELK = k;
  if (k && !keepTab && state.edit) setTab(k.startsWith('c:') ? 'comp' : k.startsWith('io:') ? 'io' : 'ant');
  selectRefresh();
  let row = null;
  if (k && k.startsWith('c:')) { const q = LAY.inst.find(x => 'c:' + x.key === k); if (q) row = ROOT.querySelector('.cr.sub[data-row="' + CSS.escape(q.row.name) + '"][data-i="' + q.i + '"]:not([hidden])') || ROOT.querySelector('.cr[data-row="' + CSS.escape(q.row.name) + '"]'); }
  else if (k) row = ROOT.querySelector('#r3d-' + (k.startsWith('io:') ? 'io' : 'ant') + '-list li.sel');
  if (row) row.scrollIntoView({ block: 'nearest' });
}
/* 選取中：左下的操作提示換成「已選取 X · 可以怎麼調」＋「完成」鈕（Esc、點 3D 空白處、切換分頁也會取消） */
function selbarPaint() {
  const on = !!SELK; $('selbar').hidden = !on; $('hint').hidden = on;
  if (!on) { hidebarPlace(); return; }
  let h = '';
  if (SELK.startsWith('c:')) {
    const o = LAY.inst.find(q => 'c:' + q.key === SELK);
    if (o) h = '已選取 <b>' + esc(o.row.name) + (o.row.qty > 1 ? ' #' + (o.i + 1) : '') + '</b>' +
      (o.port ? ' · 跟 ' + ioLabel(ioList().indexOf(o.port)) + ' 光口綁在一起 · ←→ 左右' : ' · ←→ 橫向 · ↑↓ 相對高度') + (o.role === 'sfp' ? '' : ' · R 轉 90°');
  } else {
    const kind = SELK.startsWith('io:') ? 'io' : 'ant', list = kind === 'io' ? ioList() : antList(), i = list.findIndex(x => kind + ':' + x.id === SELK), it = list[i];
    if (it) h = '已選取 <b>' + (kind === 'io' ? ioLabel(i) : antLabel(i)) + '</b> · ←→ 橫向' + (kind === 'io' && it.type !== 'sfp' ? ' · ↑↓ 高度' : '') +
      (kind === 'io' && it.type === 'sfp' && LAY.inst.some(o => o.port === it) ? ' · PCB 上的 SFP 籠一起動' : '');
  }
  $('selbar-t').innerHTML = h + ' · 按住連續 · H 隱藏';
  const hb = $('selbar-hide'), hid = HIDEI.has(SELK); hb.textContent = hid ? '顯示' : '隱藏';
  hb.title = hid ? '這一個已在 3D 隱藏：按一下顯示回來（H）' : '在 3D 隱藏選取的這一個（H）；清單上的 👁 或左下「全部顯示」可以再顯示';
  hidebarPlace();
}
function updateTags() {    // 接頭上的小標籤（SFP1、ANT2…）：編輯模式或打開對應分頁時顯示
  if (!rru) return;
  const show = { io: state.edit || TAB === 'io', ant: state.edit || TAB === 'ant' };
  rru.traverse(o => { if (o.userData && o.userData.portTag) { const pk = o.parent.userData.portKind; o.visible = !!show[pk]; o.element.classList.toggle('sel', o.parent.userData.selKey === SELK); } });
}
/* 即時更新：元件模型（連同 TIM）移到 o.x／o.z；I/O（或天線座）那一組重建；選取框跟著 */
function placeLive(list) {
  list.forEach(q => { const gq = findSel('c:' + q.key); if (gq) gq.position.set(q.x, 0, q.z); });
  HSK.traverse(m => { if (m.userData.kind === 'tim' && list.includes(m.userData.inst)) { m.position.x = m.userData.inst.x; m.position.z = m.userData.inst.z; } });
  selBoxSync();
}
function portsLive(kind) {
  const io = kind === 'io', host = io ? HSK : FIL, key2 = io ? 'io' : 'ant', old = host.userData[key2];
  host.remove(old); disposeTree(old); const nw = io ? buildIO() : buildAnt(); host.add(nw); host.userData[key2] = nw;
  const pk = io ? 'io' : 'rfc'; parts[pk] = (parts[pk] || []).map(x => x === old ? nw : x);   // 模型樹的顯示／隱藏跟著新的那一組
  applyModeTo(nw); applyHide(); updateTags();
  if (io) liveBoss();
  selBoxSync();
}
function selBoxSync() { if (!selBox || !SELK) return; const o = findSel(SELK); if (o) { holder.updateMatrixWorld(true); selBox.setFromObject(o); } }
/* → { kind, grp, get/clamp/commit/live }（z 皆為所屬零件的 local z）；元件另有 getH/clampH：元件相對高度 */
function selTarget(k) {
  if (!k) return null;
  if (k.startsWith('c:')) {
    const o = LAY.inst.find(q => 'c:' + q.key === k); if (!o) return null;
    const g = P.g, z0 = g.Left, x0 = g.Btm, lo = z0 + o.fpW / 2 + 0.5, hi = z0 + g.W_pcb - o.fpW / 2 - 0.5;
    const rowI = LAY.inst.filter(q => q.row === o.row), fp = Math.max(...rowI.map(q => q.fpL));
    const hLo = A.ref === 'bottom' ? 1 : fp / 2 + 1, hHi = Math.max(hLo, A.ref === 'bottom' ? g.L_pcb - fp - 1 : g.L_pcb - fp / 2 - 1);
    const xOf = (q, h) => x0 + (A.ref === 'bottom' ? h + q.fpL / 2 : h);
    const port = o.port || null;             // SFP 籠：橫向存在它的 I/O 光口上（兩邊一起動）；籠子要貼齊 I/O 端 → 不沿長度拖
    return { kind: 'c', grp: PCB, o, rowI, port, lockH: !!port,
      snap: () => ({ pos: port ? port.pos : null }), restore: sn => { if (port) port.pos = sn.pos; },   // 即時更新會先改光口位置；沒寫回就還原
      get: () => o.z, clamp: z => Math.min(Math.max(z, lo), hi),
      getH: () => hgtOf(o.row), clampH: h => Math.min(Math.max(h, hLo), hHi),
      commit: (z, h) => {
        const E = ed();
        if (z != null) {
          if (port) port.pos = Math.round(z * 2) / 2;
          else { const n = o.row.qty, arr = (E.posW[o.row.name] || []).slice(); while (arr.length < n) arr.push(null); arr[o.i] = Math.round((z - z0) * 2) / 2; E.posW[o.row.name] = arr; }
        }
        if (h != null) { const v = Math.round(h * 2) / 2; if (Math.abs(v - o.row.hgt) < 1e-9) delete E.hgt[o.row.name]; else E.hgt[o.row.name] = v; }
      },
      live: (z, h) => {
        if (z != null) o.z = z;
        if (h != null) rowI.forEach(q => { q.x = xOf(q, h); q.hgt = h; });
        placeLive(rowI);
        if (port && z != null) { port.pos = z; portsLive('io'); }
        liveGeom();
      } };
  }
  const kind = k.startsWith('io:') ? 'io' : 'ant', id = k.slice(k.indexOf(':') + 1), list = kind === 'io' ? ioList() : antList(), it = list.find(x => x.id === id);
  if (!it) return null;
  const types = kind === 'io' ? IO_TYPES : ANT_TYPES, w = (types[it.type] || { w: 20 }).w, W = P.r.W, io = kind === 'io';
  const lay = () => (io ? ioLayout() : portsLayout(list, types)).find(p => p.it === it);
  const cage = io && it.type === 'sfp' ? LAY.inst.find(o => o.port === it) || null : null;     // 這個光口對應的 SFP 籠（PCB 上）一起動
  const cz = z => cage ? Math.min(Math.max(z, P.g.Left + cage.fpW / 2 + 0.5), P.g.Left + P.g.W_pcb - cage.fpW / 2 - 0.5) : z;
  return { kind, grp: io ? HSK : FIL, it, cage, vert: io && it.type !== 'sfp',
    snap: () => ({ pos: it.pos, y: it.y }), restore: sn => { it.pos = sn.pos; if (sn.y === undefined) delete it.y; else it.y = sn.y; },
    get: () => lay().z, clamp: z => cz(Math.min(Math.max(z, w / 2), W - w / 2)),
    getY: () => io ? lay().y : null, clampY: y => { const q = lay(); return Math.min(Math.max(y, q.fh / 2 + 1), LAY.yTop + 15); },
    commit: (z, y) => { if (z != null) it.pos = Math.round(z * 2) / 2; if (y != null && io && it.type !== 'sfp') it.y = Math.round(y * 2) / 2; },
    live: (z, y) => {
      if (z != null) it.pos = z; if (y != null && io && it.type !== 'sfp') it.y = y;
      portsLive(kind);
      if (cage && z != null) { cage.z = cz(z); placeLive([cage]); liveGeom(); }
    } };
}
/* 拖曳中：基板凹槽、補肉、屏蔽罩腔體跟著動（一格畫面最多重算一次） */
let liveReq = 0;
function liveGeom() {
  if (liveReq) return;
  liveReq = requestAnimationFrame(() => {
    liveReq = 0;
    const core = HSK.userData.core, old = core.geometry; core.geometry = coreGeoNow(); old.dispose();
    liveBoss();
    LAY.conns = connsNow(); shieldLayout(); fillShield(SHD); applyModeTo(SHD);
    applyHide(); if (SEC.on) secBuild();
    if (selBox) selBox.update();
  });
}
function liveBoss() {             // 補肉（含 I/O 接頭造成的）與鰭片分段跟著更新
  LAY.bosses = bossesNow(); delete PBOX.hsk; const bg = HSK.userData.boss; bg.children.slice().forEach(c => { bg.remove(c); disposeTree(c); }); parts.boss = []; buildBosses(bg); applyModeTo(bg);
  buildFins(HSK.userData.fins); applyModeTo(HSK.userData.fins); applyHide();
}
/* 一顆水平轉 90°（再轉一次轉回）；SFP 插口一定朝 I/O 端，不能轉 */
function rotateKey(k) {
  const t = selTarget(k); if (!t || t.kind !== 'c' || t.o.role === 'sfp') return;
  const E = ed(), r = t.o.row, arr = ((E.rot || {})[r.name] || []).slice(); while (arr.length < r.qty) arr.push(0);
  arr[t.o.i] = arr[t.o.i] === 90 ? 0 : 90; E.rot = Object.assign({}, E.rot, { [r.name]: arr }); if (arr.every(v => v !== 90)) delete E.rot[r.name];
  saveEdit(); rebuild(null, true);
}
const rotateSel = () => rotateKey(SELK);
/* 橫向回到自動：SFP 籠＝它的光口回到自動等分；其他元件＝拿掉這一顆的手動值 */
function lateralAuto(o) {
  if (o.port) { o.port.pos = null; return; }
  const E = ed(), a = E.posW[o.row.name]; if (!a) return;
  a[o.i] = null; if (a.every(v => typeof v !== 'number')) delete E.posW[o.row.name];
}
const isManualZ = o => o.port ? typeof o.port.pos === 'number' : typeof ((ed().posW[o.row.name] || [])[o.i]) === 'number';

/* ── 按住連續調整（◀ ▶ ▼ ▲、鍵盤方向鍵）：第一下立刻動；按住 0.4 秒後連發（每 60 ms 一步），越按越快（1 → 2 → 5 mm／步）；
   Shift＝一步 10 mm。連發中只做即時更新（跟 3D 拖曳同一條路），放開才寫回、存檔、重建一次 ── */
let HOLD = null, KJOB = null;
function holdStart(btn, e, job) {
  holdStop();
  if (!job) return;
  HOLD = { btn, job, n: 0, shift: e.shiftKey, t: 0 };
  btn.classList.add('holding');
  job.step(e.shiftKey ? 10 : 1);
  HOLD.t = setTimeout(function rep() {
    if (!HOLD) return;
    HOLD.n++; HOLD.job.step(HOLD.shift ? 10 : HOLD.n > 40 ? 5 : HOLD.n > 15 ? 2 : 1);
    HOLD.t = setTimeout(rep, 60);
  }, 400);
}
function holdStop() {
  if (!HOLD) return;
  clearTimeout(HOLD.t); HOLD.btn.classList.remove('holding');
  const j = HOLD.job; HOLD = null; j.done();
}
['pointerup', 'pointercancel', 'blur'].forEach(ev => window.addEventListener(ev, holdStop));
/* 一個調整動作 { step(mm), done() }：k＝選取鍵（c:元件#i、io:id、ant:id）；axis＝'z' 橫向、'v' 上下（元件＝相對高度、I/O＝高度）；sign＝±1 */
function selJob(k, axis, sign) {
  const t = selTarget(k); if (!t) return null;
  const sn = t.snap(), r2 = v => Math.round(v * 2) / 2, fin = (a, b, fn) => { t.restore(sn); if (Math.abs(a - b) > 0.01) { fn(); saveEdit(); } rebuild(null, true); };
  if (axis === 'z') { const z0 = t.get(); let z = z0;
    return { step: m => { z = t.clamp(r2(z + sign * m)); t.live(z, null); liveVals(); }, done: () => fin(z, z0, () => t.commit(z, null)) }; }
  if (t.kind === 'c') { if (t.lockH) return null; const h0 = t.getH(); let h = h0;
    return { step: m => { h = t.clampH(r2(h + sign * m)); t.live(null, h); liveVals(); }, done: () => fin(h, h0, () => t.commit(null, h)) }; }
  if (!t.vert) return null;
  const y0 = t.getY(); let y = y0;
  return { step: m => { y = t.clampY(r2(y + sign * m)); t.live(null, y); liveVals(); }, done: () => fin(y, y0, () => t.commit(null, y)) };
}
/* 整列一起平移（多顆的列）：間距不變；碰到板邊整列停住 */
function rowJob(name, sign) {
  const ts = compRowInsts(name).map(o => selTarget('c:' + o.key)).filter(Boolean); if (!ts.length) return null;
  const z0 = ts.map(t => t.get()), lo = Math.max(...ts.map((t, i) => t.clamp(-1e9) - z0[i])), hi = Math.min(...ts.map((t, i) => t.clamp(1e9) - z0[i]));
  const sns = ts.map(t => t.snap());
  let d = 0;
  return { step: m => { d = Math.min(Math.max(Math.round((d + sign * m) * 2) / 2, lo), hi); ts.forEach((t, i) => t.live(z0[i] + d, null)); liveVals(); },
           done: () => { ts.forEach((t, i) => t.restore(sns[i])); if (Math.abs(d) > 0.01) { ts.forEach((t, i) => t.commit(z0[i] + d, null)); saveEdit(); } rebuild(null, true); } };
}
/* 連發中：表格與清單的數字跟著跳（不整區重繪） */
function liveVals() {
  const z0 = P.g.Left;
  ROOT.querySelectorAll('#r3d-ctab .stp[data-key]').forEach(sp => { const o = LAY.inst.find(q => q.key === sp.dataset.key), inp = sp.querySelector('input'); if (o && inp && document.activeElement !== inp) inp.value = f1(o.z - z0); });
  ['io', 'ant'].forEach(kind => {
    const lay = kind === 'io' ? ioLayout() : portsLayout(antList(), ANT_TYPES);
    $(kind + '-list').querySelectorAll('li').forEach(li => { const p = lay[+li.dataset.i]; if (!p) return;
      const iz = li.querySelector('.p-z'); if (iz && document.activeElement !== iz) iz.value = f1(p.z);
      const iy = li.querySelector('.p-y'); if (iy && document.activeElement !== iy && !p.lock) iy.value = f1(p.y); });
  });
}
const dragPlane = new THREE.Plane(), dragPt = new THREE.Vector3();
function rayLocal(e, grp) {
  const r = canvas.getBoundingClientRect(); ndc.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1);
  ray.setFromCamera(ndc, acam());
  if (!ray.ray.intersectPlane(dragPlane, dragPt)) return null;
  return grp.worldToLocal(dragPt.clone());
}
/* 真的看得到：自己和每一層父層都是 visible（Raycaster 不管父層，單看部件時被藏起來的部件還是會被射中） */
function shown(o) { for (let x = o; x && x !== rru; x = x.parent) if (!x.visible) return false; return true; }
function pickEditable(e) {
  const r = canvas.getBoundingClientRect(); ndc.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1);
  ray.setFromCamera(ndc, acam());
  const hits = ray.intersectObject(rru, true).filter(h => shown(h.object) && !h.object.userData.secHelper && !(h.object.material && h.object.material.transparent && h.object.material.opacity < 0.3) && !(SEC.on && secWorld.distanceToPoint(h.point) < 0));
  for (const h of hits) {
    let x = h.object; while (x && x !== rru && !(x.userData && x.userData.selKey)) x = x.parent;
    if (x && x !== rru && x.userData.selKey) return x.userData.selKey;
    if (h.object.userData.kind !== 'tim') return null;
  }
  return null;
}
stage.addEventListener('pointerdown', e => {
  if (!state.edit || e.button !== 0 || e.target !== canvas) return;
  const k = pickEditable(e); if (!k) return;
  const t = selTarget(k); if (!t) return;
  controls.enabled = false;                              // 相機控制的 pointerdown 在後面觸發，會直接略過
  canvas.setPointerCapture(e.pointerId);
  select(k);
  t.grp.updateMatrixWorld(true);
  const q = t.grp.getWorldQuaternion(new THREE.Quaternion());
  if (t.kind === 'c') dragPlane.setFromNormalAndCoplanarPoint(V(0, 1, 0).applyQuaternion(q), t.grp.localToWorld(V(0, P.g.t_PCB || 2, 0)));
  else dragPlane.setFromNormalAndCoplanarPoint(V(1, 0, 0).applyQuaternion(q), t.grp.localToWorld(V(0, 0, 0)));
  drag = { t, k, x0: e.clientX, y0: e.clientY, startZ: t.get(), startH: t.getH ? t.getH() : null, startY: t.getY ? t.getY() : null, sn: t.snap(), grab: rayLocal(e, t.grp), moved: false, pid: e.pointerId, cur: null };
  canvas.style.cursor = 'grabbing';
}, { capture: true });
canvas.addEventListener('pointermove', e => {
  if (!drag) return;
  if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 4) return;
  drag.moved = true;
  const p = rayLocal(e, drag.t.grp); if (!p || !drag.grab) return;
  const t = drag.t, isC = t.kind === 'c';
  let dz = p.z - drag.grab.z, dx = isC && !t.lockH ? p.x - drag.grab.x : 0, dy = !isC && t.vert ? p.y - drag.grab.y : 0;
  if (e.shiftKey) {                                        // Shift：只動一個方向
    if (isC) { if (Math.abs(dx) > Math.abs(dz)) dz = 0; else dx = 0; }
    else if (t.vert) { if (Math.abs(dy) > Math.abs(dz)) dz = 0; else dy = 0; }
  }
  const nz = t.clamp(Math.round((drag.startZ + dz) * 2) / 2), nh = isC && !t.lockH ? t.clampH(Math.round((drag.startH + dx) * 2) / 2) : null;
  const ny = !isC && t.vert ? t.clampY(Math.round((drag.startY + dy) * 2) / 2) : null;
  drag.cur = { z: nz, h: nh, y: ny }; t.live(nz, isC ? nh : ny);
  if (selBox) selBox.update();
  const tip = $('tip'), sr = stage.getBoundingClientRect();
  if (isC) {
    const r = t.o.row, hh = nh != null ? nh : t.getH(), dh = hh - r.hgt, dT = r.W > 0 ? dh * P.g.Slope : 0;
    tip.innerHTML = '<b>' + esc(r.name) + '</b>' + (r.qty > 1 ? ' <span style="color:var(--ink3)">第 ' + (t.o.i + 1) + '/' + r.qty + ' 顆</span>' : '') +
      trow('元件相對高度', f1(hh) + ' mm' + (Math.abs(dh) > 0.01 ? '（原 ' + f1(r.hgt) + '）' : '')) + trow('橫向（距 PCB 左緣）', f1(nz - P.g.Left) + ' mm') +
      (r.W > 0 && Math.abs(dh) > 0.01 ? trow('估計溫度', (dT >= 0 ? '+' : '') + f2(dT) + ' °C → ' + r.ref + ' ' + f1(r.Tref + dT)) : '') +
      riskHtml(r, hh) +
      '<div style="color:var(--ink3);font-size:0.7rem;margin-top:3px">' + (t.lockH ? 'SFP 籠跟 ' + ioLabel(ioList().indexOf(t.port)) + ' 光口綁在一起：左右一起動（籠子貼齊 I/O 端）' :
        (r.qty > 1 ? '元件相對高度整列共用：' + r.qty + ' 顆一起上下移 · ' : '') + '放開＝寫回元件設定 · Shift 只動一個方向') + '</div>';
  } else {
    const q = t.kind === 'io' ? ioLayout().find(x => x.it === t.it) : null, over = q ? q.y + q.fh / 2 + BOSS_WALL - LAY.yTop : 0;
    tip.innerHTML = '<b>' + (t.kind === 'io' ? ioLabel : antLabel)((t.kind === 'io' ? ioList() : antList()).indexOf(t.it)) + '</b>' + trow('距外殼左側', f1(nz) + ' mm') +
      (q ? trow('高度（距分模面）', f1(q.y) + ' mm' + (q.lock ? '（對齊 SFP 籠）' : '')) : '') +
      (over > 0.01 ? '<div class="warn">框超出端牆 → 端牆補肉 ' + f1(over) + ' mm</div>' : '') +
      '<div style="color:var(--ink3);font-size:0.7rem;margin-top:3px">' + (t.vert ? '左右＋上下都能拖 · Shift 只動一個方向' : q ? (t.cage ? 'SFP 光口只能左右，PCB 上的 SFP 籠一起動' : 'SFP 光口只能左右（高度跟著 SFP 籠）') : '左右拖') + '</div>';
  }
  tip.hidden = false; tip.style.left = Math.min(e.clientX - sr.left + 16, sr.width - 280) + 'px'; tip.style.top = Math.max(8, e.clientY - sr.top + 14) + 'px';
});
function endDrag(e) {
  if (!drag) return;
  const d = drag; drag = null; controls.enabled = true; canvas.style.cursor = '';
  try { canvas.releasePointerCapture(d.pid); } catch (err) { /* 已釋放 */ }
  if (d.moved && d.cur) {                                // 只寫有動到的那個方向（只拖長度就不把橫向鎖成手動）
    const z = Math.abs(d.cur.z - d.startZ) > 0.25 ? d.cur.z : null;
    const sec = d.t.kind === 'c' ? (d.cur.h != null && Math.abs(d.cur.h - d.startH) > 0.25 ? d.cur.h : null) : (d.cur.y != null && Math.abs(d.cur.y - d.startY) > 0.25 ? d.cur.y : null);
    d.t.restore(d.sn);
    if (z != null || sec != null) { d.t.commit(z, sec); saveEdit(); }
    rebuild(null, true);
  }
}
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
window.addEventListener('keydown', e => {
  if (!onScreen()) return;
  if (e.key === 'Escape' && SELK) {                         // 在側欄的輸入框裡按 Esc 也算：先離開輸入框（打的值照樣寫回），再取消選取
    const a = document.activeElement; if (a && /INPUT|SELECT|TEXTAREA|BUTTON/.test(a.tagName) && a.closest('.side')) a.blur();
    holdStop(); keyStop(); e.preventDefault(); select(null); return;
  }
  if (!SELK || /INPUT|SELECT|TEXTAREA/.test((document.activeElement || {}).tagName || '')) return;
  if ((e.key === 'r' || e.key === 'R') && !e.ctrlKey && !e.metaKey && !e.altKey && SELK.startsWith('c:')) { e.preventDefault(); if (!e.repeat) rotateSel(); return; }
  if ((e.key === 'h' || e.key === 'H') && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); if (!e.repeat) hideSet([SELK], !HIDEI.has(SELK)); return; }
  const ax = { ArrowLeft: ['z', -1], ArrowRight: ['z', 1], ArrowUp: ['v', 1], ArrowDown: ['v', -1] }[e.key]; if (!ax) return;
  e.preventDefault();
  if (!KJOB || KJOB.key !== e.key) { keyStop(); const job = selJob(SELK, ax[0], ax[1]); if (!job) return; KJOB = { key: e.key, job }; }
  KJOB.job.step(e.shiftKey ? 10 : 1);
});
window.addEventListener('keyup', e => { if (KJOB && e.key === KJOB.key) keyStop(); });
window.addEventListener('blur', () => keyStop());
function keyStop() { if (!KJOB) return; const j = KJOB.job; KJOB = null; j.done(); }
/* 在 3D 上點一下（沒拖動）：點到元件或接頭＝選取；點到空白處＝取消選取 */
let clickAt = null;
canvas.addEventListener('pointerdown', e => { clickAt = e.button === 0 ? { x: e.clientX, y: e.clientY } : null; });
canvas.addEventListener('pointerup', e => {
  const c = clickAt; clickAt = null;
  if (!c || e.button !== 0 || Math.hypot(e.clientX - c.x, e.clientY - c.y) > 4) return;
  const k = pickEditable(e);
  if (k) { if (k !== SELK) select(k); } else if (SELK) select(null);
});

/* ── 游標提示：元件／凹槽／接頭／屏蔽罩腔體／補肉的數據 ── */
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
let hoverQ = null;
canvas.addEventListener('pointermove', e => { hoverQ = e; });
canvas.addEventListener('pointerleave', () => { hoverQ = null; if (!drag) $('tip').hidden = true; });
function hoverUpdate() {
  if (!hoverQ || drag) return; const e = hoverQ; hoverQ = null;
  if (e.buttons) { $('tip').hidden = true; return; }
  const r = canvas.getBoundingClientRect(); ndc.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1);
  ray.setFromCamera(ndc, acam());
  const hits = ray.intersectObject(rru, true).filter(h => shown(h.object) && !h.object.userData.secHelper && !(h.object.material && h.object.material.transparent && h.object.material.opacity < 0.3) && !(SEC.on && secWorld.distanceToPoint(h.point) < 0));
  let html = null, editable = false;
  for (const h of hits) {
    let x = h.object; while (x && x !== rru && !(x.userData && (x.userData.inst || x.userData.selKey))) x = x.parent;
    if (x && x !== rru && x.userData.port) { html = portTipHtml(x.userData.port, x.userData.portKind); editable = true; break; }
    if (x && x !== rru && x.userData.inst) { html = tipHtml(x.userData.inst, h.object.userData.what || 'comp'); editable = !!x.userData.selKey; break; }
    const what = h.object.userData.what;
    if (what === 'shield') { html = cellTipHtml(cellAt(SHD.worldToLocal(h.point.clone()))); break; }
    if (what === 'boss') { html = bossTipHtml(h.object.userData.boss); break; }
    if (h.object.userData.kind !== 'tim') break;
  }
  canvas.style.cursor = state.edit && editable ? 'grab' : '';
  const tip = $('tip');
  if (!html) { tip.hidden = true; return; }
  tip.innerHTML = html; tip.hidden = false;
  const sr = stage.getBoundingClientRect(); let x = e.clientX - sr.left + 16, y = e.clientY - sr.top + 14;
  if (x + 280 > sr.width) x = e.clientX - sr.left - 284; if (y + tip.offsetHeight > sr.height - 8) y = sr.height - tip.offsetHeight - 8;
  tip.style.left = x + 'px'; tip.style.top = Math.max(8, y) + 'px';
}
const trow = (k, v) => '<div class="row"><span>' + k + '</span><span>' + v + '</span></div>';
function tipHtml(o, what) {
  const r = o.row, em = estMargin(r), lv = marginLevel(em), pk = o.pocket, est = r.W > 0 && Math.abs(dHgt(r)) > 0.01;
  let h = '<b>' + esc(r.name) + '</b> <span style="color:var(--ink3)">' + r.cat + (r.qty > 1 ? ' · 第 ' + (o.i + 1) + '/' + r.qty + ' 顆' : '') + '</span>';
  h += trow('單顆功耗', f2(r.P) + ' W') + trow('判定溫度', r.ref + ' ' + f1(r.Tref + dTemp(r)) + ' °C' + (est ? '（估）' : '') + ' / 限溫 ' + r.lim);
  h += trow('裕度', f1(em) + ' °C' + (lv ? '<span class="lv" style="background:' + lv.mk + '">' + lv.label + '</span>' : ''));
  h += '<hr>' + trow('導熱方式', r.bt + '（' + (o.side === 'hsk' ? 'HSK 側' : '濾波器側') + '）') + trow('接觸面', o.ct.label) + trow('TIM', (r.tim || 'None') + (r.timT ? ' ' + r.timT + ' mm' : ''));
  if (pk) h += trow(o.side === 'hsk' ? '基板凹槽' : o.ct.kind === 'coin' ? '銅塊凹槽' : 'TIM 淺槽',
    '深 ' + f2(pk.depth) + ' mm' + (o.side === 'hsk' ? '（本體 ' + f2(pk.prot) + (pk.air ? '＋空隙 ' : '＋TIM ') + f2(pk.gap) + '）' : pk.prot ? '（底板 ' + f2(pk.prot) + '＋TIM ' + f2(pk.gap) + '）' : ''));
  else if (o.side === 'filter') h += trow('HSK 接觸', 'PCB 背面貼基板');
  if (o.ct.kind === 'coin') h += trow('銅塊', '底板 ' + f2(o.ct.L) + '×' + f2(o.ct.W) + '×' + P.g.Coin_T + '＋凸台 ' + f2(o.body.L) + '×' + f2(o.body.W));
  if (pk && pk.boss > 0) h += '<div class="warn">穿出基板 → 鰭片側補肉 ' + f2(pk.boss) + ' mm</div>';
  h += '<hr>' + trow('元件相對高度', f1(o.hgt) + ' mm' + (est ? '（原 ' + f1(r.hgt) + '）' : '') + (Math.abs(o.shift) > 0.5 ? '（' + (Math.abs(o.clampD) > 0.5 ? '夾回板內' : '避讓') + ' ' + (o.shift > 0 ? '+' : '') + f1(o.shift) + '）' : ''));
  h += trow('橫向', '距左緣 ' + f1(o.z - P.g.Left) + ' mm（' + ({ manual: '手動', io: '對齊 SFP 光口', auto: '自動' }[o.src] || '自動') + '）');
  if (o.lane >= 0) h += trow('通道', 'CH' + (o.lane + 1) + (LAY.G && o.grp >= 0 ? ' · ' + esc(grpLabel(o.grp)) + ' 那一組' : o.subN > 1 ? ' · 第 ' + (o.sub + 1) + '/' + o.subN + ' 格' : ''));
  h += trow('本體', f2(o.body.L) + '×' + f2(o.body.W) + '×' + (o.body.h != null ? f2(o.body.h) : '?') + (o.rot ? '（轉 90°）' : ''));
  h += '<div style="color:var(--ink3);font-size:0.7rem">尺寸：' + esc(o.body.sizeSrc) + '<br>高度：' + esc(o.body.hSrc) + '</div>';
  if (o.clash) h += '<div class="warn">⚠ 比屏蔽罩腔深高 ' + f2(o.clash) + ' mm，會頂到頂板</div>';
  if (est) h += riskHtml(r, hgtOf(r));
  if (o.overlap) h += '<div class="warn">⚠ 與其他元件重疊</div>';
  if (state.edit) h += '<div style="color:var(--ink3);font-size:0.7rem;margin-top:3px">拖曳＝長度＋橫向（Shift 只動一個方向）· ←→ 橫向 · ↑↓ 元件相對高度（Shift ×10）' + (o.role === 'sfp' ? '' : ' · R 轉 90°') + '</div>';
  return h;
}
const ISO_WHY = { pa: '末級 PA：輸出功率最大，跟前級隔開避免自激', drv: 'Driver：增益高，最怕輸出漏回來', pre: 'Pre-driver：最前級小訊號，要跟後級隔開',
  circ: '天線輸出（環形器＋往濾波器的盲插接頭）：大功率輸出與諧波不外漏', clk: '時脈 IC：相位雜訊、突波源，獨立隔離' };
/* 游標指到屏蔽罩的哪一格：先看腔體內側；落在牆上（斜看時常常先碰到牆）就算最近的那一格 */
function cellAt(lp) {
  const SH = LAY.shd, w = SH.S.wall / 2;
  const inner = SH.cells.find(q => lp.x >= q.x0 + w && lp.x <= q.x1 - w && lp.z >= q.z0 + w && lp.z <= q.z1 - w);
  if (inner) return inner;
  let best = null, bd = Infinity;
  SH.cells.forEach(q => {
    if (lp.x < q.x0 - w - 0.01 || lp.x > q.x1 + w + 0.01 || lp.z < q.z0 - w - 0.01 || lp.z > q.z1 + w + 0.01) return;
    const d = Math.hypot(lp.x - (q.x0 + q.x1) / 2, lp.z - (q.z0 + q.z1) / 2); if (d < bd) { bd = d; best = q; }
  });
  return best;
}
function cellTipHtml(c) {
  const SH = LAY.shd, S = SH.S;
  if (!c) return '<b>屏蔽罩</b> <span style="color:var(--ink3)">開放區</span>' + trow('頂板／腔深', S.roof + ' / ' + f1(SH.depth) + ' mm') +
    '<div style="color:var(--ink3);font-size:0.72rem">這一區沒有要隔離的濾波器側元件，不做腔體</div>';
  const k = c.keep;
  let h = '<b>屏蔽罩腔體</b> <span style="color:var(--ink3)">' + esc(k.label) + '</span>';
  h += trow('內尺寸', f1(c.a) + ' × ' + f1(c.b) + ' × ' + f1(SH.depth) + ' mm') + trow('最低共振', f2(c.f) + ' GHz（' + (c.f / S.fmax).toFixed(1) + ' × f_max）');
  h += '<hr>' + trow('內含', esc([...new Set(k.insts.map(o => o.row.name))].join('、')));
  h += '<div style="color:var(--ink3);font-size:0.72rem">' + esc(k.merged ? '距離太近放不下牆 → 合成一格' : (ISO_WHY[k.roles[0]] || '濾波器側元件：獨立隔離')) + '</div>';
  if (c.warn) h += '<div class="warn">⚠ 共振低於 1.2 × f_max：加一道牆或貼吸波材</div>';
  return h;
}
/* 補肉是誰造成的：元件（凹槽穿出基板）＋I/O 接頭（框超出端牆）。SFP 光口和 PCB 上的 SFP 籠是同一個東西，只列一次 */
function bossSrc(b) {
  const own = b.ports.map(q => q.o).filter(Boolean);
  return { comps: [...new Set(b.insts.filter(o => !own.includes(o)).map(o => o.row.name))], ports: b.ports.map(q => ioLabel(q.i)) };
}
function bossNames(b, sep) { const s = bossSrc(b); return s.comps.concat(s.ports.map(n => n + ' 接頭')).join(sep); }
function bossTipHtml(b) {
  const s = bossSrc(b), why = [s.comps.length ? '凹槽穿出基板' : '', s.ports.length ? '接頭的框超出端牆' : ''].filter(Boolean).join('、');
  return '<b>補肉</b> <span style="color:var(--ink3)">鰭片側加高</span>' + trow('範圍', f1(b.x1 - b.x0) + ' × ' + f1(b.z1 - b.z0) + ' mm') + trow('加高', f2(b.h) + ' mm') +
    '<div style="color:var(--ink3);font-size:0.72rem">' + esc(bossNames(b, '、')) + '：' + why + '，四周留 ' + BOSS_WALL + ' mm、頂部留 ' + T_MIN + ' mm 肉厚</div>';
}
function portTipHtml(p, kind) {
  const list = kind === 'io' ? ioList() : antList(), t = (kind === 'io' ? IO_TYPES : ANT_TYPES)[p.it.type] || { n: p.it.type };
  const cls = kind === 'io' ? ioClassOf(p.it.type) : '', ctx = cls && t.n.indexOf(cls) < 0 ? '（' + cls + '）' : '';
  let h = '<b>' + (kind === 'io' ? ioLabel(p.i) : antLabel(p.i)) + '</b> <span style="color:var(--ink3)">' + esc(t.n) + ctx + '</span>';
  const io = kind === 'io', vert = io && !p.lock;
  h += trow('位置', '距外殼左側 ' + f1(p.z) + ' mm' + (p.auto ? '（自動等分）' : '')) + (io ? trow('高度', '距分模面 ' + f1(p.y) + ' mm' + (p.lock ? '（對齊 SFP 籠）' : p.yAuto ? '（自動）' : '')) : '') + trow('順序', (p.i + 1) + ' / ' + list.length);
  if (io && p.y + p.fh / 2 + BOSS_WALL > LAY.yTop + 0.01) h += trow('補肉', '框超出端牆 → 加高 ' + f1(p.y + p.fh / 2 + BOSS_WALL - LAY.yTop) + ' mm');
  if (io && p.it.type === 'sfp') h += '<div style="color:var(--ink3);font-size:0.7rem">SFP 元件（PCB 上的籠子）會對齊這個光口</div>';
  h += '<div style="color:var(--ink3);font-size:0.7rem;margin-top:3px">' + (state.edit ? (vert ? '拖曳上下左右移動 · 方向鍵微調' : '拖曳左右移動 · ←→ 微調') + '（Shift ×10）' : '開「移動」可以直接拖；清單在「' + (io ? '數位 I/O' : '天線座') + '」分頁') + '</div>';
  return h;
}

/* ── 後製：多重取樣＋GTAO（縫隙的遮蔽陰影）＋色調映射 ── */
const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4, stencilBuffer: true });
const composer = new EffectComposer(renderer, rt);
const renderPass = new RenderPass(scene, camera);
composer.addPass(renderPass);
const gtao = new GTAOPass(scene, camera, 4, 4);
// ⚠ 半徑／厚度不要調回 20／10：屏蔽罩隔牆（2 mm 厚、十幾 mm 高）的牆腳會出現一條帶顆粒的亮帶，影子像跟牆腳脫開，
//   看起來整道牆浮在頂板上（使用者回報過；幾何上是貼齊的）。去雜點加強（24 點、3 圈）＋對深度／法線的邊界更敏感，
//   牆腳、轉角就乾淨；整機外觀（鰭片間的陰影）幾乎不變。取樣數維持 16（每一幀都會重畫，不要加重 GTAO 本身）
gtao.updateGtaoMaterial({ radius: 8, distanceExponent: 1.2, thickness: 3, scale: 1.5, samples: 16, distanceFallOff: 1, screenSpaceRadius: false });
gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 1, normalPhi: 2, radius: 10, rings: 3, samples: 24 });
composer.addPass(gtao);
composer.addPass(new OutputPass());
const labelRenderer = new CSS2DRenderer({ element: $('labels') });
/* 正交／透視切換：只換算繪用的相機（主相機一直是透視、由 TrackballControls 控制）；AO 的相機型別要跟著換 */
function setProjection(o) {
  ORTHO = !!o; if (ORTHO) syncOrtho();
  const c = acam(), persp = c.isPerspectiveCamera ? 1 : 0;
  renderPass.camera = c; gtao.camera = c;
  if (gtao.gtaoMaterial.defines.PERSPECTIVE_CAMERA !== persp) { gtao.gtaoMaterial.defines.PERSPECTIVE_CAMERA = persp; gtao.gtaoMaterial.needsUpdate = true; }
  if (gtao.depthRenderMaterial && gtao.depthRenderMaterial.defines.PERSPECTIVE_CAMERA !== persp) { gtao.depthRenderMaterial.defines.PERSPECTIVE_CAMERA = persp; gtao.depthRenderMaterial.needsUpdate = true; }
  $('t-ortho').setAttribute('aria-pressed', String(ORTHO));
}
/* 視角方塊：CSS 3D 方塊跟著相機轉（世界座標的六個面）；子標題寫出這一面看到的是什麼 */
const vcCube = $('vc-cube'), _vq = new THREE.Quaternion(), _vm = new THREE.Matrix4(), _vS = new THREE.Matrix4().makeScale(1, -1, 1);
let vcLast = '';
function vcUpdate() {
  _vm.makeRotationFromQuaternion(_vq.copy(camera.quaternion).invert());
  const e = _vS.clone().multiply(_vm).multiply(_vS).elements, s = 'matrix3d(' + e.map(v => (Math.abs(v) < 1e-6 ? 0 : v).toFixed(5)).join(',') + ')';
  if (s !== vcLast) { vcCube.style.transform = s; vcLast = s; }
}
function vcLabels() {
  const up = state.upright;
  const sub = up ? { left: '鰭片', right: '濾波器', top: '頂端', bottom: 'I/O' } : { left: 'I/O', right: '頂端', top: '鰭片', bottom: '濾波器' };
  const tip = up ? { front: '前視：長邊側面', back: '後視：另一側長邊', left: '左視：鰭片側', right: '右視：濾波器側', top: '上視：頂端', bottom: '下視：I/O 端（接頭朝下）' }
                 : { front: '前視：長邊側面（長 × 高）', back: '後視：另一側長邊', left: '左視：I/O 端（接頭、疊層）', right: '右視：頂端', top: '上視：從鰭片側往下看（長 × 寬）', bottom: '下視：濾波器底面' };
  ROOT.querySelectorAll('.vc-f').forEach(b => { const k = b.dataset.std; b.querySelector('small').textContent = sub[k] || ''; b.title = tip[k] + '（正交投影）'; b.setAttribute('aria-label', tip[k]); });
  ROOT.querySelectorAll('.vc-cross [data-std]').forEach(b => { const k = b.dataset.std; b.title = tip[k] + '（正交投影）'; b.setAttribute('aria-label', tip[k]); });
}
function resize() {
  const w = stage.clientWidth, h = stage.clientHeight; if (!w || !h) return;
  renderer.setSize(w, h, false); composer.setSize(w, h); labelRenderer.setSize(w, h);
  camera.aspect = w / h; camera.updateProjectionMatrix(); controls.handleResize();
}
let wasPortrait = null;
new ResizeObserver(() => {
  resize();
  if (REFRAME && onScreen() && rru) { REFRAME = false; frame(state.st === 'flat' ? 'flat' : state.st === 'exp' ? 'exp' : 'iso', true); }
  // 畫面大小變了（工具收合／展開參數控制台、視窗縮放），而使用者還沒自己轉過／平移／縮放（curView 還在）→ 用新的大小重新對焦同一個視角
  else if (rru && onScreen() && curView && !camTween && frameSize && (Math.abs(stage.clientWidth - frameSize[0]) > 2 || Math.abs(stage.clientHeight - frameSize[1]) > 2)) frame(curView, true);
  const pt = portrait();
  if (rru && state.st === 'flat' && wasPortrait !== null && pt !== wasPortrait) { applyState('flat', true); frame('flat', true); }
  wasPortrait = pt; if (rru) updateVis();
}).observe(stage);

/* 工具列與側欄 */
const HINTS = { view: '左鍵旋轉 · 右鍵或 Shift＋左鍵平移 · 滾輪縮放 · 右上方塊／十字鈕切正視（⟲⟳ 轉 90°）· 游標停在元件上看數據', edit: '移動模式：拖曳元件＝長度＋橫向（放開寫回元件設定；Shift 只動一個方向）· R 轉 90° · I/O 接頭可上下左右 · 方向鍵微調（按住連續）· 點空白處或 Esc 取消選取' };
ROOT.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => frame(b.dataset.view)));
/* 自己轉／平移過 → 畫面已經不是那個預設視角：按鈕不再亮（再按一次就回正）；轉場還在跑就中斷，不跟使用者搶鏡頭 */
controls.addEventListener('start', () => { camTween = null; });
canvas.addEventListener('pointerdown', e => { if (!drag && (e.button === 0 || e.button === 2)) { curView = null; viewRoll = 0; markViews(); } });
canvas.addEventListener('wheel', () => { if (curView) { curView = null; viewRoll = 0; markViews(); } }, { passive: true });   // 縮放過也算自己調過（畫面大小變了不再自動重新對焦）
ROOT.querySelectorAll('.vc-f').forEach(b => b.addEventListener('click', () => { viewRoll = 0; frame(b.dataset.std); }));   // 點正視圖＝原本的方向（轉過的也轉回來）
ROOT.querySelectorAll('.vc-cross [data-std]').forEach(b => b.addEventListener('click', () => { viewRoll = 0; frame(b.dataset.std); }));
ROOT.querySelectorAll('[data-roll]').forEach(b => b.addEventListener('click', () => rollView(+b.dataset.roll)));
ROOT.querySelectorAll('[data-pan]').forEach(b => b.addEventListener('click', e => { const v = b.dataset.pan; if (v === 'c') { recenter(); return; } const [x, y] = v.split(',').map(Number), k = e.shiftKey ? 3 : 1; panView(x * k, y * k); }));
ROOT.querySelectorAll('[data-solo]').forEach(b => b.addEventListener('click', () => {
  const k = b.dataset.solo, all = Object.keys(PARTS());   // 可複選：按一下加入、再按一下拿掉；全部拿掉或四件都選 → 回到「全部」
  if (!k) state.solo = null;
  else { const s = new Set(state.solo || []); s.has(k) ? s.delete(k) : s.add(k); state.solo = s.size && s.size < all.length ? all.filter(x => s.has(x)) : null; }
  applySolo();
  if (state.pflip && state.st !== 'flat') applyState(state.st);   // 翻著的整組換了組成 → 以新的組合重新算中心
  frame(curView || (state.st === 'flat' ? 'flat' : state.st === 'exp' ? 'exp' : 'iso'));
}));
stage.addEventListener('pointerdown', e => {               // Shift＋左鍵拖曳＝平移（在元件上拖則是移動元件，由上面的拖曳處理）
  if (drag || e.button !== 0 || !e.shiftKey || e.target !== canvas) return;
  controls.mouseButtons.LEFT = THREE.MOUSE.PAN;
}, { capture: true });
window.addEventListener('pointerup', () => { controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE; });
window.addEventListener('pointercancel', () => { controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE; });
let overStage = false;
stage.addEventListener('pointerenter', () => { overStage = true; }); stage.addEventListener('pointerleave', () => { overStage = false; });
window.addEventListener('keydown', e => {                  // 沒選東西、滑鼠在 3D 畫面上：方向鍵平移（Shift 走大步）
  if (!onScreen() || SELK || !overStage || /INPUT|SELECT|TEXTAREA|BUTTON/.test((document.activeElement || {}).tagName || '')) return;
  const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[e.key]; if (!d) return;
  e.preventDefault(); panView(d[0] * (e.shiftKey ? 3 : 1), d[1] * (e.shiftKey ? 3 : 1));
});
$('t-ortho').addEventListener('click', () => setProjection(!ORTHO));
ROOT.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => { state.mode = b.dataset.mode; applyMode(); }));
ROOT.querySelectorAll('[data-state]').forEach(b => b.addEventListener('click', () => { applyState(b.dataset.state); frame(b.dataset.state === 'flat' ? 'flat' : b.dataset.state === 'exp' ? 'exp' : 'iso'); }));
$('t-sec').addEventListener('click', () => secToggle(!SEC.on));
$('sec-pos').addEventListener('input', e => { SEC.pos = parseFloat(e.target.value); secPlace(); });
$('sec-bn').addEventListener('click', () => { SEC.pos = secDefault(); secPlace(); });
ROOT.querySelectorAll('[data-sax]').forEach(b => b.addEventListener('click', () => { SEC.axis = b.dataset.sax; SEC.pos = null; secPlace(); frame(SEC.axis === 'z' ? 'secz' : 'secx'); }));
$('t-dim').addEventListener('click', () => { state.dims = !state.dims; $('t-dim').setAttribute('aria-pressed', String(state.dims)); updateVis(); });
function pflipPaint() { const b = $('t-pflip'); if (b) b.setAttribute('aria-pressed', String(!!state.pflip)); }
$('t-pflip').addEventListener('click', () => {
  if (!rru) return;
  state.pflip = !state.pflip; pflipPaint(); applyState(state.st);
});
/* 全螢幕：整頁進瀏覽器全螢幕＋3D 檢視器蓋滿（工具的對話框、密碼框照樣疊在上面）；瀏覽器不給全螢幕時仍蓋滿視窗 */
const fsOn = () => ROOT.classList.contains('r3d-fs');
function fsSet(on) {
  ROOT.classList.toggle('r3d-fs', on); $('t-fs').setAttribute('aria-pressed', String(on));
  $('t-fs').title = on ? '退出全螢幕（Esc 也可以）' : '全螢幕（只顯示 3D 檢視器；再按一次或 Esc 退出）';
}
function fsExit() { if (!fsOn()) return; fsSet(false); if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); }
$('t-fs').addEventListener('click', () => {
  if (fsOn()) { fsExit(); return; }
  fsSet(true);
  const el = document.documentElement;
  try { const r = el.requestFullscreen && el.requestFullscreen(); if (r && r.catch) r.catch(() => {}); } catch (e) {}
});
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && fsOn()) fsSet(false); });   // Esc、跳出對話框 → 瀏覽器退出全螢幕，檢視器也跟著還原
document.addEventListener('keydown', e => { if (e.key === 'Escape' && fsOn() && !document.fullscreenElement && !SELK) fsExit(); });
$('t-save').addEventListener('click', async () => {   // 存檔中再按不重複送出
  const b = $('t-save'); if (!HOST.onSave || b.getAttribute('aria-busy') === 'true') return;
  b.setAttribute('aria-busy', 'true');
  try { await HOST.onSave(); } catch (e) { console.error('[3D] save failed:', e); } finally { b.removeAttribute('aria-busy'); }
});
$('t-flip').addEventListener('click', () => { state.flip = !state.flip; $('t-flip').setAttribute('aria-pressed', String(state.flip)); applyState('flat'); });
$('t-up').addEventListener('click', () => { state.upright = !state.upright; $('t-up').setAttribute('aria-pressed', String(state.upright)); applyState(state.st, true); frame(state.st === 'exp' ? 'exp' : 'iso'); });
function setEdit(on) {
  state.edit = on; $('t-edit').setAttribute('aria-pressed', String(on)); $('hint').textContent = on ? HINTS.edit : HINTS.view;
  $('hint').classList.toggle('edit', on); if (!on) canvas.style.cursor = '';
  updateTags();
  if (!on && SELK) select(null);                         // 關掉「移動」＝編輯完成
}
$('t-edit').addEventListener('click', () => setEdit(!state.edit));
ROOT.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => { setTab(b.dataset.tab); if (SELK) select(null); }));
$('selbar-done').addEventListener('click', () => select(null));
$('selbar-hide').addEventListener('click', () => { if (SELK) hideSet([SELK], !HIDEI.has(SELK)); });
$('hidebar-all').addEventListener('click', () => hideSet([...HIDEI], false));
$('tree').addEventListener('change', e => { const li = e.target.closest('li'); if (!li) return; HIDE[li.dataset.part] = !e.target.checked; applyHide(); });
$('tree').addEventListener('click', e => { const li = e.target.closest('li'); if (li && e.target.tagName !== 'INPUT') flash(li.dataset.part); });
wireComp(); wirePorts('io'); wirePorts('ant');

const ease = k => k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
/* 零件動畫的某一刻（e＝0～1）：內插的是 cen（部件座標裡的一個點；整組翻轉時＝整組的轉軸中心）→ 繞那一點轉 */
function tweenApply(tw, e) {
  Object.keys(tw.objs).forEach(n => { const o = tw.objs[n], f = tw.from[n], t = tw.to[n], c = tw.cen && tw.cen[n];
    o.quaternion.slerpQuaternions(f[1], t[1], e);
    if (c) { const a = f[0].clone().add(c.clone().applyQuaternion(f[1])), b = t[0].clone().add(c.clone().applyQuaternion(t[1])); o.position.lerpVectors(a, b, e).sub(c.clone().applyQuaternion(o.quaternion)); }
    else o.position.lerpVectors(f[0], t[0], e); });
  holder.position.lerpVectors(tw.h0, tw.h1, e);
}
let FRAMES = 0;                   // 畫了幾幀（測試用：確認全螢幕時照樣在重畫）
function tick(now) {
  if (!P || !onScreen()) { requestAnimationFrame(tick); return; }
  if (tween) {
    const k = Math.min(1, (now - tween.t0) / tween.dur);
    tweenApply(tween, ease(k));
    if (k >= 1) tween = null;
  }
  if (camTween) {
    const k = Math.min(1, (now - camTween.t0) / camTween.dur), e = ease(k);
    camera.position.lerpVectors(camTween.p0, camTween.p1, e); controls.target.lerpVectors(camTween.t0v, camTween.t1, e);
    camera.up.lerpVectors(camTween.u0, camTween.u1, e); if (camera.up.lengthSq() < 1e-6) camera.up.set(0, 1, 0); camera.up.normalize();
    if (k >= 1) camTween = null;
  }
  if (SEC.on) { holder.updateMatrixWorld(true); secWorld.copy(secLocal).applyMatrix4(holder.matrixWorld); renderer.clippingPlanes = [secWorld]; }
  if (selBox) selBox.update();
  hoverUpdate();
  controls.update();
  if (ORTHO) syncOrtho();
  dimsFacing();
  vcUpdate();
  composer.render(); FRAMES++;
  labelRenderer.render(scene, acam());
  requestAnimationFrame(tick);
}

/* ══ 輸出 PDF（兩頁 A4）══════════════════════════════════════════════════════════
   第 1 頁「外觀與尺寸」：等角渲染＋重點數字＋第三角法三視圖（依比例、標外殼尺寸與 I/O 接頭）＋標題欄。
   第 2 頁「內部結構與佈局」：爆炸圖＋疊層（依比例）＋PCB 佈局圖（兩面元件、銅塊、補肉、I/O 接頭）＋機構重點＋元件位置表。
   3D 圖在畫面外另外渲染（白底，不含選取框、剖面、畫面上的標籤）；整頁用 canvas 排版，每頁存成一張 200 dpi 的 JPEG，
   再自己組成 PDF —— 不需要字型檔（中文照畫面上的字型畫），也不靠外部套件。
   存檔：claude.ai 檢視器裡走 claude.use("downloads")（檢視者會先看到確認視窗）；直接開本機檔時用一般下載。 */
const PDF_DPI = 200, PX = PDF_DPI / 72, A4W = 595.28, A4H = 841.89, MM = 72 / 25.4, PG = 32;
const PC = { ink: '#15212c', ink2: '#4a5968', ink3: '#7b8895', rule: '#c7d0d8', tint: '#f1f4f6', acc: '#0a7f89',
             hsk: '#2f6ca3', hskDk: '#1f4f7c', fil: '#c9701a', coin: '#b8763e', boss: '#9a6a00', pcb: '#eaf2eb', pcbLn: '#5d8a66', gasket: '#d6bd6f', wall: '#dde3e8' };
const PF = { ui: '"Barlow","Noto Sans TC","Microsoft JhengHei",sans-serif', mono: '"IBM Plex Mono","Noto Sans TC",monospace' };
const PDF_BG = new THREE.Color(0xffffff);
let PDF_OUT = null;

/* ── 畫布小工具（單位＝pt，畫布已經依 200 dpi 放大） ── */
function pT(c, s, x, y, o) {
  o = o || {};
  c.font = (o.w || 400) + ' ' + (o.s || 8) + 'px ' + (o.m ? PF.mono : PF.ui);
  c.fillStyle = o.c || PC.ink; c.textAlign = o.a || 'left'; c.textBaseline = 'alphabetic';
  let t = String(s);
  if (o.max && c.measureText(t).width > o.max) { while (t.length > 1 && c.measureText(t + '…').width > o.max) t = t.slice(0, -1); t += '…'; }
  c.fillText(t, x, y);
  return c.measureText(t).width;
}
function pW(c, s, o) { c.font = ((o && o.w) || 400) + ' ' + ((o && o.s) || 8) + 'px ' + (o && o.m ? PF.mono : PF.ui); return c.measureText(String(s)).width; }
function pL(c, x1, y1, x2, y2, col, w, dash) { c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.strokeStyle = col || PC.ink; c.lineWidth = w || 0.5; c.setLineDash(dash || []); c.stroke(); c.setLineDash([]); }
function pArrow(c, x, y, ang, col) {
  const s = 3.4, w = 1.15; c.beginPath(); c.moveTo(x, y);
  c.lineTo(x - s * Math.cos(ang) + w * Math.sin(ang), y - s * Math.sin(ang) - w * Math.cos(ang));
  c.lineTo(x - s * Math.cos(ang) - w * Math.sin(ang), y - s * Math.sin(ang) + w * Math.cos(ang));
  c.closePath(); c.fillStyle = col; c.fill();
}
/* 尺寸線：a、b＝物體上的兩點（pt），往 n（單位向量）那一側偏 off；延伸線離物體 1.5 pt 起畫，字跟尺寸線平行、白底 */
function pDim(c, a, b, n, off, label, col) {
  col = col || PC.ink;
  const A = { x: a.x + n.x * off, y: a.y + n.y * off }, B = { x: b.x + n.x * off, y: b.y + n.y * off };
  pL(c, a.x + n.x * 1.5, a.y + n.y * 1.5, A.x + n.x * 2.5, A.y + n.y * 2.5, col, 0.35);
  pL(c, b.x + n.x * 1.5, b.y + n.y * 1.5, B.x + n.x * 2.5, B.y + n.y * 2.5, col, 0.35);
  pL(c, A.x, A.y, B.x, B.y, col, 0.45);
  const ang = Math.atan2(B.y - A.y, B.x - A.x); pArrow(c, B.x, B.y, ang, col); pArrow(c, A.x, A.y, ang + Math.PI, col);
  let rot = ang; if (rot > Math.PI / 2 + 1e-6) rot -= Math.PI; if (rot < -Math.PI / 2 - 1e-6) rot += Math.PI;
  c.save(); c.translate((A.x + B.x) / 2, (A.y + B.y) / 2); c.rotate(rot);
  const tw = pW(c, label, { s: 7, w: 500, m: true }); c.fillStyle = '#fff'; c.fillRect(-tw / 2 - 2, -4.8, tw + 4, 8.6);
  pT(c, label, 0, 2.5, { s: 7, w: 500, m: true, a: 'center', c: col }); c.restore();
}
function pBalloon(c, x, y, n) {
  c.beginPath(); c.arc(x, y, 4.4, 0, Math.PI * 2); c.fillStyle = '#fff'; c.fill(); c.strokeStyle = PC.ink; c.lineWidth = 0.5; c.stroke();
  pT(c, n, x, y + 2.1, { s: 5.6, w: 700, a: 'center', m: true });
}
function pPage() {
  const cv = document.createElement('canvas'); cv.width = Math.round(A4W * PX); cv.height = Math.round(A4H * PX);
  const c = cv.getContext('2d'); c.fillStyle = '#fff'; c.fillRect(0, 0, cv.width, cv.height); c.scale(PX, PX);
  return { cv, c };
}
function pHead(c, eyebrow, page, when) {
  pT(c, eyebrow, PG, 41, { s: 7.5, w: 600, c: PC.acc });
  pT(c, P.name, PG, 61, { s: 17, w: 700, max: 380 });
  pT(c, when, A4W - PG, 41, { s: 7.5, c: PC.ink2, a: 'right', m: true });
  pT(c, '第 ' + page + ' 頁／共 2 頁', A4W - PG, 61, { s: 7.5, c: PC.ink2, a: 'right' });
  pL(c, PG, 68, A4W - PG, 68, PC.ink, 0.8);
}
function pFoot(c, text) { pL(c, PG, A4H - 36, A4W - PG, A4H - 36, PC.rule, 0.5); pT(c, text, PG, A4H - 25, { s: 6.5, c: PC.ink3, max: A4W - 2 * PG }); }
function pSec(c, x, y, w, title, sub) {
  const tw = pT(c, title, x, y, { s: 9, w: 700 });
  if (sub) pT(c, sub, x + tw + 8, y, { s: 7, c: PC.ink2, max: w - tw - 8 });
  pL(c, x, y + 4, x + w, y + 4, PC.rule, 0.5);
}

/* ── 畫面外渲染 ── */
const pCorners = b => { const o = []; for (let i = 0; i < 8; i++) o.push(V(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z)); return o; };
function aoUse(cam) {
  const persp = cam.isPerspectiveCamera ? 1 : 0; renderPass.camera = cam; gtao.camera = cam;
  if (gtao.gtaoMaterial.defines.PERSPECTIVE_CAMERA !== persp) { gtao.gtaoMaterial.defines.PERSPECTIVE_CAMERA = persp; gtao.gtaoMaterial.needsUpdate = true; }
  if (gtao.depthRenderMaterial && gtao.depthRenderMaterial.defines.PERSPECTIVE_CAMERA !== persp) { gtao.depthRenderMaterial.defines.PERSPECTIVE_CAMERA = persp; gtao.depthRenderMaterial.needsUpdate = true; }
}
/* 拍一張：暫時改畫布大小與相機、白底，藏選取框／剖面輔助面；同一段同步程式內拍完就還原（動畫迴圈插不進來） */
function pShoot(w, h, cam, withFloor) {
  const pr = renderer.getPixelRatio(), bg = scene.background, fv = floor.visible, cvis = contacts.map(q => q.visible), prevCam = renderPass.camera;
  const clip = renderer.clippingPlanes, sbv = selBox ? selBox.visible : false, fo = flashObj ? flashObj.visible : false, helpers = [];
  scene.traverse(o => { if (o.userData && o.userData.secHelper && o.visible) { helpers.push(o); o.visible = false; } });
  try {
    renderer.setPixelRatio(1); composer.setPixelRatio(1); renderer.setSize(w, h, false); composer.setSize(w, h);
    scene.background = PDF_BG; floor.visible = !!withFloor; if (!withFloor) contacts.forEach(q => { q.visible = false; });
    if (selBox) selBox.visible = false; if (flashObj) flashObj.visible = false; renderer.clippingPlanes = [];
    aoUse(cam); holder.updateMatrixWorld(true); composer.render();
    const out = document.createElement('canvas'); out.width = w; out.height = h; const oc = out.getContext('2d'); oc.drawImage(renderer.domElement, 0, 0, w, h);
    if (withFloor) pWhite(oc, w, h);                 // 產品圖（有地面陰影）提到白底；三視圖留淺灰底，白色的鰭片才看得出來
    return out;
  } finally {
    scene.background = bg; floor.visible = fv; contacts.forEach((q, i) => { q.visible = cvis[i]; }); helpers.forEach(o => { o.visible = true; });
    renderer.clippingPlanes = clip; if (selBox) selBox.visible = sbv; if (flashObj) flashObj.visible = fo;
    aoUse(prevCam); renderer.setPixelRatio(pr); composer.setPixelRatio(pr); resize();
  }
}
/* 色調映射會把白底壓成淺灰：以角落的底色當白點，整張等比例提亮（陰影與模型的明暗關係不變） */
function pWhite(oc, w, h) {
  const im = oc.getImageData(0, 0, w, h), d = im.data, i0 = 4 * (2 * w + 2), b = [d[i0], d[i0 + 1], d[i0 + 2]];
  if (Math.min(b[0], b[1], b[2]) < 150) return;
  const f = b.map(v => 255 / v);
  for (let i = 0; i < d.length; i += 4) { d[i] *= f[0]; d[i + 1] *= f[1]; d[i + 2] *= f[2]; }
  oc.putImageData(im, 0, 0);
}
/* 透視相機：外框的 8 個角都放進畫面（fill＝佔畫面比例），再把投影後的外框挪到正中 */
function pPersp(w, h, dir, box, fill) {
  const cam = new THREE.PerspectiveCamera(camera.fov, w / h, 10, 40000), ctr = box.getCenter(new THREE.Vector3()), pts = pCorners(box);
  let d = box.getSize(new THREE.Vector3()).length() * 1.6;
  const place = () => { cam.position.copy(ctr).addScaledVector(dir, d); cam.up.set(0, 1, 0); cam.lookAt(ctr); cam.updateMatrixWorld(true); cam.updateProjectionMatrix(); };
  for (let it = 0; it < 10; it++) { place(); let m = 0.05; pts.forEach(p => { const q = p.clone().project(cam); m = Math.max(m, Math.abs(q.x), Math.abs(q.y)); }); d *= Math.pow(m / fill, 0.9); }
  place();
  let x0 = 1, x1 = -1, y0 = 1, y1 = -1; pts.forEach(p => { const q = p.clone().project(cam); x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y); });
  const hh = d * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)), hw = hh * cam.aspect;
  cam.position.add(V(1, 0, 0).applyQuaternion(cam.quaternion).multiplyScalar((x0 + x1) / 2 * hw)).add(V(0, 1, 0).applyQuaternion(cam.quaternion).multiplyScalar((y0 + y1) / 2 * hh));
  cam.updateMatrixWorld(true);
  return cam;
}
/* 正交相機（依比例）：k＝每 mm 幾個頁面像素；pad＝外框四周留白（mm） */
function pOrtho(dir, up, box, k, pad) {
  const f = dir.clone().negate(), r = new THREE.Vector3().crossVectors(f, up).normalize(), u = new THREE.Vector3().crossVectors(r, f).normalize();
  const ctr = box.getCenter(new THREE.Vector3()); let ex = 0, ey = 0;
  pCorners(box).forEach(p => { const d = p.clone().sub(ctr); ex = Math.max(ex, Math.abs(d.dot(r))); ey = Math.max(ey, Math.abs(d.dot(u))); });
  const hw = ex + pad, hh = ey + pad, dist = box.getSize(new THREE.Vector3()).length() * 2 + 200;
  const cam = new THREE.OrthographicCamera(-hw, hw, hh, -hh, 1, dist * 3);
  cam.up.copy(up); cam.position.copy(ctr).addScaledVector(dir, dist); cam.lookAt(ctr); cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
  const w = Math.round(2 * hw * k), h = Math.round(2 * hh * k);
  return { cam, w, h, pt: p => { const q = p.clone().project(cam); return { x: (q.x + 1) / 2 * w / PX, y: (1 - q.y) / 2 * h / PX }; } };
}
/* 三視圖比例：由小到大試標準比例，放得下就用（A4 列印時的比例） */
const PDF_SCALES = [1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30];
function pScale(sx, sy, sz, availW, availH) {
  for (const S of PDF_SCALES) {
    const u = MM / S, pad = 2;
    const wL = (sz + 2 * pad) * u, wF = (sx + 2 * pad) * u, hT = (sz + 2 * pad) * u, hF = (sy + 2 * pad) * u;
    if (22 + wL + 8 + wF + 38 <= availW && hT + 12 + hF + 24 <= availH) return S;
  }
  return PDF_SCALES[PDF_SCALES.length - 1];
}

/* 拍全部需要的圖：組裝（等角＋三視圖）、爆炸。標準姿勢、寫實、四大部件與所有零件都顯示；拍完全部還原 */
function pdfShots() {
  const st0 = state.st, up0 = state.upright, mode0 = state.mode, solo0 = state.solo, hide0 = Object.assign({}, HIDE), hideI0 = new Set(HIDEI), pf0 = state.pflip;
  state.pflip = false;
  tween = null;                                   // 零件移動的動畫直接到位（拍完會照原本的狀態放回去）
  const out = {};
  try {
    if (mode0 !== 'real') { state.mode = 'real'; applyMode(); }
    state.solo = null; Object.values(PARTS()).forEach(o => { if (o) o.visible = true; });
    Object.keys(HIDE).forEach(k => { HIDE[k] = false; }); HIDEI.clear(); applyHide();
    state.upright = false; applyState('asm', true); if (dimsA) dimsA.visible = false; holder.updateMatrixWorld(true);
    const g = P.g, r = P.r, box = bbox.clone(), sz3 = box.getSize(new THREE.Vector3());
    const L = r.L, W = r.W, Ht = g.H_filter + g.H_shield + g.t_base + r.FH, env = (x, y, z) => holder.localToWorld(V(x, y, z));
    out.iso = pShoot(Math.round(340 * PX), Math.round(250 * PX), pPersp(Math.round(340 * PX), Math.round(250 * PX), VIEWS.iso.d.clone().normalize(), box, 0.9), true);
    const S = pScale(sz3.x, sz3.y, sz3.z, A4W - 2 * PG, 348), k = MM / S * PX;
    const view = (dir, up) => { const o = pOrtho(dir, up, box, k, 2); o.img = pShoot(o.w, o.h, o.cam, false); return o; };
    const fr = view(V(0, 0, 1), V(0, 1, 0)), tp = view(V(0, 1, 0), V(0, 0, -1)), lf = view(V(-1, 0, 0), V(0, 1, 0));
    fr.d = { L: [fr.pt(env(0, 0, W)), fr.pt(env(L, 0, W))], H: [fr.pt(env(L, 0, W)), fr.pt(env(L, Ht, W))], FH: [fr.pt(env(L, Ht - r.FH, W)), fr.pt(env(L, Ht, W))] };
    tp.d = { W: [tp.pt(env(L, Ht, 0)), tp.pt(env(L, Ht, W))] };
    lf.d = { W: [lf.pt(env(0, 0, 0)), lf.pt(env(0, 0, W))], H: [lf.pt(env(0, 0, 0)), lf.pt(env(0, Ht, 0))] };
    // I/O 端的接頭：每一組的外框中心與上緣（左視圖上標名稱）
    lf.ports = [];
    const tag = (grp, name) => { const b = new THREE.Box3().setFromObject(grp); if (b.isEmpty()) return; const cc = b.getCenter(new THREE.Vector3());
      lf.ports.push({ name, c: lf.pt(cc), top: lf.pt(V(cc.x, b.max.y, cc.z)) }); };
    (HSK.userData.io ? HSK.userData.io.children : []).forEach(pg => { if (pg.userData.port) tag(pg, ioLabel(pg.userData.port.i)); });
    (FIL.userData.ant ? FIL.userData.ant.children : []).forEach(pg => { if (pg.userData.port) tag(pg, antLabel(pg.userData.port.i)); });
    Object.assign(out, { S, fr, tp, lf, L, W, Ht });
    applyState('exp', true); if (dimsA) dimsA.visible = false; holder.updateMatrixWorld(true);
    const ew = Math.round((A4W - 2 * PG) * PX), eh = Math.round(236 * PX), ecam = pPersp(ew, eh, VIEWS.exp.d.clone().normalize(), bbox.clone(), 0.94);
    out.exp = pShoot(ew, eh, ecam, true);
    const eproj = p => { const q = p.clone().project(ecam); return { x: (q.x + 1) / 2 * ew / PX, y: (1 - q.y) / 2 * eh / PX }; };
    out.expParts = [['hsk', HSK], ['pcb', PCB], ['shd', SHD], ['fil', FIL]].map(([key, o]) => {
      const b = new THREE.Box3().setFromObject(o); if (b.isEmpty()) return null;
      let xr = -1e9; pCorners(b).forEach(p => { xr = Math.max(xr, eproj(p).x); });
      return { key, c: eproj(b.getCenter(new THREE.Vector3())), xr };
    }).filter(Boolean);
  } finally {
    state.upright = up0; state.pflip = pf0; state.solo = solo0; applyState(st0, true);   // 先還原部件組合：整組翻的中心跟著顯示中的部件
    Object.assign(HIDE, hide0); hideI0.forEach(k => HIDEI.add(k)); applyHide();
    applySolo();
    if (state.mode !== mode0) { state.mode = mode0; applyMode(); }
    updateVis();
  }
  return out;
}

/* ── 資料整理（兩頁共用） ── */
function pdfFacts() {
  const g = P.g, r = P.r, E = ed(), S = LAY.shd.S;
  const rows = [...new Set(LAY.inst.map(o => o.row))];
  const heat = P.rows.filter(q => q.W > 0).reduce((a, q) => a + q.W, 0);
  const bn = P.rows.find(q => q.name === r.bn) || null, edited = P.rows.some(q => typeof E.hgt[q.name] === 'number' && q.W > 0);
  const pockets = LAY.inst.filter(o => o.pocket), coins = LAY.inst.filter(o => o.ct.kind === 'coin');
  const cells = LAY.shd.cells, fmin = cells.length ? Math.min(...cells.map(q => q.f)) : null;
  return { g, r, S, rows, heat, bn, edited, pockets, coins, cells, fmin, bosses: LAY.bosses || [], io: ioLayout(), ant: portsLayout(antList(), ANT_TYPES) };
}
const pWhen = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); return { day: d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()), full: d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()), tag: '' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) }; };

/* ── 第 1 頁：外觀與尺寸 ── */
const PDF_LAYERS = F => {
  const g = F.g, r = F.r, S = F.S;
  return [
    { n: '濾波器', t: g.H_filter, col: '#bdb6aa', txt: PC.ink, note: '調諧螺絲收在高度內' },
    { n: '屏蔽罩', t: LAY.df, col: '#cdd2d8', txt: PC.ink, note: S.on ? '頂板 ' + S.roof + ' · 腔深 ' + f1(LAY.shd.depth) : '只有空間' },
    { n: 'PCB', t: g.t_PCB || 2, col: '#4f8a5b', txt: '#fff', note: '貼基板內側' },
    { n: '基板', t: g.t_base, col: '#9aa8b5', txt: PC.ink, note: '凹槽 ' + F.pockets.length + ' · 補肉 ' + F.bosses.length },
    { n: '鰭片', t: r.FH, col: '#e2e7ec', txt: PC.ink, note: r.n + ' 片 · ' + finSpecTxt() },
  ];
};
/* 高度組成（依比例的橫條）：由左（濾波器底面）到右（鰭片頂端）；窄的層把名稱放到上方、自動錯開 */
function pdfHeightBar(c, x, y, w, F) {
  const Ls = PDF_LAYERS(F), tot = Ls.reduce((a, q) => a + q.t, 0), sc = w / tot;
  pSec(c, x, y, w, '高度組成', '依比例 · 由左（濾波器底面）到右（鰭片頂端）· 合計 ' + f1(tot) + ' mm');
  const by = y + 34, bh = 20; let xx = x; const above = [], rowsUsed = [];
  Ls.forEach(q => {
    const sw = q.t * sc; c.fillStyle = q.col; c.fillRect(xx, by, sw, bh); c.strokeStyle = PC.ink; c.lineWidth = 0.4; c.strokeRect(xx, by, sw, bh);
    const lab = q.n + ' ' + f1(q.t), lw = pW(c, lab, { s: 7.5, w: 700 });
    if (sw >= lw + 8) pT(c, lab, xx + sw / 2, by + bh / 2 + 2.7, { s: 7.5, w: 700, a: 'center', c: q.txt });
    else above.push({ lab, cx: xx + sw / 2, lw });
    xx += sw;
  });
  above.forEach(a => {                               // 放在橫條上方：選最低、不跟別的標籤重疊的那一排
    let row = 0; while ((rowsUsed[row] || []).some(u => Math.abs(u.cx - a.cx) < (u.lw + a.lw) / 2 + 6)) row++;
    (rowsUsed[row] = rowsUsed[row] || []).push(a);
    const ly = by - 5 - row * 10; pL(c, a.cx, by, a.cx, ly + 1.5, PC.ink3, 0.4); pT(c, a.lab, a.cx, ly, { s: 7, w: 700, a: 'center' });
  });
  let cum = 0; xx = x; pT(c, '0', x, by + bh + 9, { s: 6, m: true, a: 'center', c: PC.ink2 });
  Ls.forEach(q => { cum += q.t; xx += q.t * sc; pL(c, xx, by + bh, xx, by + bh + 3, PC.ink2, 0.4); pT(c, f1(cum), xx, by + bh + 9, { s: 6, m: true, a: cum === tot ? 'right' : 'center', c: PC.ink2 }); });
  pT(c, Ls.map(q => q.n + '：' + q.note).join('　·　'), x, by + bh + 22, { s: 6.5, c: PC.ink2, max: w });
  return by + bh + 26 - y;
}
function pdfPage1(sh, F, when) {
  const { cv, c } = pPage(), g = F.g, r = F.r;
  pHead(c, 'RRU 3D 模型 · 外觀與尺寸', 1, when.full);
  c.drawImage(sh.iso, PG, 78, 340, 250);
  // 重點數字
  const kx = 386, kw = A4W - PG - kx, bnr = F.bn;
  const bnSub = bnr ? bnr.ref + ' ' + f1(bnr.Tref + dTemp(bnr)) + ' °C／限溫 ' + bnr.lim + (F.edited ? '（估）' : '') : '';
  const kp = [
    ['外觀尺寸 L × W × H', r.L + ' × ' + r.W + ' × ' + f1(r.H), 'mm', '長＝鰭片方向（吊掛後上下）'],
    ['體積', r.V.toFixed(2), 'L', ''],
    ['重量', r.kg.toFixed(1), 'kg', '工具的重量模型（含屏蔽罩一項）'],
    ['鰭片', r.n + ' 片 × ' + f1(r.FH), 'mm', finSpecTxt() + ' mm · ' + g.tech],
    ['熱負載', f1(F.heat), 'W', '發熱元件實際功耗合計'],
    ['基板溫度', f1(r.T_base), '°C', '環境溫度 ' + g.T_amb + ' °C'],
    ['瓶頸元件', bnr ? bnr.name : '—', '', bnr ? '裕度 ' + f1(estMargin(bnr)) + ' °C · ' + bnSub : ''],
  ];
  let ky = 78;
  kp.forEach(([lab, val, unit, sub]) => {
    pT(c, lab, kx, ky + 8.5, { s: 7, c: PC.ink2 });
    const vw = pT(c, val, kx, ky + 22.5, { s: 13, w: 600, m: true, max: kw - 20 });
    if (unit) pT(c, unit, kx + vw + 3, ky + 22.5, { s: 7.5, c: PC.ink2 });
    if (sub) pT(c, sub, kx, ky + 31.5, { s: 6.3, c: PC.ink3, max: kw });
    ky += 36; pL(c, kx, ky - 1.5, A4W - PG, ky - 1.5, PC.rule, 0.4);
  });
  // 三視圖（第三角法：上視在前視上方、左視在前視左方）
  const S = sh.S, sec = 348;
  pSec(c, PG, sec, A4W - 2 * PG, '三視圖', '第三角法 · 比例 1:' + S + '（A4 列印時）· 尺寸單位 mm · 外殼尺寸（不含接頭）');
  const fr = sh.fr, tp = sh.tp, lf = sh.lf, wL = lf.w / PX, hT = tp.h / PX, wF = fr.w / PX, hF = fr.h / PX;
  const xL = PG + 22, xF = xL + wL + 8, yT = sec + 16, yF = yT + hT + 12;
  c.drawImage(tp.img, xF, yT, wF, hT); c.drawImage(fr.img, xF, yF, wF, hF); c.drawImage(lf.img, xL, yF, wL, lf.h / PX);
  const at = (x0, y0) => p => ({ x: x0 + p.x, y: y0 + p.y });
  const F1 = at(xF, yF), T1 = at(xF, yT), L1 = at(xL, yF);
  pDim(c, F1(fr.d.L[0]), F1(fr.d.L[1]), { x: 0, y: 1 }, 12, String(sh.L));
  pDim(c, F1(fr.d.H[0]), F1(fr.d.H[1]), { x: 1, y: 0 }, 12, f1(sh.Ht));
  pDim(c, F1(fr.d.FH[0]), F1(fr.d.FH[1]), { x: 1, y: 0 }, 28, f1(F.r.FH) + ' 鰭片');
  pDim(c, T1(tp.d.W[0]), T1(tp.d.W[1]), { x: 1, y: 0 }, 12, String(sh.W));
  pDim(c, L1(lf.d.W[0]), L1(lf.d.W[1]), { x: 0, y: 1 }, 12, String(sh.W));
  pDim(c, L1(lf.d.H[0]), L1(lf.d.H[1]), { x: -1, y: 0 }, 12, f1(sh.Ht));
  // 左視圖（I/O 端）：接頭名稱標在接頭上方
  lf.ports.forEach(q => { const p = L1(q.top), tw = pW(c, q.name, { s: 5.8, w: 600 }); c.fillStyle = 'rgba(255,255,255,0.9)'; c.fillRect(p.x - tw / 2 - 1.5, p.y - 8.6, tw + 3, 7.2); pT(c, q.name, p.x, p.y - 2.8, { s: 5.8, w: 600, a: 'center' }); });
  pT(c, '上視（鰭片側）', xF, yT - 3, { s: 6.5, w: 600, c: PC.ink2 });
  pT(c, '前視（長邊側面）', xF, yF - 3, { s: 6.5, w: 600, c: PC.ink2 });
  pT(c, '左視（I/O 端）', xL, yF - 3, { s: 6.5, w: 600, c: PC.ink2 });
  // 標題欄（左上空出來的那一格）
  const bx = PG, bw = Math.min(xF - 16 - PG, 230), by = yT, rowsTB = [
    ['專案', P.name], ['日期', when.day], ['單位', 'mm'], ['比例', '1:' + S + '（A4）'], ['投影', '第三角法'],
    ['外殼', r.L + ' × ' + r.W + ' × ' + f1(r.H)], ['來源', '參數控制台 · 元件設定 · 3D 頁調整'], ['工具', '5G RRU 快速體積評估 · 3D 頁']];
  const rh = Math.min(15, (hT - 4) / rowsTB.length);
  c.strokeStyle = PC.ink; c.lineWidth = 0.7; c.strokeRect(bx, by, bw, rh * rowsTB.length);
  rowsTB.forEach(([k2, v], i) => {
    const y = by + i * rh; if (i) pL(c, bx, y, bx + bw, y, PC.rule, 0.4);
    pT(c, k2, bx + 5, y + rh / 2 + 2.5, { s: 6.5, c: PC.ink2 }); pT(c, v, bx + 36, y + rh / 2 + 2.5, { s: 7, w: i === 0 ? 700 : 400, max: bw - 40 });
  });
  pL(c, bx + 32, by, bx + 32, by + rh * rowsTB.length, PC.rule, 0.4);
  // 高度組成：接在三視圖下面
  pdfHeightBar(c, PG, Math.max(yF + hF + 30, 640), A4W - 2 * PG, F);
  pFoot(c, '初步評估用：尺寸由參數控制台、元件設定與 3D 頁的調整產生；正式尺寸以機構圖為準。' + (F.edited ? '有元件的相對高度在 3D 頁改過：溫度為估計值，接進工具後會完整重算。' : ''));
  return cv;
}

/* ── 第 2 頁：內部結構與佈局 ── */
function pdfMap(c, X, Y, maxW, maxH, F) {
  const g = F.g, r = F.r, s = Math.min(maxW / r.L, maxH / r.W), px = x => X + x * s, pz = z => Y + z * s;
  const LP = LAY.loops, trace = (pts, fresh = true) => { if (fresh) c.beginPath(); pts.forEach(([x, z], i) => i ? c.lineTo(px(x), pz(z)) : c.moveTo(px(x), pz(z))); c.closePath(); };
  // 外殼牆（含往內凸的螺絲柱）→ 防水膠條（繞開螺絲孔）→ PCB（螺絲柱處缺口）→ 螺絲孔
  c.beginPath(); c.rect(px(0), pz(0), r.L * s, r.W * s); trace(LP.boss.pts, false); c.fillStyle = PC.wall; c.fill('evenodd');
  c.strokeStyle = PC.ink3; c.lineWidth = 0.5; c.strokeRect(px(0), pz(0), r.L * s, r.W * s); trace(LP.boss.pts); c.lineWidth = 0.35; c.stroke();
  trace(LP.gasket.pts); c.strokeStyle = PC.gasket; c.lineWidth = Math.max(0.9, GK_W * s); c.lineJoin = 'round'; c.stroke(); c.lineJoin = 'miter';
  trace(LP.pcb.pts); c.fillStyle = PC.pcb; c.fill(); c.strokeStyle = PC.pcbLn; c.lineWidth = 0.7; c.stroke();
  (LAY.screws || []).forEach(e => { c.beginPath(); c.arc(px(e.x), pz(e.z), Math.max(1, SC_HOLE * s), 0, Math.PI * 2); c.fillStyle = PC.ink; c.fill(); });
  // 刻度：沿 PCB 上緣＝距 I/O 端 PCB 邊（相對高度）；沿右緣＝距 PCB 左緣（橫向）
  for (let d = 0; d <= g.L_pcb + 0.01; d += 50) { const xx = px(g.Btm + d); pL(c, xx, pz(0) - 1.5, xx, pz(0) - 4.5, PC.ink2, 0.4); pT(c, d, xx, pz(0) - 6, { s: 5.5, m: true, a: 'center', c: PC.ink2 }); }
  for (let d = 0; d <= g.W_pcb + 0.01; d += 50) { const zz = pz(g.Left + d); pL(c, px(r.L) + 1.5, zz, px(r.L) + 4.5, zz, PC.ink2, 0.4); pT(c, d, px(r.L) + 6, zz + 2, { s: 5.5, m: true, c: PC.ink2 }); }
  // 銅塊（HSK 側底板）
  F.coins.forEach(o => { const w = o.cL * s, h = o.cW * s; c.fillStyle = 'rgba(184,118,62,0.22)'; c.fillRect(px(o.x) - w / 2, pz(o.z) - h / 2, w, h); c.strokeStyle = PC.coin; c.lineWidth = 0.5; c.setLineDash([2, 1.2]); c.strokeRect(px(o.x) - w / 2, pz(o.z) - h / 2, w, h); c.setLineDash([]); });
  // 元件：HSK 側實心藍、濾波器側橘框；圓圈號碼＝元件位置表的項次
  F.rows.forEach((row, ri) => LAY.inst.filter(o => o.row === row).forEach(o => {
    const w = Math.max(o.bL * s, 1.2), h = Math.max(o.bW * s, 1.2), x0 = px(o.x) - w / 2, z0 = pz(o.z) - h / 2;
    if (o.side === 'hsk') { c.fillStyle = PC.hsk; c.fillRect(x0, z0, w, h); c.strokeStyle = PC.hskDk; c.lineWidth = 0.5; c.strokeRect(x0, z0, w, h); }
    else { c.fillStyle = 'rgba(201,112,26,0.14)'; c.fillRect(x0, z0, w, h); c.strokeStyle = PC.fil; c.lineWidth = 0.9; c.strokeRect(x0, z0, w, h); }
  }));
  const taken = [], OFF = [[0, 0], [9.6, 0], [-9.6, 0], [0, -9.6], [0, 9.6], [9.6, -9.6], [-9.6, -9.6], [9.6, 9.6], [-9.6, 9.6], [19, 0], [-19, 0]];
  F.rows.forEach((row, ri) => LAY.inst.filter(o => o.row === row).forEach(o => {
    const x = px(o.x), y = pz(o.z), off = OFF.find(([dx, dy]) => !taken.some(t => Math.hypot(t.x - x - dx, t.y - y - dy) < 9.4)) || [0, 0];
    taken.push({ x: x + off[0], y: y + off[1], ox: x, oy: y, n: ri + 1 });
  }));
  // 補肉（鰭片側加高）：點線框＋加高多少；標籤放在框的四個角外側，挑不會壓到號碼圈的那一個
  F.bosses.forEach(b => {
    const x0 = px(b.x0), x1 = px(b.x1), z0 = pz(b.z0), z1 = pz(b.z1), lab = '+' + f1(b.h), lw = pW(c, lab, { s: 5.5, w: 600, m: true });
    c.setLineDash([1.2, 1.2]); c.strokeStyle = PC.boss; c.lineWidth = 0.9; c.strokeRect(x0, z0, x1 - x0, z1 - z0); c.setLineDash([]);
    const spots = [[x1 - lw, z0 - 1.8], [x0 + 1, z0 - 1.8], [x1 - lw, z1 + 6.2], [x0 + 1, z1 + 6.2]];
    const ok = ([lx, ly]) => !taken.some(t => t.x + 4.4 > lx - 1 && t.x - 4.4 < lx + lw + 1 && t.y + 4.4 > ly - 6 && t.y - 4.4 < ly + 1.5);
    const [lx, ly] = spots.find(ok) || spots[0];
    pT(c, lab, lx, ly, { s: 5.5, w: 600, m: true, c: PC.boss });
  });
  taken.forEach(t => {
    if (t.x !== t.ox || t.y !== t.oy) { pL(c, t.ox, t.oy, t.x, t.y, PC.ink, 0.4); c.beginPath(); c.arc(t.ox, t.oy, 0.9, 0, Math.PI * 2); c.fillStyle = PC.ink; c.fill(); }
    pBalloon(c, t.x, t.y, t.n);
  });
  // I/O 端的接頭（外殼 I/O 端，x＝0）：黑色短條＋名稱
  F.io.forEach(p => { const zc = pz(p.z), hw = p.w / 2 * s; c.fillStyle = PC.ink; c.fillRect(px(0) - 3, zc - hw, 3, 2 * hw); pT(c, ioLabel(p.i), px(0) - 5, zc + 2.2, { s: 6, w: 600, a: 'right' }); });
  return { w: r.L * s, h: r.W * s, s };
}
function pdfBom(c, X, Y, W, maxH, F) {
  const g = F.g, E = ed();
  const cols = [['項次', 24, 'c'], ['元件', 110, 'l'], ['面', 40, 'l'], ['數量', 24, 'r'], ['導熱方式', 54, 'l'], ['相對高度', 42, 'r'], ['橫向（距 PCB 左緣）', 0, 'l'], ['轉向', 46, 'l']];
  cols[6][1] = W - cols.reduce((a, q) => a + q[1], 0);
  const data = F.rows.map((row, ri) => {
    const list = LAY.inst.filter(o => o.row === row), hChg = typeof E.hgt[row.name] === 'number';
    const lat = list.map(o => f1(o.z - g.Left) + (isManualZ(o) ? '*' : '') + (o.port ? '（對齊 ' + ioLabel(ioList().indexOf(o.port)) + ' 光口）' : ''));
    const rotN = list.filter(o => o.rot);
    return [ri + 1, row.name, list[0].side === 'hsk' ? 'HSK 側' : '濾波器側', row.qty, row.bt || '—', f1(hgtOf(row)) + (hChg ? '*' : ''), lat.join(' / '),
            !rotN.length ? '—' : rotN.length === list.length ? '全部 90°' : rotN.map(o => '#' + (o.i + 1)).join('、') + ' 90°'];
  });
  let fs = 7, lh = 9, pad = 3.2;
  const wrap = (txt, w, f) => { const parts = String(txt).split(' / '); const lines = []; let cur = ''; parts.forEach((p, i) => { const t = cur ? cur + ' / ' + p : p; if (cur && pW(c, t, { s: f, m: true }) > w) { lines.push(cur + ' /'); cur = p; } else cur = t; }); if (cur) lines.push(cur); return lines; };
  const heights = () => data.map(d => Math.max(1, wrap(d[6], cols[6][1] - 14, fs).length) * lh + pad * 2);
  let hs = heights(); if (14 + hs.reduce((a, b) => a + b, 0) + 14 > maxH) { fs = 6.2; lh = 7.8; pad = 2.4; hs = heights(); }
  // 表頭
  c.fillStyle = PC.tint; c.fillRect(X, Y, W, 14); pL(c, X, Y + 14, X + W, Y + 14, PC.ink, 0.6);
  let cx = X; cols.forEach(([n, w, al]) => { pT(c, n, al === 'r' ? cx + w - 4 : al === 'c' ? cx + w / 2 : cx + 4, Y + 9.6, { s: 6.8, w: 700, a: al === 'r' ? 'right' : al === 'c' ? 'center' : 'left', c: PC.ink2 }); cx += w; });
  let y = Y + 14;
  data.forEach((d, i) => {
    const h = hs[i]; if (i % 2) { c.fillStyle = '#f8fafb'; c.fillRect(X, y, W, h); }
    let x = X;
    cols.forEach(([n, w, al], j) => {
      const mono = j === 3 || j === 5 || j === 6, ty = y + pad + fs;
      if (j === 0) pBalloon(c, x + w / 2, y + h / 2, d[0]);
      else if (j === 6) wrap(d[6], w - 14, fs).forEach((ln, k2) => pT(c, ln, x + 4, ty + k2 * lh, { s: fs, m: true }));
      else pT(c, d[j], al === 'r' ? x + w - 4 : x + 4, ty, { s: fs, m: mono, w: j === 1 ? 600 : 400, a: al === 'r' ? 'right' : 'left', max: w - 6 });
      x += w;
    });
    y += h; pL(c, X, y, X + W, y, PC.rule, 0.4);
  });
  pT(c, '* 在 3D 頁調整過（相對高度會寫回元件設定；橫向只影響 3D 位置）。圓圈號碼對應上方佈局圖。', X, y + 10, { s: 6.3, c: PC.ink3, max: W });
  return y + 12 - Y;
}
function pdfPage2(sh, F, when) {
  const { cv, c } = pPage(), g = F.g, r = F.r, S = F.S, ew = A4W - 2 * PG;
  pHead(c, 'RRU 3D 模型 · 內部結構與佈局', 2, when.full);
  // 爆炸圖（整頁寬）＋四大部件的名稱：由下往上是組裝順序
  c.drawImage(sh.exp, PG, 78, ew, 236);
  const nm = {
    hsk: ['④ 散熱器（HSK）', '基板 ' + g.t_base + ' mm · 鰭片 ' + r.n + ' 片 × ' + f1(r.FH) + ' mm'],
    pcb: ['③ PCB', g.L_pcb + ' × ' + g.W_pcb + ' × ' + (g.t_PCB || 2) + ' mm · ' + LAY.inst.length + ' 顆元件'],
    shd: ['② 屏蔽罩', S.on ? F.cells.length + ' 格腔體 · 高 ' + f1(LAY.df) + ' mm · 頂板 ' + S.roof : '未使用'],
    fil: ['① 腔體濾波器', '高 ' + g.H_filter + ' mm · 天線座 ' + F.ant.length + ' 個'] };
  const parts = (sh.expParts || []).slice().sort((a, b) => a.c.y - b.c.y), right = Math.max(...parts.map(q => q.xr), 0);
  const lx = PG + Math.min(ew - 150, right + 30); let lastY = -1e9;
  parts.forEach(q => {
    const t = nm[q.key]; if (!t) return;
    const ly = Math.max(78 + 12, Math.max(q.c.y + 78, lastY + 24)); lastY = ly;
    const ax = PG + q.c.x, ay = 78 + q.c.y;
    pL(c, ax, ay, lx - 4, ly - 3, PC.ink, 0.45); c.beginPath(); c.arc(ax, ay, 1.3, 0, Math.PI * 2); c.fillStyle = PC.ink; c.fill();
    pT(c, t[0], lx, ly, { s: 8.5, w: 700 }); pT(c, t[1], lx, ly + 9, { s: 6.5, c: PC.ink2, max: A4W - PG - lx });
  });
  pT(c, '爆炸圖 · 由下往上＝組裝順序', PG, 78 + 236 + 9, { s: 6.5, w: 600, c: PC.ink2 });
  // PCB 佈局
  const sec = 340;
  pSec(c, PG, sec, A4W - 2 * PG, 'PCB 佈局', '俯視、跟三視圖的上視同方向（I/O 端在左）· 刻度：上緣＝距 PCB I/O 端邊緣，右緣＝距 PCB 左緣（mm）');
  const mapX = PG + 30, mapY = sec + 22, colX = 392, m = pdfMap(c, mapX, mapY, colX - 22 - mapX, 212, F);
  // 右欄：圖例＋機構重點＋I/O 端
  let yy = mapY - 4;
  const leg = [[PC.hsk, 'fill', 'HSK 側元件'], [PC.fil, 'line', '濾波器側元件'], [PC.coin, 'coin', '銅塊底板'], [PC.boss, 'dot', '補肉（+ 加高 mm）'], [PC.gasket, 'gasket', '防水膠條（繞開孔位）'], [PC.wall, 'screw', '牆＋螺絲柱（M3 孔）']];
  leg.forEach(([col, kind, txt], i) => {
    const lx = colX + (i % 2) * 88, ly = yy + Math.floor(i / 2) * 11.5;
    if (kind === 'fill') { c.fillStyle = col; c.fillRect(lx, ly, 10, 7); }
    else if (kind === 'line') { c.strokeStyle = col; c.lineWidth = 0.9; c.strokeRect(lx + 0.5, ly + 0.5, 9, 6); }
    else if (kind === 'coin') { c.fillStyle = 'rgba(184,118,62,0.22)'; c.fillRect(lx, ly, 10, 7); c.strokeStyle = col; c.lineWidth = 0.5; c.setLineDash([2, 1.2]); c.strokeRect(lx, ly, 10, 7); c.setLineDash([]); }
    else if (kind === 'gasket') { pL(c, lx, ly + 3.5, lx + 10, ly + 3.5, col, 1.6); }
    else if (kind === 'screw') { c.fillStyle = col; c.fillRect(lx, ly, 10, 7); c.strokeStyle = PC.ink3; c.lineWidth = 0.35; c.strokeRect(lx, ly, 10, 7); c.beginPath(); c.arc(lx + 5, ly + 3.5, 1.2, 0, Math.PI * 2); c.fillStyle = PC.ink; c.fill(); }
    else { c.strokeStyle = col; c.lineWidth = 0.9; c.setLineDash([1.2, 1.2]); c.strokeRect(lx + 0.5, ly + 0.5, 9, 6); c.setLineDash([]); }
    pT(c, txt, lx + 14, ly + 6.3, { s: 6.6, max: 72 });
  });
  yy += Math.ceil(leg.length / 2) * 11.5 + 10; pT(c, '機構重點', colX, yy, { s: 8, w: 700 }); pL(c, colX, yy + 3, A4W - PG, yy + 3, PC.rule, 0.4); yy += 13;
  const maxBoss = F.bosses.length ? Math.max(...F.bosses.map(b => b.h)) : 0, maxPock = F.pockets.length ? Math.max(...F.pockets.map(o => o.pocket.depth)) : 0;
  const notes = [
    ['PCB', g.L_pcb + ' × ' + g.W_pcb + ' × ' + (g.t_PCB || 2) + ' mm'],
    ['銅塊', F.coins.length ? g.Coin_L + ' × ' + g.Coin_W + ' × ' + g.Coin_T + ' mm × ' + F.coins.length : '沒有'],
    ['基板凹槽', F.pockets.length + ' 處 · 最深 ' + f1(maxPock) + ' mm（基板 ' + g.t_base + '）'],
    ['補肉', F.bosses.length ? F.bosses.length + ' 處 · 最高 +' + f1(maxBoss) + ' mm（四周 ' + BOSS_WALL + '）' : '沒有'],
    ['螺絲', (LAY.screws || []).length + ' 支 M3 背面鎖 · 缺口深 ' + f1(Math.max(...wallSides().map(q => q.e + BOSS_R + NOTCH_C - q.M))) + ' mm'],
    ['屏蔽罩', S.on ? F.cells.length + ' 格 · 最低 ' + (F.fmin != null ? f2(F.fmin) : '—') + ' GHz（≥ ' + f2(1.2 * S.fmax) + '）' : '未使用'],
    ['天線座', F.ant.length + ' 個 · ' + [...new Set(F.ant.map(p => (ANT_TYPES[p.it.type] || { n: p.it.type }).n))].join('、')],
  ];
  notes.forEach(([k2, v]) => { pT(c, k2, colX, yy, { s: 6.8, c: PC.ink2 }); pT(c, v, colX + 42, yy, { s: 6.8, m: true, max: A4W - PG - colX - 42 }); yy += 11; });
  yy += 10; pT(c, 'I/O 端接頭', colX, yy, { s: 8, w: 700 }); pT(c, '橫向＝距外殼左側 · 高度＝距分模面', colX + 50, yy, { s: 6, c: PC.ink3, max: A4W - PG - colX - 50 }); pL(c, colX, yy + 3, A4W - PG, yy + 3, PC.rule, 0.4); yy += 12;
  const ic = [colX, colX + 40, colX + 80, colX + 134];
  ['接頭', '橫向', '高度', '補肉'].forEach((h, i) => pT(c, h, ic[i], yy, { s: 6.3, w: 700, c: PC.ink2 })); yy += 9.5;
  F.io.forEach(p => {
    const over = p.y + p.fh / 2 + BOSS_WALL - LAY.yTop;
    pT(c, ioLabel(p.i), ic[0], yy, { s: 6.8, w: 600 }); pT(c, f1(p.z), ic[1], yy, { s: 6.8, m: true }); pT(c, f1(p.y) + (p.lock ? ' 對齊籠' : ''), ic[2], yy, { s: 6.8, m: true, max: 52 });
    pT(c, over > 0.01 ? '+' + f1(over) : '—', ic[3], yy, { s: 6.8, m: true, c: over > 0.01 ? PC.boss : PC.ink3 }); yy += 10;
  });
  // 元件位置表
  const tY = Math.max(mapY + m.h + 22, yy + 12);
  pSec(c, PG, tY, A4W - 2 * PG, '元件位置表', 'HSK 側在基板挖凹槽；濾波器側在屏蔽罩腔體內（' + F.cells.length + ' 格）');
  pdfBom(c, PG, tY + 10, A4W - 2 * PG, A4H - 46 - (tY + 10), F);
  pFoot(c, '位置為 3D 頁的初步佈局（正式 layout 前的評估用）；以元件中心為準，相對高度從 PCB 的 I/O 端邊緣量起。');
  return cv;
}

/* ── 組 PDF：每頁一張 JPEG（DCTDecode），A4 直式 ── */
function pdfBuild(pages, title) {
  const enc = new TextEncoder(), chunks = [], offs = [];
  let pos = 0;
  const put = x => { const b = typeof x === 'string' ? enc.encode(x) : x; chunks.push(b); pos += b.length; };
  const hex16 = s => { let h = 'FEFF'; for (const ch of s) { const cp = ch.codePointAt(0); if (cp > 0xffff) { const v = cp - 0x10000; h += (0xd800 + (v >> 10)).toString(16).padStart(4, '0') + (0xdc00 + (v & 0x3ff)).toString(16).padStart(4, '0'); } else h += cp.toString(16).padStart(4, '0'); } return '<' + h.toUpperCase() + '>'; };
  const n = pages.length, pid = i => 3 + i * 3, infoId = 3 + n * 3, total = infoId + 1;
  const obj = (id, body) => { offs[id] = pos; put(id + ' 0 obj\n' + body + '\nendobj\n'); };
  put('%PDF-1.4\n'); put(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [' + pages.map((_, i) => pid(i) + ' 0 R').join(' ') + '] /Count ' + n + ' >>');
  pages.forEach((p, i) => {
    const cs = 'q ' + A4W + ' 0 0 ' + A4H + ' 0 0 cm /Im' + i + ' Do Q';
    obj(pid(i), '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + A4W + ' ' + A4H + '] /Resources << /XObject << /Im' + i + ' ' + (pid(i) + 2) + ' 0 R >> >> /Contents ' + (pid(i) + 1) + ' 0 R >>');
    obj(pid(i) + 1, '<< /Length ' + cs.length + ' >>\nstream\n' + cs + '\nendstream');
    offs[pid(i) + 2] = pos;
    put((pid(i) + 2) + ' 0 obj\n<< /Type /XObject /Subtype /Image /Width ' + p.w + ' /Height ' + p.h + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + p.jpg.length + ' >>\nstream\n');
    put(p.jpg); put('\nendstream\nendobj\n');
  });
  const d = new Date(), p2 = v => String(v).padStart(2, '0');
  obj(infoId, '<< /Title ' + hex16(title) + ' /Producer (RRU 3D viewer) /CreationDate (D:' + d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) + p2(d.getHours()) + p2(d.getMinutes()) + p2(d.getSeconds()) + ') >>');
  const xref = pos;
  let x = 'xref\n0 ' + total + '\n0000000000 65535 f \n';
  for (let i = 1; i < total; i++) x += String(offs[i]).padStart(10, '0') + ' 00000 n \n';
  put(x + 'trailer\n<< /Size ' + total + ' /Root 1 0 R /Info ' + infoId + ' 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');
  const out = new Uint8Array(pos); let o = 0; chunks.forEach(b => { out.set(b, o); o += b.length; });
  return out;
}
const pdfJpeg = cv => new Promise((res, rej) => cv.toBlob(b => b ? res(b) : rej(new Error('JPEG 編碼失敗')), 'image/jpeg', 0.92));
async function pdfFonts() {                     // 畫布用的字型先載好（載不到就用系統字型，照樣能出）
  const want = ['400 10px "Barlow"', '600 10px "Barlow"', '700 10px "Barlow"', '400 10px "IBM Plex Mono"', '500 10px "IBM Plex Mono"', '400 10px "Noto Sans TC"', '700 10px "Noto Sans TC"'];
  await Promise.race([Promise.all(want.map(f => document.fonts.load(f, '字A1').catch(() => null))), new Promise(r => setTimeout(r, 2500))]);
}
/* 存檔：claude.ai 檢視器 → downloads（檢視者確認）；直接開本機檔（沒有 window.claude）→ 一般下載 */
async function pdfSave(bytes, name) {
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const cl = window.claude && typeof window.claude.use === 'function' ? window.claude : null;
  if (cl) {
    const dl = await cl.use('downloads').catch(() => null);
    if (dl) { try { await dl.save({ filename: name, data: blob }); return 'saved'; } catch (e) { return (e && e.code) || 'error'; } }
    if (window.top !== window) return 'unavailable';   // 框在檢視器裡又拿不到 downloads → 頁面自己下載一定被擋，別假裝存了
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 5000);
  return cl ? 'sent' : 'local';
}
let pdfBusy = false;
async function pdfOpen() {
  if (pdfBusy) return; pdfBusy = true;
  const dlg = $('pdfdlg'), st = $('pdf-st'), pages = $('pdf-pages'), btn = $('pdf-save'), note = $('pdf-note');
  pages.querySelectorAll('img').forEach(im => URL.revokeObjectURL(im.src)); pages.innerHTML = '';
  btn.disabled = true; note.textContent = ''; PDF_OUT = null;
  dlg.hidden = false; $('pdf-x').focus();
  st.textContent = '正在渲染 3D 視圖…';
  try {
    await new Promise(r => requestAnimationFrame(() => setTimeout(r, 30)));
    await pdfFonts();
    const sh = pdfShots();
    st.textContent = '正在排版…'; await new Promise(r => setTimeout(r, 0));
    const F = pdfFacts(), when = pWhen(), cvs = [pdfPage1(sh, F, when), pdfPage2(sh, F, when)];
    const blobs = await Promise.all(cvs.map(pdfJpeg));
    blobs.forEach((b, i) => { const im = new Image(); im.src = URL.createObjectURL(b); im.alt = '第 ' + (i + 1) + ' 頁預覽'; pages.appendChild(im); });
    const jpgs = await Promise.all(blobs.map(async (b, i) => ({ jpg: new Uint8Array(await b.arrayBuffer()), w: cvs[i].width, h: cvs[i].height })));
    const name = (P.name + '_3D模型_' + when.tag + '.pdf').replace(/[\\/:*?"<>|]+/g, '_');
    PDF_OUT = { bytes: pdfBuild(jpgs, P.name + ' 3D 模型'), name };
    st.textContent = '兩頁 A4 · ' + (PDF_OUT.bytes.length / 1048576).toFixed(1) + ' MB · ' + name;
    btn.disabled = false; btn.focus();
  } catch (e) {
    st.textContent = '產生失敗：' + ((e && e.message) || e);
  } finally { pdfBusy = false; }
}
function pdfClose() { $('pdfdlg').hidden = true; $('t-pdf').focus(); }
$('t-pdf').addEventListener('click', pdfOpen);
$('pdf-x').addEventListener('click', pdfClose);
$('pdfdlg').addEventListener('click', e => { if (e.target === $('pdfdlg')) pdfClose(); });
window.addEventListener('keydown', e => {
  if ($('pdfdlg').hidden) return;
  e.stopImmediatePropagation();
  if (e.key === 'Escape') { e.preventDefault(); pdfClose(); }
}, true);
$('pdf-save').addEventListener('click', async () => {
  if (!PDF_OUT) return;
  const note = $('pdf-note'), btn = $('pdf-save'); btn.disabled = true; note.textContent = '請在確認視窗按「儲存」…';
  const res = await pdfSave(PDF_OUT.bytes, PDF_OUT.name);
  btn.disabled = false; btn.focus();
  note.textContent = res === 'saved' || res === 'local' ? '已存檔：' + PDF_OUT.name
    : res === 'sent' ? '已交給瀏覽器下載：' + PDF_OUT.name + '（沒看到檔案的話，請從 claude.ai 開啟這一頁再存）'
    : res === 'declined' ? '沒有存檔（確認視窗按了取消）。'
    : res === 'extension_not_enabled' ? '這個檢視畫面不開放存 PDF；上面是兩頁的預覽。'
    : res === 'rate_limited' ? '已經有一個存檔確認視窗開著，先處理那一個。'
    : res === 'unavailable' || res === 'not_granted' || res === 'capability_disabled' || res === 'capability_removed' ? '這個檢視畫面不能存檔；上面是兩頁的預覽。'
    : '存檔失敗（' + res + '）。';
});

/* ══ 下載目前畫面（PNG）：WebGL 畫布＋畫面上的標註（CSS2D 標籤另外畫上去） ══ */
function dlBlob(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 5000);
}
function stamp() { const d = new Date(), p = n => String(n).padStart(2, '0'); return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()); }
function shotCanvas() {
  composer.render(); labelRenderer.render(scene, acam());
  const w = canvas.width, h = canvas.height, k = w / Math.max(1, canvas.clientWidth), box = canvas.getBoundingClientRect();
  const out = document.createElement('canvas'); out.width = w; out.height = h;
  const c = out.getContext('2d'); c.drawImage(canvas, 0, 0);
  $('labels').querySelectorAll('.dim, .ptitle, .ptag').forEach(el => {
    if (el.style.display === 'none' || el.closest('[style*="display: none"]')) return;
    const r = el.getBoundingClientRect(); if (!r.width || r.right < box.left || r.left > box.right || r.bottom < box.top || r.top > box.bottom) return;
    const cs = getComputedStyle(el), x = (r.left - box.left) * k, y = (r.top - box.top) * k, ww = r.width * k, hh = r.height * k;
    c.fillStyle = cs.backgroundColor; c.strokeStyle = cs.borderTopColor; c.lineWidth = Math.max(1, k);
    c.beginPath(); c.roundRect(x, y, ww, hh, 4 * k); c.fill(); if (parseFloat(cs.borderTopWidth) > 0) c.stroke();
    const lines = el.innerText.split('\n').map(t => t.trim()).filter(Boolean), fs = parseFloat(cs.fontSize) * k, lh = hh / Math.max(1, lines.length);
    c.fillStyle = cs.color; c.textBaseline = 'middle';
    lines.forEach((t, i) => { c.font = (i ? '500 ' + (fs * 0.85) : cs.fontWeight + ' ' + fs) + 'px ' + cs.fontFamily; c.fillText(t, x + parseFloat(cs.paddingLeft) * k, y + lh * (i + 0.5)); });
  });
  return out;
}
$('t-shot').addEventListener('click', () => {
  if (!P) return;
  shotCanvas().toBlob(b => { if (b) dlBlob(b, (P.name || 'RRU') .replace(/[\\/:*?"<>|]+/g, '_') + '_3D畫面_' + stamp() + '.png'); }, 'image/png');
});

/* ══ 工具介面：window.RRU3D ═══════════════════════════════════════════════════════
   update(data, hooks)：data＝{ key, name, g, r, rows, specs, edit, dirty }；hooks＝{ onEdit(E) }
     - key 換了（換專案）→ 重建並回到預設視角；同一個專案（重算後）→ 保留視角、選取與展開的列
     - edit＝這個專案的 3D 調整（工具由 layout3d 轉過來，元件名稱當 key）；每次 saveEdit 都交給 hooks.onEdit
   gate(html)：算不出來（缺必填欄位、DRC 不通過）時蓋一層說明；null＝拿掉
   snapshot(w, h)：畫面外渲染一張等角圖（白底、組裝、寫實，不含標註與選取框）→ JPEG data URL（PDF 報告第 6 節用）
   left()：切到別的分頁 → 取消選取、停掉按住中的調整 */
let UPD_SEQ = 0;
function update(data, hooks) {
  UPD_SEQ++;
  HOST.onEdit = (hooks && hooks.onEdit) || null; HOST.onSave = (hooks && hooks.onSave) || null; $('t-save').disabled = !HOST.onSave;
  $('pname').textContent = data.name && data.name !== '（未命名）' ? data.name : '';
  DB_SPECS = data.specs || {}; ROLE_REF_CACHE.clear();
  const newProj = !P || P.key !== data.key;
  HOST.E = normEdit(data.edit);
  P = Object.assign({}, data); delete P.specs; delete P.edit; delete P.dirty;
  SAVED.pending = !!data.dirty; if (!data.dirty) SAVED.at = null;
  if (newProj) { SELK = null; CEXP.clear(); if (!onScreen()) REFRAME = true; }
  $('loading').hidden = true; gate(null);
  rebuild(newProj ? String(P.key) : null, !newProj);
}
function gate(html) { const el = $('gate'); el.hidden = !html; el.innerHTML = html || ''; }
function snapshot(w = 1600, h = 1000) {
  if (!P || !rru) return null;
  const st0 = state.st, up0 = state.upright, mode0 = state.mode, solo0 = state.solo, hide0 = Object.assign({}, HIDE), hideI0 = new Set(HIDEI), pf0 = state.pflip;
  state.pflip = false;
  tween = null;
  try {
    if (mode0 !== 'real') { state.mode = 'real'; applyMode(); }
    state.solo = null; Object.values(PARTS()).forEach(o => { if (o) o.visible = true; });
    Object.keys(HIDE).forEach(k => { HIDE[k] = false; }); HIDEI.clear(); applyHide();
    state.upright = false; applyState('asm', true); if (dimsA) dimsA.visible = false; holder.updateMatrixWorld(true);
    return pShoot(w, h, pPersp(w, h, VIEWS.iso.d.clone().normalize(), bbox.clone(), 0.9), true).toDataURL('image/jpeg', 0.92);
  } catch (e) { console.warn('[3D] snapshot failed:', e); return null; }
  finally {
    state.upright = up0; state.pflip = pf0; state.solo = solo0; applyState(st0, true);
    Object.assign(HIDE, hide0); hideI0.forEach(k => HIDEI.add(k)); applyHide();
    applySolo();
    if (state.mode !== mode0) { state.mode = mode0; applyMode(); }
    updateVis();
  }
}
function left() { holdStop(); keyStop(); if (SELK) select(null); fsExit(); }

resize();
requestAnimationFrame(tick);
window.RRU3D = {
  update, gate, snapshot, left, resize,
  dbg: { LAY: () => LAY, P: () => P, ed, scene, camera, controls, A, state, select, setEdit, setTab, rebuild, ioList, antList, saveEdit, sel: () => SELK,
    frame, setProjection, ortho: () => ORTHO, acam, panView, recenter, soloBox, ioLayout, rotateSel, applySolo, SHD: () => SHD, HSK: () => HSK, PCB: () => PCB, FIL: () => FIL, partCenter, partBox, targets, targets0, flipPivot, shownParts, fsOn, frames: () => FRAMES, tween: () => tween, tweenApply,
    settle: () => { if (tween) { tweenApply(tween, 1); tween = null; } if (camTween) { camera.position.copy(camTween.p1); controls.target.copy(camTween.t1); camera.up.copy(camTween.u1); controls.update(); camTween = null; } },
    busy: () => !!(camTween || tween), frameSize: () => frameSize, curView: () => curView, viewRoll: () => viewRoll, rollView, hideSet, HIDEI, hidKeys, pairPlan: () => LAY && LAY.pair, grpLabel, bandOf, pdf: () => PDF_OUT, pdfBusy: () => pdfBusy, screws: () => LAY.screws, loops: () => LAY.loops, shotCanvas,
    screenOf: k => { const o = findSel(k); if (!o) return null; holder.updateMatrixWorld(true); const c = new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3()).project(acam()), r = canvas.getBoundingClientRect();
      return { x: r.left + (c.x + 1) / 2 * r.width, y: r.top + (1 - c.y) / 2 * r.height }; } },
};
window.dispatchEvent(new Event('rru3d-ready'));
