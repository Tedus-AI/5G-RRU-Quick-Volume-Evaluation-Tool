import streamlit as st
import pandas as pd
import numpy as np

# === APP 設定 ===
st.set_page_config(page_title="5G RRU Thermal Calculator", layout="wide")

st.title("📡 5G RRU 體積估算引擎 (Smart Formulas)")
st.markdown("### ⚡ 自動連動版：輸入參數後，幾何與熱阻將自動計算並鎖定")

# ==================================================
# 1. 側邊欄：全域邊界條件 (Table 1)
# ==================================================
st.sidebar.header("🛠️ 全域邊界條件 (Table 1)")

# 環境與係數
with st.sidebar.expander("1. 環境與係數", expanded=True):
    T_amb = st.number_input("環境溫度 (°C)", value=45.0, step=1.0)
    h_value = st.number_input("自然對流係數 h (W/m2K)", value=8.8, step=0.1)
    Margin = st.number_input("設計安全係數 (Margin)", value=1.0, step=0.1)
    Slope = 0.03 # 空氣升溫梯度 (固定常數)
    Eff = st.number_input("鰭片效率 (Eff)", value=0.95, step=0.01)

# 機構參數
with st.sidebar.expander("2. PCB 與 機構尺寸", expanded=False):
    L_pcb = st.number_input("PCB 長度 (mm)", value=350)
    W_pcb = st.number_input("PCB 寬度 (mm)", value=250)
    t_base = st.number_input("散熱器基板厚 (mm)", value=7)
    H_shield = st.number_input("HSK內腔深度 (mm)", value=20)
    H_filter = st.number_input("Filter 厚度 (mm)", value=42)

# 材料參數 (已解鎖編輯功能)
with st.sidebar.expander("3. 材料參數 (導熱係數/厚度)", expanded=False):
    st.markdown("**Thermal Putty**")
    c1, c2 = st.columns(2)
    K_Putty = c1.number_input("K (Putty)", value=9.1)
    t_Putty = c2.number_input("t (Putty)", value=0.5)
    
    st.markdown("**Thermal Pad**")
    c3, c4 = st.columns(2)
    K_Pad = c3.number_input("K (Pad)", value=7.5)
    t_Pad = c4.number_input("t (Pad)", value=1.7)
    
    st.markdown("**Thermal Grease**")
    c5, c6 = st.columns(2)
    K_Grease = c5.number_input("K (Grease)", value=3.0)
    t_Grease = c6.number_input("t (Grease)", value=0.05, format="%.3f")
    
    st.markdown("**Solder (錫)**")
    c7, c8 = st.columns(2)
    K_Solder = c7.number_input("K (Solder)", value=58.0)
    t_Solder = c8.number_input("t (Solder)", value=0.3)
    Voiding = st.number_input("錫片空洞率 (Voiding)", value=0.75)
    
    st.markdown("**PCB Thermal Via**")
    K_Via = st.number_input("Via 等效 K值", value=30.0)
    Via_Eff = st.number_input("Via 製程係數", value=0.9)

# 散熱器參數
with st.sidebar.expander("4. 鰭片幾何", expanded=False):
    Gap = st.number_input("鰭片間距 (mm)", value=13.2, step=0.1)
    Fin_t = st.number_input("鰭片厚度 (mm)", value=1.2, step=0.1)

Top, Btm, Left, Right = 11, 13, 11, 11

# ==================================================
# 2. 主畫面：元件熱源清單 (Table 2) - 核心邏輯區
# ==================================================
st.subheader("🔥 元件熱源清單 (Table 2)")
st.info("📝 請修改白色背景的欄位，灰色欄位 (Base, Loc_Amb, R_int...) 會自動計算。")

