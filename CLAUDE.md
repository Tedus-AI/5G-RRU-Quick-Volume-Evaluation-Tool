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
  再統一套到所有同類元件（推不出來 → 出廠預設，不是 0）；Tab0 跳藍色橫幅寫出回推依據並**逐顆列出被改動的元件**，
  提醒要按「儲存專案」才寫回 DB。⚠ 判斷「專案有沒有存過」一定要看傳進來的 `global_params`，
  不能看 `G` —— `G` 還留著上一個專案的值（`readGlobals` 只從畫面欄位刷新）。

### `K (銅塊)`：原本寫死的 380 已拉成參數

`calcThermalResistance` 的 Copper Coin 分支原本是 `kb=380`（寫死）。現在取
`global_params.K_Coin`，**沒有有效值時 fallback 380**（純銅）。Thermal Via 仍是
`K_Via`（Via 等效 K，預設 30）＋ `Via_Eff`（0.9）；整份計算裡**沒有 FR4 基材 K**，
穿板路徑就由「Via 等效 K」一個值代表。

> 5G-RRU 專屬的新 global_params keys：`t_PCB`、`Coin_T_Setting`、`K_Coin`
> （三份清單都要同步：`readGlobals` / `saveProject` / `PROJECT_GLOBAL_KEYS`）。

### 整機長寬：防水邊距的方向（`rruFootprint`）

```
長 L = L_pcb + Top  + Bottom
寬 W = W_pcb + Left + Right
```

- **單一事實來源是 `rruFootprint(p)`**：`computeAll` 與參數控制台「PCB 板離外殼邊距」底下的即時算式
  （`renderDimDerive`，每次 `recalc()` 更新）都走它，不要在別處再寫一次加法。
- 方向依據：鰭片沿「長」延伸（每片鰭片長＝L，片數由 W 決定：`calcFinCount(WH,…)`，3D 視圖也是
  鰭片沿 x＝Length），自然對流時鰭片必須垂直 → **L 是吊掛後的上下方向** → Top/Bottom 是長度方向兩端，
  Left/Right 是寬度方向兩側。Bottom 通常較大（底部留接頭／防水）。
- ⚠ 原本寫成 `L+Left+Right`、`W+Top+Bottom`（平面圖「圖面上下」的習慣），與鰭片方向對不起來：
  使用者 PCB 500×385、邊距 8/11/8/8 算出 516×404（應為 519×401）。配反時 Bottom 多出來的 mm 被加到寬度
  → 可能多排一片鰭片 → 鰭片高與體積**偏樂觀**。修正後備份裡 5 個專案：長 +3、寬 −3；
  少一片鰭片的 3 個專案體積 +1.5～1.7%，鰭片數不變的 2 個 −0.7～−0.8%。
- PDF「Geometry」表列出邊距（T/B 加在長、L/R 加在寬），報告上的 L/W 才對得回來源。
- 契約測試：`tests/dimensions.test.js`（四個邊距都不同的值才分辨得出配對）。

### 表頭色票與專案工具列（改色／改高度前先看這裡）

兩處刻意抽成 `:root` 的共用值，改一次三個地方一起動：

| 變數 | 用途 |
|---|---|
| `--th-bg` / `--th-bg2` / `--th-fg` / `--th-accent` | 表頭深藍底＋白字＋青色底線，`.comp-table th`、`.detail-table th`、`.tim-lib-modal th` 共用 |
| `--io-h` | 專案工具列所有控制項（按鈕／保護標籤）的統一高度 |

- **表頭不可回到淺灰底**（原本 `#f1f5f9` ＋ `#475569` 與白色表身糊成一片）。深底白字的文字對比
  ≥ 7、與表身對比 ≥ 4.5，這是 `tests/header-toolbar.test.js` 的契約。
- **工具列是「半透明深色托盤 ＋ 白底深字實心按鈕」**：原本白字透明底在青藍漸層 header 上
  對比不足、按鈕整個融進背景。⚠ 不要再把按鈕改回 `background:transparent` ＋ `color:#fff`。
  「儲存專案」是唯一的深色實心鈕（主要動作＝寫回共用資料庫），其餘維持白底。
