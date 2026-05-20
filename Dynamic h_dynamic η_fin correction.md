# SPEC: 5G-RRU-Quick-Volume-Evaluation-Tool 動態 h + 動態 η_fin 修正

## 1. 背景與目標

### 1.1 問題
舊工具用常數散熱模型（`h=8.35, eff=0.95`，與 FH 無關），導致工具反推的 FH 帶入 CFD 後，Tj 會隨環溫單調偏移：
- T_amb=45°C（短 fin 60mm）：CFD Tj=97.9°C，**比 Limit 低 2.1°C**（過設計）
- T_amb=55°C（長 fin 79mm）：CFD Tj=101.0°C，**比 Limit 高 1.0°C**（欠設計）
- 誤差跨度 3.1°C

### 1.2 目標
讓新工具的 K_eff(FH) 隨 fin 高度動態變化，匹配真實 CFD 結果。**目標**：CFD 對新工具給的 FH 跑出來，Tj 落在 100±0.5°C。

### 1.3 已驗證的校準結果（Python 模擬）
| T_amb | 新工具 FH | 預測 CFD Tj | 誤差 |
|---|---|---|---|
| 45 | 55.46 | 100.01 | +0.01 |
| 48 | 61.76 | 100.06 | +0.06 |
| 50 | 66.74 | 100.02 | +0.02 |
| 53 | 75.83 | 99.84 | −0.16 |
| 55 | 83.41 | 99.60 | −0.40 |

誤差跨度從舊工具 3.10°C 收斂到 0.46°C。

---

## 2. 鎖定的物理常數（不可改）

```
FH_REF              = 70.0   // h 校準參考點 [mm]
ALPHA_H             = 0.20   // h 對 FH 衰減指數
ETA_PROCESS_EMBED   = 1.04   // Embedded 製程整體校準
ETA_PROCESS_DC      = 0.99   // Die-casting (推算值，暫用)
K_FIN_EMBED         = 200    // 純鋁熱導 [W/m·K]
K_FIN_DC            = 160    // ADC12 熱導 [W/m·K]
```

---

## 3. 改動範圍

只動一個檔案：`index.html`

| 位置 | 行號 | 動作 |
|---|---|---|
| `calcHValue` 函式定義 | 932 | 修改：加入 FH_mm 參數 |
| `computeAll` 內 h_value 計算 | 982 | 修改：放進迭代裡 |
| `computeAll` 內反推 Embedded FH | 988-991 | 重寫：改成迭代 |
| `computeAll` 內反推 Die-casting FH | 992-1006 | 重寫：合併迭代 |
| `computeAll` 回傳新增欄位 | 1033 | 修改：return 加 eta_fin |
| `updateHDisplay` 呼叫 calcHValue | 1042 | 修改：傳入 FH |
| PDF export 呼叫 calcHValue | 1885 | 修改：傳入 FH |

**不動的**：`calcThermalResistance`、`calcFinCount`、所有 UI 渲染、weight 計算、T_hsk_base 計算（line 1017）、Tj/Tc 計算（line 1018）。

---

## 4. Phase 0：安全網（必做）

```bash
# 確認 main 乾淨
git status

# 開新 branch
git checkout -b feat/dynamic-h-eff

# Tag 目前版本（萬一要 rollback）
git tag v-before-dynamic-h
```

✋ **STOP 條件**：若 git status 不乾淨，先 commit / stash 既有改動再繼續。

---

## 5. Phase 1：新增 helper + 修改 calcHValue 簽名

### 5.1 修改 `calcHValue`（line 932）

**原本（單行）：**
```javascript
function calcHValue(gap){let hc=6.4*Math.tanh(gap/7.0);let rf=gap>=10?1:Math.sqrt(gap/10);let hr=2.4*rf;return{h_value:hc+hr,h_conv:hc,h_rad:hr};}
```

**改為（保持單行風格）：**
```javascript
function calcHValue(gap,FH_mm){const FH_REF=70.0,ALPHA_H=0.20;let FH=(FH_mm&&FH_mm>0)?FH_mm:FH_REF;let FHs=Math.max(FH,20);let hc_base=6.4*Math.tanh(gap/7.0);let fh_factor=Math.pow(FH_REF/FHs,ALPHA_H);let hc=hc_base*fh_factor;let rf=gap>=10?1:Math.sqrt(gap/10);let hr=2.4*rf;return{h_value:hc+hr,h_conv:hc,h_rad:hr};}
```

**關鍵保險**：當 `FH_mm` 為 `undefined`、`null`、`0`、或負值時，自動 fallback 到 `FH_REF=70`，確保所有舊呼叫不會崩。

### 5.2 在 `calcHValue` 下一行新增 `calcEtaFin`（line 933 之前）

