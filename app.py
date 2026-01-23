import streamlit as st
import pandas as pd
import numpy as np

# === APP 設定 ===
st.set_page_config(page_title="5G RRU Thermal Calculator", layout="wide")

# [修正 1] 標題移除 (Pro)
st.title("📡 5G RRU 體積估算引擎")

# [修正 2] 移除不必要的介面說明文字
# st.markdown("### ⚡ 雙重介面設定...") -> 已刪除

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
with st.sidebar.expander("2. PCB 與 機構尺寸", expanded=False):
    L_pcb = st.number_input("PCB 長度 (mm)", value=350)
    W_pcb = st.number_input("PCB 寬度 (mm)", value=250)
    t_base = st.number_input("散熱器基板厚 (mm)", value=7)
    H_shield = st.number_input("HSK內腔深度 (mm)", value=20)
    # [修正 3] Filter 更名為 Cavity Filter
    H_filter = st.number_input("Cavity Filter 厚度 (mm)", value=42)

# 材料參數
with st.sidebar.expander("3. 材料參數 (含 Via K值)", expanded=True):
    # 分欄顯示比較整齊
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
    
    # [修正 4] 加入分隔線，並將 Solder 改為中文「錫片」
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
# [修正 5] 移除 (Table 2) 字樣
st.subheader("🔥 元件熱源清單")

# [修正 6] 移除更新說明的 Info Box
# st.info("📝 新增 **Board Type** 欄位...") -> 已刪除

# 1. 定義初始資料
input_data = {