- 順序固定為 **匯入／匯出 ｜ 儲存／載入／複製 ｜ 資料庫保護**，三組用留白分隔
  （不用豎線：換行時會單獨留一根在行尾）。窄螢幕靠 `flex-wrap` 整組換行。
- **工具列靠右**（`.project-io{margin-left:auto}`）：`.header` 是 `space-between`，同一行時
  本來就靠右，但換行後整組會掉到「自己那一行的最左邊」。專案名稱欄位移除後要讓按鈕
  往右補上空出來的位置，兩種情況都要靠右才一致（`tests/header-toolbar.test.js` 的契約：
  右緣貼齊 header 內距、左邊必須空出位置）。
- 隱藏的 `#fileInput` 放在 `.project-io` **外面**，不然它會卡在兩組中間破壞間距。

### header 頂排：版本徽章 ─ 專案名稱 ─ 右側按鈕

原本三塊各自 `position:absolute`（徽章 `left:30px`、右側按鈕群 `right:16px`），中間那段沒人管。
現在包成一條 flex `.hdr-topbar`（`left:30px; right:16px; top:12px`）：

| 區塊 | flex 行為 |
|---|---|
| `#version-badge` | `flex-shrink:0`（CI 戳完版本後約 230px 寬，本機只有 60px —— 量位置時要自己塞長字串）|
| `.hdr-name-slot` | `flex:1 1 auto; min-width:0` → 吃掉中間剩餘空間並置中；**只有它會縮** |
| `.hdr-right` | `flex-shrink:0` |

⚠ **不可加 `flex-wrap:wrap`**：flex 是「先分行、後壓縮」，加了會變成名稱還沒縮、右側按鈕
就先掉到第二行蓋到標題。目前的設計是空間不夠時名稱縮到 ellipsis，兩端永遠不重疊。

### 專案名稱：狀態不是欄位（`#cloudProjectName` 已移除）

工具列上的專案名稱輸入框已拿掉，改成頂排的**純文字顯示**（`#projNameBox` / `#projNameText`）：

- **單一事實來源是 `currentProjectName`**，讀寫一律走 `projectNameGet()` / `projectNameSet()`
  （`projectNameSet` 同時更新畫面與 tooltip）。不要再從 DOM 讀專案名稱。
- 會動到它的地方：`cloudLoadOne`（`d.project_name || docId` —— 常駐顯示，**不可留上一個專案的
  殘值**）、`confirmCopyProject`、`cloudDeleteOne`（刪到目前這個就清空）、`cloudSaveProject`、
  `saveProject`（匯出檔名，JSON 也帶 `project_name`）、`handleFileLoad`、PDF 報告標題。
- **沒命名時按「💾 儲存專案」會當場 `promptProjectName()` 問一次**，取消就靜靜退出（不寫入、
  不噴警告）。欄位拿掉後 `promptProjectName()` 是唯一的手動輸入口 → ✏️ 必須常駐可見
  （不可只在 hover 才出現），點文字即可改名。
- **文字不可有外框／底色**（使用者明確要求），顏色必須是**深色**：header 是青藍漸層，
  名稱所在位置實測背景為 `rgb(0,161,231)`，白字只有 **2.90:1**，深藍 `#062a46` 有 **5.08:1**。
  測試是截 1×1 的圖讀真實像素再算對比（拿漸層端點算會失真：兩端分別是 3.4:1 與 9.3:1）。

### 專案身分：存檔寫回「載入時的 id」（`currentProjectId`）

⚠ **不可再由名稱推 docId 來存檔**。AI-Thermal 建專案時 id 與名稱分開輸入，改名也刻意只改
`project_name`、不動 id（id 是規格書／標註圖／三個頁籤選單的錨點）。原本本工具每次存檔都由名稱推
docId → id≠名稱的專案每存一次就多一份分身、原專案永遠收不到修改（備份裡 8 個專案有 3 個是這樣：
`CB-GN-HB-2X2M-2B`、`tedus`、`RRU_5G`）。

- 身分一律走 `projectIdentitySet(id, name)`：`cloudLoadOne` → 載入的 id；`cloudSaveProject` 成功 →
  寫入的 id；`confirmCopyProject` → 複本的 id；`handleFileLoad`（匯入本機檔）→ **`null`**
  （未儲存的新專案，存檔才不會蓋掉前一個開著的雲端專案）；`cloudDeleteOne` 刪到目前的 → `null`。
