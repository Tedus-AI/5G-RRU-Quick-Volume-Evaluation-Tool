import streamlit as st
import streamlit.components.v1 as components
import pandas as pd
import numpy as np
import plotly.express as px
import plotly.graph_objects as go
import time
import os
import json
import copy

# ==============================================================================
# 版本：v4.11 (Restore Sensitivity Analysis)
# 日期：2026-02-10
# 修正重點：
# 1. [Fix] 補回 Tab 5 敏感度分析 (Sensitivity Analysis) 功能與介面。
# 2. [Core] 補回 compute_key_results 計算核心函數。
# 3. [Fix] 確保執行敏感度分析時 Slope 參數正確傳遞 (避免 KeyError)。
# ==============================================================================

# 定義版本資訊
APP_VERSION = "v4.11"
UPDATE_DATE = "2026-02-10"

# === APP 設定 ===
st.set_page_config(
    page_title="5G RRU Thermal Engine", 
    page_icon="📡", 
    layout="wide",
    initial_sidebar_state="expanded"
)

# ==================================================
# 0. 初始化 Session State
# ==================================================

# 1. 全域參數預設值
DEFAULT_GLOBALS = {
    "T_amb": 45.0, "Margin": 1.0, 
    "L_pcb": 350.0, "W_pcb": 250.0, "t_base": 7.0, "H_shield": 20.0, "H_filter": 42.0,
    "Top": 11.0, "Btm": 13.0, "Left": 11.0, "Right": 11.0,
    "Coin_L_Setting": 55.0, "Coin_W_Setting": 35.0,
    "Gap": 13.2, "Fin_t": 1.2,
    "K_Via": 30.0, "Via_Eff": 0.9,
    "K_Putty": 9.1, "t_Putty": 0.5,
    "K_Pad": 7.5, "t_Pad": 1.7,
    "K_Grease": 3.0, "t_Grease": 0.05,
    "K_Solder": 58.0, "t_Solder": 0.3, "Voiding": 0.75,
    "fin_tech_selector_v2": "Embedded Fin (0.95)",
    "al_density": 2.70, "filter_density": 1.00, 
    "shielding_density": 0.76, "pcb_surface_density": 0.95
}

# 嘗試載入設定檔
config_path = "default_config.json"
config_loaded_msg = "🟡 使用內建預設值" 
config_status_color = "#f1c40f" 

if os.path.exists(config_path):
    try:
        with open(config_path, "r", encoding='utf-8') as f:
            custom_config = json.load(f)
            
            loaded_globals = False
            loaded_components = False
            
            if 'global_params' in custom_config:
                DEFAULT_GLOBALS.update(custom_config['global_params'])
                loaded_globals = True
            
            if 'components_data' in custom_config:
                pass 
                
            if loaded_globals:
                config_loaded_msg = "🟢 設定檔載入成功 (default_config.json)"
                config_status_color = "#2ecc71" 
            else:
                config_loaded_msg = "🔴 預設檔格式異常"
                config_status_color = "#e74c3c"
    except Exception as e:
        config_loaded_msg = f"🔴 讀取錯誤: {str(e)}"
        config_status_color = "#e74c3c"
else:
    config_loaded_msg = "🟡 無預設檔 (Internal Defaults)"
    config_status_color = "#f1c40f"

# 寫入 Session State
for k, v in DEFAULT_GLOBALS.items():
    if k not in st.session_state:
        st.session_state[k] = v

