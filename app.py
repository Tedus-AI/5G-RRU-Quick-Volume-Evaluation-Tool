import streamlit as st
import pandas as pd
import numpy as np
import plotly.express as px

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
with st.sidebar.expander("2. PCB 與 機構尺寸", expanded=True):
    L_pcb = st.number_input("PCB 長度 (mm)", value=350)
    W_pcb = st.number_input("PCB 寬度 (mm)", value=250)
    t_base = st.number_input("散熱器基板厚 (mm)", value=7)
    H_shield = st.number_input("HSK內腔深度 (mm)", value=20)
    H_filter = st.number_input("Cavity Filter 厚度 (mm)", value=42)
    
    # Final PA 銅塊尺寸設定
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
# 3. 建立分頁 (Tabs)
# ==================================================
# [修改重點] 調整分頁順序： 1.輸入 -> 2.詳細數據 -> 3.視覺化報告
tab_input, tab_data, tab_viz = st.tabs(["📝 元件清單設定", "🔢 詳細計算數據", "📊 視覺化分析結果"])


# ==================================================
# Tab 1: 輸入介面
# ==================================================
with tab_input:
    st.subheader("🔥 元件熱源清單設定")
    st.caption("💡 **提示：請在此編輯元件參數，修改後可切換至「詳細數據」或「視覺化結果」查看報告。**")

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
            "Component": st.column_config.TextColumn(label="元件名稱", help="元件型號或代號", disabled=False),
            "Qty": st.column_config.NumberColumn(label="數量", min_value=0, step=1, width="small"),
            "Power(W)": st.column_config.NumberColumn(label="單顆功耗 (W)", format="%.2f"),
            "Height(mm)": st.column_config.NumberColumn(label="元件高度 (mm)", format="%.1f"),
            "Pad_L": st.column_config.NumberColumn(label="Pad 長 (mm)"),
            "Pad_W": st.column_config.NumberColumn(label="Pad 寬 (mm)"),
            "Thick(mm)": st.column_config.NumberColumn(label="基板厚度 (mm)", format="%.1f"),
            "Board_Type": st.column_config.SelectboxColumn(label="基板導通", options=["Thermal Via", "Copper Coin", "None"], required=True, width="medium"),
            "TIM_Type": st.column_config.SelectboxColumn(label="介面材料", options=["Solder", "Grease", "Pad", "Putty", "None"], required=True, width="medium"),
            "R_jc": st.column_config.NumberColumn(label="熱阻 Rjc", format="%.2f"),
            "Limit(C)": st.column_config.NumberColumn(label="限溫 (°C)", format="%.1f")
        },
        num_rows="dynamic",
        use_container_width=True,
        key="editor"
    )

# ==================================================
# 後台邏輯運算 (不顯示)
# ==================================================

tim_props = {
    "Solder": {"k": K_Solder, "t": t_Solder},
    "Grease": {"k": K_Grease, "t": t_Grease},
    "Pad":    {"k": K_Pad,    "t": t_Pad},
    "Putty":  {"k": K_Putty,  "t": t_Putty},
    "None":   {"k": 1,        "t": 0}
}

def apply_excel_formulas(row):
    # A. Base L/W
    if row['Component'] == "Final PA":
        base_l, base_w = Coin_L_Setting, Coin_W_Setting
    elif row['Power(W)'] == 0 or row['Thick(mm)'] == 0:
        base_l, base_w = 0.0, 0.0
    else:
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

if not edited_df.empty:
    calc_results = edited_df.apply(apply_excel_formulas, axis=1)
    calc_results.columns = ['Base_L', 'Base_W', 'Loc_Amb', 'R_int', 'R_TIM', 'Total_W', 'Drop', 'Allowed_dT']
    final_df = pd.concat([edited_df, calc_results], axis=1)
else:
    final_df = pd.DataFrame()

# 準備全域變數
valid_rows = final_df[final_df['Total_W'] > 0].copy()
if not valid_rows.empty:
    Total_Watts_Sum = valid_rows['Total_W'].sum()
    Min_dT_Allowed = valid_rows['Allowed_dT'].min()
    Bottleneck_Name = valid_rows.loc[valid_rows['Allowed_dT'].idxmin()]['Component'] if not pd.isna(valid_rows['Allowed_dT'].idxmin()) else "None"
else:
    Total_Watts_Sum = 0; Min_dT_Allowed = 50; Bottleneck_Name = "None"

# 體積與散熱器計算
L_hsk = L_pcb + Top + Btm
W_hsk = W_pcb + Left + Right
Fin_Count = W_hsk / (Gap + Fin_t)

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


