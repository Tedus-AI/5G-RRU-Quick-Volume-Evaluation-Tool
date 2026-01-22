import streamlit as st
import pandas as pd
import numpy as np

# === APP 設定 ===
st.set_page_config(page_title="5G RRU Thermal Calculator (Pro)", layout="wide")

st.title("📡 5G RRU 體積估算引擎 (Pro Version)")
st.markdown("### 完整物理核心：含幾何熱阻運算 (R_int, R_TIM)")

# ==================================================
# 1. 側邊欄：全域邊界條件 (Table 1)
# ==================================================
st.sidebar.header("🛠️ 全域邊界條件 (Table 1)")

# 環境與係數
with st.sidebar.expander("環境與係數設定", expanded=True):
    T_amb = st.number_input("環境溫度 (°C)", value=45.0, step=1.0)
    h_value = st.number_input("自然對流係數 h (W/m2K)", value=8.8, step=0.1)
    Margin = st.number_input("設計安全係數 (Margin)", value=1.0, step=0.1)
    Eff = st.number_input("鰭片效率 (Eff)", value=0.95, step=0.01)

# 機構參數
with st.sidebar.expander("PCB 與 機構尺寸", expanded=False):
    L_pcb = st.number_input("PCB 長度 (mm)", value=350)
    W_pcb = st.number_input("PCB 寬度 (mm)", value=250)
    t_base = st.number_input("散熱器基板厚 (mm)", value=7)
    H_shield = st.number_input("HSK內腔深度 (mm)", value=20)
    H_filter = st.number_input("Filter 厚度 (mm)", value=42)

# 材料參數 (用於計算 R_TIM)
with st.sidebar.expander("材料導熱係數 (K值)", expanded=False):
    st.caption("單位: W/mK")
    K_Solder = st.number_input("Solder (錫)", value=58.0)
    K_Grease = st.number_input("Grease (導熱膏)", value=3.0)
    K_Pad = st.number_input("Thermal Pad", value=7.5)
    K_Putty = st.number_input("Thermal Putty", value=9.1)
    # 厚度設定 (mm)
    t_Solder = 0.3
    t_Grease = 0.05
    t_Pad = 1.7
    t_Putty = 0.5
    # Thermal Via
    K_Via = st.number_input("Thermal Via (等效)", value=30.0)
    Via_Eff = 0.9 # 製程有效係數

# 散熱器參數
with st.sidebar.expander("鰭片幾何", expanded=False):
    Gap = st.number_input("鰭片間距 (mm)", value=13.2, step=0.1)
    Fin_t = st.number_input("鰭片厚度 (mm)", value=1.2, step=0.1)

# 邊框
Top, Btm, Left, Right = 11, 13, 11, 11

# ==================================================
# 2. 主畫面：元件熱源清單 (Table 2 - 完整版)
# ==================================================
st.subheader("🔥 元件熱源清單 (Table 2)")
st.info("此表格包含完整幾何參數。修改數值後，系統會即時重算 R_jc, R_int, R_TIM 與 允許溫升。")

# 建立預設資料 (包含您 Excel 的幾何細節)
# 注意：TIM Type 對應: 1=Solder, 2=Grease, 3=Pad, 4=Putty
data = {
    "Component": ["Final PA", "Driver PA", "Pre Driver", "Circulator", "Cavity Filter", "CPU (FPGA)", "Si5518", "16G DDR", "Power Mod", "SFP"],
    "Qty": [4, 4, 4, 4, 1, 1, 1, 2, 1, 1],
    "Power(W)": [52.13, 9.54, 0.37, 2.76, 31.07, 35.00, 2.00, 0.40, 29.00, 0.50],
    "Limit(C)": [225, 200, 175, 125, 200, 100, 125, 95, 95, 200],
    "R_jc": [1.50, 1.70, 50.0, 0.0, 0.0, 0.16, 0.50, 0.0, 0.0, 0.0],
    # 幾何尺寸 (mm)
    "Pad_L": [20, 5, 2, 10, 0, 35, 8.6, 7.5, 58, 14],
    "Pad_W": [10, 5, 2, 10, 0, 35, 8.6, 11.5, 61, 50],
    "PCB_t": [2.5, 2.0, 2.0, 2.0, 0, 0, 2.0, 0, 0, 0], # 厚度 (Final PA 是 Coin厚度)
    "K_Board": [380, K_Via, K_Via, K_Via, 0, 0, K_Via, 0, 0, 0], # 380=Coin, 30=Via
    # TIM 選擇 (字串識別)
    "TIM_Type": ["Solder", "Grease", "Grease", "Grease", "None", "Putty", "Pad", "Grease", "Grease", "Grease"]
}

df = pd.DataFrame(data)

# 讓使用者編輯表格
edited_df = st.data_editor(
    df,
    column_config={
        "TIM_Type": st.column_config.SelectboxColumn(
            "TIM Type",
            options=["Solder", "Grease", "Pad", "Putty", "None"],
            required=True,
        )
    },
    num_rows="dynamic",
    use_container_width=True
)