# 2. 預設元件清單
default_component_data = {
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

# 再次檢查 JSON 是否有元件資料並覆蓋
if os.path.exists(config_path):
    try:
        with open(config_path, "r", encoding='utf-8') as f:
            custom_config = json.load(f)
            if 'components_data' in custom_config:
                default_component_data = custom_config['components_data']
    except:
        pass

if 'df_initial' not in st.session_state:
    st.session_state['df_initial'] = pd.DataFrame(default_component_data)

if 'df_current' not in st.session_state:
    st.session_state['df_current'] = st.session_state['df_initial'].copy()

if 'editor_key' not in st.session_state:
    st.session_state['editor_key'] = 0

if 'last_loaded_file' not in st.session_state:
    st.session_state['last_loaded_file'] = None

if 'json_ready_to_download' not in st.session_state:
    st.session_state['json_ready_to_download'] = None
if 'json_file_name' not in st.session_state:
    st.session_state['json_file_name'] = ""
if 'trigger_generation' not in st.session_state:
    st.session_state['trigger_generation'] = False

# 新增記錄目前載入專案名稱的狀態
if 'current_project_name' not in st.session_state:
    st.session_state['current_project_name'] = None

def reset_download_state():
    st.session_state['json_ready_to_download'] = None

# ==================================================
# 🔐 密碼保護
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
        st.markdown("""<style>.stTextInput > div > div > input {text-align: center;}</style>""", unsafe_allow_html=True)
        
        # === 1. 大標題 ===
        st.markdown("""
        <div style="background: linear-gradient(135deg, #007CF0, #00DFD8); padding: 30px; border-radius: 15px; color: white; text-align: center; margin-bottom: 30px; box-shadow: 0 6px 12px rgba(0,0,0,0.2);">
            <h1 style="margin:0; font-size: 2.8rem; font-weight: 900;">📡 5G RRU 熱流引擎 Pro</h1>
            <p style="font-size: 1.3rem; margin: 10px 0 0; opacity: 0.95;">High-Performance Thermal & Volume Estimation System</p>
            <p style="font-size: 1rem; margin-top: 15px; opacity: 0.9;">{APP_VERSION} • {UPDATE_DATE}</p>
        </div>
        """.format(APP_VERSION=APP_VERSION, UPDATE_DATE=UPDATE_DATE), unsafe_allow_html=True)

        # === 2. 密碼輸入區塊 ===
        c1, c2, c3 = st.columns([1,2,1])
        with c2:
            st.markdown("<h2 style='text-align: center; color: #2c3e50; margin-bottom: 20px;'>🔐 請輸入授權金鑰</h2>", unsafe_allow_html=True)
            st.text_input(
                "", 
                type="password", 
                on_change=password_entered, 
                key="password", 
                label_visibility="collapsed",
                placeholder="輸入密碼後按 Enter"
            )
            if st.session_state.get("password_correct") == False:
                st.error("❌ 密碼錯誤，請重新輸入")

        st.markdown("<div style='margin: 40px 0;'></div>", unsafe_allow_html=True)

        # === 3. 功能說明區塊 (Green Card) ===
        st.markdown("""
        <div style="background: #e9f7ef; padding: 25px; border-radius: 12px; border-left: 6px solid #2ecc71; margin-bottom: 30px; box-shadow: 0 4px 10px rgba(0,0,0,0.08);">
            <h3 style="color: #27ae60; margin-top: 0; padding-bottom: 8px;">🛠️ 主要功能一覽</h3>
            <ul style="font-size: 1.05rem; line-height: 1.8; color: #34495e;">
                <li><strong>元件熱源管理</strong>：動態新增/編輯元件清單，支援 Copper Coin、Thermal Via、多種 TIM</li>
                <li><strong>精準熱阻計算</strong>：自動計算 Rjc + Rint + Rtim，並考慮局部環溫與高度效應</li>
                <li><strong>散熱器尺寸優化</strong>：根據瓶頸元件裕度，自動推算所需鰭片高度、數量與整機體積</li>
                <li><strong>重量預估</strong>：含散熱器、Shield、Filter、Shielding、PCB 等分項重量</li>
                <li><strong>設計規則檢查 (DRC)</strong>：自動檢測 Gap 過小、流阻比過高、製程限制等問題</li>
                <li><strong>3D 模擬視圖</strong>：真實比例展示電子艙 + 散熱器 + 鰭片結構</li>
                <li><strong>AI 寫實渲染輔助</strong>：一鍵生成精確提示詞，搭配 Image 可產出照片級渲染圖</li>
                <li><strong>專案存取</strong>：JSON 格式載入/儲存，支援參數與元件資料完整備份</li>
            </ul>
        </div>

        <div style="background: #e8f4fd; padding: 20px; border-radius: 12px; border-left: 6px solid #3498db; margin-bottom: 30px;">
            <h3 style="color: #2980b9; margin-top: 0;">🔥 綜合傳熱係數 h 的計算原理</h3>
            <p style="line-height: 1.7; color: #2c3e50;">
            本工具的 h 值採用<strong>半經驗模型</strong>，經多款實際 RRU 產品的 CFD 模擬結果校正而得，具有高度可信度：<br><br>
            • <strong>h_conv</strong> = 6.4 × tanh(Gap / 7.0)　→ 模擬自然對流隨鰭片間距的飽和行為<br>
            • <strong>h_rad</strong> = 2.4 × (Gap / 10)<sup>0.5</sup>　→ 考慮鰭片間輻射交換隨間距衰減<br>
            • <strong>h_total</strong> = h_conv + h_rad<br><br>
            該模型已在多個專案中與 FloTHERM 結果比對，誤差通常在 <strong>±8%</strong> 以內。<br><br>
            當 Gap 過小時會自動提示 h_conv 過低；當流阻比（Aspect Ratio）過高時也會觸發設計風險警告，提醒避免空氣滯留與散熱效率下降。
            </p>
        </div>

        <div style="background: #fffacd; padding: 20px; border-radius: 12px; border-left: 6px solid #f39c12;">
            <h3 style="color: #d35400; margin-top: 0;">⚠️ 使用注意事項</h3>
            <ul style="line-height: 1.7; color: #34495e;">
                <li>本工具為<strong>快速概念設計與尺寸評估</strong>用途，非最終驗證級熱模擬</li>
                <li>計算結果高度依賴輸入參數準確度，請使用實際量測或 Datasheet 數值</li>
                <li>自然對流模型基於垂直鰭片、無風環境，室外高風速情境需另行評估</li>
                <li>Embedded Fin 高度限制預設 < 100mm，超過將觸發 DRC 警告</li>
                <li>建議將計算結果與 CFD 或實測進行交叉驗證，尤其在高功耗或極端環境下</li>
            </ul>
        </div>
        """, unsafe_allow_html=True)
        return False

    elif not st.session_state["password_correct"]:
        c1, c2, c3 = st.columns([1,2,1])
        with c2:
            st.text_input("", type="password", on_change=password_entered, key="password", label_visibility="collapsed", placeholder="請重新輸入")
            st.error("❌ 密碼錯誤")
        return False
    else:
        return True

if not check_password():
    st.stop()

if "welcome_shown" not in st.session_state:
    st.toast(f'🎉 登入成功！歡迎回到熱流運算引擎 ({APP_VERSION})', icon="✅")
    st.session_state["welcome_shown"] = True

# ==================================================
# 👇 主程式開始 - Header 區塊
# ==================================================
# CSS 樣式 (v4.00 Stable Style - Pixel Perfect Uploader)
st.markdown("""
<style>
    html, body, [class*="css"] { font-family: "Microsoft JhengHei", "Roboto", sans-serif; }
    section[data-testid="stSidebar"] { background-color: #f8f9fa; border-right: 1px solid #dee2e6; }
    
    /* Tabs */
    button[data-baseweb="tab"] {
        border-radius: 20px !important; margin: 0 5px !important; padding: 8px 20px !important;
        background-color: #f1f3f5 !important; border: none !important; font-weight: 600 !important;
        transition: all 0.3s ease !important;
    }
    button[data-baseweb="tab"][aria-selected="true"] {
        background-color: #228be6 !important; color: white !important;
        box-shadow: 0 4px 6px rgba(34, 139, 230, 0.3) !important;
    }

    /* v3.14 經典卡片樣式 */
    .kpi-card {
        background-color: #ffffff;
        border-radius: 10px;
        padding: 20px;
        margin: 10px 0;
        box-shadow: 0 4px 6px rgba(0,0,0,0.1);
        text-align: center;
        border: 1px solid #ddd;
    }
    .kpi-title { color: #666; font-size: 0.9rem; font-weight: 500; margin-bottom: 5px; }
    .kpi-value { color: #333; font-size: 1.8rem; font-weight: 700; margin-bottom: 5px; }
    .kpi-desc { color: #888; font-size: 0.8rem; }
    
    /* Header Container Style */
    [data-testid="stHeader"] { z-index: 0; }

    /* ==================== File Uploader Clean UI (v4.00 Stable) ==================== */
    /* 1. 隱藏預設文字與圖示 (Drag & Drop, Limits...) */
    [data-testid="stFileUploader"] section > div > div > span, 
    [data-testid="stFileUploader"] section > div > div > small {
        display: none !important;
    }
    
    /* 2. 關鍵：隱藏上傳後顯示的檔案列表與刪除按鈕 */
    [data-testid="stFileUploader"] ul {
        display: none !important;
    }
    
    /* 3. 移除拖曳區背景與邊框，高度壓縮，只留按鈕 */
    [data-testid="stFileUploader"] section {
        padding: 0px !important;
        min-height: 0px !important;
        background-color: transparent !important;
        border: none !important;
        margin-bottom: 0px !important;
    }
    
    /* 4. 調整 "Browse files" 按鈕為滿版 */
    [data-testid="stFileUploader"] button {
        width: 100% !important;
        margin-top: 0px;
        border: 1px solid rgba(49, 51, 63, 0.2);
        border-radius: 8px !important;
        background-color: white;
        position: relative;
        padding: 0.25rem 0.5rem;
        min-height: 2.5rem;
        line-height: 1.6;
    }

    /* 5. 植入新文字 "📂 載入專案" (偽裝) */
    [data-testid="stFileUploader"] button::after {
        content: "📂 載入專案";
        color: rgb(49, 51, 63);
        position: absolute;
        left: 50%;
        top: 50%;
        transform: translate(-50%, -50%);
        font-size: 14px;
        font-weight: 600 !important;
        width: 100%;
        text-align: center;
        pointer-events: none;
    }
    
    /* 隱藏原生文字 */
    [data-testid="stFileUploader"] button {
        color: transparent !important;
    }

    /* 6. Hover 效果 */
    [data-testid="stFileUploader"] button:hover {
        border-color: #ff4b4b !important;
        color: transparent !important;
    }
    [data-testid="stFileUploader"] button:hover::after {
        color: #ff4b4b !important;
    }
    [data-testid="stFileUploader"] button:active {
        background-color: #ff4b4b !important;
        border-color: #ff4b4b !important;
    }
    [data-testid="stFileUploader"] button:active::after {
        color: white !important;
    }

</style>
""", unsafe_allow_html=True)

# [UI] 頂部布局
col_header_L, col_header_R = st.columns([1.8, 1.2])

with col_header_L:
    st.markdown(f"""
        <div style="padding-top: 10px;">
            <h1 style='margin:0; background: -webkit-linear-gradient(45deg, #007CF0, #00DFD8); -webkit-background-clip: text; -webkit-text-fill-color: transparent; font-weight: 900; font-size: 2.5rem;'>
            📡 5G RRU 體積估算引擎 <span style='font-size: 20px; color: #888; -webkit-text-fill-color: #888;'>Pro</span>
            </h1>
            <div style='color: #666; font-size: 14px; margin-top: 5px;'>
                High-Performance Thermal Calculation System 
                <span style="color: #bbb; margin-left: 10px;">| {APP_VERSION} ({UPDATE_DATE})</span>
            </div>
        </div>
    """, unsafe_allow_html=True)

with col_header_R:
    # 專案存取控制台 (外框)
    with st.container(border=True):
        # 左右兩大欄
        c_p1, c_p2 = st.columns(2, gap="small")
        
        # 標題樣式
        header_style = "font-size: 0.9rem; font-weight: 700; color: #333; margin-bottom: 2px;"

        with c_p1:
            st.markdown(f"<div style='{header_style}'>專案存取 (Project I/O)</div>", unsafe_allow_html=True)
            
            # [UI v4.00] 判斷是否載入專案檔，顯示對應訊息
            if st.session_state.get('current_project_name'):
                # 藍色粗體顯示載入的檔名
                file_display = f"📄 {st.session_state['current_project_name']}"
                st.markdown(f"<div style='font-size: 0.8rem; color: #007CF0; font-weight: 600; margin-top: 5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;' title='{file_display}'>{file_display}</div>", unsafe_allow_html=True)
            else:
                # 顯示預設設定檔狀態
                st.markdown(f"<div style='font-size: 0.8rem; color: #555; margin-top: 5px;'>{config_loaded_msg}</div>", unsafe_allow_html=True)
            
        with c_p2:
            # 檔案上傳按鈕 (CSS 已偽裝成 "📂 載入專案" 按鈕)
            st.markdown(f"<div style='height: 2px;'></div>", unsafe_allow_html=True)
            uploaded_proj = st.file_uploader("📂 載入專案", type=["json"], key="project_loader", label_visibility="collapsed")
            
        if uploaded_proj is not None:
            if uploaded_proj != st.session_state['last_loaded_file']:
                try:
                    data = json.load(uploaded_proj)
                    if 'global_params' in data:
                        for k, v in data['global_params'].items():
                            st.session_state[k] = v
                    if 'components_data' in data:
                        new_df = pd.DataFrame(data['components_data'])
                        st.session_state['df_initial'] = new_df
                        st.session_state['df_current'] = new_df.copy()
                        st.session_state['editor_key'] += 1
                    
                    st.session_state['last_loaded_file'] = uploaded_proj
                    # 記錄檔名
                    st.session_state['current_project_name'] = uploaded_proj.name
                    
                    st.toast("✅ 專案載入成功！", icon="📂")
                    time.sleep(0.5)
                    st.rerun()
                except Exception as e:
                    st.error(f"Error: {e}")
        
        st.markdown("<hr style='margin: 8px 0;'>", unsafe_allow_html=True)
        
        # 2. 存檔 (Save) - 使用 Placeholder 佔位
        project_io_save_placeholder = st.empty()

st.markdown("<hr style='margin-top: 5px; margin-bottom: 20px;'>", unsafe_allow_html=True)


# ==================================================
# 1. 側邊欄 (參數設定)
# ==================================================
st.sidebar.header("🛠️ 參數控制台")

# --- 參數設定區 (綁定 on_change=reset_download_state + 讀取 value) ---
with st.sidebar.expander("1. 環境與係數", expanded=True):
    T_amb = st.number_input("環境溫度 (°C)", step=1.0, key="T_amb", value=st.session_state['T_amb'], on_change=reset_download_state)
    Margin = st.number_input("設計安全係數 (Margin)", step=0.1, key="Margin", value=st.session_state['Margin'], on_change=reset_download_state)
    Slope = 0.03 
    
    fin_tech = st.selectbox(
        "🔨 鰭片製程 (Fin Tech)", 
        ["Embedded Fin (0.95)", "Die-casting Fin (0.90)"],
        key="fin_tech_selector_v2",
        on_change=reset_download_state
    )
    
    if "Embedded" in fin_tech:
        Eff = 0.95
    else:
        Eff = 0.90
    st.caption(f"目前設定效率 (Eff): **{Eff}**")

with st.sidebar.expander("2. PCB 與 機構尺寸", expanded=True):
    L_pcb = st.number_input("PCB 長度 (mm)", key="L_pcb", value=st.session_state['L_pcb'], on_change=reset_download_state)
    W_pcb = st.number_input("PCB 寬度 (mm)", key="W_pcb", value=st.session_state['W_pcb'], on_change=reset_download_state)
    t_base = st.number_input("散熱器基板厚 (mm)", key="t_base", value=st.session_state['t_base'], on_change=reset_download_state)
    H_shield = st.number_input("HSK內腔深度 (mm)", key="H_shield", value=st.session_state['H_shield'], on_change=reset_download_state)
    H_filter = st.number_input("Cavity Filter 厚度 (mm)", key="H_filter", value=st.session_state['H_filter'], on_change=reset_download_state)
    
    # 重量參數
    st.caption("⚖️ 重量估算參數")
    al_density = st.number_input("鋁材密度 (g/cm³)", step=0.01, key="al_density", value=st.session_state['al_density'], on_change=reset_download_state, help="Heatsink + Shield 用；壓鑄略調低")
    filter_density = st.number_input("Cavity Filter (g/cm³)", step=0.05, key="filter_density", value=st.session_state['filter_density'], on_change=reset_download_state, help="實測校正 ≈0.97–1.05")
    shielding_density = st.number_input("Shielding (g/cm³)", step=0.05, key="shielding_density", value=st.session_state['shielding_density'], on_change=reset_download_state, help="實測 0.758；固定高度 12 mm")
    pcb_surface_density = st.number_input("PCB 面密度 (g/cm²)", step=0.05, key="pcb_surface_density", value=st.session_state['pcb_surface_density'], on_change=reset_download_state, help="含 SMT；實測 0.965 保守調低")

    st.markdown("---")
    st.caption("📏 PCB板離外殼邊距(防水)")
    m1, m2 = st.columns(2)
    Top = m1.number_input("Top (mm)", step=1.0, key="Top", value=st.session_state['Top'], on_change=reset_download_state)
    Btm = m2.number_input("Bottom (mm)", step=1.0, key="Btm", value=st.session_state['Btm'], on_change=reset_download_state)
    m3, m4 = st.columns(2)
    Left = m3.number_input("Left (mm)", step=1.0, key="Left", value=st.session_state['Left'], on_change=reset_download_state)
    Right = m4.number_input("Right (mm)", step=1.0, key="Right", value=st.session_state['Right'], on_change=reset_download_state)
    
    st.markdown("---")
    st.caption("🔶 Final PA 銅塊設定")
    c1, c2 = st.columns(2)
    Coin_L_Setting = c1.number_input("銅塊長 (mm)", step=1.0, key="Coin_L_Setting", value=st.session_state['Coin_L_Setting'], on_change=reset_download_state)
    Coin_W_Setting = c2.number_input("銅塊寬 (mm)", step=1.0, key="Coin_W_Setting", value=st.session_state['Coin_W_Setting'], on_change=reset_download_state)

    st.markdown("---")
    st.caption("🌊 鰭片幾何")
    c_fin1, c_fin2 = st.columns(2)
    Gap = c_fin1.number_input("鰭片air gap (mm)", step=0.1, key="Gap", value=st.session_state['Gap'], on_change=reset_download_state)
    Fin_t = c_fin2.number_input("鰭片厚度 (mm)", step=0.1, key="Fin_t", value=st.session_state['Fin_t'], on_change=reset_download_state)

    # [Core] h 值自動計算
    h_conv = 6.4 * np.tanh(Gap / 7.0)
    if Gap >= 10.0:
        rad_factor = 1.0
    else:
        rad_factor = np.sqrt(Gap / 10.0)
    h_rad = 2.4 * rad_factor
    h_value = h_conv + h_rad
    
    if h_conv < 4.0:
        st.error(f"🔥 **h_conv 過低警告: {h_conv:.2f}** (對流受阻，建議 ≥ 4.0)")
    else:
        st.info(f"🔥 **自動計算 h: {h_value:.2f}**\n\n(h_conv: {h_conv:.2f} + h_rad: {h_rad:.2f})")
    
    st.caption("✅ **設計建議：** h_conv 應 ≥ 4.0")
    ar_status_box = st.empty()

with st.sidebar.expander("3. 材料參數 (含 Via K值)", expanded=False):
    c1, c2 = st.columns(2)
    K_Via = c1.number_input("Via 等效 K值", key="K_Via", value=st.session_state['K_Via'], on_change=reset_download_state)
    Via_Eff = c2.number_input("Via 製程係數", key="Via_Eff", value=st.session_state['Via_Eff'], on_change=reset_download_state)
    st.markdown("---") 
    st.caption("🔷 熱介面材料 (TIM)")
    c3, c4 = st.columns(2)
    K_Putty = c3.number_input("K (Putty)", key="K_Putty", value=st.session_state['K_Putty'], on_change=reset_download_state)
    t_Putty = c4.number_input("t (Putty)", key="t_Putty", value=st.session_state['t_Putty'], on_change=reset_download_state)
    c5, c6 = st.columns(2)
    K_Pad = c5.number_input("K (Pad)", key="K_Pad", value=st.session_state['K_Pad'], on_change=reset_download_state)
    t_Pad = c6.number_input("t (Pad)", key="t_Pad", value=st.session_state['t_Pad'], on_change=reset_download_state)
    c7, c8 = st.columns(2)
    K_Grease = c7.number_input("K (Grease)", key="K_Grease", value=st.session_state['K_Grease'], on_change=reset_download_state)
    t_Grease = c8.number_input("t (Grease)", format="%.3f", key="t_Grease", value=st.session_state['t_Grease'], on_change=reset_download_state)
    st.markdown("---") 
    st.markdown("**🔘 Solder (錫片)**") 
    c9, c10 = st.columns(2)
    K_Solder = c9.number_input("K (錫片)", key="K_Solder", value=st.session_state['K_Solder'], on_change=reset_download_state)
    t_Solder = c10.number_input("t (錫片)", key="t_Solder", value=st.session_state['t_Solder'], on_change=reset_download_state)
    Voiding = st.number_input("錫片空洞率 (Voiding)", key="Voiding", value=st.session_state['Voiding'], on_change=reset_download_state)

# ==================================================
# 3. 分頁與邏輯
# ==================================================
tab_input, tab_data, tab_viz, tab_3d = st.tabs([
    "📝 COMPONENT SETUP (元件設定)", 
    "🔢 DETAILED ANALYSIS (詳細分析)", 
    "📊 VISUAL REPORT (視覺化報告)", 
    "🧊 3D SIMULATION (3D 模擬視圖)"
])

# --- Tab 1: 輸入介面 ---
with tab_input:
    st.subheader("🔥 元件熱源清單設定")
    st.caption("💡 **提示：將滑鼠游標停留在表格的「欄位標題」上，即可查看詳細的名詞解釋與定義。**")

    # [Fix] 使用 df_initial (穩定源)
    edited_df = st.data_editor(
        st.session_state['df_initial'],
        column_config={
            "Component": st.column_config.TextColumn("元件名稱", help="元件型號或代號 (如 PA, FPGA)", width="medium"),
            "Qty": st.column_config.NumberColumn("數量", help="該元件的使用數量", min_value=0, step=1, width="small"),
            "Power(W)": st.column_config.NumberColumn("單顆功耗 (W)", help="單一顆元件的發熱瓦數 (TDP)", format="%.2f", min_value=0.0, step=0.01),
            "Height(mm)": st.column_config.NumberColumn("高度 (mm)", help="元件距離 PCB 底部的垂直高度。高度越高，局部環溫 (Local Amb) 越高。", format="%.2f"),
            "Pad_L": st.column_config.NumberColumn("Pad 長 (mm)", help="元件底部散熱焊盤 (E-pad) 的長度", format="%.2f"),
            "Pad_W": st.column_config.NumberColumn("Pad 寬 (mm)", help="元件底部散熱焊盤 (E-pad) 的寬度", format="%.2f"),
            "Thick(mm)": st.column_config.NumberColumn("板厚 (mm)", help="熱需傳導穿過的 PCB 或銅塊 (Coin) 厚度", format="%.2f"),
            "Board_Type": st.column_config.SelectboxColumn("元件導熱方式", help="元件導熱到HSK表面的方式(thermal via或銅塊)", options=["Thermal Via", "Copper Coin", "None"], width="medium"),
            # [修正] 移除 Solder 選項
            "TIM_Type": st.column_config.SelectboxColumn("介面材料", help="元件或銅塊底部與散熱器之間的TIM", options=["Grease", "Pad", "Putty", "None"], width="medium"),
            "R_jc": st.column_config.NumberColumn("熱阻 Rjc", help="結點到殼的內部熱阻", format="%.2f"),
            "Limit(C)": st.column_config.NumberColumn("限溫 (°C)", help="元件允許最高運作溫度", format="%.2f")
        },
        num_rows="dynamic",
        use_container_width=True,
        key=f"editor_{st.session_state['editor_key']}",
        on_change=reset_download_state # [Fix] 表格變動也會觸發下載按鈕重置
    )
    
    # [Fix] 實時更新 df_current
    st.session_state['df_current'] = edited_df

# ==================================================
# # 核心計算函數 (Refactored for Maintainability)
# ==================================================
def calc_h_value(Gap):
    """計算 h_conv, h_rad, h_value"""
    h_conv = 6.4 * np.tanh(Gap / 7.0)
    if Gap >= 10.0:
        rad_factor = 1.0
    else:
        rad_factor = np.sqrt(Gap / 10.0)
    h_rad = 2.4 * rad_factor
    h_value = h_conv + h_rad
    return h_value, h_conv, h_rad

def calc_fin_count(W_hsk, Gap, Fin_t):
    """植樹原理計算最大鰭片數"""
    if Gap + Fin_t > 0:
        num_fins_float = (W_hsk + Gap) / (Gap + Fin_t)
        num_fins_int = int(num_fins_float)
        if num_fins_int > 0:
            total_width = num_fins_int * Fin_t + (num_fins_int - 1) * Gap
            while total_width > W_hsk and num_fins_int > 0:
                num_fins_int -= 1
                total_width = num_fins_int * Fin_t + (num_fins_int - 1) * Gap
    else:
        num_fins_int = 0
    return num_fins_int

# [Restore] 補回敏感度分析所需的核心計算函數
def compute_key_results(global_params, df_components):
    """
    獨立計算核心結果，不依賴 Streamlit session_state
    返回 dict 包含關鍵 KPI
    """
    # 複製參數，避免修改原始
    p = global_params.copy()
    df = df_components.copy()
    
    # 準備 globals_dict 給 calc_thermal_resistance 使用
    g_for_calc = p.copy()
    g_for_calc['tim_props'] = {
        "Solder": {"k": p["K_Solder"], "t": p["t_Solder"]},
        "Grease": {"k": p["K_Grease"], "t": p["t_Grease"]},
        "Pad": {"k": p["K_Pad"], "t": p["t_Pad"]},
        "Putty": {"k": p["K_Putty"], "t": p["t_Putty"]},
        "None": {"k": 1, "t": 0}
    }
    
    # === 熱阻與溫降計算 ===
    if not df.empty:
        # 使用既有的單行計算函數
        calc_results = df.apply(lambda row: calc_thermal_resistance(row, g_for_calc), axis=1)
        calc_results.columns = ['Base_L', 'Base_W', 'Loc_Amb', 'R_int', 'R_TIM', 'Total_W', 'Drop', 'Allowed_dT']
        df = pd.concat([df, calc_results], axis=1)
        
        df["Allowed_dT"] = df["Allowed_dT"].clip(lower=0)
        Total_Power = (df["Power(W)"] * df["Qty"]).sum() * p["Margin"]
        Min_dT_Allowed = df["Allowed_dT"].min()
        if not pd.isna(df["Allowed_dT"].idxmin()):
            Bottleneck_Name = df.loc[df["Allowed_dT"].idxmin(), "Component"]
        else:
             Bottleneck_Name = "None"
    else:
        Total_Power = 0
        Min_dT_Allowed = 50
        Bottleneck_Name = "None"

    # === h 值 ===
    h_value, h_conv, h_rad = calc_h_value(p["Gap"])
        
    # === 鰭片高度與尺寸 ===
    L_hsk = p["L_pcb"] + p["Left"] + p["Right"]
    W_hsk = p["W_pcb"] + p["Top"] + p["Btm"]
    base_area_m2 = (L_hsk * W_hsk) / 1e6
    
    num_fins_int = calc_fin_count(W_hsk, p["Gap"], p["Fin_t"])
    
    # === 所需面積 ===
    eff = 0.95 if "Embedded" in p["fin_tech_selector_v2"] else 0.90
    
    if Total_Power > 0 and Min_dT_Allowed > 0:
        Area_req = 1 / (h_value * (Min_dT_Allowed / Total_Power) * eff)
        try:
             Fin_Height = ((Area_req - base_area_m2) * 1e6) / (2 * num_fins_int * L_hsk)
        except:
             Fin_Height = 0
    else:
        Area_req = 0
        Fin_Height = 0
        
    # === 體積與重量 ===
    RRU_Height = p["H_shield"] + p["H_filter"] + p["t_base"] + Fin_Height
    Volume_L = round(L_hsk * W_hsk * RRU_Height / 1e6 / 1000, 2)
    
    # 重量計算 (包含所有部件)
    base_vol_cm3 = L_hsk * W_hsk * p["t_base"] / 1000
    fins_vol_cm3 = num_fins_int * p["Fin_t"] * Fin_Height * L_hsk / 1000
    hs_weight_kg = (base_vol_cm3 + fins_vol_cm3) * p["al_density"] / 1000
    
    shield_outer_vol_cm3 = L_hsk * W_hsk * p["H_shield"] / 1000
    shield_inner_vol_cm3 = p["L_pcb"] * p["W_pcb"] * p["H_shield"] / 1000
    shield_vol_cm3 = max(shield_outer_vol_cm3 - shield_inner_vol_cm3, 0)
    shield_weight_kg = shield_vol_cm3 * p["al_density"] / 1000
    
    filter_vol_cm3 = L_hsk * W_hsk * p["H_filter"] / 1000
    filter_weight_kg = filter_vol_cm3 * p["filter_density"] / 1000
    
    shielding_height_cm = 1.2
    shielding_area_cm2 = p["L_pcb"] * p["W_pcb"] / 100
    shielding_vol_cm3 = shielding_area_cm2 * shielding_height_cm
    shielding_weight_kg = shielding_vol_cm3 * p["shielding_density"] / 1000
    
    pcb_area_cm2 = p["L_pcb"] * p["W_pcb"] / 100
    pcb_weight_kg = pcb_area_cm2 * p["pcb_surface_density"] / 1000
    
    cavity_weight_kg = filter_weight_kg + shield_weight_kg + shielding_weight_kg + pcb_weight_kg
    total_weight_kg = hs_weight_kg + cavity_weight_kg
    
    return {
        "Total_Power": round(Total_Power, 2),
        "Min_dT_Allowed": round(Min_dT_Allowed, 2),
        "Bottleneck_Name": Bottleneck_Name,
        "Area_req": round(Area_req, 3),
        "Fin_Height": round(Fin_Height, 2),
        "Volume_L": Volume_L,
        "total_weight_kg": round(total_weight_kg, 2),
        "h_value": round(h_value, 2)
    }

def calc_thermal_resistance(row, g):
    """單行元件熱阻計算 (取代原本 apply_excel_formulas)"""
    # 從 g (globals_dict) 取出需要的全域變數
    if row['Component'] == "Final PA":
        base_l, base_w = g['Coin_L_Setting'], g['Coin_W_Setting']
    elif row['Power(W)'] == 0 or row['Thick(mm)'] == 0:
        base_l, base_w = 0.0, 0.0
    else:
        base_l, base_w = row['Pad_L'] + row['Thick(mm)'], row['Pad_W'] + row['Thick(mm)']
        
    loc_amb = g['T_amb'] + (row['Height(mm)'] * g['Slope'])
    
    if row['Board_Type'] == "Copper Coin":
        k_board = 380.0
    elif row['Board_Type'] == "Thermal Via":
        k_board = g['K_Via']
    else:
        k_board = 0.0

    pad_area = (row['Pad_L'] * row['Pad_W']) / 1e6
    base_area = (base_l * base_w) / 1e6
    
    if k_board > 0 and pad_area > 0:
        eff_area = np.sqrt(pad_area * base_area) if base_area > 0 else pad_area
        r_int_val = (row['Thick(mm)']/1000) / (k_board * eff_area)
        if row['Component'] == "Final PA":
            r_int = r_int_val + ((g['t_Solder']/1000) / (g['K_Solder'] * pad_area * g['Voiding']))
        elif row['Board_Type'] == "Thermal Via":
            r_int = r_int_val / g['Via_Eff']
        else:
            r_int = r_int_val
    else:
        r_int = 0
        
    tim = g['tim_props'].get(row['TIM_Type'], {"k":1, "t":0})
    target_area = base_area if base_area > 0 else pad_area
    if target_area > 0 and tim['t'] > 0:
        r_tim = (tim['t']/1000) / (tim['k'] * target_area)
    else:
        r_tim = 0
        
    total_w = row['Qty'] * row['Power(W)']
    drop = row['Power(W)'] * (row['R_jc'] + r_int + r_tim)
    allowed_dt = row['Limit(C)'] - drop - loc_amb
    return pd.Series([base_l, base_w, loc_amb, r_int, r_tim, total_w, drop, allowed_dt])

# --- 後台運算 (Refactored) ---
globals_dict = {
    'T_amb': T_amb, 'Slope': Slope,
    'Coin_L_Setting': Coin_L_Setting, 'Coin_W_Setting': Coin_W_Setting,
    'K_Via': K_Via, 'Via_Eff': Via_Eff,
    'K_Solder': K_Solder, 't_Solder': t_Solder, 'Voiding': Voiding,
}
tim_props = {
    "Solder": {"k": K_Solder, "t": t_Solder},
    "Grease": {"k": K_Grease, "t": t_Grease},
    "Pad": {"k": K_Pad, "t": t_Pad},
    "Putty": {"k": K_Putty, "t": t_Putty},
    "None": {"k": 1, "t": 0}
}
globals_dict['tim_props'] = tim_props

# 元件熱阻計算
if not edited_df.empty:
    calc_results = edited_df.apply(lambda row: calc_thermal_resistance(row, globals_dict), axis=1)
    calc_results.columns = ['Base_L', 'Base_W', 'Loc_Amb', 'R_int', 'R_TIM', 'Total_W', 'Drop', 'Allowed_dT']
    final_df = pd.concat([edited_df, calc_results], axis=1)
else:
    final_df = pd.DataFrame()

# 總功耗與瓶頸
valid_rows = final_df[final_df['Total_W'] > 0].copy()
if not valid_rows.empty:
    Total_Watts_Sum = valid_rows['Total_W'].sum()
    Min_dT_Allowed = valid_rows['Allowed_dT'].min()
    Bottleneck_Name = valid_rows.loc[valid_rows['Allowed_dT'].idxmin()]['Component'] if not pd.isna(valid_rows['Allowed_dT'].idxmin()) else "None"
else:
    Total_Watts_Sum = 0; Min_dT_Allowed = 50; Bottleneck_Name = "None"

L_hsk, W_hsk = L_pcb + Top + Btm, W_pcb + Left + Right

# 核心計算呼叫
h_value, h_conv, h_rad = calc_h_value(Gap)
num_fins_int = calc_fin_count(W_hsk, Gap, Fin_t)
Fin_Count = num_fins_int

Total_Power = Total_Watts_Sum * Margin
if Total_Power > 0 and Min_dT_Allowed > 0:
    R_sa = Min_dT_Allowed / Total_Power
    Area_req = 1 / (h_value * R_sa * Eff)
    Base_Area_m2 = (L_hsk * W_hsk) / 1e6
    try:
        Fin_Height = ((Area_req - Base_Area_m2) * 1e6) / (2 * Fin_Count * L_hsk)
    except:
        Fin_Height = 0
    RRU_Height = t_base + Fin_Height + H_shield + H_filter
    Volume_L = (L_hsk * W_hsk * RRU_Height) / 1e6
    
    # [v3.84] 重量計算
    base_vol_cm3 = L_hsk * W_hsk * t_base / 1000
    fins_vol_cm3 = num_fins_int * Fin_t * Fin_Height * L_hsk / 1000
    hs_weight_kg = (base_vol_cm3 + fins_vol_cm3) * al_density / 1000
    
    shield_outer_vol_cm3 = L_hsk * W_hsk * H_shield / 1000
    shield_inner_vol_cm3 = L_pcb * W_pcb * H_shield / 1000
    shield_vol_cm3 = max(shield_outer_vol_cm3 - shield_inner_vol_cm3, 0)
    shield_weight_kg = shield_vol_cm3 * al_density / 1000
    
    filter_vol_cm3 = L_hsk * W_hsk * H_filter / 1000
    filter_weight_kg = filter_vol_cm3 * filter_density / 1000
    
    shielding_height_cm = 1.2
    shielding_area_cm2 = L_pcb * W_pcb / 100
    shielding_vol_cm3 = shielding_area_cm2 * shielding_height_cm
    shielding_weight_kg = shielding_vol_cm3 * shielding_density / 1000
    
    pcb_area_cm2 = L_pcb * W_pcb / 100
    pcb_weight_kg = pcb_area_cm2 * pcb_surface_density / 1000
    
    cavity_weight_kg = filter_weight_kg + shield_weight_kg + shielding_weight_kg + pcb_weight_kg
    total_weight_kg = hs_weight_kg + cavity_weight_kg

else:
    R_sa = 0; Area_req = 0; Fin_Height = 0; RRU_Height = 0; Volume_L = 0
    # [Fix NameError] 必須初始化重量變數
    total_weight_kg = 0; hs_weight_kg = 0; shield_weight_kg = 0
    filter_weight_kg = 0; shielding_weight_kg = 0; pcb_weight_kg = 0

# ==================================================
# 3. 分頁與邏輯
# ==================================================
# [Restore] Tabs 擴充為 5 頁籤
tab_input, tab_data, tab_viz, tab_3d, tab_sensitivity = st.tabs([
    "📝 COMPONENT SETUP (元件設定)", 
    "🔢 DETAILED ANALYSIS (詳細分析)", 
    "📊 VISUAL REPORT (視覺化報告)", 
    "🧊 3D SIMULATION (3D 模擬視圖)",
    "📈 SENSITIVITY ANALYSIS (敏感度分析)"
])

# --- Tab 1: 輸入介面 ---
with tab_input:
if aspect_ratio > 12.0:
    ar_color = "#e74c3c" # Red
    ar_msg = "過高 (High)"
else:
    ar_color = "#00b894" # Green
    ar_msg = "良好 (Good)"

if Fin_Height > 0:
    ar_status_box.markdown(f"""
    <div style="border: 1px solid #ddd; padding: 10px; border-radius: 5px; margin-top: 10px; background-color: white;">
        <small style="color: #666;">📐 流阻比 (Aspect Ratio)</small><br>
        <strong style="color: {ar_color}; font-size: 1.2rem;">{aspect_ratio:.1f}</strong> 
        <span style="color: {ar_color};">({ar_msg})</span><br>
        <small style="color: #888;">✅ 最佳建議： 4.5 ~ 6.5</small><br>
        <small style="color: #999; font-size: 0.8em;">(建議值內，無風AR往低趨勢設計，反之亦然)</small>
    </div>
    """, unsafe_allow_html=True)
else:
    ar_status_box.info("等待計算 Aspect Ratio...")

if aspect_ratio > 12.0:
    drc_failed = True
    drc_msg = f"⛔ **設計無效 (Choked Flow)：** 流阻比 (高/寬) 達 {aspect_ratio:.1f} (上限 12)。\n鰭片太深且太密，空氣滯留無法流動，請降低高度或增大間距。"
elif h_conv < 4.0:
    drc_failed = True
    drc_msg = f"⛔ **設計無效 (Step 3 - Poor Convection)：** 有效對流係數 h_conv 僅 {h_conv:.2f} (目標 >= 4.0)。\nGap 過小導致風阻過大，散熱效率極低。請增大 Air Gap。"
elif Gap < 4.0:
    drc_failed = True
    drc_msg = f"⛔ **設計無效 (Gap Too Small)：** 鰭片間距 {Gap}mm 小於物理極限 (4mm)。\n邊界層完全重疊，自然對流失效。"
elif "Embedded" in fin_tech and Fin_Height > 100.0:
    drc_failed = True
    drc_msg = f"⛔ **製程限制 (Process Limit)：** Embedded Fin (埋入式鰭片) 製程高度限制需 < 100mm (目前計算值: {Fin_Height:.1f}mm)。\n此高度已超過製程極限，建議增加設備的X/Y方向面積來讓Z方向面積增加。"

# --- Tab 2: 詳細數據 (表二) ---
with tab_data:
    st.subheader("🔢 DETAILED ANALYSIS (詳細分析)")
    st.caption("💡 **提示：將滑鼠游標停留在表格的「欄位標題」上，即可查看詳細的名詞解釋與定義。**")
    
    if not final_df.empty:
        # [v4.10] 篩選顯示欄位 (隱藏基礎尺寸參數，保留熱流關鍵數據)
        cols_to_hide = ["Qty", "Power(W)", "Height(mm)", "Pad_L", "Pad_W", "Thick(mm)", "Base_L", "Base_W"]
        # 確保只移除存在的欄位，建立一個新的顯示用 DataFrame
        df_display = final_df.drop(columns=[c for c in cols_to_hide if c in final_df.columns])

        min_val = final_df['Allowed_dT'].min()
        max_val = final_df['Allowed_dT'].max()
        mid_val = (min_val + max_val) / 2
        
        # [修改] 使用 df_display 進行樣式設定
        styled_df = df_display.style.background_gradient(
            subset=['Allowed_dT'], 
            cmap='RdYlGn'
        ).format({
            "R_int": "{:.4f}", "R_TIM": "{:.4f}", "Allowed_dT": "{:.2f}"
        })
        
        # [修正 v3.66] 還原完整的 Help 說明 (包含物理公式)
        # 這裡保留完整的 config 沒關係，Streamlit 會自動忽略不存在的欄位設定
        st.dataframe(
            styled_df, 
            column_config={
                "Component": st.column_config.TextColumn("元件名稱", help="元件型號或代號 (如 PA, FPGA)", width="medium"),
                "Qty": st.column_config.NumberColumn("數量", help="該元件的使用數量"),
                "Power(W)": st.column_config.NumberColumn("單顆功耗 (W)", help="單一顆元件的發熱瓦數 (TDP)", format="%.1f"),
                "Height(mm)": st.column_config.NumberColumn("高度 (mm)", help="元件距離 PCB 底部的垂直高度。高度越高，局部環溫 (Local Amb) 越高。公式：全域環溫 + (元件高度 × 0.03)", format="%.1f"),
                "Pad_L": st.column_config.NumberColumn("Pad 長 (mm)", help="元件底部散熱焊盤 (E-pad) 的長度", format="%.1f"),
                "Pad_W": st.column_config.NumberColumn("Pad 寬 (mm)", help="元件底部散熱焊盤 (E-pad) 的寬度", format="%.1f"),
                "Thick(mm)": st.column_config.NumberColumn("板厚 (mm)", help="熱需傳導穿過的 PCB 或銅塊 (Coin) 厚度", format="%.1f"),
                "R_jc": st.column_config.NumberColumn("Rjc", help="結點到殼的內部熱阻", format="%.2f"),
                "Limit(C)": st.column_config.NumberColumn("限溫 (°C)", help="元件允許最高運作溫度", format="%.1f"),
                
                # 計算欄位 - 完整公式說明
                "Base_L": st.column_config.NumberColumn("Base 長 (mm)", help="熱量擴散後的底部有效長度。Final PA 為銅塊設定值；一般元件為 Pad + 板厚。", format="%.1f"),
                "Base_W": st.column_config.NumberColumn("Base 寬 (mm)", help="熱量擴散後的底部有效寬度。Final PA 為銅塊設定值；一般元件為 Pad + 板厚。", format="%.1f"),
                "Loc_Amb": st.column_config.NumberColumn("局部環溫 (°C)", help="該元件高度處的環境溫度。公式：全域環溫 + (元件高度 × 0.03)。", format="%.1f"),
                "Drop": st.column_config.NumberColumn("內部溫降 (°C)", help="熱量從晶片核心傳導到散熱器表面的溫差。公式：Power × (Rjc + Rint + Rtim)。", format="%.1f"),
                "Total_W": st.column_config.NumberColumn("總功耗 (W)", help="該元件的總發熱量 (單顆功耗 × 數量)。", format="%.1f"),
                "Allowed_dT": st.column_config.NumberColumn("允許溫升 (°C)", help="散熱器剩餘可用的溫升裕度。數值越小代表該元件越容易過熱 (瓶頸)。公式：Limit - Loc_Amb - Drop。", format="%.2f"),
                "R_int": st.column_config.NumberColumn("基板熱阻 (°C/W)", help="元件穿過 PCB (Via) 或銅塊 (Coin) 傳導至底部的熱阻值。", format="%.4f"),
                "R_TIM": st.column_config.NumberColumn("介面熱阻 (°C/W)", help="元件或銅塊底部與散熱器之間的接觸熱阻 (由 TIM 材料與面積決定)。", format="%.4f"),
                
                # [修正 v3.67] 名詞一致化
                "Board_Type": st.column_config.Column("元件導熱方式", help="元件導熱到HSK表面的方式(thermal via或銅塊)"),
                "TIM_Type": st.column_config.Column("介面材料", help="元件或銅塊底部與散熱器之間的TIM")
            },
            use_container_width=True, 
            hide_index=True
        )
        
        # 只有當 'Allowed_dT' 有顯示時，才顯示下方的 Scale Bar 與說明
        if 'Allowed_dT' in df_display.columns:
            st.markdown(f"""
            <div style="display: flex; flex-direction: column; align-items: center; margin: 15px 0;">
                <div style="font-weight: bold; margin-bottom: 5px; color: #555; font-size: 0.9rem;">允許溫升 (Allowed dT) 色階參考</div>
                <div style="width: 100%; max-width: 600px; height: 12px; background: linear-gradient(to right, #d73027, #fee08b, #1a9850); border-radius: 6px; border: 1px solid #ddd;"></div>
                <div style="display: flex; justify-content: space-between; width: 100%; max-width: 600px; color: #555; font-weight: bold; font-size: 0.8rem; margin-top: 4px;">
                    <span>{min_val:.0f}°C (Risk)</span>
                    <span>{mid_val:.0f}°C</span>
                    <span>{max_val:.0f}°C (Safe)</span>
                </div>
            </div>
            """, unsafe_allow_html=True)
            
            st.info("""
            ℹ️ **名詞解釋 - 允許溫升 (Allowed dT)** 此數值代表 **「散熱器可用的溫升裕度」** (Limit - Local Ambient - Drop)。
            * 🟩 **綠色 (數值高)**：代表散熱裕度充足，該元件不易過熱。
            * 🟥 **紅色 (數值低)**：代表散熱裕度極低，該元件是系統的熱瓶頸。
            """)

# --- Tab 3: 視覺化報告 ---
with tab_viz:
    st.subheader("📊 VISUAL REPORT (視覺化報告)")
    
    def card(col, title, value, desc, color="#333"):
        col.markdown(f"""
        <div class="kpi-card" style="border-left: 5px solid {color};">
            <div class="kpi-title">{title}</div>
            <div class="kpi-value">{value}</div>
            <div class="kpi-desc">{desc}</div>
        </div>""", unsafe_allow_html=True)

    k1, k2, k3, k4 = st.columns(4)
    # Total Power: Red (#e74c3c)
    card(k1, "整機總熱耗", f"{round(Total_Power, 2)} W", "Total Power", "#e74c3c")
    # Bottleneck: Orange (#f39c12)
    card(k2, "系統瓶頸元件", f"{Bottleneck_Name}", f"dT: {round(Min_dT_Allowed, 2)}°C", "#f39c12")
    # Area: Blue (#3498db)
    card(k3, "所需散熱面積", f"{round(Area_req, 3)} m²", "Required Area", "#3498db")
    # Fin Count: Purple (#9b59b6)
    card(k4, "預估鰭片數量", f"{int(Fin_Count)} Pcs", "Fin Count", "#9b59b6")

    st.markdown("<br>", unsafe_allow_html=True)

    if not valid_rows.empty:
        c1, c2 = st.columns(2)
        with c1:
            # 圓餅圖
            fig_pie = px.pie(valid_rows, values='Total_W', names='Component', 
                             title='<b>各元件功耗佔比 (Power Breakdown)</b>', 
                             hole=0.5,
                             color_discrete_sequence=px.colors.qualitative.Pastel)
            
            fig_pie.update_traces(
                textposition='outside', 
                textinfo='label+percent',
                marker=dict(line=dict(color='#ffffff', width=2))
            )
            
            # 設定超大 Margin，強迫標籤往左右空白處延伸
            fig_pie.update_layout(
                showlegend=False, 
                margin=dict(t=90, b=150, l=100, r=100),
                title=dict(pad=dict(b=20)),
                annotations=[
                    dict(
                        text=f"<b>{round(Total_Power, 2)} W</b><br><span style='font-size:14px; color:#888'>Total</span>", 
                        x=0.5, y=0.5, 
                        font_size=24, 
                        showarrow=False
                    )
                ]
            )
            st.plotly_chart(fig_pie, use_container_width=True)
            
        with c2:
            valid_rows_sorted = valid_rows.sort_values(by="Allowed_dT", ascending=True)
            fig_bar = px.bar(
                valid_rows_sorted, x='Component', y='Allowed_dT', 
                title='<b>各元件剩餘溫升裕度 (Thermal Budget)</b>',
                color='Allowed_dT', 
                color_continuous_scale='RdYlGn',
                labels={'Allowed_dT': '允許溫升 (°C)'}
            )
            fig_bar.update_layout(xaxis_title="元件名稱", yaxis_title="散熱器允許溫升 (°C)")
            st.plotly_chart(fig_bar, use_container_width=True)

    st.markdown("---")
    st.subheader("📏 尺寸與體積估算")
    c5, c6 = st.columns(2)
    
    if drc_failed:
        st.error(drc_msg)
        st.markdown(f"""
        <div style="display:flex; gap:20px;">
            <div style="flex:1; background:#eee; padding:20px; border-radius:10px; text-align:center; color:#999;">
                建議鰭片高度<br>N/A
            </div>
            <div style="flex:1; background:#eee; padding:20px; border-radius:10px; text-align:center; color:#999;">
                RRU 整機尺寸<br>Calculation Failed
            </div>
        </div>
        """, unsafe_allow_html=True)
        vol_bg = "#ffebee"; vol_border = "#e74c3c"; vol_title = "#c0392b"; vol_text = "N/A"
    else:
        card(c5, "建議鰭片高度", f"{round(Fin_Height, 2)} mm", "Suggested Fin Height", "#2ecc71")
        card(c6, "RRU 整機尺寸 (LxWxH)", f"{L_hsk} x {W_hsk} x {round(RRU_Height, 1)}", "Estimated Dimensions", "#34495e")
        vol_bg = "#e6fffa"; vol_border = "#00b894"; vol_title = "#006266"; vol_text = f"{round(Volume_L, 2)} L"

    st.markdown(f"""
    <div style="background-color: {vol_bg}; padding: 30px; margin-top: 20px; border-radius: 15px; border-left: 10px solid {vol_border}; box-shadow: 0 4px 15px rgba(0,0,0,0.1); text-align: center;">
        <h3 style="color: {vol_title}; margin:0; font-size: 1.4rem; letter-spacing: 1px;">★ RRU 整機估算體積 (Estimated Volume)</h3>
        <h1 style="color: {vol_border}; margin:15px 0 0 0; font-size: 4.5rem; font-weight: 800;">{vol_text}</h1>
    </div>
    """, unsafe_allow_html=True)

    # [v3.84/85 Fix] 重量顯示區塊 (僅在 DRC 通過時顯示，並確保變數安全)
    if not drc_failed:
        st.markdown(f"""
        <div style="background-color: #ecf0f1; padding: 30px; margin-top: 20px; border-radius: 15px; border-left: 10px solid #34495e; box-shadow: 0 4px 15px rgba(0,0,0,0.1); text-align: center;">
            <h3 style="color: #2c3e50; margin:0; font-size: 1.4rem; letter-spacing: 1px;">⚖️ 整機估算重量 (Estimated Weight)</h3>
            <h1 style="color: #34495e; margin:15px 0 10px 0; font-size: 3.5rem; font-weight: 800;">{round(total_weight_kg, 1)} kg</h1>
            <small style="color: #7f8c8d; line-height: 1.6;">
                Heatsink ≈ {round(hs_weight_kg, 1)} kg | Shield ≈ {round(shield_weight_kg, 1)} kg<br>
                Filter ≈ {round(filter_weight_kg, 1)} kg | Shielding Case ≈ {round(shielding_weight_kg, 1)} kg | PCB ≈ {round(pcb_weight_kg, 2)} kg
            </small>
        </div>
        """, unsafe_allow_html=True)

# --- Tab 4: 3D 模擬視圖 ---
with tab_3d:
    st.subheader("🧊 3D SIMULATION (3D 模擬視圖)")
    st.caption("模型展示：底部電子艙 + 頂部散熱鰭片、鰭片數量與間距皆為真實比例。模擬圖右上角有小功能可使用。")
    
    # [修正] 3D 圖也受 DRC 控制
    if not drc_failed and L_hsk > 0 and W_hsk > 0 and RRU_Height > 0 and Fin_Height > 0:
        fig_3d = go.Figure()
        COLOR_FINS = '#E5E7E9'; COLOR_BODY = COLOR_FINS
        LIGHTING_METAL = dict(ambient=0.5, diffuse=0.8, specular=0.5, roughness=0.1)
        LIGHTING_MATTE = dict(ambient=0.6, diffuse=0.8, specular=0.1, roughness=0.8)

        # 1. Body
        h_body = H_shield + H_filter
        fig_3d.add_trace(go.Mesh3d(
            x=[0, L_hsk, L_hsk, 0, 0, L_hsk, L_hsk, 0], y=[0, 0, W_hsk, W_hsk, 0, 0, W_hsk, W_hsk], z=[0, 0, 0, 0, h_body, h_body, h_body, h_body],
            i=[7, 0, 0, 0, 4, 4, 6, 6, 4, 0, 3, 2], j=[3, 4, 1, 2, 5, 6, 5, 2, 0, 1, 6, 3], k=[0, 7, 2, 3, 6, 7, 1, 1, 5, 5, 7, 6],
            color=COLOR_BODY, lighting=LIGHTING_MATTE, flatshading=True, name='Electronics Body'))
        
        # 2. Base
        z_base_start = h_body; z_base_end = h_body + t_base
        fig_3d.add_trace(go.Mesh3d(
            x=[0, L_hsk, L_hsk, 0, 0, L_hsk, L_hsk, 0], y=[0, 0, W_hsk, W_hsk, 0, 0, W_hsk, W_hsk], z=[z_base_start, z_base_start, z_base_start, z_base_start, z_base_end, z_base_end, z_base_end, z_base_end],
            i=[7, 0, 0, 0, 4, 4, 6, 6, 4, 0, 3, 2], j=[3, 4, 1, 2, 5, 6, 5, 2, 0, 1, 6, 3], k=[0, 7, 2, 3, 6, 7, 1, 1, 5, 5, 7, 6],
            color=COLOR_FINS, lighting=LIGHTING_METAL, flatshading=True, name='Heatsink Base'))
        
        # 3. Fins
        fin_x, fin_y, fin_z, fin_i, fin_j, fin_k = [], [], [], [], [], []
        z_fin_start, z_fin_end = z_base_end, z_base_end + Fin_Height
        if num_fins_int > 0:
            total_fin_array_width = (num_fins_int * Fin_t) + ((num_fins_int - 1) * Gap)
            y_offset = (W_hsk - total_fin_array_width) / 2
        else: y_offset = 0
            
        base_i = [7, 0, 0, 0, 4, 4, 6, 6, 4, 0, 3, 2]; base_j = [3, 4, 1, 2, 5, 6, 5, 2, 0, 1, 6, 3]; base_k = [0, 7, 2, 3, 6, 7, 1, 1, 5, 5, 7, 6]
        
        for idx in range(num_fins_int):
            y_start = y_offset + idx * (Fin_t + Gap); y_end = y_start + Fin_t
            if y_end > W_hsk: break
            current_x = [0, L_hsk, L_hsk, 0, 0, L_hsk, L_hsk, 0]; current_y = [y_start, y_start, y_end, y_end, y_start, y_start, y_end, y_end]
            current_z = [z_fin_start, z_fin_start, z_fin_start, z_fin_start, z_fin_end, z_fin_end, z_fin_end, z_fin_end]
            offset = len(fin_x)
            fin_x.extend(current_x); fin_y.extend(current_y); fin_z.extend(current_z)
            fin_i.extend([x + offset for x in base_i]); fin_j.extend([x + offset for x in base_j]); fin_k.extend([x + offset for x in base_k])

        fig_3d.add_trace(go.Mesh3d(x=fin_x, y=fin_y, z=fin_z, i=fin_i, j=fin_j, k=fin_k, color=COLOR_FINS, lighting=LIGHTING_METAL, flatshading=True, name='Fins'))
        
        # 4. Wireframe
        x_lines = [0, L_hsk, L_hsk, 0, 0, None, 0, L_hsk, L_hsk, 0, 0, None, 0, 0, None, L_hsk, L_hsk, None, L_hsk, L_hsk, None, 0, 0]
        y_lines = [0, 0, W_hsk, W_hsk, 0, None, 0, 0, W_hsk, W_hsk, 0, None, 0, 0, None, 0, 0, None, W_hsk, W_hsk, None, W_hsk, W_hsk]
        z_lines = [0, 0, 0, 0, 0, None, RRU_Height, RRU_Height, RRU_Height, RRU_Height, RRU_Height, None, 0, RRU_Height, None, 0, RRU_Height, None, 0, RRU_Height, None, 0, RRU_Height]
        fig_3d.add_trace(go.Scatter3d(x=x_lines, y=y_lines, z=z_lines, mode='lines', line=dict(color='black', width=2), showlegend=False))
        
        max_dim = max(L_hsk, W_hsk, RRU_Height) * 1.1
        fig_3d.update_layout(
            scene=dict(xaxis=dict(title='Length', range=[0, max_dim], dtick=50), yaxis=dict(title='Width', range=[0, max_dim], dtick=50), zaxis=dict(title='Height', range=[0, max_dim], dtick=50), aspectmode='manual', aspectratio=dict(x=1, y=1, z=1), camera=dict(projection=dict(type="orthographic"), eye=dict(x=1.2, y=1.2, z=1.2)), bgcolor='white'),
            margin=dict(l=0, r=0, b=0, t=0), height=600)
        st.plotly_chart(fig_3d, use_container_width=True)
        c1, c2 = st.columns(2)
        c1.info(f"📐 **外觀尺寸：** 長 {L_hsk:.1f} x 寬 {W_hsk:.1f} x 高 {RRU_Height:.1f} mm")
        c2.success(f"⚡ **鰭片規格：** 數量 {num_fins_int} pcs | 高度 {Fin_Height:.1f} mm | 厚度 {Fin_t} mm | 間距 {Gap} mm")
    
    elif drc_failed:
        st.error("🚫 因設計參數不合理 (DRC Failed)，無法生成有效模型。")
    else:
        st.warning("⚠️ 無法繪製 3D 圖形，因為計算出的尺寸無效 (為 0)。請檢查元件清單與參數設定。")

    # --- AI Section ---
    if not drc_failed:
        st.markdown("---")
        st.subheader("🎨 RRU寫實渲染生成流程(AI)")
        st.markdown("""<div style="background-color: #f8f9fa; padding: 20px; border-radius: 10px; border: 1px solid #e9ecef;"><h4 style="margin-top:0;">準備工作</h4></div>""", unsafe_allow_html=True)
        c1, c2 = st.columns([1, 1])
        with c1:
            st.markdown("#### Step 1. 下載 3D 模擬圖")
            st.info("請將滑鼠移至上方 3D 圖表的右上角，點擊相機圖示 **(Download plot as a png)** 下載目前的模型底圖。")
        with c2:
            st.markdown("#### Step 2. 下載I/O寫實參考圖")
            default_ref_bytes = None; default_ref_name = None; default_ref_type = None
            default_files = ['reference_style.png', 'reference_style.jpg', 'reference_style.jpeg']
            for filename in default_files:
                if os.path.exists(filename):
                    with open(filename, "rb") as f:
                        default_ref_bytes = f.read(); default_ref_name = filename; 
                        ext = filename.split('.')[-1].lower()
                        default_ref_type = 'image/png' if ext == 'png' else 'image/jpeg'
                    break
            if default_ref_bytes:
                st.image(default_ref_bytes, caption=f"系統預設參考圖: {default_ref_name}", width=200)
                st.download_button(label="⬇️ 下載原始高解析度圖檔", data=default_ref_bytes, file_name=default_ref_name, mime=default_ref_type, key="download_ref_img")
            else:
                st.warning("⚠️ 系統中找不到預設參考圖 (reference_style.png)。請確認檔案已上傳至 GitHub。")

        st.markdown("#### Step 3. 複製提示詞 (Prompt)")
        prompt_template = f"""
5G RRU 無線射頻單元工業設計渲染圖

核心結構（極其嚴格參照圖 1 的幾何形狀）：
請務必精確生成 {int(num_fins_int)} 片散熱鰭片。關鍵要求：這些鰭片必須是「平直、互相平行且垂直於底面」的長方形薄板結構。嚴禁生成尖刺狀、錐形或任何斜向角度的鰭片。它們必須以極高密度、線性陣列且完全等距的方式緊密排列，其形態必須與圖 1 的線框圖完全一致。鰭片的數量、形狀與分佈密度是此圖的最優先要求，請嚴格遵守第一張 3D 模擬圖的結構比例。

外觀細節與材質（參考圖 2）：
材質採用白色粉體烤漆壓鑄鋁（霧面質感）。僅在底部的 I/O 接口佈局（參考如圖二的I/O布局）或上網參考5G RRU I/O介面。

技術規格：
整體尺寸約 {L_hsk:.0f}x{W_hsk:.0f}x{RRU_Height:.0f}mm。邊緣需呈現銳利的工業感，具備真實的金屬紋理與精細的倒角（Chamfer）。

光線設定：
專業攝影棚打光，強調對比與柔和陰影。使用邊緣光（Rim Lighting）來勾勒並凸顯每一片散熱鰭片的俐落線條與間隔。

視覺規格：
一律生成3D等角視圖，且角度要和第一張模擬圖的視角角位相同（Isometric view），純白背景，8k 高解析度，照片級真實影像渲染。
        """.strip()
        user_prompt = st.text_area(label="您可以在此直接修改提示詞：", value=prompt_template, height=300)
        safe_prompt = user_prompt.replace('`', '\`')
        components.html(f"""<script>function copyToClipboard(){{const text=`{safe_prompt}`;if(navigator.clipboard&&window.isSecureContext){{navigator.clipboard.writeText(text).then(function(){{document.getElementById('status').innerHTML="✅ 已複製！";setTimeout(()=>{{document.getElementById('status').innerHTML="";}},2000)}},function(err){{fallbackCopy(text)}})}}else{{fallbackCopy(text)}}}}function fallbackCopy(text){{const textArea=document.createElement("textarea");textArea.value=text;textArea.style.position="fixed";document.body.appendChild(textArea);textArea.focus();textArea.select();try{{document.execCommand('copy');document.getElementById('status').innerHTML="✅ 已複製！"}}catch(err){{document.getElementById('status').innerHTML="❌ 複製失敗"}}document.body.removeChild(textArea);setTimeout(()=>{{document.getElementById('status').innerHTML="";}},2000)}}</script><div style="display: flex; align-items: center; font-family: 'Microsoft JhengHei', sans-serif;"><button onclick="copyToClipboard()" style="background-color: #ffffff; border: 1px solid #d1d5db; border-radius: 4px; padding: 8px 16px; font-size: 14px; cursor: pointer; color: #31333F; display: flex; align-items: center; gap: 5px; transition: all 0.2s; box-shadow: 0 1px 2px rgba(0,0,0,0.05);" onmouseover="this.style.borderColor='#ff4b4b'; this.style.color='#ff4b4b'" onmouseout="this.style.borderColor='#d1d5db'; this.style.color='#31333F'">📋 複製提示詞 (Copy Prompt)</button><span id="status" style="margin-left: 10px; color: #00b894; font-size: 14px; font-weight: bold;"></span></div>""", height=50)

        st.markdown("#### Step 4. 執行 AI 生成")
        st.success("""1. 開啟 **Gemini** 對話視窗。\n2. 確認模型設定為 **思考型 (Thinking) + Nano Banana (Imagen 3)**。\n3. 依序上傳兩張圖片 (3D 模擬圖 + 寫實參考圖)。\n4. 貼上提示詞並送出。""")

# [Restore] Tab 5: 敏感度分析 UI 內容
with tab_sensitivity:
    st.subheader("📈 敏感度分析 (Sensitivity Analysis)")
    st.markdown("""
    此功能讓您快速評估單一參數變化對整機體積、重量與熱裕度的影響。<br>
    選擇一個變數，設定變化範圍後點擊執行，即可看到趨勢圖。
    """, unsafe_allow_html=True)
    
    col1, col2 = st.columns([1, 1])
    with col1:
        var_type = st.selectbox("變數類型", ["全局參數", "元件功率"])
    with col2:
        if var_type == "全局參數":
            var_name = st.selectbox("選擇變數", ["T_amb", "Gap", "Fin_t", "Margin"])
        else:
            var_name = st.selectbox("選擇元件", ["Final PA Power(W)"])  # 未來可擴充
            
    col_range1, col_range2, col_range3 = st.columns([1, 1, 1])
    with col_range1:
        # 取得基準值
        if var_type == "全局參數":
            base_val_display = float(st.session_state.get(var_name, 0))
        else:
            base_val_display = float(st.session_state['df_current'].loc[st.session_state['df_current']["Component"] == "Final PA", "Power(W)"].iloc[0])
        st.number_input("基準值 (自動帶入目前值)", value=base_val_display, disabled=True)
        
    with col_range2:
        pct_range = st.number_input("變化範圍 (±%)", min_value=5.0, max_value=100.0, value=20.0, step=5.0)
    with col_range3:
        num_points = st.selectbox("計算點數", [5, 7, 9, 11], index=1)
        
    if st.button("🚀 執行敏感度分析", type="primary"):
        # 取得目前狀態
        current_params = {k: st.session_state[k] for k in DEFAULT_GLOBALS.keys()}
        
        # [Fix] 補上 Slope 參數，避免計算熱阻時發生 KeyError
        # 因 Slope 定義在程式碼中而非 DEFAULT_GLOBALS，需手動補入
        current_params['Slope'] = 0.03 
        
        current_df = st.session_state['df_current'].copy()
        
        # 產生變化點
        if var_type == "全局參數":
            base_val = current_params[var_name]
        else:  # 元件功率
            base_val = current_df.loc[current_df["Component"] == "Final PA", "Power(W)"].iloc[0]
            
        delta = base_val * (pct_range / 100)
        values = np.linspace(base_val - delta, base_val + delta, num_points)
        
        # 儲存結果
        results = {"var_values": [], "volume": [], "weight": [], "min_dt": []}
        
        for val in values:
            # 深拷貝
            params_copy = copy.deepcopy(current_params)
            df_copy = current_df.copy()
            
            # 修改變數
            if var_type == "全局參數":
                params_copy[var_name] = val
            else:
                df_copy.loc[df_copy["Component"] == "Final PA", "Power(W)"] = val
                
            # 計算
            res = compute_key_results(params_copy, df_copy)
            
            results["var_values"].append(round(val, 2))
            results["volume"].append(res["Volume_L"])
            results["weight"].append(res["total_weight_kg"])
            results["min_dt"].append(res["Min_dT_Allowed"])
        
        # 畫圖
        fig = go.Figure()
        fig.add_trace(go.Scatter(x=results["var_values"], y=results["volume"], mode='lines+markers', name='體積 (L)', line=dict(color='#00b894')))
        fig.add_trace(go.Scatter(x=results["var_values"], y=results["weight"], mode='lines+markers', name='重量 (kg)', line=dict(color='#34495e'), yaxis='y2'))
        fig.add_trace(go.Scatter(x=results["var_values"], y=results["min_dt"], mode='lines+markers', name='瓶頸允許溫升 (°C)', line=dict(color='#e74c3c', dash='dot'), yaxis='y3'))
        
        fig.update_layout(
            title=f"<b>{var_name} 敏感度分析 (基準 {base_val:.2f})</b>",
            xaxis_title=var_name,
            yaxis=dict(title="體積 (L)", side="left"),
            yaxis2=dict(title="重量 (kg)", side="right", overlaying="y", position=0.95, showgrid=False),
            yaxis3=dict(title="瓶頸允許溫升 (°C)", side="right", overlaying="y", position=1.0, showgrid=False),
            legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="right", x=1),
            height=600
        )
        
        st.plotly_chart(fig, use_container_width=True)
        
        # 表格顯示
        df_sens = pd.DataFrame(results)
        df_sens.columns = [var_name, "體積 (L)", "重量 (kg)", "瓶頸允許溫升 (°C)"]
        st.dataframe(df_sens, use_container_width=True)