- `cloudSaveProject`：有 id → 寫回同一個 id（**不再跳「已存在，確定要覆蓋？」**，那是同一個專案）；
  沒有 id（新專案）→ 才 `projectDocIdFromName(name)`，撞到既有專案時確認訊息寫出**對方的名稱**。
- **改名＝只改 `project_name`**（✏️ 改名後存檔，id 不變）；要另存一份用「📋 複製專案」。
- **名稱不可與其他專案重複**（`projectNameTakenBy`，不分大小寫；與 AI-Thermal 改名規則同一條：
  規格書路徑 `SPEC/<專案名>/`，同名會共用資料夾）。只在「新專案」或「改了名」時檢查，
  既有的重名資料不會因此存不了檔。
- `cloudLoadOne` 對 `getDoc` 的結果**深拷貝**（原本 `getDoc` 回傳 DB 快取的活參照；直接編輯的話，
  載入時的轉型與畫面上的試改會在釋放編輯鎖——整份快取寫回——時被寫進共用 DB）。
  `_buildProjectFields` 寫出去的元件也深拷貝（反方向同理）。現在兩個後端的 `getDoc` 本身就回複本、
  寫入也存複本（見下方「存檔三方合併」），這兩處深拷貝保留當作第二道保險。
- 載入時**缺哪一類元件就是空陣列**，不可沿用上一個專案的元件。
- 規格書是「檔案參照」：**複製專案**與 **📋 複製元件**都用 `specMarkFromIfUnset` 逐份標 `_from`
  （單一物件與陣列兩種形狀都要；已經有 `_from` 的保留原本的來源），AI-Thermal 刪除或取代複本的規格書
  時才不會把來源的實體檔一起刪掉。複製專案成功後畫面上的元件也要標（它們從此代表複本）。
- 契約測試：`tests/project-load.test.js`。

### 參數控制台：換專案先退回出廠預設（`loadGlobalsForProject`）

⚠ 原本只覆寫「專案有存的 key」，有輸入框的參數會沿用上一個專案留在畫面上的值、存檔時還寫進本專案
（AI-Thermal 建的專案沒有 `global_params` → 34 個參數全部沿用前一個看過的專案；其餘專案都沒存過
`K_Coin`，也一樣沿用）。

- 載入／匯入：`clearGlobalsWithoutInputs()` → **所有 `PROJECT_GLOBAL_KEYS`＋`fin_tech_selector_v2`
  先退回 `DEFAULT_CONFIG.global_params`** → 再套專案存過的值 → `syncGlobalsToInputs` 同步所有輸入框
  （勾選框用 `checked`、自訂鰭片係數走 `applyFinCustomUI`）。
- 參數控制台**允許**出廠預設（這是使用者同意的地方），但要看得出哪些是預設：Tab0 藍色橫幅
  （`#globals-default-banner`）列出「專案沒存過、採用出廠預設」的參數；完全沒有 `global_params` 時
  直接寫「參數控制台全部是出廠預設值」。
- `migrateThickGlobals` 從元件推不出板厚時改用**出廠預設**（`t_PCB` 2.0／`Coin_T_Setting` 2.5），
  不再給 0（0 會讓所有 Via／Coin 元件 `R_int = 0`，偏樂觀）。

### 存檔三方合併（`compMerge.js`）⚠️ 兩個 repo 共用同一份

兩個工具存檔時都會把整份元件清單（`rf_data`／`digital_data`／`pwr_data`）用自己畫面上的副本寫回。
直接寫回 → 對方在我們**載入之後**存的修改被整批蓋掉。標準流程就會踩到：5G-RRU 開著專案 →
到 AI-Thermal 補 θJC 存檔 → 回 5G-RRU 補高度再存 → θJC、導熱方式、E-Pad、規格書全被蓋回舊值。

- **`compMerge.js`（＋`tests/comp-merge.unit.test.js`）在兩個 repo 內容逐字相同**，改一邊就同步另一邊。
- 三方比對：`projBase`（載入時的快照）／畫面（我的）／寫入當下資料庫的最新內容（對方的）。
  逐顆元件、逐欄：我沒改 → 用資料庫的；只有我改 → 用我的；兩邊改得一樣 → 照用；
  **兩邊改得不一樣 → 存檔前跳衝突視窗**（`CompMerge.showConflictDialog`，列出元件、欄位、兩邊的值與
  載入時的值，每一列選「用我的／用資料庫的」，全部選完才能存；取消 → 不寫入、畫面不動）。
