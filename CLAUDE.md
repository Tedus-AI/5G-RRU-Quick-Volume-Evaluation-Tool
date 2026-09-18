# Claude Code 啟動說明

## 開始前請閱讀以下 Skill 檔案
- .claude/skills/impeccable-frontend-design.md：Create distinctive, production-grade frontend interfaces with exceptional design quality — actively avoiding generic AI aesthetics. Use this skill whenever the user asks to build web components, pages, artifacts, dashboards, forms, tools, posters, or any UI. Also use when the user asks to audit, polish, simplify, critique, animate, or improve an existing interface. Generates creative, polished code that avoids AI slop: no Inter font, no purple gradients, no card-in-card nesting, no glassmorphism by default. Based on the Impeccable design system (github.com/pbakaus/impeccable).
- .claude/skills/pptx.md：Use this skill any time a .pptx file is involved in any way — as input, output, or both. This includes: creating slide decks, pitch decks, or presentations; reading, parsing, or extracting text from any .pptx file (even if the extracted content will be used elsewhere, like in an email or summary); editing, modifying, or updating existing presentations; combining or splitting slide files; working with templates, layouts, speaker notes, or comments. Trigger whenever the user mentions \"deck,\" \"slides,\" \"presentation,\" or references a .pptx filename, regardless of what they plan to do with the content afterward. If a .pptx file needs to be opened, created, or touched, use this skill.
- .claude/skills/pdf.md：Use this skill whenever the user wants to do anything with PDF files. This includes reading or extracting text/tables from PDFs, combining or merging multiple PDFs into one, splitting PDFs apart, rotating pages, adding watermarks, creating new PDFs, filling PDF forms, encrypting/decrypting PDFs, extracting images, and OCR on scanned PDFs to make them searchable. If the user mentions a .pdf file or asks to produce one, use this skill.
- .claude/skills/thermal-engineering-expert.md：>
- .claude/skills/uiux-designer-expert.md：>
- .claude/skills/xlsx.md：Use this skill any time a spreadsheet file is the primary input or output. This means any task where the user wants to: open, read, edit, or fix an existing .xlsx, .xlsm, .csv, or .tsv file (e.g., adding columns, computing formulas, formatting, charting, cleaning messy data); create a new spreadsheet from scratch or from other data sources; or convert between tabular file formats. Trigger especially when the user references a spreadsheet file by name or path — even casually (like \"the xlsx in my downloads\") — and wants something done to it or produced from it. Also trigger for cleaning or restructuring messy tabular data files (malformed rows, misplaced headers, junk data) into proper spreadsheets. The deliverable must be a spreadsheet file. Do NOT trigger when the primary deliverable is a Word document, HTML report, standalone Python script, database pipeline, or Google Sheets API integration, even if tabular data is involved.

## 共用資料庫（thermal_db.json）寫入規則 ⚠️

本工具與 `AI-Thermal-pad-and-stud-size-Evaluation-Tool` **共用同一份 `thermal_db.json`**。多工具寫同一份 DB 時，**永遠不要假設自己擁有整顆 document**。

### Schema 概觀

頂層 collections（各工具會用到的 keys 用括號標註）：

```
{
  "rf_library":      { ... },   // 共用
  "digital_library": { ... },   // 共用
  "pwr_library":     { ... },   // 共用
  "projects": {
    "<project_id>": {
      // 5G-RRU 寫: meta, project_name, global_params, rf_data, digital_data, pwr_data
      // AI-Thermal Tab2 寫: thermal_specs, hidden_components,
      //                     param_temp, param_temp_custom,
      //                     param_backoff, param_backoff_rt,
      //                     param_duplex, param_duplex_rt,
      //                     tcPlacement
      // AI-Thermal Tab3 寫: validation_data, vd_hidden_components
      // global_params 兩邊都會碰（key set 幾乎重疊但不完全相同，例如 Draft_Angle 只有 RRU 有）
    }
  },
  "feedback_items":  { ... },   // AI-Thermal Tab5
  "tim_library":     { "<id>": { model, timType, k, thickness, gapThickness, gapUnlock,
                                 vendor, note, at, by, updatedAt, updatedBy } },
                                // TIM 型號庫：全工具共用、不屬於任何專案。
                                // 維護介面只在 AI-Thermal Tab2；**本工具只讀不寫**。
  "login_history":   { "<id>": { name, email, at, tool } },  // AI-Thermal 登入稽核（本工具尚未寫入）
  "version":         <number>
}
```

### TIM 型號庫（`tim_library`）與 `TIM_Model`

一顆 Pad 的 k 值只登錄一次，所有專案共用；放頂層 collection 是刻意的（規則 3），天然與
`projects` 的寫入隔離。每筆的兩個厚度**不是同一件事**：

| 欄位 | AI-Thermal UI 標題 | 意義 | 對應本工具 |
|---|---|---|---|
| `k` | k (W/m·K) | 導熱係數 | `K_Pad` / `K_Putty` / `K_Grease` |
| `gapThickness` | 填縫厚度(mm) | **壓縮後實際填在縫隙裡**的厚度 | `t_Pad` / `t_Putty` / `t_Grease` |
| `thickness` | 預設厚度(mm) | 材料**原始片厚**（Pad 買來 2.5mm） | 無（僅供規格書參考，計算不可用）|

佐證：本工具預設 `t_Pad = 1.7` 等於 AI-Thermal Tab2 的「IC 距離 HSK = 1.7」，而不是
「TIM 厚度 2.5」→ `calcRow` 要的就是壓縮後的縫隙厚度。**餵給 `R_TIM` 的是 `gapThickness`。**

`calcThermalResistance` 取 TIM 的 k / t 一律走 `resolveTim(row, g)`（單一事實來源，計算與畫面共用）：

1. `row.TIM_Model` 有值且在 `tim_library` 查得到（比對 `timType` ＋型號名，不分大小寫）
   → 用該型號的 `k` 與 `gapThickness`；
2. 否則沿用 `global_params` 的 `K_<Type>` / `t_<Type>`（**fallback 不可省**，否則型號庫還沒
   建完的專案會整批算不出來）；型號查不到／型號缺 `k` 或 `gapThickness` 時也走這條，並在
   畫面上以琥珀色標明原因；
3. 舊類型（`Pad2` / `Solder`）→ `TIM_LEGACY_PARAM` 指到原本吃的 global key，維持既有計算值。

`resolveTim` 會把來源回傳到列上（`TIM_Src` / `TIM_SrcLabel` / `TIM_SrcDetail` / `TIM_Warn`），
元件表每列標「k=… · t=… ← 型號 X／專案預設值」，Tab1 的 `R_TIM` 標 ◆（來自型號）或 ⚠（來源有問題）。

⚠ **本工具絕不寫入 `tim_library`**（維護介面只在 AI-Thermal Tab2 的「🧪 TIM 型號庫」）。
載入時機：`loadLibraryFromLocal()`（DB 連線／取得鎖／換 DB 檔）、`cloudLoadOne()`（載入專案）
與 `timLibViewOpen()`（按下型號庫按鈕）各 `timLibLoad(true)` 重讀一次，讀完 `recalc()`。

#### 參數控制台的 TIM 區塊 ＝ 一顆唯讀的「🧪 TIM 型號庫」按鈕

`K_Putty`/`t_Putty`/`K_Pad`/`t_Pad`/`K_Grease`/`t_Grease` **六個輸入欄已從參數控制台移除**，
改成一顆按鈕開出唯讀檢視（`timLibViewOpen` → `renderTimLibView` → `#timLibModal`），列出型號／
類型／`k`／填縫厚度／預設厚度／廠商／備註，並給一個前往 AI-Thermal 的連結。k 值屬於「材料」
不屬於「專案」，在兩個工具各有一份可編輯的 k 會立刻對不起來 → **編輯入口只留 AI-Thermal 一個**。

規則：

- **視窗裡不可出現任何 input／select／新增／儲存／刪除鍵**，也不可呼叫 `setDoc`/`writeBatch`/
  `deleteDoc`。要改型號一律指路到 AI-Thermal。
- **六個 key 仍留在 `PROJECT_GLOBAL_KEYS`、仍由 `_buildProjectFields` 寫回 `global_params`**：
  它們是沒選型號時的 fallback（`resolveTim` 第 2 條）。少了它們 → `R_TIM` 以 0 計入 ＝ 低估熱阻。
- 相對地 `readGlobals` **不再**讀這六個 id（畫面上沒有欄位可讀）；值的來源是
  `DEFAULT_CONFIG.global_params` 的出廠預設 ＋ 載入專案時的 `global_params`。
- 換專案時 `clearGlobalsWithoutInputs()`（原 `clearLegacyTimGlobals`）處理所有「沒有輸入框」的
  global key：**有出廠預設的退回預設值，沒有出廠預設的（`K_Pad2` 之類）才 `delete`**。
  對這六個 key 不可以 `delete` —— 專案若沒存過該 key，fallback 會落空而靜默把 `R_TIM` 算成 0。
- 開視窗會 `timLibLoad(true)` ＋ `recalc()`：AI-Thermal 剛改過的 k 要立刻反映到元件表。

### `Pad2` 已停用（改用「`Pad` ＋型號」）

`TIM_TYPES` 只剩 `Grease / Pad / Putty / None`；不同 k 值的 Pad 用型號表達。

- **讀取相容**：`TIM_Type: 'Pad2'` 的舊元件仍以該專案 `global_params` 殘留的 `K_Pad2`/`t_Pad2`
  計算（`TIM_LEGACY_PARAM`），**不可讓它靜默變成 `R_TIM = 0`**（低估熱阻＝樂觀，比 NaN 危險）。
  該列的下拉會臨時補回「Pad2（已停用）」選項——不靜默改掉使用者填的內容。
- **遷移**：Tab0 會跳橫幅列出受影響元件與殘留的 k/t，選一個 Pad 型號按「套用遷移」即
  改成 `TIM_Type:'Pad'` ＋ `TIM_Model`（只改記憶體，要按「儲存專案」才寫回 DB）。
  型號本身要先在 AI-Thermal 的型號庫建好（本工具唯讀）。
- `K_Pad2` / `t_Pad2` 已從參數控制台與 `PROJECT_GLOBAL_KEYS` 移除：不再由本工具寫入，
  但既有專案裡的值因 `_buildProjectFields` 的 merge 而**保留**。換專案時
  `clearGlobalsWithoutInputs()` 會清掉 `G` 裡沒有輸入框、也沒有出廠預設的舊參數，
  免得拿 A 案的殘留值算 B 案（有出廠預設的則退回預設，見上一節）。

### `Board_Type`（導熱方式）與 AI-Thermal 的「主散熱路徑」同一組詞彙

`BOARD_TYPES = ['Thermal Via','Copper Coin','IC top','None']`，與 AI-Thermal Tab2「主散熱路徑」
的選項同名；它存檔時把 `spec.heatDirection` 直接寫成本欄的值，並同時決定 `Pad_L`/`Pad_W`
取 E-PAD 大小（Thermal Via）還是元件大小（Copper Coin／IC top）。

| `Board_Type` | `R_int` | `R_TIM` 的接觸面積 |
|---|---|---|
| `Copper Coin` | 銅塊 + die-attach solder | 銅塊面積 `Coin_L×Coin_W` |
| `Thermal Via` | 導熱孔（`K_Via`／`Via_Eff`）| `(Pad_L+Thick)×(Pad_W+Thick)` 擴散面積 |
| `IC top` | **0**（不穿板）| **`Pad_L×Pad_W`**（元件上表面積，不加板厚）|
| `None` | 0 | `(Pad_L+Thick)×(Pad_W+Thick)`（沿用舊行為）|

⚠ `IC top` 是後來補的：在它之前 AI-Thermal 的 `IC top` 被壓成 `None`，於是熱從封裝上表面出去
的元件也吃到「加了板厚的擴散面積」，**高估接觸面積＝低估 `R_TIM`**（樂觀）。兩邊同名之後，
`calcThermalResistance` 對 `IC top` 令 `bl=bw=0`，`ta` 退回 `pa`。

值不在 `BOARD_TYPES` 裡時（對方工具寫進未知值），下拉會臨時補上該選項並標「（未知值）」，
不可讓瀏覽器把它靜默顯示成清單第一項、使用者一碰就改掉資料。

### `Thick(mm)`（板厚）由參數控制台統一，不再逐顆填

導熱方式決定該元件的板厚吃哪一個**全域值**（`THICK_SOURCE` / `applyThickFromGlobals`，
每次 `recalc()` 都會套用）：

| `Board_Type` | 板厚來源 | 元件清單顯示 |
|---|---|---|
| `Copper Coin` | `Coin_T_Setting`（銅塊厚度）| 白底黑字純參照文字 |
| `Thermal Via` | `t_PCB`（PCB 板厚度）| 白底黑字純參照文字 |
| `IC top` / `None` | 不穿板 → 不適用，`Thick(mm)` 歸 **0** | 反灰「—」|

- 元件上仍保留 `Thick(mm)` 這個 key（Excel／PDF／共用 DB 都讀得到真實數字），只是它由全域值
  推導而來、不再是逐顆輸入的欄位。**AI-Thermal 仍然一律不寫這個 key。**
- ⚠ `None` 現在與 `IC top` 一致：板厚不參與計算（`bl=bw=0`）。在此之前 `None` 會把 `R_TIM`
  的接觸面積算成 `(Pad_L+Thick)×(Pad_W+Thick)`，欄位既然反灰就不能再偷偷影響數字。
  實際資料檢查：備份裡 `None` 元件的板厚全部是 0，所以此改動對既有專案是 no-op。
- **舊專案遷移**（`migrateThickGlobals(loadedGlobals)`）：專案的 `global_params` 沒存過
  `t_PCB`／`Coin_T_Setting` 時，由該導熱方式底下「**最常見的非零板厚**」回推（平手取小），
  再統一套到所有同類元件；Tab0 跳藍色橫幅寫出回推依據並**逐顆列出被改動的元件**，
  提醒要按「儲存專案」才寫回 DB。⚠ 判斷「專案有沒有存過」一定要看傳進來的 `global_params`，
  不能看 `G` —— `G` 還留著上一個專案的值（`readGlobals` 只從畫面欄位刷新）。

### `K (銅塊)`：原本寫死的 380 已拉成參數

`calcThermalResistance` 的 Copper Coin 分支原本是 `kb=380`（寫死）。現在取
`global_params.K_Coin`，**沒有有效值時 fallback 380**（純銅）。Thermal Via 仍是
`K_Via`（Via 等效 K，預設 30）＋ `Via_Eff`（0.9）；整份計算裡**沒有 FR4 基材 K**，
穿板路徑就由「Via 等效 K」一個值代表。

> 5G-RRU 專屬的新 global_params keys：`t_PCB`、`Coin_T_Setting`、`K_Coin`
> （三份清單都要同步：`readGlobals` / `saveProject` / `PROJECT_GLOBAL_KEYS`）。

### 參數控制台可調寬／收合

`#sidebar-resizer` 同時是拖曳把手與收合鈕：`mousedown` 後位移超過 4px 才算拖曳，
沒超過就當點一下 → 收合／展開（收合後分隔線變 ▶，這是收合狀態唯一回得去的路，不可拿掉）；
標題列也有一顆同功能的按鈕。寬度（220–560px）與收合狀態存 localStorage，
讀寫一律 try/catch。⚠ **寬度變動後要呼叫 `resizePlots()`**，否則 Plotly 圖停在舊寬度；
登入前／登出後由 `_setShellVisible(false)` 把側欄、分隔線、主區一起藏起來。

### AI-Thermal 推導欄位的來源標記

`Board_Type`／`Pad_L`／`Pad_W`（Tab2 主散熱路徑）與 `R_jc`（Tab1 熱阻表的 θJC）由 AI-Thermal
推導。這些欄位在本工具仍可編輯，但下次從 AI-Thermal 存檔時會被覆寫 → 元件清單以
**欄位左側藍邊＋tooltip**（`derivedAttrs`／`.derived-src`）標出來源，表格上方給一行圖例。
判斷依據是 AI-Thermal 寫在元件物件上的內部標記，本工具**只讀不寫**：

| 標記 | 意義 |
|---|---|
| `_bt_from = 'heatDirection'` | `Board_Type` 來自 Tab2 主散熱路徑 |
| `_pad_from = 'epadSize' / 'heatSourceSize' / 'none'` | `Pad_L`/`Pad_W` 的來源尺寸 |
| `_rjc_from = 'JC_bot' / 'JC_top'` | `R_jc` 取自熱阻表的哪一筆 θJC |

標記是底線開頭的內部欄位，**不列入 carry 白名單**（快選複製出來的元件不帶標記，
等 AI-Thermal 下次推導時再標）。

### 每元件欄位的歸屬（同一顆元件物件由兩個工具共寫）

| 欄位 | 誰有畫面可編輯 |
|---|---|
| `Component`、`Qty`、`Power(W)`、`Limit(C)` | 兩邊 |
| `Height(mm)` | 只有 5G-RRU（AI-Thermal 一律不寫）|
| `Thick(mm)` | 只有 5G-RRU，且**由參數控制台的 PCB 板厚度／銅塊厚度推導**（見下節）；AI-Thermal 一律不寫 |
| `Board_Type`、`Pad_L`、`Pad_W`、`R_jc`、`TIM_Model`、`TIM_Type` | 5G-RRU 可編輯（標藍邊提醒會被覆寫）；AI-Thermal 存檔時由 Tab1/Tab2 推導後覆寫 |
| `Type`、`Power_RT(W)`、`TV_ID_mil`、`TV_Qty`、`Temp_Sensor`、`Local_Qty`、`Remote_Qty`、`note`、`Rth`、`SpecFile` | 只有 AI-Thermal（本工具不顯示但原樣保留）|

⚠ **「從資料庫快選」的 carry 白名單兩邊都必須列全上表所有欄位**（本工具的 `VARIANT_CARRY`
／AI-Thermal 的 `SG_VARIANT_CARRY`，目前各 21 項）。漏列的 key 會被各自的分類罐頭預設值
蓋掉，複製完再存回共用 DB 就等於把對方工具填的真實值洗成罐頭值。新增任何每元件欄位時，
**同一個 commit 內要把它加進本工具的白名單，並在另一個 repo 同步補上**。
物件／陣列欄位（`Rth`、`SpecFile`）carry 時必須深拷貝（`carrySrc`）。
`SpecFile` 是檔案參照不是複本（實體檔在來源專案的 `SPEC/<專案名>/` 底下）→ 快選帶入時標
`SpecFile._from = <來源專案名>`，AI-Thermal 才知道換檔／刪除時只能解除參照、不可刪來源檔。

⚠ **空值一律「不寫 key」，不可寫 `''`**：快選是 `Object.assign({}, RF_DEFAULT, src)`，key 不
存在會套分類預設；寫 `''` 會覆蓋預設值，而 `calcRow` 對空字串多半不噴 NaN 而是**靜默算成 0**
（`Thick` 空 → `R_int`=0、`Pad_L/W` 空 → 面積用字串算出假值、`Limit(C)` 空 → 裕度變超大負數），
方向是**低估熱阻＝樂觀**，比 NaN 更危險。取消 TIM 選型／換 TIM 類型時一律 `delete` key。

### 規則

1. **存 project 一律用 `updateDoc('projects', id, fields)`，不要用 `setDoc`。**
   `setDoc(col, id, data)` 是「整顆 document 替換」，會把其他工具寫進去但你不認識的欄位全部抹掉。
   `updateDoc` 在 `fileDb` / `graphDb` 都是 shallow merge，是安全做法。
2. **`global_params` 是 nested object，shallow merge 救不了它。** 寫之前要先 `getDoc` 把舊的 `global_params` 撈出來，把自己的 keys 蓋上去再寫回，否則對方工具獨有的 key（例如 `Draft_Angle`、`fin_tech_selector_v2`）會被吃掉。
3. **新加欄位前先想：這個欄位該掛在 `projects[id]` 底下，還是另開一個頂層 collection？**
   頂層 collection（像 `feedback_items`）天然就跟其他工具的寫入隔離；放進 `projects[id]` 就要遵守上面兩條。
4. **跨工具共用 schema 變更時，兩個 repo 的 CLAUDE.md 都要同步更新本段表格。**
5. **壞檔唯讀保護（兩個 repo 的 DB backend 都必須具備）**：`_readFile` 解析失敗時
   **絕不可** fallback 成空骨架（否則下一次寫入會把整份共用 DB 抹掉），必須保留舊快取、
   設 `dbCorrupted = true` 進入唯讀；`_writeFile` 開頭一律過 `_assertWritable`：
   (a) `dbCorrupted` → 拒寫；(b) `projects` 由「上次讀檔筆數」(`lastReadProjects`，反映磁碟現況、
   非 session 高水位) 非零突然歸零、且非刻意刪除（`deleteDoc('projects', …)` 例外放行並下修基準）→ 拒寫。
   **空檔判斷**：只有「從未持有過實際資料（`sawRealData=false`）的全新空檔」才允許 bootstrap 空骨架；
   若先前已有資料卻讀到 0-byte（截斷）→ 比照壞檔進唯讀。
6. **檔案級樂觀並發（SharePoint backend）**：整檔 PUT 必帶 `If-Match: <eTag>`；`_readFile` 取
   DriveItem metadata 的 `eTag` 為基準（content GET 經 302 轉址後的 ETag 不可靠），`_writeFile`
   成功後由 PUT 回應更新 `eTag`。寫入走 `_withOptimisticWrite(mutateFn)`：412 時重讀最新內容＋新
   eTag，於最新狀態上重跑 mutateFn 後重試（上限 4 次）。如此 (a) 取鎖 read-check-write 成為原子
   CAS（兩人不會同時取得鎖）、(b) 他人對其他 doc/collection 的寫入不會被我們的整檔 PUT 回滾、
   (c) releaseLock 衝突時只刪自己的鎖。**兩個 repo 要同步實作**（共用同一份檔案，並發保護取決於最弱的寫入者）。
   參考實作：5G-RRU 的 `graphDb.js`（`_withOptimisticWrite`、`currentEtag`）/ `fileDb.js`
   （`_assertWritable`、`lastReadProjects`、`sawRealData`；本機單人模式無 eTag）。

### 反例（造成 Bug 的寫法）

```js
// ❌ 會抹掉 thermal_specs / validation_data / tcPlacement / param_* / hidden_components 等
const d = { meta, project_name, global_params, rf_data, digital_data, pwr_data };
await dbAdapter.setDoc('projects', docId, d);
```

### 正確寫法

```js
// ✅ 保留 sibling tool 寫入的欄位
const existing = await dbAdapter.getDoc('projects', docId) || {};
const mergedGlobals = { ...(existing.global_params || {}), ...myGlobals };
await dbAdapter.updateDoc('projects', docId, {
  meta, project_name,
  global_params: mergedGlobals,
  rf_data, digital_data, pwr_data,
});
```

參考歷史 fix：5G-RRU PR #53（`claude/fix-database-overwrite-bug-W1bT1`）。

## 軟體版本戳記是「自動」的，不要手改 ⚠️

本工具有一套「使用者載入到舊版會被醒目橫幅提醒更新」的機制，版本號**完全由 CI 自動產生**，
任何 session（包含未來的你）改 code 時**都不需要、也不應該手動更新版本號**。

### 運作方式

- 原始碼裡只放佔位符 `__APP_VERSION__`（出現在 `index.html` 的 `window.APP_VERSION`、
  4 支本地 JS（`config.js` / `fileDb.js` / `graphDb.js` / `dbAdapter.js`）的
  `?v=__APP_VERSION__` 快取戳記、以及 `version.json`）。
- `.github/workflows/deploy-pages.yml` 在每次 push 到 `main` 時，用
  `TZ='Asia/Taipei' date +%Y.%m.%d.%H%M`＋短 SHA 算出版本號，`sed` 戳進上述佔位符，
  再部署到 GitHub Pages。**因此每次 push 都會自動戳新版本，不靠人記憶。**
- 前端（`index.html` 的 `setupUpdateChecker`）載入後延遲首檢、每 5 分鐘、切回分頁時，
  以 `cache:'no-store'` 抓 `version.json` 與烙印的 `APP_VERSION` 比對；不同才跳橫幅，
  相同則 `#version-badge` 打勾「最新」，完全靜默。

### 規則

1. **不要把 `__APP_VERSION__` 換成真實版本字串**，那是 CI 的工作。新增需要快取戳記的
   本地 JS 時，在 script 標籤後面加 `?v=__APP_VERSION__` 即可。
2. **停用偵測的守衛刻意寫成 `'__APP_' + 'VERSION__'`**（拆字串），這樣 CI 的
   `sed s/__APP_VERSION__/.../g` 不會把它換掉、導致 production 誤判為「未戳版本」而停用偵測。
   改這段時務必保持拆字串寫法。
3. **GitHub Pages 的 Source 必須設為「GitHub Actions」**（Settings → Pages），
   否則 workflow 戳的版本不會上線。
4. 此機制移植自 AI-Thermal（參考其 PR #140）。

