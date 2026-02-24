# FloTHERM XT 專屬指南
## 目錄
1. [FloTHERM vs FloTHERM XT 差異比較](#1-flotherm-vs-flotherm-xt-差異比較)
2. [CAD 匯入與幾何處理](#2-cad-匯入與幾何處理)
3. [非結構化網格策略](#3-非結構化網格策略)
4. [建模最佳實踐](#4-建模最佳實踐)
5. [適用場景決策](#5-適用場景決策)
---
## 1. FloTHERM vs FloTHERM XT 差異比較
| 特性 | FloTHERM | FloTHERM XT |
|------|----------|-------------|
| 網格類型 | 結構化 Cartesian | 非結構化 (tet/hex/prism) |
| 幾何處理 | SmartParts + 簡化 CAD | 原生 CAD 幾何 |
| 複雜幾何 | 需大量簡化 | 可直接使用 |
| 曲面精度 | 階梯狀近似 | 貼合真實曲面 |
| 求解速度 | 通常較快 | 複雜幾何可能較慢 |
| 學習曲線 | 較平緩 | 需要更多 CFD 經驗 |
| CAD 互操作 | 匯入後簡化 | 直接使用原始 CAD |
| 暫態模擬 | 支援 | 支援，適合複雜暫態場景 |
### 何時用 FloTHERM XT 而非 FloTHERM
- 幾何非常複雜（大量曲面、不規則形狀），用 FloTHERM 簡化代價太高
- 需要精確保留 CAD 幾何（如外觀件、精密流道）
- 分析對象有圓管、圓弧、斜面等非正交幾何
- 需要與 MCAD team 的設計模型直接互通
- 已有完整的 3D CAD 模型，不想重新用 SmartParts 建模
### 何時仍應使用 FloTHERM
- 早期概念設計階段，需要快速迭代
- 模型以矩形幾何為主（PCB、機箱、方形散熱片）
- 需要使用 Command Center 做大量參數化研究
- 團隊已熟悉 FloTHERM 流程，且幾何簡化代價不大
---
## 2. CAD 匯入與幾何處理
### 支援的 CAD 格式
- 原生格式：CATIA V5、Pro/E (Creo)、SolidWorks、NX、Inventor
- 中間格式：STEP (推薦)、IGES、Parasolid、ACIS
### 幾何簡化策略
即使 FloTHERM XT 可以處理複雜幾何，適度簡化仍然對效率很重要：
**應該移除的特徵**：
- 螺絲孔、螺紋、圓角、倒角（除非它們影響氣流路徑）
- 極小的特徵（< 網格最小尺寸的 1/2）
- 裝飾性細節（logo、文字刻印）
- 遠離熱關注區域的結構細節
**必須保留的特徵**：
- 影響氣流路徑的開孔、擋板、導風結構
- 散熱片鰭片幾何
- PCB 與元件之間的間隙
- 風扇安裝位置與進出口幾何
### 幾何修復工具
FloTHERM XT 內建幾何修復功能：
- **Stitch**：縫合不連續的面
- **Fill Holes**：填補小孔洞
- **Remove Small Features**：自動移除小於指定尺寸的特徵
- **Imprint**：在面上建立分區（用於施加局部邊界條件）
建議流程：匯入 → 自動修復 → 手動檢查 → 簡化 → 驗證水密性 (watertight)
---
## 3. 非結構化網格策略
### 網格類型
FloTHERM XT 使用混合網格：
- **四面體 (Tetrahedral)**：填充複雜幾何區域
- **六面體 (Hexahedral)**：結構化區域，精度較高
- **稜柱層 (Prism layers)**：邊界層貼體網格，對對流換熱很重要
### 重要 Mesh 設定
**全域 Mesh 控制**：
- Maximum element size：決定最粗的網格尺寸
- Minimum element size：防止過度細化（建議 ≥ 最小幾何特徵的 1/3）
- Growth rate：控制網格從細到粗的過渡速率（建議 1.2-1.5）
**Prism Layer（邊界層網格）**：
- 對對流換熱的準確性至關重要
- 建議層數：3-5 層（基本精度）、8-12 層（高精度）
- 第一層厚度需確保 y+ 在合適範圍
- 壁面處理：通常使用 wall function approach (y+ ≈ 30-300)
**局部加密**：
- 在高溫梯度區域（熱源附近、TIM 層）增加局部加密
- 在高速度梯度區域（開孔、狹窄通道）增加加密
- 使用 "Body of Influence" 在特定區域指定更細的網格尺寸
### Mesh 品質檢查
- **Skewness**：< 0.9（理想 < 0.7）
- **Aspect ratio**：< 20（理想 < 10）
- **Element quality**：> 0.1（理想 > 0.3）
- 使用 mesh quality histogram 快速識別問題區域
---
## 4. 建模最佳實踐
### 材料與熱源
- 與 FloTHERM 類似，PCB 需設定異向性導熱
- FloTHERM XT 支援更靈活的 volumetric heat source 設定
- 可以直接在 CAD 實體上指定功率，不需要額外建立 SmartPart
### 風扇建模
- 可使用 MRF (Moving Reference Frame) 做更精確的風扇模擬
- 簡化方式仍可使用 P-Q curve 的 momentum source 方法
- 對系統級分析，P-Q curve 方法通常已足夠
### 輻射
- 支援 surface-to-surface (S2S) 和 discrete ordinates (DO) 模型
- S2S：適合密閉空間少量面之間的輻射
- DO：適合半透明介質或複雜輻射場景
- 電子散熱通常使用 S2S 即可
### 暫態分析
- FloTHERM XT 在暫態分析上比 FloTHERM 更靈活
- 適合分析開機熱暫態 (power-on transient)、任務循環 (duty cycle)
- 時間步長選擇：初始較小（捕捉快速變化），之後可逐步增大
- 先跑穩態解作為初始條件（除非是冷啟動分析）
---
## 5. 適用場景決策
### 推薦使用 FloTHERM XT 的典型場景
**散熱模組設計**：
- 複雜的散熱片 + 熱管組合結構
- 需要評估精確的鰭片幾何效果
**密封機箱分析**：
- RRU 等戶外設備，外殼有複雜的鰭片與曲面
- 內部有精密的結構件影響氣流
**整機流場分析**：
- 需要精確 CAD 幾何來評估系統氣流分佈
- 伺服器、交換機等有複雜內部結構的設備
**CAD-driven 設計迭代**：
- 與機構工程師緊密合作，頻繁更新 CAD 模型
- 需要快速反映設計變更到模擬中
