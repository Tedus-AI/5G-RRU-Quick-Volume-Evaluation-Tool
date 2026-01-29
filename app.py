import streamlit as st
import pandas as pd
import numpy as np

# === APP 設定 ===
st.set_page_config(page_title="5G RRU Thermal Calculator", layout="wide")

st.title("📡 5G RRU 體積估算引擎")

# ==================================================
# 1. 側邊欄：全域邊界條件
# ==================================================
st.sidebar.header("🛠️ 全域參數設定")

# 環境與係數
with st.sidebar.expander("1. 環境與係數", expanded=True):
    T_amb = st.number_input("環境溫度 (°C)", value=45.0, step=1.0)
    h_value = st.number_input("自然對流係數 h (W/m2K)", value=8.8, step=0.1)
    Margin = st.number_input("設計安全係數 (Margin)", value=1.0, step=0.1)
    Slope = 0.03 # 空氣升溫梯度
    Eff = st.number_input("鰭片效率 (Eff)", value=0.95, step=0.01)

# 機構參數
with st.sidebar.expander("2. PCB 與 機構尺寸", expanded=True): # 展開此區塊以便設定銅塊
    L_pcb = st.number_input("PCB 長度 (mm)", value=350)
    W_pcb = st.number_input("PCB 寬度 (mm)", value=250)
    t_base = st.number_input("散熱器基板厚 (mm)", value=7)
    H_shield = st.number_input("HSK內腔深度 (mm)", value=20)
    H_filter = st.number_input("Cavity Filter 厚度 (mm)", value=42)
    
    # [新增功能] Final PA 銅塊尺寸設定
    st.markdown("---")
    st.caption("Final PA 專用銅塊尺寸")
    c_coin_1, c_coin_2 = st.columns(2)
    Coin_L_Setting = c_coin_1.number_input("銅塊長 (mm)", value=55.0, step=1.0)
    Coin_W_Setting = c_coin_2.number_input("銅塊寬 (mm)", value=35.0, step=1.0)

# 材料參數
with st.sidebar.expander("3. 材料參數 (含 Via K值)", expanded=False):
    c1, c2 = st.columns(2)
    K_Via = c1.number_input("Via 等效 K值", value=30.0)
    Via_Eff = c2.number_input("Via 製程係數", value=0.9)
    
    st.markdown("---") 
    st.caption("熱介面材料 (TIM)")
    
    c3, c4 = st.columns(2)
    K_Putty = c3.number_input("K (Putty)", value=9.1)
    t_Putty = c4.number_input("t (Putty)", value=0.5)
    
    c5, c6 = st.columns(2)
    K_Pad = c5.number_input("K (Pad)", value=7.5)
    t_Pad = c6.number_input("t (Pad)", value=1.7)
    
    c7, c8 = st.columns(2)
    K_Grease = c7.number_input("K (Grease)", value=3.0)
    t_Grease = c8.number_input("t (Grease)", value=0.05, format="%.3f")
    
    st.markdown("---") 
    st.markdown("**Solder (錫片)**") 
    
    c9, c10 = st.columns(2)
    K_Solder = c9.number_input("K (錫片)", value=58.0)
    t_Solder = c10.number_input("t (錫片)", value=0.3)
    Voiding = st.number_input("錫片空洞率 (Voiding)", value=0.75)

# 散熱器參數
with st.sidebar.expander("4. 鰭片幾何", expanded=False):
    Gap = st.number_input("鰭片間距 (mm)", value=13.2, step=0.1)
    Fin_t = st.number_input("鰭片厚度 (mm)", value=1.2, step=0.1)

Top, Btm, Left, Right = 11, 13, 11, 11

# ==================================================
# 2. 主畫面：元件熱源清單
# ==================================================
st.subheader("🔥 元件熱源清單")
st.caption("💡 **提示：將滑鼠游標停留在表格的「欄位標題」上，即可查看詳細的名詞解釋與定義。**")

# 1. 定義初始資料
input_data = {
    "Component": ["Final PA", "Driver PA", "Pre Driver", "Circulator", "Cavity Filter", "CPU (FPGA)", "Si5518", "16G DDR", "Power Mod", "SFP"],
    "Qty": [4, 4, 4, 4, 1, 1, 1, 2, 1, 1],
    "Power(W)": [52.13, 9.54, 0.37, 2.76, 31.07, 35.00, 2.00, 0.40, 29.00, 0.50],
    "Height(mm)": [250, 200, 180, 250, 0, 50, 80, 60, 30, 0], 
    "Pad_L": [20, 5, 2, 10, 0, 35, 8.6, 7.5, 58, 14], 
    "Pad_W": [10, 5, 2, 10, 0, 35, 8.6, 11.5, 61, 50],
    "Thick(mm)": [2.5, 2.0, 2.0, 2.0, 0, 0, 2.0, 0, 0, 0],
    "Board_Type": ["Copper Coin", "Thermal Via", "Thermal Via", "Thermal Via", "None", "None", "Thermal Via", "None", "None", "None"],
    "Limit(C)": [225, 200, 175, 125, 200, 100, 125, 95, 95, 200],
    "R_jc": [1.50, 1.70, 50.0, 0.0, 0.0, 0.16, 0.50, 0.0, 0.0, 0.0],
    "TIM_Type": ["Solder", "Grease", "Grease", "Grease", "None", "Putty", "Pad", "Grease", "Grease", "Grease"]
}

