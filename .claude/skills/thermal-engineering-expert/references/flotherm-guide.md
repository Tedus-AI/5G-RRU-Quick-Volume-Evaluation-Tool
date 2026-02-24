# FloTHERM 完整操作指南與最佳實踐
## 目錄
1. [建模流程總覽](#1-建模流程總覽)
2. [SmartPart 使用技巧](#2-smartpart-使用技巧)
3. [邊界條件設定](#3-邊界條件設定)
4. [Mesh 設定](#4-mesh-設定)
5. [求解器設定](#5-求解器設定)
6. [後處理技巧](#6-後處理技巧)
7. [Command Center 參數優化](#7-command-center-參數優化)
8. [常見問題排除](#8-常見問題排除)
---
## 1. 建模流程總覽
FloTHERM 使用結構化網格 (structured grid) 的 RANS-based CFD 求解器，特別針對電子散熱最佳化。標準工作流程：
**Step 1: 幾何建模與簡化**
- 匯入 CAD (STEP/IGES) 或使用 SmartParts 建模
- 簡化原則：移除不影響熱流的小特徵（螺絲孔、倒角、小圓角）
- 保留影響氣流路徑的關鍵幾何
- 建議在 CAD 端先做 defeaturing，再匯入 FloTHERM
**Step 2: 材料指定**
- 使用內建材料庫或自定義材料
- PCB 記得設定異向性導熱（面內/穿板方向不同）
- 在 Material 資料庫中，copper layer 百分比直接影響 PCB 等效熱導率
**Step 3: 熱源設定**
- IC 封裝：使用 DELPHI/2-resistor 模型或詳細 die-level 模型
- 分散元件：surface heat source 或 volumetric heat source
- 注意區分 TDP (Thermal Design Power) 與 actual power dissipation
**Step 4: 邊界條件**
- 系統級：ambient temperature、flow inlet/outlet
- 元件級：功率、接觸條件
**Step 5: Mesh → Solve → Post-process**
---
## 2. SmartPart 使用技巧
SmartParts 是 FloTHERM 的核心建模工具，每個都封裝了特定元件的物理行為。
### PCB SmartPart
- 設定銅層比例 (copper percentage) 來自動計算等效導熱率
- 可定義每一層的銅含量（outer layer 通常 40-70%，inner layer 70-90%）
- 記得設定 through-hole via 的等效導熱增強
- Via 陣列區域可透過 "thermal via region" 功能指定
### IC Package SmartPart
- **2-Resistor model (Theta_JC + Theta_JB)**：最常用，適合系統級分析
- **DELPHI model**：更精確的多節點熱阻網路，適合需要更準確封裝溫度分佈時
- **Detailed model**：包含 die、die attach、substrate、lid 等細節
- 選擇原則：系統級用 2-Resistor，封裝級用 DELPHI 或 Detailed
### Heat Sink SmartPart
- 自動生成常見鰭片幾何（plate fin、pin fin、flared fin）
- 可設定 fin count、fin height、fin thickness、base thickness
- 材料預設鋁，可更改
- 注意：SmartPart 假設鰭片均勻分佈，非均勻設計需自行建模
### Fan SmartPart
- 輸入 P-Q curve（至少 3 個點：shutoff pressure、operating point、free delivery）
- 可設定旋轉方向、hub 比例
- 支援 axial fan 和 radial blower
- 建議從供應商規格書取得 P-Q curve 數據
### Enclosure SmartPart
- 快速建立密封或開孔機箱
- 可定義壁厚、材料、開孔位置與大小
- 開孔可設定為 free opening 或加裝 filter/grill（附加壓降）
---
## 3. 邊界條件設定
### 常用邊界條件類型
**Fixed Temperature (Dirichlet)**
- 用途：已知溫度的表面（如液冷板表面、恆溫槽）
- 注意：不要用在自然對流模型的外壁面上（這會移除對流阻抗）
**Heat Flux (Neumann)**
- 用途：已知功率/熱流密度的表面
- 注意：均勻 vs 非均勻熱流分佈的影響
**Convection Coefficient**
- 用途：簡化外部對流為 h×A×ΔT
- 適用：當外部流場不在模擬範圍內（如機箱外壁面）
- 自然對流典型 h：5-25 W/m²·K
- 強制對流典型 h：25-250 W/m²·K
**Radiation**
- FloTHERM 使用 surface-to-surface radiation model
- 對密封機箱內部，輻射可貢獻 20-40% 的散熱（不可忽略）
- 設定 emissivity：陽極氧化鋁 ≈ 0.8-0.9，拋光金屬 ≈ 0.05-0.1，塑膠 ≈ 0.9
### 戶外 RRU 場景的邊界條件
- 環境溫度：依產品規格（如 +55°C）
- 太陽輻射負載：約 1000 W/m² (worst case)，在 FloTHERM 中可透過 surface heat source 模擬
- 風速：通常假設 0 m/s (worst case for natural convection) 或規格定義的最低風速
- 重力方向：確認安裝方向正確（影響自然對流計算）
---
## 4. Mesh 設定
FloTHERM 使用 Cartesian 結構化網格（局部化加密 localized grid）。
### 基本原則
- 最小 cell 尺寸要能解析最小的重要特徵（如 TIM 厚度、thin wall）
- 相鄰 cell 尺寸比 ≤ 2:1（expansion ratio），理想 ≤ 1.5:1
- 流體區域在邊界層方向至少 3-5 個 cell
- 高熱流密度區域需要更密的網格
### Localized Grid 操作
- 在關鍵區域（IC die、TIM layer、narrow gaps）添加 region 並指定 cell count
- 使用 "grid constrain" 功能確保特定位置有 grid line 通過
- 先用 auto-grid 生成基礎網格，再手動加密關鍵區域
### Mesh 數量指引
| 模型規模 | 建議 cell 數 | 說明 |
|----------|-------------|------|
| 單一封裝 | 100K-500K | 封裝級分析 |
| 單板 PCB | 500K-2M | 板級分析 |
| 系統級 (chassis) | 1M-5M | 機箱級分析 |
| 機櫃級 | 3M-10M | 大型系統 |
### 常見 Mesh 問題
- **"Mesh too coarse" warning**：檢查 expansion ratio 與最小 cell 尺寸
- **記憶體不足**：減少不必要的 localized grid，或簡化遠離關注區的幾何
- **mesh 穿越薄層**：確保 TIM 或 thin wall 方向有足夠 cell（至少 1-2 個）
---
## 5. 求解器設定
### 收斂準則
- 預設殘差目標通常足夠，但建議同時監控 monitor point 溫度
- 溫度 monitor point 變化 < 0.1°C 持續 50+ iterations 可視為收斂
- 最大迭代次數：通常 500-1000 足夠，複雜模型可能需要 2000+
### 求解加速技巧
- 先以粗網格求解，收斂後再加密網格繼續
- 對純傳導問題，關閉流場求解可大幅加速
- 使用 multi-grid solver 加速收斂
- 對暫態問題，先跑一個穩態解作為初始條件
### 紊流模型
- FloTHERM 預設使用修改版的 zero-equation 紊流模型
- 對大多數電子散熱場景已足夠
- 低 Re 流動（自然對流、微通道）可能需要啟用 laminar region
- 不需要像 Fluent 那樣手動選擇 k-ε 或 k-ω 模型
---
## 6. 後處理技巧
### 溫度場可視化
- Plane cut：在關鍵截面查看溫度分佈
- Isosurface：找出超過特定溫度的區域
- Tabular data：匯出特定點/面的溫度數值
### 流場可視化
- Velocity vector：檢查氣流路徑是否合理
- Streamline：追蹤流體運動軌跡
- Particle trace：可視化散熱片通道內的流動
### 驗證檢查清單
- [ ] 能量守恆：總發熱量 ≈ 系統總散熱量？
- [ ] 溫度合理性：最高溫在熱源位置？沒有非物理的溫度值？
- [ ] 流場合理性：氣流方向符合預期？沒有非物理的迴流？
- [ ] 熱阻計算：(T_junction - T_ambient) / Power 是否在合理範圍？
---
## 7. Command Center 參數優化
Command Center 允許進行參數化研究 (parametric sweep) 和自動優化。
### 設定步驟
1. 將要變化的參數設為 "design variable"（如鰭片高度、風扇流量）
2. 定義目標函數 (objective)：如 minimize T_junction
3. 定義約束 (constraint)：如 pressure drop < X Pa
4. 選擇優化方法：DOE (Design of Experiments) → RSM (Response Surface) → 優化
### 最佳實踐
- 先用 DOE 掃描參數空間，了解各參數的影響程度
- 從少量參數開始（2-4 個），避免組合爆炸
- 使用 sensitivity analysis 識別最有影響力的參數
- 優化結果記得用完整 CFD 模擬驗證（RSM 是近似模型）
---
## 8. 常見問題排除
### 模型不收斂
**症狀**：殘差震盪或持續不下降
**診斷步驟**：
1. 檢查 mesh：是否有極端的 aspect ratio 或尺寸跳變？
2. 檢查邊界條件：是否有矛盾的 BC（如全封閉沒有散熱路徑）？
3. 檢查幾何：是否有重疊的物體或極薄的間隙？
4. 降低 relaxation factor，增加迭代次數
5. 簡化模型，逐步加入複雜度
### 模擬結果與實驗不符
**常見原因**：
- TIM 熱阻被低估（實際 BLT 大於設計值）
- 接觸熱阻未考慮（金屬面之間的接觸）
- 環境條件不一致（實驗室 vs 模擬的環境溫度、氣流條件）
- 元件功率不準確（實際功率 vs datasheet TDP）
- 幾何簡化過度（移除了影響流場的特徵）
### 記憶體 / 計算時間問題
- 優先簡化遠離關注區的幾何
- 使用對稱性 (symmetry) 減半模型
- 減少不必要的 localized grid
- 考慮分步驟求解（先粗再細）