# 1. 定義初始輸入資料
input_data = {
    "Component": ["Final PA", "Driver PA", "Pre Driver", "Circulator", "Cavity Filter", "CPU (FPGA)", "Si5518", "16G DDR", "Power Mod", "SFP"],
    "Qty": [4, 4, 4, 4, 1, 1, 1, 2, 1, 1],
    "Power(W)": [52.13, 9.54, 0.37, 2.76, 31.07, 35.00, 2.00, 0.40, 29.00, 0.50],
    "Height(mm)": [250, 200, 180, 250, 0, 50, 80, 60, 30, 0], 
    "Pad_L": [20, 5, 2, 10, 0, 35, 8.6, 7.5, 58, 14], 
    "Pad_W": [10, 5, 2, 10, 0, 35, 8.6, 11.5, 61, 50],
    "Thick(mm)": [2.5, 2.0, 2.0, 2.0, 0, 0, 2.0, 0, 0, 0],
    "K_Board": [380, K_Via, K_Via, K_Via, 0, 0, K_Via, 0, 0, 0],
    "Limit(C)": [225, 200, 175, 125, 200, 100, 125, 95, 95, 200],
    "R_jc": [1.50, 1.70, 50.0, 0.0, 0.0, 0.16, 0.50, 0.0, 0.0, 0.0],
    "TIM_Type": ["Solder", "Grease", "Grease", "Grease", "None", "Putty", "Pad", "Grease", "Grease", "Grease"]
}

df_input = pd.DataFrame(input_data)

# 2. 顯示「輸入用」表格
edited_df = st.data_editor(
    df_input,
    column_config={
        "TIM_Type": st.column_config.SelectboxColumn(
            "TIM Type", options=["Solder", "Grease", "Pad", "Putty", "None"], required=True, width="small"
        ),
        "Component": st.column_config.TextColumn("Component", disabled=False), 
        "Qty": st.column_config.NumberColumn("Qty", min_value=0, step=1, width="small"),
    },
    num_rows="dynamic",
    use_container_width=True,
    key="editor"
)

# ==================================================
# 3. 邏輯運算引擎 (Excel Formulas in Python)
# ==================================================

tim_props = {
    "Solder": {"k": K_Solder, "t": t_Solder},
    "Grease": {"k": K_Grease, "t": t_Grease},
    "Pad":    {"k": K_Pad,    "t": t_Pad},
    "Putty":  {"k": K_Putty,  "t": t_Putty},
    "None":   {"k": 1,        "t": 0}
}

def apply_excel_formulas(row):
    # A. 【幾何公式】: Base L/W 自動計算
    # 邏輯: Base = Pad + Thick
    # 例外: Final PA 
    if row['Component'] == "Final PA":
        base_l = 55.0
        base_w = 35.0
    elif row['Power(W)'] == 0 or row['Thick(mm)'] == 0:
        base_l = 0.0
        base_w = 0.0
    else:
        base_l = row['Pad_L'] + row['Thick(mm)']
        base_w = row['Pad_W'] + row['Thick(mm)']
        
    # B. 【局部環溫公式】(Loc_Amb)
    loc_amb = T_amb + (row['Height(mm)'] * Slope)
    
    # C. 【熱阻公式】(R_int)
    pad_area = (row['Pad_L'] * row['Pad_W']) / 1e6
    base_area = (base_l * base_w) / 1e6
    
    if row['K_Board'] > 0 and pad_area > 0:
        eff_area = np.sqrt(pad_area * base_area) if base_area > 0 else pad_area
        r_int_val = (row['Thick(mm)']/1000) / (row['K_Board'] * eff_area)
        
        if row['Component'] == "Final PA":
            r_int = r_int_val + ((t_Solder/1000) / (K_Solder * pad_area * Voiding))
        else:
            r_int = r_int_val / Via_Eff
    else:
        r_int = 0
        
    # D. 【TIM 熱阻公式】(R_TIM)
    tim = tim_props.get(row['TIM_Type'], {"k":1, "t":0})
    target_area = base_area if base_area > 0 else pad_area
    
    if target_area > 0 and tim['t'] > 0:
        r_tim = (tim['t']/1000) / (tim['k'] * target_area)
    else:
        r_tim = 0
        
    # E. 【總熱耗與溫升】
    total_w = row['Qty'] * row['Power(W)']
    drop = row['Power(W)'] * (row['R_jc'] + r_int + r_tim)
    allowed_dt = row['Limit(C)'] - drop - loc_amb
    
    return pd.Series([base_l, base_w, loc_amb, r_int, r_tim, total_w, drop, allowed_dt])