df_input = pd.DataFrame(input_data)

# 2. 顯示編輯器
edited_df = st.data_editor(
    df_input,
    column_config={
        "Component": st.column_config.TextColumn(label="元件名稱", help="元件型號或代號 (如 PA, FPGA)", disabled=False),
        "Qty": st.column_config.NumberColumn(label="數量", help="該元件的使用數量", min_value=0, step=1, width="small"),
        "Power(W)": st.column_config.NumberColumn(label="單顆功耗 (W)", help="單一顆元件的發熱瓦數 (TDP)", format="%.2f"),
        "Height(mm)": st.column_config.NumberColumn(label="元件高度 (mm)", help="元件距離 PCB 底部的垂直高度。高度越高，局部環溫 (Local Amb) 越高。", format="%.1f"),
        "Pad_L": st.column_config.NumberColumn(label="Pad 長 (mm)", help="元件底部散熱焊盤 (Thermal Pad) 的長度"),
        "Pad_W": st.column_config.NumberColumn(label="Pad 寬 (mm)", help="元件底部散熱焊盤 (Thermal Pad) 的寬度"),
        "Thick(mm)": st.column_config.NumberColumn(label="基板厚度 (mm)", help="熱需傳導穿過的 PCB 或銅塊 (Coin) 厚度", format="%.1f"),
        "Board_Type": st.column_config.SelectboxColumn(label="基板導通", help="PCB 垂直導熱的方式。Thermal Via (K=30) 或 Copper Coin (K=380)", options=["Thermal Via", "Copper Coin", "None"], required=True, width="medium"),
        "TIM_Type": st.column_config.SelectboxColumn(label="介面材料", help="元件與散熱器之間的接觸介質 (如導熱膏、墊片)", options=["Solder", "Grease", "Pad", "Putty", "None"], required=True, width="medium"),
        "R_jc": st.column_config.NumberColumn(label="熱阻 Rjc", help="結點到殼 (Junction to Case) 的內部熱阻值", format="%.2f"),
        "Limit(C)": st.column_config.NumberColumn(label="限溫 (°C)", help="元件允許的最高運作溫度 (Tj 或 Tc)", format="%.1f")
    },
    num_rows="dynamic",
    use_container_width=True,
    key="editor"
)

# ==================================================
# 3. 邏輯運算引擎
# ==================================================

tim_props = {
    "Solder": {"k": K_Solder, "t": t_Solder},
    "Grease": {"k": K_Grease, "t": t_Grease},
    "Pad":    {"k": K_Pad,    "t": t_Pad},
    "Putty":  {"k": K_Putty,  "t": t_Putty},
    "None":   {"k": 1,        "t": 0}
}

def apply_excel_formulas(row):
    # A. Base L/W (幾何計算)
    # [修改重點] 改為讀取側邊欄變數，不再寫死 55/35
    if row['Component'] == "Final PA":
        base_l, base_w = Coin_L_Setting, Coin_W_Setting
    elif row['Power(W)'] == 0 or row['Thick(mm)'] == 0:
        base_l, base_w = 0.0, 0.0
    else:
        # 其他元件依照公式計算
        base_l = row['Pad_L'] + row['Thick(mm)']
        base_w = row['Pad_W'] + row['Thick(mm)']
        
    # B. Loc_Amb
    loc_amb = T_amb + (row['Height(mm)'] * Slope)
    
    # C. R_int
    if row['Board_Type'] == "Copper Coin": k_board = 380.0
    elif row['Board_Type'] == "Thermal Via": k_board = K_Via
    else: k_board = 0.0

    pad_area = (row['Pad_L'] * row['Pad_W']) / 1e6
    base_area = (base_l * base_w) / 1e6
    
    if k_board > 0 and pad_area > 0:
        eff_area = np.sqrt(pad_area * base_area) if base_area > 0 else pad_area
        r_int_val = (row['Thick(mm)']/1000) / (k_board * eff_area)
        
        if row['Component'] == "Final PA":
            r_int = r_int_val + ((t_Solder/1000) / (K_Solder * pad_area * Voiding))
        elif row['Board_Type'] == "Thermal Via":
            r_int = r_int_val / Via_Eff
        else:
            r_int = r_int_val
    else:
        r_int = 0
        
    # D. R_TIM
    tim = tim_props.get(row['TIM_Type'], {"k":1, "t":0})
    target_area = base_area if base_area > 0 else pad_area
    if target_area > 0 and tim['t'] > 0:
        r_tim = (tim['t']/1000) / (tim['k'] * target_area)
    else:
        r_tim = 0
        
    # E. Drop & dT
    total_w = row['Qty'] * row['Power(W)']
    drop = row['Power(W)'] * (row['R_jc'] + r_int + r_tim)
    allowed_dt = row['Limit(C)'] - drop - loc_amb
    
    return pd.Series([base_l, base_w, loc_amb, r_int, r_tim, total_w, drop, allowed_dt])