```javascript
function calcEtaFin(FH_mm,t_fin_mm,h_value,k_fin){if(FH_mm<=0||t_fin_mm<=0||h_value<=0||k_fin<=0)return 1.0;let t_m=t_fin_mm/1000;let Lc_m=(FH_mm+t_fin_mm/2)/1000;let m=Math.sqrt(2*h_value/(k_fin*t_m));let mLc=m*Lc_m;if(mLc<1e-6)return 1.0;return Math.tanh(mLc)/mLc;}
```

### 5.3 Commit

```bash
git add index.html
git commit -m "Phase 1: add calcEtaFin and FH-dependent calcHValue (no behavior change yet)"
```

### 🟢 Checkpoint 1：行為應與舊版完全相同

**驗證步驟**：
1. 在瀏覽器打開 `index.html`（或本地起 server）
2. 用 default config 跑一次計算
3. 預期：所有顯示數字（FH, h_value, Tj, weights）**與 Phase 0 完全相同**

**為什麼會相同**：
- 此階段 `computeAll` 內 line 982 仍是 `calcHValue(p.Gap)`，沒傳第二個參數
- 新 `calcHValue` 在 FH_mm 沒給時 fallback 到 `FH_REF=70`
- 算出來的 hc 等於 `5.95 × (70/70)^0.20 = 5.95`，跟舊公式完全一樣
- η_fin 還沒被串進去用，所以 eff 還是舊的 0.95

✋ **STOP 條件**：若 Checkpoint 1 不通過（任何數字變了），停下回報，**不要進 Phase 2**。

---

## 6. Phase 2：重寫 `computeAll` 反推核心

### 6.1 修改 line 982（h_value 初始計算）

**原本**：
```javascript
let{h_value,h_conv,h_rad}=calcHValue(p.Gap);
```

**改為**（先用預設 FH 取得初始值，之後迭代中會更新）：
```javascript
let{h_value,h_conv,h_rad}=calcHValue(p.Gap,70);
```

### 6.2 替換 line 987-1006（整段 Embedded + Die-casting 反推邏輯）

**原本**：
```javascript
  let eff=isDieCasting?0.90:0.95;
  let nf,TP=TWS*p.Margin,AR=0,FH=0,T_root_calc=p.Fin_t,G_root_calc=p.Gap;
  if(!isDieCasting){
    nf=calcFinCount(WH,p.Gap,p.Fin_t);
    if(TP>0&&MDA>0){AR=1/(h_value*(MDA/TP)*eff);try{FH=((AR-bam2)*1e6)/(2*nf*LH);}catch(e){FH=0;}}
  }else{
    nf=calcFinCount(WH,p.Gap,p.Fin_t);
    for(let iter=0;iter<5;iter++){
      if(TP>0&&MDA>0&&nf>0){AR=1/(h_value*(MDA/TP)*eff);try{FH=((AR-bam2)*1e6)/(2*nf*LH);}catch(e){FH=0;}}
      if(FH<=0)break;
      T_root_calc=p.Fin_t+2*FH*Math.tan(alpha_rad);
      let pitch=p.Gap+p.Fin_t;
      G_root_calc=pitch-T_root_calc;
      if(G_root_calc<=0)break;
      let nf_new=calcFinCount(WH,G_root_calc,T_root_calc);
      if(nf_new<=0||nf_new===nf)break;
      nf=nf_new;
    }
    if(FH>0){T_root_calc=p.Fin_t+2*FH*Math.tan(alpha_rad);G_root_calc=(p.Gap+p.Fin_t)-T_root_calc;}
  }
```