# ==================================================
# Tab 2: 詳細數據 (唯讀表) - [已移至第二順位]
# ==================================================
with tab_data:
    st.subheader("🔢 詳細計算數據 (唯讀)")
    st.caption("💡 **提示：將滑鼠游標停留在表格的「欄位標題」上，即可查看詳細的名詞解釋與定義。**")
    
    if not final_df.empty:
        st.dataframe(
            final_df,
            column_config={
                "Base_L": st.column_config.NumberColumn(label="Base 長 (mm)", help="熱量擴散後的底部有效長度", format="%.1f"),
                "Base_W": st.column_config.NumberColumn(label="Base 寬 (mm)", help="熱量擴散後的底部有效寬度", format="%.1f"),
                "Loc_Amb": st.column_config.NumberColumn(label="局部環溫 (°C)", help="該元件高度處的環境溫度", format="%.1f"),
                "R_int": st.column_config.NumberColumn(label="基板熱阻 (°C/W)", help="元件穿過 PCB 或銅塊的熱阻", format="%.5f"),
                "R_TIM": st.column_config.NumberColumn(label="介面熱阻 (°C/W)", help="TIM 材料接觸熱阻", format="%.5f"),
                "Drop": st.column_config.NumberColumn(label="內部溫降 (°C)", help="熱量從晶片核心傳導到散熱器表面的溫差", format="%.1f"),
                "Allowed_dT": st.column_config.NumberColumn(label="允許溫升 (°C)", help="散熱器剩餘可用的溫升預算", format="%.2f"),
                "Total_W": st.column_config.NumberColumn(label="總功耗 (W)", help="該元件的總發熱量", format="%.1f"),
                "Pad_L": None, "Pad_W": None, "Thick(mm)": None, 
                "Limit(C)": None, "R_jc": None, "TIM_Type": None, "Board_Type": None, "Height(mm)": None, "Component": None, "Qty": None, "Power(W)": None
            },
            use_container_width=True,
            hide_index=True
        )

# ==================================================
# Tab 3: 視覺化與最終結果 (儀表板) - [已移至第三順位]
# ==================================================
with tab_viz:
    st.subheader("📊 熱流分析報告")
    
    # 1. 關鍵指標 (KPIs)
    kpi1, kpi2, kpi3, kpi4 = st.columns(4)
    kpi1.metric("整機總熱耗", f"{round(Total_Power, 2)} W")
    kpi2.metric("系統瓶頸", f"{Bottleneck_Name}", delta=f"dT: {round(Min_dT_Allowed, 2)}°C", delta_color="inverse")
    kpi3.metric("所需散熱面積", f"{round(Area_req, 3)} m²")
    kpi4.metric("預估鰭片數", f"{int(Fin_Count)} Pcs")

    st.markdown("---")

    # 2. 圖表區
    if not valid_rows.empty:
        chart_col1, chart_col2 = st.columns(2)
        with chart_col1:
            fig_pie = px.pie(valid_rows, values='Total_W', names='Component', title='<b>各元件功耗佔比 (Power Breakdown)</b>', hole=0.4)
            st.plotly_chart(fig_pie, use_container_width=True)
            
        with chart_col2:
            valid_rows_sorted = valid_rows.sort_values(by="Allowed_dT", ascending=True)
            fig_bar = px.bar(
                valid_rows_sorted, 
                x='Component', 
                y='Allowed_dT', 
                title='<b>各元件剩餘溫升預度 (Thermal Budget)</b>',
                color='Allowed_dT',
                color_continuous_scale='RdYlGn',
                labels={'Allowed_dT': '允許溫升 (°C)'}
            )
            fig_bar.update_layout(xaxis_title="元件名稱", yaxis_title="散熱器允許溫升 (°C)")
            st.plotly_chart(fig_bar, use_container_width=True)

    st.markdown("---")

    # 3. 尺寸與體積 Highlight
    st.subheader("📏 尺寸與體積估算")
    c5, c6 = st.columns(2)
    c5.metric("建議鰭片高度", f"{round(Fin_Height, 2)} mm")
    c6.metric("RRU 整機尺寸", f"{L_hsk} x {W_hsk} x {round(RRU_Height, 1)} mm")

    st.markdown(f"""
    <div style="
        background-color: #e6fffa; 
        padding: 20px; 
        margin-top: 20px;
        border-radius: 10px; 
        border-left: 10px solid #00b894; 
        box-shadow: 2px 2px 5px rgba(0,0,0,0.1);
        text-align: center;
    ">
        <h3 style="color: #006266; margin:0; font-size: 1.2rem;">★ RRU 整機估算體積 (Estimated Volume)</h3>
        <h1 style="color: #00b894; margin:10px 0; font-size: 3.5rem;">{round(Volume_L, 2)} L</h1>
    </div>
    """, unsafe_allow_html=True)