- 相依欄位整組比對（`GROUPS`）：E-Pad 長／寬／`_pad_from`、`R_jc`／`_rjc_from`、`Board_Type`／`_bt_from`、
  `TIM_Type`／`TIM_Model` —— 不會拼出兩邊都沒有過的組合（例：我的長＋對方的寬）。
- **推導欄位不比對**（`MERGE_DERIVED = ['Thick(mm)', '_renamed_from']`，`derivedKeys`）：板厚每次 recalc 都由參數控制台帶入，
  若列入比對，載入時自動帶入的板厚會被當成「我改過這顆」→ 對方刪掉那顆元件時變成假衝突。
  合併後由 `thickApplyToFields` 重新帶入。改名標記 `_renamed_from` 在寫入時由 `renameMarksApply` 重新決定（見下節）。
- 型別差異不算修改（`normalizeComp`：`"5.2"` 與 `5.2` 相同、`''` 等於沒有 key）。
- 專案名稱也三方比對（`MERGE_SCALARS = ['project_name']`）：AI-Thermal 改了名、本工具沒改 → 保留新名稱。
- 元件配對用 **`_cid`（元件 id）**：載入時 `CompMerge.ensureProjectCids` 補發（快照與畫面同一份 id）、
  `addComp`／快選／📋 複製都給**新的** id、存檔一律寫出；舊資料沒有 id 時退回用名稱配對，
  資料庫已有的 id 優先沿用。`_cid` 是底線開頭的內部欄位，**不列入 carry 白名單**。
- 寫入時機：`dbAdapter.updateDoc('projects', id, (cur) => fields)` —— **fields 可以是函式**，後端在
  「寫入當下的最新內容」上呼叫（412 重讀後會重算）；函式裡有未決定的衝突就丟 `CompMerge.MergePending`，
  `CompMerge.saveWithMerge` 接到後開視窗、帶著選擇重試。後端規則：**先算完才動快取**（算的途中丟例外 →
  快取不變、不寫入）。本機檔模式沒有 If-Match → 存檔前先 `dbAdapter.refresh()`（`fileDb.refresh`）。
- 不合併的情況：新專案、覆蓋別的專案、原專案已被刪除要重建 → 以畫面為準（沒有「載入時」可以比）。
- 存檔成功 → `adoptWrittenProject`：畫面換成實際寫入的內容（含併入的對方修改）、當作新快照；
  alert 附一行「已合併：併入資料庫最新的 N 項修改…」（`CompMerge.summaryText`）。
- **切回分頁自動檢查**（`visibilitychange`／`focus` → `checkProjectFreshness`，15 秒節流、存檔中或衝突視窗
  開著時不做）：資料庫裡這個專案（元件清單＋名稱＋`global_params`）跟快照不同時 ——
  畫面沒有未存修改（`projectIsDirty`，比 `markProjectClean` 當時的畫面指紋）→ 靜默重新載入並跳一行提示；
  有未存修改 → 不動畫面，Tab0 跳**琥珀色**提示（`#stale-banner`，提醒不是錯誤）與「放棄我的修改，重新載入」鈕。
- **兩個後端的 `getDoc` 回複本、`setDoc`／`updateDoc` 存複本**：不可再讓畫面持有 DB 快取的活參照。
  （`getCollection` 仍回快取本身，呼叫端只能讀。）
- 契約測試：`tests/merge-save.test.js`（整合）、`tests/comp-merge.unit.test.js`（純邏輯）。

### 元件改名：`_renamed_from`（讓 AI-Thermal 把以名稱當 key 的資料搬過去）

AI-Thermal 有好幾份資料用「元件名稱」當 key：TH/ME 頁的 `thermal_specs`／`hidden_components`、Tab3 的
`validation_data`／`vd_hidden_components`、Tab1 標註的 `componentRef`。本工具**不碰這些資料**，所以在這裡改元件名稱，
那些資料會變孤兒（AI-Thermal 的 TH/ME 頁那一列變空白、推導不出導熱方式／E-Pad → 回到本工具變必填紅框）。