**改為**：
```javascript
  // === Phase 2: 動態 h + 動態 η_fin 迭代反推 FH ===
  const K_FIN = isDieCasting ? 160 : 200;
  const ETA_PROCESS = isDieCasting ? 0.99 : 1.04;
  let nf, TP = TWS*p.Margin, AR = 0, FH = 0;
  let T_root_calc = p.Fin_t, G_root_calc = p.Gap;
  let eta_fin = 1.0, eff = isDieCasting ? 0.99 : 1.04;
  nf = calcFinCount(WH, p.Gap, p.Fin_t);
  let FH_prev = 70;  // 初始猜測 = FH_REF
  
  if (TP > 0 && MDA > 0) {
    for (let iter = 0; iter < 15; iter++) {
      // Die-casting：先依當前 FH 算 T_root 與新 nf
      let t_fin_for_eta = p.Fin_t;
      if (isDieCasting) {
        T_root_calc = p.Fin_t + 2*FH_prev*Math.tan(alpha_rad);
        let pitch = p.Gap + p.Fin_t;
        G_root_calc = pitch - T_root_calc;
        if (G_root_calc > 0) {
          let nf_new = calcFinCount(WH, G_root_calc, T_root_calc);
          if (nf_new > 0) nf = nf_new;
        }
        t_fin_for_eta = (p.Fin_t + T_root_calc) / 2;
      }
      
      // (1) 動態 h
      let hRes = calcHValue(p.Gap, FH_prev);
      h_value = hRes.h_value; h_conv = hRes.h_conv; h_rad = hRes.h_rad;
      
      // (2) 動態 η_fin
      eta_fin = calcEtaFin(FH_prev, t_fin_for_eta, h_value, K_FIN);
      eff = eta_fin * ETA_PROCESS;
      
      // (3) 反推 AR 與 FH
      try { AR = 1 / (h_value * (MDA/TP) * eff); } catch(e) { AR = 0; }
      let FH_new = 0;
      try { FH_new = ((AR - bam2) * 1e6) / (2*nf*LH); } catch(e) { FH_new = 0; }
      
      if (FH_new <= 0) { FH = 0; break; }
      
      // (4) 收斂判斷
      if (Math.abs(FH_new - FH_prev) < 0.05) { FH = FH_new; break; }
      
      // (5) 阻尼更新
      FH_prev = 0.5*FH_prev + 0.5*FH_new;
      FH = FH_new;
    }
  }
  
  // Die-casting 收斂後最終 T_root / G_root
  if (isDieCasting && FH > 0) {
    T_root_calc = p.Fin_t + 2*FH*Math.tan(alpha_rad);
    G_root_calc = (p.Gap + p.Fin_t) - T_root_calc;
  }
```

### 6.3 修改 line 1033（return）

**找到 return 物件中的這段**：
```javascript
eff,T_hsk_base:THB,T_root:T_root_calc,G_root:G_root_calc
```

**改為**（在 `eff` 後加 `eta_fin`）：
```javascript
eff,eta_fin,T_hsk_base:THB,T_root:T_root_calc,G_root:G_root_calc
```

### 6.4 Commit

```bash
git add index.html
git commit -m "Phase 2: iterative FH solver with dynamic h(FH) and eta_fin(FH)"
```

### 🟡 Checkpoint 2：驗證 5 個 case 的 FH 變化方向

**驗證步驟**：用 default config（整機 353.3W），分別把 T_amb 設成 45/48/50/53/55，記錄工具給的 FH。

**預期結果**（與 Python 模擬對比）：

| T_amb | 舊工具 FH | 新工具 FH 預期 | 容許範圍 |
|---|---|---|---|
| 45 | 60.00 | **~55.5** | 53~58 |
| 48 | 64.81 | **~61.8** | 59~64 |
| 50 | 68.33 | **~66.7** | 65~69 |
| 53 | 74.31 | **~75.8** | 74~78 |
| 55 | 78.87 | **~83.4** | 80~86 |

**關鍵驗收**：
- ✅ 短 fin（T_amb=45）：新 FH **小於** 舊 FH（變小約 4-5mm）
- ✅ 長 fin（T_amb=55）：新 FH **大於** 舊 FH（變大約 4-5mm）
- ✅ 交叉點（新 FH ≈ 舊 FH）落在 T_amb 約 50°C 附近
- ✅ FH 隨 T_amb 單調遞增

✋ **STOP 條件**（任一不通過就停）：
- 短 fin 案例新 FH 反而變**大** → 公式正負號可能寫反，回報
- 任何 FH 超出容許範圍 ±3mm 以上 → 常數可能傳錯，回報
- FH=0 或 NaN 出現 → 迭代發散，回報

✋ **不要進入 Phase 3 直到 Checkpoint 2 完全通過**。

---

## 7. Phase 3：UI 顯示更新

### 7.1 修改 line 1042（updateHDisplay）

**原本**：
```javascript
let{h_value,h_conv,h_rad}=calcHValue(G.Gap);
```

**改為**：
```javascript
let FH_disp=(calcResults&&calcResults.Fin_Height>0)?calcResults.Fin_Height:70;
let{h_value,h_conv,h_rad}=calcHValue(G.Gap,FH_disp);
```

### 7.2 修改 line 1044（h-sub 顯示加 η_fin）

**原本**：
```javascript
document.getElementById('h-sub').textContent='h_conv: '+h_conv.toFixed(2)+' + h_rad: '+h_rad.toFixed(2);
```

**改為**：
```javascript
let etaStr=(calcResults&&calcResults.eta_fin>0)?(' | η_fin: '+calcResults.eta_fin.toFixed(3)):'';
document.getElementById('h-sub').textContent='h_conv: '+h_conv.toFixed(2)+' + h_rad: '+h_rad.toFixed(2)+etaStr;
```