# 執行運算
if not edited_df.empty:
    calc_results = edited_df.apply(apply_excel_formulas, axis=1)
    calc_results.columns = ['Base_L', 'Base_W', 'Loc_Amb', 'R_int', 'R_TIM', 'Total_W', 'Drop', 'Allowed_dT']
    final_df = pd.concat([edited_df, calc_results], axis=1)
else:
    final_df = pd.DataFrame()

# ==================================================
# 4. 顯示「計算結果」表格 (鎖定版)
# ==================================================
st.markdown("#### 🔒 自動計算結果 (唯讀)")
if not final_df.empty:
    st.dataframe(
        final_df,
        column_config={
            "Base_L": st.column_config.NumberColumn("Base L (Calc)", format="%.1f"),
            "Base_W": st.column_config.NumberColumn("Base W (Calc)", format="%.1f"),
            "Loc_Amb": st.column_config.NumberColumn("Loc_Amb", format="%.1f"),
            "R_int": st.column_config.NumberColumn("R_int", format="%.2f"),
            "R_TIM": st.column_config.NumberColumn("R_TIM", format="%.2f"),
            "Drop": st.column_config.NumberColumn("Drop", format="%.1f"),
            "Allowed_dT": st.column_config.NumberColumn("Allowed_dT", format="%.2f"),
            "Total_W": st.column_config.NumberColumn("Total W", format="%.1f"),
            "Pad_L": None, "Pad_W": None, "Thick(mm)": None, "K_Board": None, 
            "Limit(C)": None, "R_jc": None, "TIM_Type": None, "Height(mm)": None
        },
        use_container_width=True,
        hide_index=True
    )

    valid_rows = final_df[final_df['Total_W'] > 0]
    if not valid_rows.empty:
        Total_Watts_Sum = valid_rows['Total_W'].sum()
        Min_dT_Allowed = valid_rows['Allowed_dT'].min()
        if not pd.isna(valid_rows['Allowed_dT'].idxmin()):
            Bottleneck_Name = valid_rows.loc[valid_rows['Allowed_dT'].idxmin()]['Component']
        else:
             Bottleneck_Name = "None"
    else:
        Total_Watts_Sum = 0; Min_dT_Allowed = 50; Bottleneck_Name = "None"

# ==================================================
# 5. 體積運算與儀表板 (Table 3)
# ==================================================
Total_Power = Total_Watts_Sum * Margin
if Total_Power > 0 and Min_dT_Allowed > 0:
    R_sa = Min_dT_Allowed / Total_Power
    Area_req = 1 / (h_value * R_sa * Eff)
    L_hsk = L_pcb + Top + Btm
    W_hsk = W_pcb + Left + Right
    Base_Area_m2 = (L_hsk * W_hsk) / 1e6
    Fin_Count = W_hsk / (Gap + Fin_t)
    try:
        Fin_Height = ((Area_req - Base_Area_m2) * 1e6) / (2 * Fin_Count * L_hsk)
    except:
        Fin_Height = 0
    RRU_Height = t_base + Fin_Height + H_shield + H_filter
    Volume_L = (L_hsk * W_hsk * RRU_Height) / 1e6
else:
    Fin_Height = 0; RRU_Height = 0; Volume_L = 0

st.markdown("---")
st.subheader("📊 最終運算結果 (Volume Engine)")
c1, c2, c3, c4 = st.columns(4)
c1.metric("整機總熱耗", f"{round(Total_Power, 2)} W")
c2.metric("系統瓶頸元件", f"{Bottleneck_Name}", delta=f"dT: {round(Min_dT_Allowed, 2)}°C")
c3.metric("建議鰭片高度", f"{round(Fin_Height, 2)} mm")
c4.metric("★ 整機估算體積", f"{round(Volume_L, 2)} L")