- 存檔時 `renameMarksApply(fields, cur, base)`：比對**資料庫最新內容**裡同一顆元件（`_cid`；舊資料還沒有 id 時用
  載入時快照裡的名稱對）的那些資料「掛在哪個名稱底下」（它的 `_renamed_from`，沒有就是它的名稱）：
  跟這次要寫的名稱不同 → 標 `_renamed_from = 那個名稱`；相同 → 不標（刪 key）。
  結果：沒改名不標、改回原名不標、連改兩次仍指向最早的名稱、AI-Thermal 已經搬過（清掉標記）之後再改名 → 指向搬過去的名稱。
- ⚠ **一定要在寫入當下拿資料庫最新內容算，不可在改名當下標**：AI-Thermal 可能在我們載入之後已經搬過一次，
  畫面上的舊標記會指向一個已經不存在的名稱。
- 沒有可以對照的資料庫內容 → **一律不標**：新專案、覆蓋別的專案、重建已刪除的專案、「複製專案」（新文件沒有
  AI-Thermal 的資料，畫面上的標記也一起清掉）；「📋 複製元件」的複本是新的一顆，也不帶標記。
- AI-Thermal 讀到標記：載入時先搬它畫面上那一份，存檔時在最新內容上搬好所有資料，**同一次寫入裡清掉標記**。
  本工具只寫、不讀這個標記（除了下一次存檔時重新計算）。
- `_renamed_from` 是底線開頭的內部欄位：不列入 carry 白名單、合併時不比對（`MERGE_DERIVED`）。
- 契約測試：`tests/merge-save.test.js` [I]；AI-Thermal 端 `tests/merge-save.test.js` [K]。

### SharePoint 讀寫防護（`graphDb.js`）

- `_graphGet`：`cache:'no-store'`＋`Cache-Control: no-cache`（不可讀到瀏覽器快取的舊檔）；逾時 30 秒；
  逾時／斷線／429／5xx 自動重試 2 次，其他 4xx 直接丟出。`_graphPut` 逾時 90 秒。
- `_withOptimisticWrite`：除了 412，逾時／斷線／429／5xx 也重讀後重試（帶 If-Match，若其實已寫成功會
  得到 412 再重讀，不會蓋掉任何人的寫入）。
- `_readFile`：metadata 多取 `size`。**本 session 第一次讀檔就讀到空內容、但檔案大小不是 0（或拿不到大小）→
  唯讀保護**，不可 bootstrap 空骨架（否則下一次寫入就把整份共用 DB 抹掉）；真的是 0 bytes 才建立空骨架。

### 參數控制台可調寬／收合

`#sidebar-resizer` 同時是拖曳把手與收合鈕：`mousedown` 後位移超過 4px 才算拖曳，
沒超過就當點一下 → 收合／展開（收合後分隔線變 ▶，這是收合狀態唯一回得去的路，不可拿掉）；
標題列也有一顆同功能的按鈕。寬度（220–560px）與收合狀態存 localStorage，
讀寫一律 try/catch。⚠ **寬度變動後要呼叫 `resizePlots()`**，否則 Plotly 圖停在舊寬度；
登入前／登出後由 `_setShellVisible(false)` 把側欄、分隔線、主區一起藏起來。

### `R_jc`（熱阻 Rjc）：AI-Thermal 推導過就鎖定

熱阻是**規格書的值**，單一事實來源在 AI-Thermal Tab1 的熱阻表（θJC）。在本工具改它只會被
AI-Thermal 下次存檔覆寫，還讓兩邊數字對不起來 → `rjcCellHtml` 改成：

| 情況 | 畫面 |
|---|---|
| 有 `comp._rjc_from`（AI-Thermal 推導過）| **鎖定的純參照值**：白底黑字文字 ＋ 小 🔒，左側保留藍邊；tooltip 寫出取自哪一筆 θJC、量測條件（讀 AI-Thermal 寫的 `comp.Rth`，本工具只讀不寫），並指路回 AI-Thermal |
| 沒有標記（本工具新增／AI-Thermal 沒推導過）| 照舊是可輸入的數字欄 |
| 有標記但**值是空的**（標記殘留、值被清掉）| 可輸入 ＋ 紅框「必填」——不可把一個空值鎖起來讓人改不了（Rjc 是必填欄位）|