### 7.3 修改 line 1885（PDF export）

**原本**：
```javascript
let {h_value, h_conv, h_rad} = calcHValue(G.Gap);
```

**改為**：
```javascript
let {h_value, h_conv, h_rad} = calcHValue(G.Gap, R.Fin_Height);
```

### 7.4 Commit

```bash
git add index.html
git commit -m "Phase 3: UI displays h(FH) and eta_fin dynamically"
```

### 🔵 Checkpoint 3：UI 顯示正確

**驗證步驟**：
1. 用 T_amb=45 跑計算，記錄側邊欄 h 顯示值
2. 用 T_amb=55 跑計算，記錄側邊欄 h 顯示值

**預期**：
- T_amb=45：h_total 應該顯示 ≈ **8.65**（FH≈55，h_conv 被放大）
- T_amb=55：h_total 應該顯示 ≈ **8.15**（FH≈83，h_conv 被縮小）
- 兩個 case 都應該看到 `η_fin` 顯示在 h_conv/h_rad 之後
- η_fin 應該在 **0.85 ~ 0.95** 範圍內

✋ **STOP 條件**：
- h 顯示為 NaN 或 undefined → 變數傳遞出錯
- η_fin 顯示不出來 → return 沒帶到 eta_fin

---

## 8. Phase 4：Final Review

### 8.1 列出所有改動

```bash
git log --oneline v-before-dynamic-h..HEAD
git diff v-before-dynamic-h..HEAD index.html
```

### 8.2 檢查清單

請逐項確認：
- [ ] `calcThermalResistance` 完全沒動
- [ ] `calcFinCount` 完全沒動  
- [ ] Tj/Tc/T_hsk_base 計算邏輯沒動（line 1017-1018）
- [ ] Weight 計算沒動（line 1009-1015）
- [ ] DRC 檢查沒動（line 1031）
- [ ] save/load JSON 功能沒動
- [ ] 5 個 case 的 FH 與預期值差距 ≤ 3mm
- [ ] η_fin 值在合理範圍 0.85~0.95
- [ ] 沒有 console error

### 8.3 PR / Merge

如果全部通過：
```bash
git checkout main
git merge feat/dynamic-h-eff
```

如果有任何疑慮：
```bash
git checkout main  # 不 merge，保持 main 乾淨
# 在 feat/dynamic-h-eff branch 繼續修
```

---

## 9. CFD 實機驗證（你來做）

新工具上線後，用 CFD 跑這 5 個新 FH，驗證 Tj 是否落在 100±0.5°C：

| 環溫 | 整機瓦數 | 新工具 FH | 預期 CFD Tj |
|---|---|---|---|
| 45 | 353.3W | ~55.5 | 100±0.5 |
| 48 | 353.3W | ~61.8 | 100±0.5 |
| 50 | 353.3W | ~66.7 | 100±0.5 |
| 53 | 353.3W | ~75.8 | 100±0.5 |
| 55 | 353.3W | ~83.4 | 100±0.5 |

驗證結果與 Python 模擬對比，回報任何超過 0.5°C 的 case，可能需要進一步微調 ETA_PROCESS。

---

## 10. Rollback 計畫

任何階段出問題：

```bash
# 完全回到改動前
git checkout main
git branch -D feat/dynamic-h-eff   # 丟掉這個 branch
```

或保留分支但 reset：
```bash
git checkout feat/dynamic-h-eff
git reset --hard v-before-dynamic-h
```

---

## 附錄 A：物理模型參考

**新模型整體**：
```
h_total(FH) = 6.4×tanh(Gap/7) × (70/FH)^0.20  +  2.4×min(1, √(Gap/10))
m(FH)       = √(2 × h_total(FH) / (k_fin × t_fin))
Lc(FH)      = (FH + t_fin/2) / 1000        [m]
η_fin(FH)   = tanh(m·Lc) / (m·Lc)
eff(FH)     = η_fin(FH) × η_process
K_eff(FH)   = h_total(FH) × eff(FH)

反推 FH：
A_req = 1 / (h_total × (MDA/TP) × eff)
FH    = (A_req - bam) × 1e6 / (2 × nf × LH)
```

**校準依據**：5 個 CFD 對比 case（T_amb 45/48/50/53/55°C, TP=353.3W），詳見背景說明 1.3。

**未驗證的部分**：
- Die-casting 製程的 η_process=0.99 是從 Embedded 1.04 × (0.90/0.95) 推算，**待 die-casting 機種 CFD 數據驗證**
- 不同 Gap（非 11.6mm）的行為未獨立驗證
- 不同 fin thickness（非 1.2mm）的行為未獨立驗證