# 運算執行
if not edited_df.empty:
    calc_results = edited_df.apply(apply_excel_formulas, axis=1)
    calc_results.columns = ['Base_L', 'Base_W', 'Loc_Amb', 'R_int', 'R_TIM', 'Total_W', 'Drop', 'Allowed_dT']
    final_df = pd.concat([edited_df, calc_results], axis=1)
else:
    final_df = pd.DataFrame()

# ==================================================
# 4. 顯示計算結果
# ==================================================
st.markdown("#### 🔒 自動計算結果 (唯讀)")
if not final_df.empty:
    st.dataframe(
        final_df,
        column_config={
            "Base_L": st.column_config.NumberColumn("Base L", format="%.1f"),
            "Base_W": st.column_config.NumberColumn("Base W", format="%.1f"),
            "R_int": st.column_config.NumberColumn("R_int", format="%.5f"),
            "R_TIM": st.column_config.NumberColumn("R_TIM", format="%.5f"),
            "Drop": st.column_config.NumberColumn("Drop", format="%.1f"),
            "Allowed_dT": st.column_config.NumberColumn("Allowed_dT", format="%.2f"),
            "Pad_L": None, "Pad_W": None, "Thick(mm)": None, 
            "Limit(C)": None, "R_jc": None, "TIM_Type": None, "Board_Type": None, "Height(mm)": None
        },
        use_container_width=True,
        hide_index=True
    )
    
    # 瓶頸元件
    valid_rows = final_df[final_df['Total_W'] > 0]
    if not valid_rows.empty:
        Total_Watts_Sum = valid_rows['Total_W'].sum()
        Min_dT_Allowed = valid_rows['Allowed_dT'].min()
        Bottleneck_Name = valid_rows.loc[valid_rows['Allowed_dT'].idxmin()]['Component'] if not pd.isna(valid_rows['Allowed_dT'].idxmin()) else "None"
    else:
        Total_Watts_Sum = 0; Min_dT_Allowed = 50; Bottleneck_Name = "None"

# ==================================================
# 5. 體積運算與結果顯示
# ==================================================

# A. 基礎機構計算
L_hsk = L_pcb + Top + Btm
W_hsk = W_pcb + Left + Right
Fin_Count = W_hsk / (Gap + Fin_t)

# B. 熱流計算
Total_Power = Total_Watts_Sum * Margin
if Total_Power > 0 and Min_dT_Allowed > 0:
    R_sa = Min_dT_Allowed / Total_Power
    Area_req = 1 / (h_value * R_sa * Eff)
    Base_Area_m2 = (L_hsk * W_hsk) / 1e6
    try:
        Fin_Height = ((Area_req - Base_Area_m2) * 1e6) / (2 * Fin_Count * L_hsk)
    except: Fin_Height = 0
    RRU_Height = t_base + Fin_Height + H_shield + H_filter
    Volume_L = (L_hsk * W_hsk * RRU_Height) / 1e6
else:
    R_sa = 0; Area_req = 0; Fin_Height = 0; RRU_Height = 0; Volume_L = 0

# C. 顯示區塊
st.markdown("---")
st.subheader("📊 最終運算結果")

# 第一排：熱流與面積資訊
c1, c2, c3, c4 = st.columns(4)
c1.metric("整機總熱耗", f"{round(Total_Power, 2)} W")
c2.metric("系統瓶頸元件", f"{Bottleneck_Name}", delta=f"dT: {round(Min_dT_Allowed, 2)}°C")
c3.metric("所需散熱總面積", f"{round(Area_req, 3)} m²")
c4.metric("預估鰭片數量", f"{int(Fin_Count)} Pcs")

# 第二排：尺寸資訊
c5, c6 = st.columns(2)
c5.metric("建議鰭片高度", f"{round(Fin_Height, 2)} mm")
c6.metric("RRU 整機尺寸 (L x W x H)", f"{L_hsk} x {W_hsk} x {round(RRU_Height, 1)} mm")

# 第三排：體積 Highlight
st.markdown("---")
st.markdown(f"""
<div style="
    background-color: #e6fffa; 
    padding: 20px; 
    border-radius: 10px; 
    border-left: 10px solid #00b894; 
    box-shadow: 2px 2px 5px rgba(0,0,0,0.1);
    text-align: center;
">
    <h3 style="color: #006266; margin:0; font-size: 1.2rem;">★ RRU 整機估算體積 (Estimated Volume)</h3>
    <h1 style="color: #00b894; margin:10px 0; font-size: 3.5rem;">{round(Volume_L, 2)} L</h1>
</div>
""", unsafe_allow_html=True)