- **不可用反灰 `disabled` input**（UX 慣例 2：純參照值要白底黑字看得清楚），也**不給 ✂ 逃生口**
  —— 這欄的逃生口是「回 AI-Thermal 改 θJC」，不是就地改。
- `.rjc-ref` 必須 `white-space:nowrap`：數值與 🔒 換行會把整列撐高（行內圖示踩過這個坑）。
- 鎖定只影響「能不能改」，計算照舊：`Tj = Tc + P×R_jc`。
- 📋 複製元件會沿用標記（同一顆元件的規格書值）→ 仍鎖定；「從資料庫快選」不帶底線開頭的
  內部標記 → 快選出來的新元件可自行輸入（`VARIANT_CARRY` 刻意不含標記）。
- 圖例文案要跟著分開講：可編輯的推導欄位是「會被覆寫」，Rjc 是「鎖定不開放修改」。
- AI-Thermal 依**主散熱路徑**取 θJC（`IC top` → θJC,top；`Copper Coin`／`Thermal Via` → θJC,bottom），
  熱阻表沒有對應的那一筆才暫用另一筆。本工具看 `Board_Type` 與 `_rjc_from` 對不上時，在鎖定值旁標琥珀色 ⚠
  （tooltip 說明「應該用哪一筆、Tj 可能被低估，請到 AI-Thermal 補上」）。只讀現有欄位，不新增 key。

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
| `Board_Type`、`Pad_L`、`Pad_W`、`TIM_Model`、`TIM_Type` | 5G-RRU 可編輯（標藍邊提醒會被覆寫）；AI-Thermal 存檔時由 Tab1/Tab2 推導後覆寫 |
| `R_jc` | **有 `_rjc_from` 且有值時本工具鎖定不可改**（見下節）；沒有標記（或值是空的）才可自行輸入 |
| `Type`、`Power_RT(W)`、`TV_ID_mil`、`TV_Qty`、`Temp_Sensor`、`Local_Qty`、`Remote_Qty`、`note`、`Rth`、`SpecFile` | 只有 AI-Thermal（本工具不顯示但原樣保留）|

> 內部欄位（底線開頭，兩個工具都原樣保留、不列入 carry 白名單）：`_cid`（元件 id，存檔三方合併配對用，
> 兩邊都會補發）、`_defaults_ok`（本工具寫：確認過不是舊預設值）、`_rjc_from`／`_bt_from`／`_pad_from`
> （AI-Thermal 寫：推導來源）、`_excluded`、`_ref_*`（本工具的快選參照）、`_renamed_from`（本工具寫：改過名的元件，
> AI-Thermal 以名稱當 key 的資料還掛在哪個名稱底下；AI-Thermal 搬完就清掉，見「元件改名」）。

⚠ **「從資料庫快選」的 carry 白名單兩邊都必須列全上表所有欄位**（本工具的 `VARIANT_CARRY`
／AI-Thermal 的 `SG_VARIANT_CARRY`，目前各 21 項）。漏列的 key 快選時就不會被帶過來（本工具已不套分類預設 → 變成缺值被必填檢查擋下；
AI-Thermal 專屬欄位則是整個掉失），複製完再存回共用 DB 就等於把對方工具填的真實值丟掉。新增任何每元件欄位時，
**同一個 commit 內要把它加進本工具的白名單，並在另一個 repo 同步補上**。
物件／陣列欄位（`Rth`、`SpecFile`）carry 時必須深拷貝（`carrySrc`）。
`SpecFile` 是檔案參照不是複本（實體檔在來源專案的 `SPEC/<專案名>/` 底下）→ 快選帶入時標
`SpecFile._from = <來源專案名>`，AI-Thermal 才知道換檔／刪除時只能解除參照、不可刪來源檔。

#### ⚠ `SpecFile` 可能是陣列（一顆元件多份規格書）

AI-Thermal 已支援「一顆元件多份規格書」（datasheet／application note／errata）。
欄位仍叫 `SpecFile`，但**形狀隨份數變**：

