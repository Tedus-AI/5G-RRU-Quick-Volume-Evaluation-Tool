import streamlit as st
import pandas as pd

# === APP 設定 ===
st.set_page_config(page_title="5G RRU Thermal Calculator", layout="wide")

st.title("📡 5G RRU 體積估算引擎")
st.markdown("### 基於 Excel 物理驗證核心 (Verified by Flotherm Logic)")

# === 側邊欄：全域邊界條件 (對應表一) ===
st.sidebar.header("🛠️ 全域邊界條件 (Table 1)")

# 環境與係數
st.sidebar.subheader("1. 環境設定")
T_amb = st.sidebar.number_input("環境溫度 (°C)", value=45.0, step=1.0)
h_value = st.sidebar.number_input("自然對流係數 h (W/m2K)", value=8.8, step=0.1)
Margin = st.sidebar.number_input("設計安全係數 (Margin)", value=1.0, step=0.1)
Eff = st.sidebar.number_input("鰭片效率 (Eff)", value=0.95, step=0.01)

# 機構參數
st.sidebar.subheader("2. 機構幾何")
L_pcb = st.sidebar.number_input("PCB 長度 (mm)", value=350)
W_pcb = st.sidebar.number_input("PCB 寬度 (mm)", value=250)
t_base = st.sidebar.number_input("散熱器基板厚 (mm)", value=7)
H_shield = st.sidebar.number_input("HSK內腔深度/Shielding (mm)", value=20)
H_filter = st.sidebar.number_input("Filter 厚度 (mm)", value=42)

# 散熱器參數
st.sidebar.subheader("3. 鰭片設定")
Gap = st.sidebar.number_input("鰭片間距 (mm)", value=13.2, step=0.1)
Fin_t = st.sidebar.number_input("鰭片厚度 (mm)", value=1.2, step=0.1)

# 邊框肉厚 (預設隱藏，可展開)
with st.sidebar.expander("進階邊框設定"):
    Top = st.number_input("上邊距 (mm)", value=11)
    Btm = st.number_input("下邊距 (mm)", value=13)
    Left = st.number_input("左邊距 (mm)", value=11)
    Right = st.number_input("右邊距 (mm)", value=11)

# === 主畫面：元件熱源清單 (對應表二) ===
st.subheader("🔥 元件熱源清單 (Table 2)")
st.info("請在下方表格直接修改各元件的「數量」、「單顆功耗」或「限溫」。系統會自動抓取最嚴苛的瓶頸。")

# 預設數據 (您 Excel 的最終精算數據)
default_data = {
    "Component": ["Final PA", "Driver PA", "Pre Driver", "Circulator", "Cavity Filter", 
                  "CPU (FPGA)", "Si5518", "16G DDR", "Power Mod", "SFP"],
    "Qty": [4, 4, 4, 4, 1, 1, 1, 2, 1, 1],
    "Power_Unit (W)": [52.13, 9.54, 0.37, 2.76, 31.07, 35.00, 2.00, 0.40, 29.00, 0.50],
    "Limit_Temp (°C)": [225, 200, 175, 125, 200, 100, 125, 95, 95, 200], # SFP 改為 200 忽略
    "Internal_Drop (°C)": [15, 5, 2, 2, 0, 7.5, 3, 0.1, 0.2, 5] # 預估的內部溫降 (Rjc+Tim)*Power
}

df = pd.DataFrame(default_data)

# 讓使用者可以在網頁上編輯表格
edited_df = st.data_editor(df, num_rows="dynamic", use_container_width=True)

# === 計算引擎核心 (Python Logic) ===
# 1. 計算總熱耗
edited_df["Total_W"] = edited_df["Qty"] * edited_df["Power_Unit (W)"]
Total_Watts_Sum = edited_df["Total_W"].sum()

# 2. 計算 B50 (系統最小有效溫差)
# 邏輯：(限溫 - Internal_Drop - 環溫) 取最小值
# 注意：這裡我們用簡化邏輯 (Limit - Drop - Tamb)，實際 Drop 值目前是預估值，
# 未來 Phase 3 可以結合 AI 讀取 Datasheet 自動填入精準 Rjc
edited_df["Allowed_dT"] = edited_df["Limit_Temp (°C)"] - edited_df["Internal_Drop (°C)"] - T_amb
Min_dT_Allowed = edited_df["Allowed_dT"].min()
Bottleneck_Component = edited_df.loc[edited_df["Allowed_dT"].idxmin()]["Component"]

# 3. 執行物理運算
Total_Power = round(Total_Watts_Sum * Margin, 2)
if Total_Power > 0 and Min_dT_Allowed > 0:
    R_sa = Min_dT_Allowed / Total_Power
    Area_req = 1 / (h_value * R_sa * Eff)
    
    L_hsk = L_pcb + Top + Btm
    W_hsk = W_pcb + Left + Right
    Base_Area_m2 = (L_hsk * W_hsk) / 1000000
    
    Fin_Count = W_hsk / (Gap + Fin_t)
    
    # 防止分母為 0 或負數
    try:
        Fin_Height = ((Area_req - Base_Area_m2) * 1000000) / (2 * Fin_Count * L_hsk)
    except:
        Fin_Height = 0
    
    RRU_Height = t_base + Fin_Height + H_filter + H_shield
    Volume_L = (L_hsk * W_hsk * RRU_Height) / 1000000
else:
    Fin_Height = 0
    RRU_Height = 0
    Volume_L = 0

# === 結果輸出區 (對應表三) ===
st.markdown("---")
st.subheader("📊 計算結果 (Volume Engine)")

col1, col2, col3 = st.columns(3)

with col1:
    st.metric(label="整機總熱耗 (W)", value=f"{Total_Power} W", delta=f"原始: {round(Total_Watts_Sum,1)} W")
    st.metric(label="系統瓶頸元件", value=f"{Bottleneck_Component}", delta=f"允許溫升: {round(Min_dT_Allowed, 1)} °C")

with col2:
    st.metric(label="建議鰭片高度", value=f"{round(Fin_Height, 2)} mm")
    st.metric(label="RRU 整機高度", value=f"{round(RRU_Height, 2)} mm")

with col3:
    st.metric(label="★ 整機估算體積", value=f"{round(Volume_L, 2)} L")
    st.metric(label="所需散熱面積", value=f"{round(Area_req, 3)} m²")

# 顯示詳細尺寸
st.caption(f"詳細尺寸: 長 {L_hsk} mm x 寬 {W_hsk} mm x 高 {round(RRU_Height,1)} mm")

# 繪製簡單的比例示意圖 (CSS)
st.markdown("---")
st.markdown(f"""
<div style="
    width: {min(W_hsk, 100)}%; 
    height: {min(RRU_Height*2, 300)}px; 
    background-color: #4CAF50; 
    color: white; 
    text-align: center; 
    line-height: {min(RRU_Height*2, 300)}px;
    border-radius: 10px;
    margin: auto;">
    RRU 體積示意 (Scale: {round(Volume_L, 2)}L)
</div>
""", unsafe_allow_html=True)
