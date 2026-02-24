# Digital Board 元件散熱專家指南
## 目錄
1. [Digital Board 散熱總覽](#1-digital-board-散熱總覽)
2. [FPGA 散熱](#2-fpga-散熱)
3. [ASIC / SoC 散熱](#3-asic--soc-散熱)
4. [DDR Memory 散熱](#4-ddr-memory-散熱)
5. [DC-DC Converter 散熱](#5-dc-dc-converter-散熱)
6. [光模組 Optical Module 散熱](#6-光模組-optical-module-散熱)
7. [封裝熱參數深度解讀](#7-封裝熱參數深度解讀)
8. [Multi-Die 封裝熱分析](#8-multi-die-封裝熱分析)
9. [Power Map 與功率分佈處理](#9-power-map-與功率分佈處理)
10. [Digital Board 模擬建模要點](#10-digital-board-模擬建模要點)
---
## 1. Digital Board 散熱總覽
### Digital Board 散熱特徵
與 RF board 相比，digital board 的散熱有以下特點：
**多個中高功率熱源**：FPGA、ASIC、memory、DC-DC 散佈在板上，形成多熱源耦合問題。不像 RF board 以 PA 為絕對主角。
**封裝以 BGA 為主**：大部分高功率 digital IC 使用 BGA 封裝，散熱路徑包括頂部和底部兩條。
**PCB 通常使用 FR4**：不像 RF board 可能使用特殊低損耗材料，digital board 的 FR4 基板在散熱上反而更友好（特別是多層高銅含量的設計）。
**功耗可能動態變化**：FPGA/ASIC 功耗取決於運算負載、時脈頻率、I/O 活動率，需要明確定義 worst case 與 typical use case。
### Digital Board 典型散熱架構
**密封機箱（如 RRU）**：
```
IC die → package → TIM → heat spreader/cold plate → chassis wall → fins → ambient
```
**通風機箱（如 BBU、server）**：
```
IC die → package → TIM → heat sink → forced air → exhaust
```
---
## 2. FPGA 散熱
### FPGA 功耗特性
FPGA 功耗由三部分組成：
**Static Power (靜態功耗)**：
- 由製程節點決定，與溫度正相關（溫度每升 10°C，靜態功耗增加 ~10-20%）
- 形成正反饋迴路：溫度↑ → 靜態功耗↑ → 溫度↑
- 先進節點 (7nm, 5nm) 的靜態功耗佔比越來越高
**Dynamic Power (動態功耗)**：
- P_dynamic = α × C × V² × f
- α = activity factor (signal toggle rate)
- 取決於設計的邏輯利用率和時脈頻率
**I/O Power (I/O 功耗)**：
- 取決於 I/O standard、data rate、termination scheme
- 高速 SerDes (如 28G/56G PAM4) 的 I/O 功耗不可忽略
### FPGA 功耗估算工具
- **Xilinx/AMD**：Vivado Power Estimator (XPE) 或 Vivado Power Analysis
- **Intel/Altera**：Quartus Power Analyzer 或 Early Power Estimator (EPE)
- 早期設計階段用 Power Estimator (spreadsheet tool)
- 詳細設計階段用 post-synthesis / post-implementation 功耗分析
### FPGA 封裝散熱
**大型 FPGA BGA 封裝特點**：
- 封裝尺寸：23×23mm 到 45×45mm+
- BGA ball count：500 到 3000+
- 有些高階 FPGA 有 metal lid（如 Xilinx VU 系列），有些是 bare die + heat spreader
- Flip-chip 封裝越來越普遍（die 面朝下焊到 substrate）
**散熱路徑分析**：
- **有 lid 的 FCBGA**：主要路徑為 die → TIM1 → lid → TIM2 → heat sink
  - TIM1：通常在封裝內部，由封裝廠決定
  - TIM2：使用者可控，選擇高性能 TIM 降低此段熱阻
- **Bare die FCBGA**：die 直接暴露，TIM 直接接觸 die surface
  - 風險：die 表面脆弱，安裝壓力需嚴格控制
  - 需要特殊的 heat sink mounting 機構（彈簧 + backplate）
### FPGA 散熱設計要點
**Thermal runaway 防護**：
- FPGA 的靜態功耗-溫度正反饋可能導致 thermal runaway
- 設計時確保：在最高 junction 溫度下，散熱能力仍大於總功耗
- 建議畫出 power vs temperature 曲線和 cooling capacity vs temperature 曲線，確認有足夠裕量
**Junction 溫度限制**：
- Commercial grade：0 to 85°C（T_J max = 100°C）
- Industrial grade：-40 to 100°C（T_J max = 100°C）
- 注意：軍規/車規有不同限制
- 降額 (derating)：通常設計目標比 T_J_max 低 10-15°C
**多電源軌 (multi-rail) 功耗**：
- FPGA 有多個電源（VCCINT、VCCAUX、VCCO、VCCBRAM 等）
- 各電源軌的功耗不同，對應的 DC-DC 效率也不同
- 總系統功耗 = Σ(P_rail / η_DCDC_rail)
---
## 3. ASIC / SoC 散熱
### ASIC vs FPGA 散熱差異
| 特性 | FPGA | ASIC / SoC |
|------|------|-----------|
| 功耗預測 | 可用 Power Estimator | 需要 RTL simulation 或 prototype 量測 |
| 功耗密度 | 中-高 | 通常更高（客製化邏輯更密集） |
| 封裝熱模型 | 供應商通常提供 | 可能需要自行建立或與封裝廠合作 |
| Die 內功率分佈 | 較均勻 | 可能極不均勻（CPU core vs cache vs I/O） |
### ASIC 散熱特殊考量
**Die 熱點 (hot spot) 問題**：
- ASIC die 上不同功能區塊的功率密度差異極大
- CPU core 區域功率密度可能是 cache 區域的 5-10 倍
- 必須考慮 die 內部的 thermal spreading resistance
- 使用 power map 進行精確建模（見第 9 節）
**先進封裝**：
- 2.5D (silicon interposer) 和 3D IC 封裝越來越普遍
- chiplet 架構帶來新的散熱挑戰（多個 die 堆疊，熱阻增加）
- 詳見第 8 節 Multi-Die 封裝分析
---
## 4. DDR Memory 散熱
### DDR 功耗特性
DDR memory 的功耗來源：
- **Activation/precharge power**：DRAM 存取操作
- **Read/write power**：資料傳輸
- **Refresh power**：定期刷新維持資料（即使 idle 也消耗）
- **I/O termination power**：ODT (On-Die Termination) 功耗
**典型功耗範圍**：
| 類型 | 單顆功耗 | 說明 |
|------|---------|------|
| DDR4 SDRAM | 0.3-1.5W | 取決於容量和活動率 |
| DDR5 SDRAM | 0.5-2.0W | 更高 data rate，但電壓更低 |
| HBM2/HBM3 | 3-10W (per stack) | 高頻寬記憶體，封裝在 interposer 上 |
### DDR 散熱設計
**單顆影響不大，但陣列效應顯著**：
- 單顆 DDR 0.5-1W 看似不多，但一塊 digital board 上可能有 8-32 顆
- 密集排列的 DDR 陣列累積功耗可達 10-30W
- DDR 之間的熱耦合效應不可忽略
**散熱方案**：
- 自然對流下：通常不需要額外散熱措施（如果 T_ambient 不太高）
- 強制對流下：確保 DDR 在氣流路徑上
- 高密度 / 高環境溫度：加裝 DDR heat spreader（金屬薄片黏貼在 DDR 頂部）
- 密封機箱中：DDR 的散熱需要透過 PCB 傳到 chassis
**DDR T_case 限制**：
- 通常 95°C（commercial grade），需注意 PCB 溫度已經很高時的餘裕
---
## 5. DC-DC Converter 散熱
### 為什麼 DC-DC 散熱重要
DC-DC converter 是 digital board 上常被忽視但功耗不低的元件：
**效率損耗計算**：
```
P_loss = P_out × (1/η - 1)
```
例如：效率 90% 的 DC-DC 提供 50W 負載 → 損耗 5.6W
**Digital board 通常有多組 DC-DC**：
- FPGA 多電源軌：0.85V (core)、1.8V (aux)、1.2V/1.35V (DDR)、3.3V (I/O)
- 每組 DC-DC 的效率和負載不同
- 總 DC-DC 損耗可能佔系統總功耗的 10-20%
### DC-DC 類型與散熱特性
| 類型 | 典型效率 | 功耗密度 | 封裝 |
|------|---------|---------|------|
| Discrete POL (Point of Load) | 85-95% | 中 | 各元件分散 |
| Module POL (如 µModule) | 87-95% | 高（集成度高） | BGA / LGA module |
| Digital POL | 88-95% | 高 | 小型 QFN/BGA |
| VRM (Voltage Regulator Module) | 90-95% | 高 | 大型模組 |
### DC-DC 散熱設計要點
**功率級元件（MOSFET/Inductor）是主要熱源**：
- MOSFET：switching loss + conduction loss
- Inductor：core loss + copper loss
- Output capacitor：ESR loss（通常小）
**PCB 散熱策略**：
- 功率級元件下方大面積銅皮
- 使用多層 PCB 的內層銅面擴散熱量
- Thermal via 連接頂層到內層銅面
- 注意 current loop 面積要小（同時是 EMI 需求和散熱需求的交集）
**模擬建模**：
- DC-DC module 通常簡化為一個 block + total power dissipation
- 如果需要精確分析，分別建模 MOSFET、inductor、capacitor
- 效率隨溫度變化（通常溫度升高效率略降），但影響小於 PA
---
## 6. 光模組 (Optical Module) 散熱
### 光模組散熱特性
5G fronthaul / backhaul 中常用的光模組：
| 形式 | 典型功耗 | 速率 | 散熱挑戰 |
|------|---------|------|---------|
| SFP+ | 0.5-1W | 10G | 低 |
| SFP28 | 0.8-1.5W | 25G | 低-中 |
| QSFP28 | 2-3.5W | 100G | 中 |
| QSFP56/QSFP-DD | 4-12W | 200G/400G | 高 |
| OSFP | 12-20W | 400G/800G | 極高 |
### 散熱設計考量
**光模組的散熱路徑**：
- 主要：模組外殼 (cage) → 散熱片 → 空氣
- 次要：模組金手指 → PCB connector → PCB
**Cage 設計**：
- cage 的金屬壁提供從模組外殼到外部的導熱路徑
- cage 上方可安裝 heat sink
- 注意 cage 與 PCB 之間的接觸熱阻
- 多 port cage（如 1×4 QSFP）需注意 port 之間的熱耦合
**高功率光模組（QSFP-DD / OSFP）**：
- 12W+ 的功耗在密封機箱中是嚴峻挑戰
- 可能需要專用的導熱路徑到 chassis
- 或使用 heat pipe 將熱量遠距離傳輸到有足夠散熱面積的區域
**溫度對光模組的影響**：
- 雷射器 (laser) 性能對溫度高度敏感
- 過高溫度 → 光功率下降、波長偏移、BER 增加
- 通常 T_case 限制 70°C（commercial）
---
## 7. 封裝熱參數深度解讀
### JEDEC 標準熱參數完整對照
| 參數 | 符號 | 定義 | 量測方法 | 正確用途 |
|------|------|------|---------|---------|
| Junction-to-Ambient | θ_JA | (T_J - T_A) / P | JEDEC 標準板 + 自然對流 | 元件比較，不用於設計 |
| Junction-to-Case (top) | θ_JC_top | (T_J - T_case_top) / P | 強制所有功率從頂面散出 | 設計計算（頂部散熱路徑） |
| Junction-to-Case (bottom) | θ_JC_bot | (T_J - T_case_bot) / P | 強制所有功率從底面散出 | 設計計算（底部散熱路徑） |
| Junction-to-Board | θ_JB | (T_J - T_board) / P | 理論上所有功率從 board 走 | 設計計算（需謹慎使用） |
| Junction-to-Top (char.) | ψ_JT | (T_J - T_top) / P | 實際雙面散熱條件 | 從量測推算 T_J |
| Junction-to-Board (char.) | ψ_JB | (T_J - T_board) / P | 實際雙面散熱條件 | 從量測推算 T_J |
### θ vs ψ 的關鍵差異
**θ (thermal resistance)**：假設所有功率沿單一路徑散出。是封裝的固有特性。
**ψ (thermal characterization parameter)**：在雙面散熱的實際條件下量測，包含了功率分配比例。隨外部散熱條件而變。
**實際應用**：
- 設計計算→ 用 θ_JC 建立熱阻網路
- 實驗驗證→ 量測 T_case 或 T_board，用 ψ_JT 或 ψ_JB 推算 T_J
- 千萬不要混用（如用 ψ_JT 替代 θ_JC_top 做設計計算）
### Datasheet 熱規格的陷阱
**陷阱 1：θ_JA 條件不明**
- 不同廠商的 θ_JA 測試板可能不同（1s0p、1s2p、2s2p）
- 如果不知道測試條件，θ_JA 幾乎沒有參考價值
**陷阱 2：Power rating 的環境假設**
- "Maximum power dissipation = 5W" 通常是在某個假設的 θ_JA 和 T_A 下算出
- 實際可允許的功耗取決於你的散熱設計，不是封裝規格
**陷阱 3：多 die 封裝的參數**
- 多 die 封裝的 θ_JC 通常只給一個值，但每個 die 到 case 的熱阻不同
- 需要供應商提供 detailed thermal model 或獨立的 per-die 參數
**陷阱 4：溫度量測點的位置**
- θ_JC 的 "case" 溫度量測位置在封裝頂面中心（有 lid）或底面中心（exposed pad）
- 如果你的溫度量測位置不在這些點上，直接套用 θ 值會有誤差
---
## 8. Multi-Die 封裝熱分析
### Multi-Die 封裝類型
| 類型 | 結構 | 典型應用 | 熱分析挑戰 |
|------|------|---------|-----------|
| SiP (System in Package) | 多 die 並排在同一 substrate | RF + digital 整合 | die 間熱耦合 |
| 2.5D (Interposer) | 多 die 並排在 silicon interposer 上 | HBM + logic | interposer 的面內導熱 |
| 3D IC | Die 垂直堆疊 | memory stack | 底層 die 散熱受阻 |
| Chiplet | 多 chiplet 在 organic/Si substrate | 先進處理器 | 每個 chiplet 功率不同 |
### 熱耦合效應
**相鄰 die 的熱耦合**：
- 當 die A 發熱時，透過共同的 substrate/interposer 傳到 die B，使 die B 溫度升高
- 耦合程度取決於：die 間距、substrate 材料導熱率、散熱條件
- 定量描述：thermal coupling coefficient = ΔT_B / P_A（die A 每瓦功率導致 die B 升溫幾度）
**建模方法**：
1. **Compact model**：每個 die 用 2-resistor 或 DELPHI 模型，加上 die 間的耦合熱阻
2. **Detailed model**：建立完整的封裝結構（die、die attach、substrate、bumps、underfill）
3. **供應商模型**：使用封裝廠提供的 3D thermal model（.PDML 或 STEP + power map）
### 3D 堆疊封裝的散熱挑戰
- 底層 die 的熱量必須穿過上層 die 才能到達散熱面→ 等效熱阻增加
- TSV (Through-Silicon Via) 提供穿層導熱路徑，但密度有限
- 微流道冷卻 (microchannel cooling) 是研究中的解決方案
- 建模時需要精確描述每層的材料和界面熱阻
---
## 9. Power Map 與功率分佈處理
### 為什麼需要 Power Map
均勻功率假設在以下情況會導致顯著誤差：
- Die 面積大（> 10×10mm）且功能區塊明顯不同
- 存在高功率密度區域（如 CPU core）與低功率密度區域（如 cache）
- 需要精確預測 hot spot 溫度（而非平均溫度）
### 如何取得 Power Map
**從 IC 設計團隊取得**：
- Floorplan + per-block power estimation
- 通常以 grid-based power map 形式提供（如 CSV 或矩陣格式）
- 注意區分 peak power 和 average power
**簡化估算**：
- 如果無法取得 detailed power map，至少區分 2-3 個功率區域
- 例如：CPU core 區域 60% power 佔 30% die area → 功率密度是平均的 2x
### FloTHERM 中的 Power Map 實作
**方法 1：Multi-block power source**
- 在 die 位置建立多個 cuboid，每個代表一個功率區域
- 各自設定不同的功率密度
- 優點：直覺、易於調整
- 缺點：區域數多時建模繁瑣
**方法 2：Non-uniform power map file**
- FloTHERM 支援匯入 power map 文件
- 格式：CSV 或特定格式的 grid-based 功率分佈
- 優點：可直接使用 IC 設計團隊提供的數據
- 缺點：需要確認座標系統和解析度的匹配
### Hot Spot 分析
**Hot spot 溫度 vs 平均溫度**：
- 對大型 die，hot spot 溫度可能比平均溫度高 10-25°C
- FPGA 的 hot spot 通常在高利用率的邏輯區塊或高速 SerDes 區域
- ASIC 的 hot spot 在 CPU core 或 DSP 密集區域
**Hot spot 的 thermal spreading resistance**：
- 小面積高功率熱源的熱量需要在散熱面上擴散
- Spreading resistance 公式（圓形熱源在半無限體上）：
  R_spread ≈ 1 / (2 × k × √(π × A_source))
- 減少 spreading resistance：使用高導熱材料的 heat spreader（銅、vapor chamber）
---
## 10. Digital Board 模擬建模要點
### FloTHERM 中的 Digital Board 建模
**FPGA / ASIC 建模層級選擇**：
| 分析目的 | 建議模型 | 精度 | 建模時間 |
|----------|---------|------|---------|
| 系統級氣流/溫度分佈 | 2-resistor | ±5-10°C | 低 |
| 封裝表面溫度分佈 | DELPHI | ±3-5°C | 中 |
| Die 級 hot spot | Detailed + power map | ±2-3°C | 高 |
**DDR 陣列建模**：
- 可將多顆 DDR 簡化為單一 block（如果距離很近且功率相似）
- 或使用 array 功能快速複製單顆 DDR 模型
- 建議至少保持每顆 DDR 為獨立個體（可看出靠近熱源的 DDR 比較熱）
**DC-DC 建模**：
- 系統級分析：簡化為一個 block + total power
- 精確分析：分開建模 MOSFET、inductor、capacitor
- 不要忘記 DC-DC 的功耗——它們通常不是 digital board 上最熱的，但累積可觀
**光模組建模**：
- Cage + module 可用 SmartPart 或簡單 cuboid 組合
- 模組功率施加在內部（模擬雷射器和驅動 IC 發熱）
- Cage 金屬壁作為主要散熱路徑
- 需要特別注意 cage 到 PCB 和 cage 到 heat sink 的接觸條件
### 系統級建模的精度平衡
**原則：離關注區越遠，簡化程度越高**
- 核心分析對象（如 FPGA）：用 detailed 或 DELPHI 模型
- 相鄰高功率元件（如 PA、DC-DC）：用 2-resistor 模型
- 低功率元件（如 small IC、passive）：可忽略或用簡單 block
- PCB：至少保留主要銅層的影響
**總功耗 check**：
- 所有元件功耗加總應接近系統總輸入功率（扣除效率損耗）
- 如果模擬中的總功耗 vs 實際系統功耗相差太多，結果可靠度存疑