| 份數 | `comp.SpecFile` |
|---|---|
| 0 | key 不存在 |
| 1 | `{ path, name, at, by, _from? }` ← 與舊格式相同 |
| ≥2 | `[{ … }, { … }, …]` |

本工具**不顯示規格書、只原樣保留**，但快選複製元件時一定要把**每一份**都標上來源：
`addFromVariant` 走 `specMarkFrom(src, v.originProjectName)`（單一物件與陣列都逐份標）。
⚠ 原本寫成 `if(src.SpecFile && src.SpecFile.path) src.SpecFile._from = …` —— 那隻認單一物件，
遇到陣列會整批漏標，AI-Thermal 之後會把那些檔案當成本專案自己的而**刪掉來源專案的原始檔**。
新增任何會碰 `SpecFile` 的程式碼時，兩種形狀都要處理（AI-Thermal 端對應 `sgSpecList()` /
`sgSpecStore()` / `sgSpecMarkFrom()`）。

#### ⚠ 元件欄位**不補預設值**：缺必填 → 告警並擋下計算（`compMissing`／`listMissing`）

標準流程是 **AI-Thermal 先建資料 → 本工具讀同一個專案算體積**。AI-Thermal 刻意不寫本工具專屬欄位
（`Height(mm)`／`R_jc`…），專案也可能還沒維護完整。原本載入時會補分類預設值（Height 250、Rjc 1.5、
限溫 200…）讓計算跑得動 —— 使用者明確要求拿掉：**預設值若是錯的，算出來的體積就是錯的，還不容易被發現。**

> 使用者原話：「參數控制台填預設值可以，元件設定那邊不需要；沒填就是使用者必須要注意到，否則不能計算。」

**必填規則**（`REQ_ALWAYS`／`REQ_IF_POWERED`）：

| 條件 | 必填欄位 |
|---|---|
| 一律 | `Qty`、`Power(W)`（沒有就不知道熱負載）|
| `Qty × Power ≠ 0`（或還不知道）| 另加 `Height(mm)`、`Limit(C)`、`R_jc`、`Board_Type`、`TIM_Type`、`Pad_L`、`Pad_W` |
| 明確填 0 瓦／0 顆 | 不產生熱 → 其餘免填（Tab1／PDF 表格裡算不出的值顯示「—」，不印 NaN）|
| 按 👁 排除（`_excluded`）| 不檢查 |

- **0 是「有填」**（例：Cavity Filter 的 E-Pad 0×0、Rjc 0 是既有建模慣例）；只有「沒有 key／空字串／非數字」算沒填。
- `TIM_Model` 不必填（沒選型號就用參數控制台的 `K_<Type>`／`t_<Type>`，那是允許預設值的地方）；
  `Thick(mm)` 也不在清單裡（每次 `recalc()` 由 `applyThickFromGlobals()` 從參數控制台帶入）。
- **擋下計算**：`computeAll` 開頭 `listMissing(comps)` 有東西就回 `{…emptyCalcResult(), blocked:true, missing}`，
  不產生任何計算列。Tab1／Tab2（體積框顯示「無法計算：必填欄位未填」）／Tab3／敏感度掃描與 Tornado
  一律顯示同一份 `calcGateHtml(missing)`；PDF 報告拒絕產生並列出缺什麼；載入／匯入時的 alert 也附上缺值摘要。
- **畫面**：元件設定頂部紅色橫幅（`#comp-missing-banner`）逐顆列出元件與欄位，**點欄位名稱 →
  `jumpToMissing` 切到該分類、捲到該列、聚焦那一格並閃一下**。缺值格：數字欄**空白**（不可再顯示 0，
  看起來像有填）＋紅框＋placeholder「必填」；下拉放「— 請選擇 —」佔位（不讓瀏覽器顯示成清單第一項）。
  紅色 = 擋下計算的錯誤狀態（紅色保留給錯誤）。
- **清空數字欄＝刪 key**（`updateCompNum`），不可寫 0：0 是一個值，缺值會被當成有填而靜默算下去。
- **新增元件只給名稱**（`addComp`）；**從資料庫快選**不再套分類預設（`makeComp` 已移除），
  來源沒填的欄位就讓它空著；來源瓦數是 `''` 不帶、也不鎖瓦數（`_ref_locked` 只在有值時成立）。
