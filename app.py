import streamlit as st
import pandas as pd
import numpy as np
import plotly.express as px

# ==============================================================================
# 版本：v3.14 (Final Fix)
# 日期：2026-01-30
# 基底：v3.14 (Hint Update)
# 修改內容：
# 1. 再次確認 Tab 2 的提示文字已移除熱力圖顏色說明，僅保留滑鼠懸停提示。
# 2. 確保 UI 樣式 (黑框、頁籤、頁尾版本號) 皆正確套用。
# ==============================================================================

# === APP 設定 ===
st.set_page_config(page_title="5G RRU Thermal Calculator v3.14", layout="wide")

# ==================================================
# 🔐 密碼保護功能
# ==================================================
def check_password():
    ACTUAL_PASSWORD = "tedus"
    def password_entered():
        if st.session_state["password"] == ACTUAL_PASSWORD:
            st.session_state["password_correct"] = True
            del st.session_state["password"]
        else:
            st.session_state["password_correct"] = False

    if "password_correct" not in st.session_state:
        st.text_input("🔒 請輸入存取密碼 (Password)", type="password", on_change=password_entered, key="password")
        return False
    elif not st.session_state["password_correct"]:
        st.text_input("🔒 請輸入存取密碼 (Password)", type="password", on_change=password_entered, key="password")
        st.error("❌ 密碼錯誤，請重試")
        return False
    else:
        return True

if not check_password():
    st.stop()

# ==================================================
# 👇 主程式開始
# ==================================================

# 標題 (無版本號)
st.title("📡 5G RRU 體積估算引擎")

# --------------------------------------------------
# [CSS] 樣式設定
# --------------------------------------------------
st.markdown("""
<style>
    /* 1. 全域字體調整 */
    html, body, [class*="css"] {
        font-family: "Microsoft JhengHei", sans-serif;
    }

    /* 2. 頁籤 (Tabs) 優化 - 高對比 */
    button[data-baseweb="tab"] {
        font-size: 18px !important;
        font-weight: 700 !important;
        background-color: #E0E0E0 !important;
        color: #333333 !important;
        border: 1px solid #999 !important;
        border-radius: 5px 5px 0 0 !important;
        margin-right: 4px !important;
        padding: 10px 20px !important;
    }
    button[data-baseweb="tab"][aria-selected="true"] {
        background-color: #4DA6FF !important;
        color: black !important;
        border: 2px solid black !important;
        border-bottom: none !important;
    }

    /* 3. 表格 (Dataframe/Editor) 樣式覆蓋 */
    /* 強制表頭文字為黑色 */
    [data-testid="stDataFrame"] thead tr th, 
    [data-testid="stDataEditor"] thead tr th,
    [data-testid="stDataFrame"] thead tr th div, 
    [data-testid="stDataEditor"] thead tr th div {
        color: black !important;
        font-weight: 900 !important;
        font-size: 16px !important;
    }
    /* 表格加黑框 */
    [data-testid="stDataFrame"], [data-testid="stDataEditor"] {
        border: 2px solid black !important;
        padding: 5px !important;
        border-radius: 5px !important;
    }

    /* 4. KPI 卡片樣式 */
    .kpi-card {
        background-color: #ffffff;
        border-radius: 10px;
        padding: 20px;
        margin: 10px 0;
        box-shadow: 0 4px 6px rgba(0,0,0,0.1);
        border-left: 5px solid #333;
        text-align: center;
        border: 1px solid #ddd;
    }
    .kpi-title { color: #666; font-size: 0.9rem; font-weight: 500; margin-bottom: 5px; }
    .kpi-value { color: #333; font-size: 1.8rem; font-weight: 700; margin-bottom: 5px; }
    .kpi-desc { color: #888; font-size: 0.8rem; }

    /* Scale Bar 樣式 */
    .legend-container { display: flex; flex-direction: column; align-items: center; margin-top: 40px; font-size: 0.85rem; }
    .legend-title { font-weight: bold; margin-bottom: 5px; color: black; }
    .legend-body { display: flex; align-items: stretch; height: 200px; }
    .gradient-bar { width: 15px; background: linear-gradient(to top, #d73027, #fee08b, #1a9850); border-radius: 3px; margin-right: 8px; border: 1px solid black; }
    .legend-labels { display: flex; flex-direction: column; justify-content: space-between; color: black; font-weight: bold; }
</style>
""", unsafe_allow_html=True)

# ==================================================
# 1. 側邊欄：全域參數
# ==================================================
st.sidebar.header("🛠️ 全域參數設定")

with st.sidebar.expander("1. 環境與係數", expanded=True):
    T_amb = st.number_input("環境溫度 (°C)", value=45.0, step=1.0)
    h_value = st.number_input("自然對流係數 h (W/m2K)", value=8.8, step=0.1)
    Margin = st.number_input("設計安全係數 (Margin)", value=1.0, step=0.1)
    Slope = 0.03 
    Eff = st.number_input("鰭片效率 (Eff)", value=0.95, step=0.01)

with st.sidebar.expander("2. PCB 與 機構尺寸", expanded=True):
    L_pcb = st.number_input("PCB 長度 (mm)", value=350)
    W_pcb = st.number_input("PCB 寬度 (mm)", value=250)
    t_base = st.number_input("散熱器基板厚 (mm)", value=7)
    H_shield = st.number_input("HSK內腔深度 (mm)", value=20)
    H_filter = st.number_input("Cavity Filter 厚度 (mm)", value=42)
    
    st.markdown("---")
    st.caption("Final PA 專用銅塊尺寸")
    c1, c2 = st.columns(2)
    Coin_L_Setting = c1.number_input("銅塊長 (mm)", value=55.0, step=1.0)
    Coin_W_Setting = c2.number_input("銅塊寬 (mm)", value=35.0, step=1.0)

with st.sidebar.expander("3. 材料參數 (含 Via K值)", expanded=False):
    c1, c2 = st.columns(2)
    K_Via = c1.number_input("Via 等效 K值", value=30.0)
    Via_Eff = c2.number_input("Via 製程係數", value=0.9)
    st.markdown("---") 
    st.caption("熱介面材料 (TIM)")
    c