# --- [Project I/O - Save Logic] 移到底部執行 ---
# [Critical Fix] 確保 placeholder 名稱與頂部定義一致 (project_io_save_placeholder)
with project_io_save_placeholder.container():
    def get_current_state_json():
        params_to_save = list(DEFAULT_GLOBALS.keys())
        saved_params = {}
        for k in params_to_save:
            if k in st.session_state:
                saved_params[k] = st.session_state[k]
        
        components_data = st.session_state['df_current'].to_dict('records')
        
        export_data = {
            "meta": {"version": APP_VERSION, "timestamp": time.strftime("%Y-%m-%d %H:%M:%S")},
            "global_params": saved_params,
            "components_data": components_data
        }
        return json.dumps(export_data, indent=4)

    if st.session_state.get('trigger_generation', False):
        json_data = get_current_state_json()
        st.session_state['json_ready_to_download'] = json_data
        st.session_state['json_file_name'] = f"RRU_Project_{time.strftime('%Y%m%d_%H%M%S')}.json"
        st.session_state['trigger_generation'] = False 
        st.rerun() 

    # [UI Fix] 左右並排按鈕 (使用 columns)
    c_btn1, c_btn2 = st.columns(2)
    with c_btn1:
        if st.button("🔄 1. 更新並產生"):
            st.session_state['trigger_generation'] = True
            st.rerun()
    with c_btn2:
        if st.session_state.get('json_ready_to_download'):
            st.download_button(
                label="💾 2. 下載專案",
                data=st.session_state['json_ready_to_download'],
                file_name=st.session_state['json_file_name'],
                mime="application/json"
            )
        else:
            st.caption("ℹ️ 待更新")