- `normalizeComps()` 仍要在 `cloudLoadOne`／`handleFileLoad`／`init` 指派完 `components.*` 後呼叫，
  但**只做型別整理**：字串數字轉 number、`''`／`null`／非數字 → 刪 key、清掉舊版 `_filled`。**不補任何值。**
- 舊版的 `_filled`／琥珀色「自動補值」機制已整個拿掉；`_buildProjectFields` 仍會剝掉殘留的 `_filled`。
- 契約測試：`tests/comp-normalize.test.js`。

#### ⚠ 疑似舊版罐頭預設值：一樣擋計算（`compStamped`／`_defaults_ok`）

2026-09-18 以前，AI-Thermal 建立元件時會自動塞一組分類預設值（它的 `SG_DEFAULTS`，已移除）。那些元件
「有值」，上面的必填檢查擋不下來，但值幾乎可以確定不是實際值 —— 正是使用者擔心的「填了預設值但是錯的」。
備份實測：Cygnus-V2-62.5dB 的 40 顆元件全中（39 顆 Digital＋1 顆 PWR），其他 7 個專案最多只有 4 欄碰巧相同。

- 判斷：**7 個欄位全部**等於該分類的舊預設（`STAMPED_FIELDS`／`STAMPED_DEFAULTS`：
  RF 250／10×10／Copper Coin／200／1.5／Grease、Digital 50／10×10／Thermal Via／100／0.5／Putty、
  PWR 30／20×20／None／95／0／Grease）。**這組是歷史值，刻意寫死**，不可改成引用 `RF_DEFAULT` 之類的常數。
- 不列入：0 瓦／0 顆、按 👁 排除、`_defaults_ok === true`、只有部分欄位相同、缺必填欄位的（先歸「必填」那段）。
- 處理（使用者選的方案 A）：**視同未填、一樣擋計算**。`listMissing` 回 `kind:'stamped'`；告警分兩段
  （「必填欄位還沒填」／「疑似舊版自動帶入的預設值」），後者每顆有「✓ 確認是實際值」鈕；元件表 7 格
  **虛線紅框**（值照常顯示，與「沒填」的實線紅框區隔）、名稱下方也有確認鈕；PDF 拒絕產生時列出。
- 解除：改掉任一格（組合不再相同）→ 自動解除；或按確認（先 `confirm` 列出 7 個值）→ 寫
  **`_defaults_ok: true`**（跟著元件存進共用 DB，AI-Thermal 原樣保留）。`_defaults_ok` 是底線開頭的內部欄位，
  **不列入 carry 白名單**（快選出來的新元件要重新確認）；📋 複製同一顆元件會沿用（同樣的值）。
- 契約測試：`tests/stamped-defaults.test.js`（含備份真實資料的判斷結果）。

#### ⚠ 數字欄位一律先轉成 Number（`Pad_L + Thick(mm)` 是加法）

`calcThermalResistance` 開頭用 `_num()` 把 `Qty`/`Power(W)`/`Height(mm)`/`Pad_L`/`Pad_W`/
`Thick(mm)`/`Limit(C)`/`R_jc` 全部轉成數字。少了這一步，值若是字串就會**字串相接**：
`"7" + "2" = "72"` → 擴散面積算成 72×72mm（正解 9×9），熱阻被低估近 8 倍，
而且**不噴 NaN**、圖表照樣畫得出來 —— 靜默樂觀，比 NaN 更危險。
`_num()` 對真的沒有值回 `NaN`（讓它在畫面上現形），不偷偷當 0。

⚠ **空值一律「不寫 key」，不可寫 `''`**：`calcRow` 對空字串多半不噴 NaN 而是**靜默算成 0**
（`Thick` 空 → `R_int`=0、`Pad_L/W` 空 → 面積用字串算出假值、`Limit(C)` 空 → 裕度變超大負數），
方向是**低估熱阻＝樂觀**，比 NaN 更危險。取消 TIM 選型／換 TIM 類型、清空數字欄時一律 `delete` key；
載入時 `normalizeComps` 也會把別的工具寫進來的 `''` 刪掉，交給必填檢查擋下。

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
  5 支本地 JS（`config.js` / `fileDb.js` / `graphDb.js` / `dbAdapter.js` / `compMerge.js`）的
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