# === 後台運算引擎 (Backend Calculation) ===

# 1. 準備計算用的常數字典
tim_props = {
    "Solder": {"k": K_Solder, "t": t_Solder},
    "Grease": {"k": K_Grease, "t": t_Grease},
    "Pad":    {"k": K_Pad,    "t": t_Pad},
    "Putty":  {"k": K_Putty,  "t": t_Putty},
    "None":   {"k": 1,        "t": 0} # 避免除以0
}

# 2. 逐行計算 R_int 與 R_TIM (Vectorized Calculation)
# 為了避免複雜，這裡用簡單的 Apply 函數模擬 Excel 公式

def calculate_row(row):
    # 基礎數據
    area_mm2 = row['Pad_L'] * row['Pad_W']
    area_m2 = area_mm2 / 1_000_000
    
    # R_int 計算 (PCB/Coin 熱阻)
    # Excel公式: Thickness / (K * Area * Eff)
    # Final PA (Coin) 不打折，其他 Via 打 0.9 折
    if area_m2 > 0 and row['K_Board'] > 0:
        eff_factor = 1.0 if row['K_Board'] == 380 else Via_Eff
        r_int = (row['PCB_t'] / 1000) / (row['K_Board'] * area_m2 * eff_factor)
    else:
        r_int = 0
        
    # R_TIM 計算 (介面材料熱阻)
    tim_info = tim_props.get(row['TIM_Type'], {"k":1, "t":0})
    if area_m2 > 0 and tim_info['t'] > 0:
        r_tim = (tim_info['t'] / 1000) / (tim_info['k'] * area_m2)
    else:
        r_tim = 0
        
    # 總熱耗
    total_w = row['Qty'] * row['Power(W)']
    
    # 溫升計算
    # 總熱阻路徑 = R_jc + R_int + R_TIM
    # 內部溫降 Drop = Power * (R_jc + R_int + R_TIM)
    # 註: 這裡是單顆的溫降
    total_r = row['R_jc'] + r_int + r_tim
    internal_drop = row['Power(W)'] * total_r
    
    # 允許 HSK 溫升 = Limit - Drop - Tamb
    allowed_dt = row['Limit(C)'] - internal_drop - T_amb
    
    return pd.Series([r_int, r_tim, total_w, internal_drop, allowed_dt])

# 應用計算
if not edited_df.empty:
    edited_df[['R_int', 'R_TIM', 'Total_W', 'Drop', 'Allowed_dT']] = edited_df.apply(calculate_row, axis=1)

    # 3. 找出系統瓶頸
    # 過濾掉那些沒有功耗或沒有限溫的元件 (避免被 SFP 誤導)
    valid_rows = edited_df[edited_df['Total_W'] > 0]
    
    Total_Watts_Sum = valid_rows['Total_W'].sum()
    
    if not valid_rows.empty:
        Min_dT_Allowed = valid_rows['Allowed_dT'].min()
        bottleneck_row = valid_rows.loc[valid_rows['Allowed_dT'].idxmin()]
        Bottleneck_Name = bottleneck_row['Component']
    else:
        Min_dT_Allowed = 50.0 # Default
        Bottleneck_Name = "None"
else:
    Total_Watts_Sum = 0
    Min_dT_Allowed = 50.0
    Bottleneck_Name = "None"

# ==================================================
# 3. 體積計算引擎 (Table 3)
# ==================================================
Total_Power = Total_Watts_Sum * Margin

if Total_Power > 0 and Min_dT_Allowed > 0:
    R_sa = Min_dT_Allowed / Total_Power
    Area_req = 1 / (h_value * R_sa * Eff)
    
    L_hsk = L_pcb + Top + Btm
    W_hsk = W_pcb + Left + Right
    Base_Area_m2 = (L_hsk * W_hsk) / 1000000
    
    Fin_Count = W_hsk / (Gap + Fin_t)
    
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

# ==================================================
# 4. 結果儀表板
# ==================================================
st.markdown("---")
st.subheader("📊 最終運算結果")

c1, c2, c3, c4 = st.columns(4)
c1.metric("整機總熱耗", f"{round(Total_Power, 2)} W")
c2.metric("系統瓶頸元件", f"{Bottleneck_Name}", delta=f"dT: {round(Min_dT_Allowed, 2)}°C")
c3.metric("建議鰭片高度", f"{round(Fin_Height, 2)} mm")
c4.metric("★ 整機估算體積", f"{round(Volume_L, 2)} L")

# 顯示詳細計算表 (Debug 用)
with st.expander("查看詳細熱阻計算表 (Calculated Details)"):
    st.dataframe(edited_df.style.format("{:.2f}", subset=['R_int', 'R_TIM', 'Drop', 'Allowed_dT']), use_container_width=True)

# 繪圖
st.markdown("---")
st.caption(f"Geometry: {L_hsk:.1f} x {W_hsk:.1f} x {RRU_Height:.1f} mm")
st.progress(min(Volume_L/20, 1.0), text=f"體積佔比參考 (Target: 20L)")
