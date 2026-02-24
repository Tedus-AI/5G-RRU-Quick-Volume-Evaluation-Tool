# RF Board 元件散熱專家指南
## 目錄
1. [RF Board 散熱總覽](#1-rf-board-散熱總覽)
2. [Power Amplifier (PA) 散熱](#2-power-amplifier-pa-散熱)
3. [Transceiver IC 散熱](#3-transceiver-ic-散熱)
4. [LNA、Mixer、Filter 等射頻前端](#4-lnamixerfilter-等射頻前端)
5. [Duplexer / Diplexer 散熱](#5-duplexer--diplexer-散熱)
6. [RF Board 級 PCB 熱設計](#6-rf-board-級-pcb-熱設計)
7. [RF 元件封裝熱參數解讀](#7-rf-元件封裝熱參數解讀)
8. [RF 散熱模擬建模要點](#8-rf-散熱模擬建模要點)
---
## 1. RF Board 散熱總覽
### RF Board 散熱的獨特挑戰
RF board 的散熱與一般 digital board 有幾個關鍵差異：
**高功率密度且集中**：PA 是 RF board 上的絕對熱源主角，單顆 GaN PA 功耗可達 20-60W+，而 die 面積可能只有幾 mm²，導致極高的熱流密度（可達 100-500 W/cm²）。
**效率敏感**：RF 元件的性能（gain、linearity、noise figure）隨溫度升高而劣化。PA 的效率下降會形成正反饋迴路——溫度升高 → 效率下降 → 功耗增加 → 溫度更高。
**佈局受 RF 性能約束**：元件位置不能單純為了散熱最佳化而隨意移動，必須兼顧 impedance matching、signal path length、isolation 等 RF 要求。
**基板材料限制**：高頻 RF board 常使用 Rogers、Taconic 等低損耗材料，其熱導率 (0.2-0.8 W/m·K) 通常遠低於 FR4 (0.3 W/m·K in-plane ~0.8 W/m·K)，加上銅箔層數較少，穿板方向導熱更差。
### RF Board 典型散熱路徑
```
Die (junction)
  ↓ die attach (solder / epoxy)
Package base / flange
  ↓ TIM or solder
PCB copper coin / thermal via array
  ↓ TIM
Heat sink / chassis
  ↓ convection + radiation
Ambient
```
對 PA 來說，主要散熱路徑通常是從 die 底部穿過封裝底座 (flange) 到 PCB 再到 heat sink，而非從 die 頂部。這一點與許多 digital IC（頂部加 heat sink）不同。
---
## 2. Power Amplifier (PA) 散熱
### GaN vs LDMOS 熱特性比較
| 特性 | GaN HEMT | LDMOS |
|------|----------|-------|
| 功率密度 | 5-12 W/mm gate width | 1-2 W/mm gate width |
| 最高 junction 溫度 | 175-225°C (depending on reliability target) | 150-175°C |
| 基板材料 | SiC (熱導率 ~370 W/m·K) 或 Si | Si (熱導率 ~150 W/m·K) |
| 封裝形式 | Flange, QFN, SMD air cavity | Flange, plastic overmold |
| 效率 (5G NR) | 40-55% (Doherty) | 30-45% |
| 熱管理難度 | 高（極高功率密度） | 中等 |
### PA 功耗計算
PA 的實際功耗取決於效率和輸出功率：
```
P_dissipated = P_DC - P_RF_out = P_RF_out × (1/η - 1)
```
其中 η 是 drain efficiency。
**注意**：5G NR 使用 OFDM 波形，具有高 PAPR (Peak-to-Average Power Ratio)，PA 通常使用 DPD (Digital Pre-Distortion) 來提升效率。實際平均功耗需考慮：
- 信號統計特性（PAPR、traffic loading）
- DPD 效果
- Doherty / ET (Envelope Tracking) 等效率增強架構
**經驗法則**：對 5G massive MIMO RRU，每通道 PA 平均功耗約為額定 P_out 的 1-2 倍。例如 5W per channel output 的 PA，散熱設計按 5-10W per channel 計算。
### PA 封裝散熱設計要點
**Flange-mount PA（螺鎖式封裝）**：
- 底部金屬 flange 直接鎖在 heat sink 或 chassis 上
- 關鍵：確保 flange 與 heat sink 之間的平整度與接觸壓力
- TIM 選擇：通常用 thermal grease 或 phase change material
- 螺絲扭矩需嚴格控制（過鬆 → 接觸不良，過緊 → 封裝變形）
- Theta_JC（junction-to-case）通常 0.5-3°C/W
**SMD PA（表面貼裝封裝，如 QFN）**：
- 散熱主要透過 exposed pad（底部裸露焊墊）到 PCB
- PCB 必須設計 thermal via array 在 exposed pad 下方
- Thermal via 設計建議：
  - Via 直徑：0.2-0.3mm
  - Via pitch：0.5-1.0mm
  - Via 填充：copper-filled 最佳（plated through 次之）
  - Via 數量：盡可能佔滿 exposed pad 面積
- PCB 背面需要大面積銅皮接到 heat sink
**Air-cavity 封裝**：
- 常用於高功率 GaN PA
- 封裝內部為氣腔（非 plastic overmold），降低封裝內部熱阻
- 注意：氣腔內熱傳以傳導為主（透過 bonding wire 和 die attach），對流和輻射可忽略
### PA 散熱設計常見問題
**問題 1：Junction 溫度超標**
- 檢查順序：die attach 品質 → TIM 接觸 → heat sink 能力 → 環境條件
- 對 GaN-on-SiC，die attach void（氣泡）是常見殺手，void 率 > 5% 顯著影響溫度
**問題 2：PA 效率隨溫度劣化**
- 量化：典型 GaN PA 效率每升高 10°C 下降 0.5-1%
- 正反饋迴路需要在模擬中 iterate（功耗隨溫度變化）
**問題 3：多 PA 陣列的熱耦合**
- Massive MIMO RRU 可能有 32/64/128 個 PA 通道
- 相鄰 PA 之間的熱耦合不可忽略
- 建議用 FloTHERM 建立完整 array model，而非只模擬單顆
---
## 3. Transceiver IC 散熱
### 典型 Transceiver IC 特性
5G RRU 常用的 transceiver IC（如 ADI ADRV9040、TI AFE7950 等）：
- 整合 ADC/DAC、mixer、NCO 等功能
- 典型功耗：5-25W
- 封裝：大型 BGA（如 23×23mm、35×35mm）
- Multi-die 或 chiplet 架構越來越常見
### 散熱路徑分析
Transceiver IC 通常是 BGA 封裝，散熱路徑有兩條：
1. **頂部路徑**：die → lid/mold compound → TIM → heat sink（如果頂部有安裝散熱）
2. **底部路徑**：die → substrate → BGA balls → PCB → via → heat sink
哪條路徑為主取決於封裝設計：
- 有 metal lid 的 BGA → 頂部路徑通常更有效
- Plastic BGA → 底部路徑為主（mold compound 熱導率僅 0.5-1 W/m·K）
### 建模注意事項
- 使用原廠提供的 DELPHI 或 detailed thermal model（通常可從供應商網站下載）
- 如果只有 2-resistor model (Theta_JC_top + Theta_JC_bottom)，注意 power split 的假設
- BGA ball array 在模擬中可用 lumped thermal conductivity 簡化
- Die 上的 power map 分佈不均，hot spot 溫度可能比平均高 5-15°C
---
## 4. LNA、Mixer、Filter 等射頻前端
### 功耗等級與散熱需求
| 元件 | 典型功耗 | 散熱難度 | 說明 |
|------|---------|---------|------|
| LNA | 0.1-1W | 低 | 功耗小，但 noise figure 對溫度敏感 |
| Mixer | 0.2-1W | 低 | 功耗小 |
| RF Filter (SAW/BAW) | < 0.5W (insertion loss) | 低-中 | 高功率路徑上的 filter 可能有較高損耗 |
| RF Switch | 0.1-0.5W | 低 | |
| Attenuator (digital) | 0.1-0.5W | 低 | |
### 雖然功耗低，仍需注意的點
**LNA 溫度敏感性**：
- Noise figure 隨溫度升高而增加（~0.01-0.02 dB/°C）
- 在接收鏈路第一級的 LNA，NF 劣化直接影響系統靈敏度
- 建議：LNA 遠離 PA 等高發熱源，避免被動加熱
**高功率路徑的 Filter**：
- TX 路徑上的 filter 需承受全功率通過，insertion loss 轉化為熱量
- 例如：40 dBm (10W) 信號通過 0.5 dB insertion loss 的 filter，損耗功耗 ≈ 1.1W
- Ceramic filter / cavity filter 的散熱需注意與 PCB 的熱接觸
**密集排列的小元件**：
- 雖然單顆功耗低，但 RF front-end 元件密度高
- 累積效應可能造成局部溫升
- 特別在 massive MIMO 的多通道 RF board 上
---
## 5. Duplexer / Diplexer 散熱
### 散熱特性
Duplexer 同時處理 TX 和 RX 信號，TX 端承受高功率：
- 典型 insertion loss：0.3-1.5 dB（TX path）
- 對高功率系統（如 20W+ per channel），功耗不可忽略
- 計算：P_loss = P_in × (1 - 10^(-IL/10))
  - 例如：43 dBm (20W) input，1 dB IL → P_loss ≈ 5W
### 封裝與散熱
**Ceramic SMD Duplexer**：
- 底部通常有 ground pad，透過 PCB thermal via 散熱
- 散熱設計類似一般 SMD 元件
**Cavity Duplexer**（較大功率）：
- 金屬外殼，可直接與 chassis 接觸散熱
- 安裝平面的平整度與 TIM 很重要
**注意**：Duplexer 的溫度升高會影響 filter 的中心頻率和頻寬（溫漂），對系統性能有直接影響。某些 duplexer 規格會標註 temperature coefficient of frequency (TCF)。
---
## 6. RF Board 級 PCB 熱設計
### RF PCB 基板材料熱特性
| 材料 | 熱導率 (W/m·K) | 常用頻段 | 散熱影響 |
|------|----------------|---------|---------|
| FR4 | 0.3 (thru) / 0.8 (in-plane) | < 3 GHz | 基礎，靠 copper layer 導熱 |
| Rogers 4350B | 0.69 | < 10 GHz | 導熱比 FR4 略好 |
| Rogers 3003 | 0.50 | < 40 GHz | 較差 |
| Taconic TLY | 0.22 | < 40 GHz | 很差，需額外散熱措施 |
| PTFE (Teflon) | 0.25 | 高頻 | 很差 |
| Aluminum PCB (MCPCB) | 基板 1-3 / 鋁基 150-200 | LED/power | 極好，但 RF 性能受限 |
### RF PCB 銅層利用策略
RF board 銅層設計需平衡 RF 性能與散熱：
**Ground plane 的雙重功用**：
- RF：提供低阻抗參考面、屏蔽
- 散熱：作為面內熱擴散層
- 原則：盡量保持 ground plane 的完整性，避免大面積開槽
**Thermal via 設計（RF board 特別注意事項）**：
- Via 位置避開 RF signal trace 的 return current path
- Via fence 同時提供 RF isolation 和散熱功能（一舉兩得）
- Stitching via 密度：在熱源周圍加密
- 注意 via stub 對高頻信號的影響（back-drill 可能改變熱路徑）
**Copper coin / embedded heat slug**：
- 在 PA 下方嵌入銅塊 (copper coin)，從 PCB 頂面直通底面
- 大幅降低 PA 到 heat sink 的熱阻（相比 thermal via array 可降低 30-50%）
- 需要 PCB 廠特殊製程，成本較高
- 設計時注意 coin 與周圍層壓結構的 CTE mismatch
---
## 7. RF 元件封裝熱參數解讀
### JEDEC 標準熱參數
**Theta_JA (θ_JA) — Junction-to-Ambient Thermal Resistance**
- 定義：(T_J - T_A) / P
- 量測條件：JEDEC 標準板 (1s2p 或 2s2p)、自然對流
- **注意：θ_JA 極度依賴 PCB 設計和環境條件，不能直接用來預測實際系統溫度**
- 用途：僅用於元件間的相對比較，不用於設計計算
**Theta_JC (θ_JC) — Junction-to-Case Thermal Resistance**
- 分為 θ_JC_top（到封裝頂面）和 θ_JC_bottom（到封裝底面/exposed pad）
- 對 PA：通常 θ_JC_bottom 是主要散熱路徑參數
- 這是封裝本身的固有參數，不受外部環境影響
- **設計計算使用此參數**
**Psi_JT (ψ_JT) — Junction-to-Top Characterization Parameter**
- 不是真正的熱阻，而是特性參數
- 用於從封裝頂面溫度推算 junction 溫度：T_J = T_top + ψ_JT × P
- 適合搭配紅外線熱像儀 (IR camera) 量測使用
**Psi_JB (ψ_JB) — Junction-to-Board Characterization Parameter**
- 從 PCB 表面溫度推算 junction 溫度
- 適合搭配 thermocouple 在 PCB 上量測使用
### 正確使用方式
**設計計算用**：
```
T_J = T_A + P × (θ_JC + θ_TIM + θ_sink + θ_sink-to-ambient)
```
- 把整條散熱路徑的每段熱阻加起來
- θ_JC 用封裝規格
- θ_TIM = BLT / (k_TIM × A_contact)
- θ_sink 和 θ_sink-to-ambient 從散熱片規格或模擬取得
**驗證量測用**：
```
T_J = T_case_measured + θ_JC × P   （如果量測封裝表面溫度）
T_J = T_top_measured + ψ_JT × P    （如果量測封裝頂面溫度）
T_J = T_board_measured + ψ_JB × P  （如果量測 PCB 表面溫度）
```
### 常見誤區
- ❌ 直接用 θ_JA 計算：T_J = T_ambient + θ_JA × P（這只在 JEDEC 標準板上成立）
- ❌ 把 ψ_JT 當成 θ_JC_top 使用（它們的定義不同）
- ❌ 忽略 power split（功率不是 100% 從 case 底部走，部分從頂部和側面散失）
- ❌ 對多 die 封裝用單一 θ_JC（每個 die 的熱阻不同，且有 die-to-die 耦合）
---
## 8. RF 散熱模擬建模要點
### FloTHERM 中的 RF Board 建模
**PA 建模**：
- Flange-mount PA：使用 cuboid + power source，設定 flange 材料為銅
- SMD PA with exposed pad：使用 IC package SmartPart，設定 Theta_JC_bottom
- 如果有供應商提供的 detailed thermal model (.PDML)，優先使用
**PCB 建模**：
- RF 基板材料需自定義（Rogers 等不在預設材料庫中）
- 銅層百分比需根據實際 Gerber 資料估算
- Thermal via array 可用 "effective thermal conductivity" 簡化：
  - k_eff = k_copper × (A_via / A_total) + k_substrate × (1 - A_via / A_total)
  - 或在 FloTHERM 中使用 via region SmartPart
**Power Map 處理**：
- PA 如果 die 上有多個 transistor cell，功率分佈不均
- 簡化方式：均勻功率分佈（通常足夠，除非分析 die 級熱點）
- 精確方式：分區域設定不同功率密度
### 模擬與量測比對的 RF 特殊考量
- PA 功率會隨溫度變化，模擬中可能需要 iterate
- RF board 上的屏蔽罩 (RF shield can) 會阻擋氣流但也可作為散熱面
- 屏蔽罩的建模：考慮其導熱（金屬材料）和對氣流的阻擋效果
- 供電損耗（DC-DC regulator 效率損失）也是熱源，不要忽略
