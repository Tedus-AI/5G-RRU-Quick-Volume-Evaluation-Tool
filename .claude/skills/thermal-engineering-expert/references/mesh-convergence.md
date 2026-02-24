# Mesh 策略與收斂除錯完整指南
## 目錄
1. [Mesh 基礎觀念](#1-mesh-基礎觀念)
2. [各軟體 Mesh 策略](#2-各軟體-mesh-策略)
3. [Mesh Independence Study](#3-mesh-independence-study)
4. [收斂診斷](#4-收斂診斷)
5. [不收斂排除手冊](#5-不收斂排除手冊)
6. [模擬驗證與確認 V&V](#6-模擬驗證與確認-vv)
---
## 1. Mesh 基礎觀念
### 為什麼 Mesh 品質這麼重要
CFD 求解器在每個 cell 上離散化 governing equations（Navier-Stokes + energy equation）。Mesh 品質直接影響：
- **精度**：網格太粗會錯失重要的溫度/速度梯度
- **收斂性**：畸形的 cell 導致數值不穩定
- **計算成本**：過度加密浪費時間和記憶體
核心原則：**在梯度大的地方用密網格，梯度小的地方用粗網格，過渡要平滑**。
### 關鍵品質指標
**Aspect Ratio（縱橫比）**
- 定義：cell 最長邊 / 最短邊
- 目標：< 5:1（理想），< 20:1（可接受），> 100:1 會嚴重影響精度
- 電子散熱中常見問題：TIM 薄層方向被拉伸成高 aspect ratio
**Skewness（歪斜度）**
- 定義：cell 偏離理想形狀的程度（0 = 完美，1 = 退化）
- 目標：< 0.7（良好），< 0.9（可接受），> 0.95 可能導致不收斂
- 主要出現在非結構化網格的複雜幾何區域
**Orthogonal Quality（正交品質）**
- 定義：cell 面法向量與 cell 中心連線的正交性（1 = 完美，0 = 退化）
- 目標：> 0.3（可接受），> 0.7（良好）
- 與 skewness 互補，一起看
**Expansion Ratio（膨脹比）**
- 定義：相鄰 cell 的尺寸比
- 目標：≤ 1.5:1（理想），≤ 2:1（可接受）
- FloTHERM 結構化網格特別需要注意此指標
---
## 2. 各軟體 Mesh 策略
### FloTHERM（結構化 Cartesian 網格）
**特點**：自動生成正交網格，透過 localized grid 加密
**策略**：
- 使用 system grid 設定全域基礎解析度
- 在關鍵區域添加 localized grid region
- 確保 grid line 通過重要界面（TIM、die surface）
- 善用 grid constraint 功能精確控制 grid line 位置
**每層至少 cell 數建議**：
- TIM 層（0.05-0.5mm）：1-2 cells
- Die 厚度（0.1-0.5mm）：2-3 cells
- PCB 每層銅：理想 1 cell（但通常做 lumped model）
- 散熱片鰭片間通道：3-5 cells（寬度方向）
- 散熱片鰭片厚度：1-2 cells
### FloTHERM XT（非結構化混合網格）
**特點**：四面體 + 稜柱層，可貼合曲面
**策略**：
- 設定合適的全域 max/min element size
- 對所有換熱壁面啟用 prism layer（3-8 層）
- 在熱源周圍使用 Body of Influence 局部加密
- 窄通道至少 5-8 cells 跨越
### ANSYS Icepak
**特點**：非保角多塊 (non-conformal multi-block) 網格
**策略**：
- 使用 Icepak 的 auto mesh 作為起點
- 手動添加 mesh region 加密關鍵區域
- Slack-based meshing 可自動適應幾何特徵
- 注意 non-conformal interface 的影響
### ANSYS Fluent（通用 CFD）
**特點**：完全靈活的非結構化網格
**策略**：
- 使用 Fluent Meshing 的 watertight geometry workflow
- 對壁面添加 boundary layer (inflation layers)
- 第一層高度根據 y+ 目標設定
- 使用 poly-hexcore 網格平衡精度與效率
---
## 3. Mesh Independence Study（網格獨立性測試）
### 為什麼必須做
證明你的結果不是因為網格太粗而失準。這是任何可信模擬的基本要求。
### 標準做法
**Step 1: 準備三組網格**
- Coarse（粗）：基礎解析度
- Medium（中）：cell 數 ≈ 粗的 2-3x（每個方向 cell 數增加約 1.3-1.5x）
- Fine（細）：cell 數 ≈ 中的 2-3x
**Step 2: 用相同設定跑三次模擬**
**Step 3: 比較關鍵指標**
- T_junction（最關心的溫度）
- Maximum temperature
- Flow rate（如果有風扇/開口）
- 特定 monitor point 的溫度
**Step 4: 判斷收斂**
- Medium vs Fine 的差異 < 1-2°C (或 < 2-3%) → Medium 夠用
- 差異仍大 → 需要更密的網格
- 建議用 Richardson extrapolation 估算 "真值" 與網格誤差
### 報告時的呈現方式
| 網格 | Cell 數 | T_junction (°C) | T_max (°C) | 相對於 Fine 的誤差 |
|------|---------|-----------------|------------|-------------------|
| Coarse | 500K | 87.3 | 92.1 | 3.2% |
| Medium | 1.5M | 85.4 | 89.8 | 1.0% |
| Fine | 4.5M | 84.6 | 88.9 | baseline |
如果 Medium 與 Fine 差異在可接受範圍內，就用 Medium 做後續分析（節省時間）。
---
## 4. 收斂診斷
### 什麼是「收斂」
數學上，CFD 迭代求解直到殘差 (residual) 降到指定門檻以下。殘差代表離散方程式在當前迭代未被滿足的程度。
**但殘差低 ≠ 結果正確**。必須同時確認：
1. 殘差持續下降（或穩定在低值）
2. Monitor point 數值穩定
3. 全域守恆量 (mass/energy balance) 合理
### Monitor Point 設置
在以下位置放置 monitor point：
- **Junction temperature**：最終關心的溫度
- **Heat sink base temperature**：檢查散熱路徑
- **Air outlet temperature**：檢查能量守恆
- **流速監控點**：在流場可能不穩定的位置
判斷準則：monitor 值的變化 < 0.1°C（溫度）或 < 1%（流速）持續 50+ 迭代
### 殘差解讀
| 殘差行為 | 意義 | 行動 |
|----------|------|------|
| 穩定下降到目標值 | 正常收斂 | 結果可信 |
| 下降後平穩 (plateau) | 可能到達最佳收斂 | 檢查 monitor point 是否穩定 |
| 持續震盪（固定幅度）| 可能有周期性流動 | 考慮暫態模擬或更細的網格 |
| 震盪且幅度增大 | 數值不穩定 | 見不收斂排除手冊 |
| 突然跳升 | 數值發散 | 立即停止，檢查模型 |
---
## 5. 不收斂排除手冊
### 系統化排除流程
遇到不收斂時，依照以下順序排除：
**Level 1: 檢查模型基本設定**
- [ ] 幾何有無重疊、穿透、或極小間隙？
- [ ] 材料屬性正確？（特別是密度、黏度、導熱率的量級）
- [ ] 邊界條件合理？（有進有出？質量守恆？）
- [ ] 重力方向正確？（自然對流模型特別重要）
- [ ] 功率設定正確？（W vs mW 的單位錯誤很常見）
**Level 2: 檢查 Mesh 品質**
- [ ] 有無極端的 aspect ratio (> 100:1)？
- [ ] 有無嚴重畸形的 cell (skewness > 0.95)？
- [ ] 相鄰 cell 的 expansion ratio 是否 ≤ 2:1？
- [ ] 薄層結構（TIM、thin wall）是否有 cell 通過？
**Level 3: 調整求解器參數**
- [ ] 降低 relaxation factor（under-relaxation）
  - 壓力：0.1-0.3（預設通常 0.3）
  - 動量：0.3-0.5（預設通常 0.7）
  - 能量：可保持 1.0（能量方程通常穩定）
- [ ] 使用 first-order upwind 先收斂，再切換 second-order
- [ ] 增加迭代次數上限
**Level 4: 逐步建立模型**
- [ ] 先只開傳導（關閉流場），確認熱源與熱阻設定合理
- [ ] 加入流場但使用層流模型
- [ ] 最後加入紊流模型和輻射
### 特定場景的不收斂對策
**自然對流不收斂**
- 自然對流本質上是弱驅動流動，容易不穩定
- 嘗試：更低的 relaxation factor、更密的網格（特別在邊界層）
- 確認 Boussinesq approximation 是否適用（ΔT 不宜太大）
- 考慮暫態求解代替穩態（穩態自然對流在某些幾何下無穩態解）
**風扇模型不收斂**
- P-Q curve 數據是否完整？（特別是 shutoff pressure 與 free delivery）
- 風扇附近的網格是否足夠密？
- 嘗試先用 fixed flow rate 替代 P-Q curve，收斂後再切換
**多物理場耦合不收斂**
- 輻射 + 對流同時求解可能不穩定
- 嘗試先跑 no-radiation，收斂後再啟用輻射
- 降低輻射的 relaxation factor
---
## 6. 模擬驗證與確認 (V&V)
### 驗證 (Verification)：數學上是否正確求解
- Mesh independence study（已在第 3 節說明）
- 迭代收斂確認
- 能量/質量守恆檢查
- 與解析解比較（簡單案例）
### 確認 (Validation)：物理上是否正確描述
- 與實驗量測數據比較
- 比較 thermocouple (TC) 量測位置的溫度
- 注意 TC 位置在模擬中的精確對應
- 合理的差異範圍：±5°C 或 ±10%（系統級），±2-3°C（元件級）
### 常見的模擬-實驗差異來源
1. **TIM 實際厚度 vs 設計值**：組裝壓力不均、overflow、氣泡
2. **接觸熱阻**：金屬接觸面的實際接觸狀況難以精確建模
3. **環境條件**：實驗室氣流、周圍物體的輻射影響
4. **元件功率**：實際功耗 vs datasheet 標稱值
5. **材料參數**：溫度相依性、批次差異
6. **量測誤差**：TC 安裝方式、讀值精度
