import tkinter as tk
from tkinter import ttk
import math

class HeatsinkApp:
    def __init__(self, root):
        self.root = root
        self.root.title("5G Base Station Heatsink Vol. Calculator V3.9.7")
        self.root.geometry("600x680") # 稍微加高視窗以容納大字體

        # --- 設定樣式 (Style Configuration) ---
        self.style = ttk.Style()
        self.style.theme_use('clam') # 使用 clam 主題以支援較多自定義顏色

        # 需求 1: 頁籤標題不夠醒目 -> 加大字體、增加背景色
        # 設定 TNotebook (頁籤容器) 的樣式
        self.style.configure("TNotebook", background="#F0F0F0")
        
        # 設定 TNotebook.Tab (個別頁籤) 的樣式
        self.style.configure("TNotebook.Tab", 
                             font=("Microsoft JhengHei", 12, "bold"), # 設定字體大小
                             background="#CCCCCC",     # 未選中時的背景色 (深灰)
                             foreground="black",       # 文字顏色
                             padding=[15, 8])          # 增加頁籤內距讓它看起來更大
        
        # 設定選中狀態 (Selected) 的顏色變化
        self.style.map("TNotebook.Tab", 
                       background=[("selected", "#87CEFA")], # 選中時變亮藍色
                       foreground=[("selected", "black")])

        # 建立頁籤控制項
        self.notebook = ttk.Notebook(root)
        self.notebook.pack(pady=10, expand=True, fill="both")

        # 建立主要頁面 Frame
        self.main_frame = ttk.Frame(self.notebook)
        self.notebook.add(self.main_frame, text=" 體積估算主程式 ")

        # 主標題
        title_label = tk.Label(self.main_frame, text="5G 基地台散熱器體積估算", font=("Microsoft JhengHei", 16, "bold"))
        title_label.pack(pady=15)

        # 建立輸入參數區 (表一)
        self.create_table_1()

        # 建立計算按鈕
        btn_calc = tk.Button(self.main_frame, text="執行計算 (Calculate)", command=self.calculate, 
                             bg="#4CAF50", fg="white", font=("Microsoft JhengHei", 12, "bold"), 
                             relief="raised", bd=3, cursor="hand2")
        btn_calc.pack(pady=20, fill="x", padx=25)

        # 建立計算結果區 (表二)
        self.create_table_2()
        
        # 狀態列
        self.status_var = tk.StringVar()
        self.status_var.set("系統就緒 - V3.9.7")
        self.status_bar = tk.Label(self.main_frame, textvariable=self.status_var, bd=1, relief=tk.SUNKEN, anchor=tk.W, bg="#E0E0E0")
        self.status_bar.pack(side=tk.BOTTOM, fill=tk.X)

    def create_table_1(self):
        # 使用 LabelFrame 框住表一
        frame_table1 = tk.LabelFrame(self.main_frame, text="表一：輸入參數 (Input Parameters)", 
                                     font=("Microsoft JhengHei", 11, "bold"), padx=10, pady=10)
        frame_table1.pack(padx=15, pady=5, fill="x")

        # 定義表一欄位
        headers = ["參數名稱", "數值", "單位"]
        
        # 需求 3: 標題改為黑色字體 (透過 fg="black")
        for col, text in enumerate(headers):
            # 使用 tk.Label 並設定 relief="solid" 實現黑色邊框
            lbl = tk.Label(frame_table1, text=text, font=("Microsoft JhengHei", 10, "bold"), 
                           fg="black", bg="#D3D3D3", relief="solid", bd=1)
            lbl.grid(row=0, column=col, sticky="nsew", padx=0, pady=0, ipadx=5, ipady=5)

        # V3.9.6 核心邏輯參數 (包含 Margin/裕度)
        self.inputs = [
            ("熱源功耗 (Q)", "300", "Watts"),
            ("環境溫度 (T_amb)", "40", "°C"),
            ("允許最高溫度 (T_max)", "85", "°C"),
            ("設計裕度 (Margin)", "1.2", "Ratio"), # V3.9.6 修正項目
            ("鰭片高度 (H_fin)", "50", "mm"),
            ("基板厚度 (t_base)", "5", "mm")
        ]

        self.entries = {}

        # 建立表一內容
        # 需求 2: 格子邊框改為黑色 (使用 relief="solid", bd=1)
        for i, (label_text, default_val, unit) in enumerate(self.inputs):
            row_idx = i + 1
            
            # 參數名稱
            lbl_name = tk.Label(frame_table1, text=label_text, font=("Microsoft JhengHei", 10), 
                                fg="black", relief="solid", bd=1, anchor="w", padx=5)
            lbl_name.grid(row=row_idx, column=0, sticky="nsew")
            
            # 輸入框 (Entry) - 這裡也加上 solid border
            entry = tk.Entry(frame_table1, font=("Arial", 10), justify="center", relief="solid", bd=1)
            entry.insert(0, default_val)
            entry.grid(row=row_idx, column=1, sticky="nsew")
            self.entries[label_text] = entry
            
            # 單位
            lbl_unit = tk.Label(frame_table1, text=unit, font=("Arial", 10), 
                                fg="black", relief="solid", bd=1)
            lbl_unit.grid(row=row_idx, column=2, sticky="nsew")

        # 設定欄位權重使其填滿
        frame_table1.grid_columnconfigure(0, weight=2)
        frame_table1.grid_columnconfigure(1, weight=1)
        frame_table1.grid_columnconfigure(2, weight=1)

    def create_table_2(self):
        # 使用 LabelFrame 框住表二
        frame_table2 = tk.LabelFrame(self.main_frame, text="表二：計算結果 (Calculation Results)", 
                                     font=("Microsoft JhengHei", 11, "bold"), padx=10, pady=10)
        frame_table2.pack(padx=15, pady=5, fill="x")

        # 定義表二欄位
        headers = ["結果項目", "數值", "單位"]
        
        # 需求 3: 標題改為黑色字體
        for col, text in enumerate(headers):
            lbl = tk.Label(frame_table2, text=text, font=("Microsoft JhengHei", 10, "bold"), 
                           fg="black", bg="#D3D3D3", relief="solid", bd=1)
            lbl.grid(row=0, column=col, sticky="nsew", padx=0, pady=0, ipadx=5, ipady=5)

        self.results_labels = {}
        result_items = [
            ("目標熱阻 (R_th)", "°C/W"),
            ("所需散熱面積 (A_req)", "cm²"),
            ("預估散熱器長度 (L)", "mm"),
            ("預估散熱器寬度 (W)", "mm"),
            ("總體積 (Volume)", "cm³")
        ]

        # 建立表二內容
        # 需求 2: 格子邊框改為黑色
        for i, (key, unit) in enumerate(result_items):
            row_idx = i + 1
            
            # 結果項目名稱
            lbl_name = tk.Label(frame_table2, text=key, font=("Microsoft JhengHei", 10), 
                                fg="black", relief="solid", bd=1, anchor="w", padx=5)
            lbl_name.grid(row=row_idx, column=0, sticky="nsew")
            
            # 數值顯示區 (初始為空)
            lbl_val = tk.Label(frame_table2, text="-", font=("Arial", 10, "bold"), 
                               fg="blue", relief="solid", bd=1, bg="white")
            lbl_val.grid(row=row_idx, column=1, sticky="nsew")
            self.results_labels[key] = lbl_val
            
            # 單位
            lbl_unit = tk.Label(frame_table2, text=unit, font=("Arial", 10), 
                                fg="black", relief="solid", bd=1)
            lbl_unit.grid(row=row_idx, column=2, sticky="nsew")

        # 設定欄位權重
        frame_table2.grid_columnconfigure(0, weight=2)
        frame_table2.grid_columnconfigure(1, weight=1)
        frame_table2.grid_columnconfigure(2, weight=1)

    def calculate(self):
        try:
            # 1. 讀取輸入
            Q = float(self.entries["熱源功耗 (Q)"].get())
            T_amb = float(self.entries["環境溫度 (T_amb)"].get())
            T_max = float(self.entries["允許最高溫度 (T_max)"].get())
            margin = float(self.entries["設計裕度 (Margin)"].get()) # 來自 V3.9.6 的變數名稱
            H_fin = float(self.entries["鰭片高度 (H_fin)"].get())
            
            # 2. 基礎物理計算 (簡易模型)
            delta_T = T_max - T_amb
            if delta_T <= 0:
                self.status_var.set("錯誤：最高溫度必須大於環境溫度")
                self.status_bar.config(fg="red")
                return

            # 重置狀態列顏色
            self.status_bar.config(fg="black")

            # 目標熱阻 R_th = delta_T / (Q * margin)
            # 註：這裡將裕度應用在功耗上 (Q * margin)
            R_th = delta_T / (Q * margin)

            # 經驗公式估算所需面積
            # 簡化參數：假設有效熱傳係數 h_eff 綜合考量輻射與對流約為 0.0012 W/(cm^2*C)
            h_eff = 0.0012 
            A_req_cm2 = 1 / (R_th * h_eff)

            # 根據鰭片高度估算體積
            # 假設擴充表面積倍率 (Area Extension Ratio) 與鰭片高度成正比
            # 設 Ratio = 3 + (H_fin / 10)
            ratio = 3 + (H_fin / 10) 
            base_area_cm2 = A_req_cm2 / ratio
            
            side_length_cm = math.sqrt(base_area_cm2)
            L_mm = side_length_cm * 10
            W_mm = side_length_cm * 10
            
            # 總體積
            # 簡單起見，這裡只算包絡體積 L * W * H_fin
            Volume_cm3 = (L_mm * W_mm * H_fin) / 1000

            # 3. 更新顯示
            self.results_labels["目標熱阻 (R_th)"].config(text=f"{R_th:.4f}")
            self.results_labels["所需散熱面積 (A_req)"].config(text=f"{A_req_cm2:.1f}")
            self.results_labels["預估散熱器長度 (L)"].config(text=f"{L_mm:.1f}")
            self.results_labels["預估散熱器寬度 (W)"].config(text=f"{W_mm:.1f}")
            self.results_labels["總體積 (Volume)"].config(text=f"{Volume_cm3:.1f}")

            self.status_var.set("計算成功")

        except ValueError:
            self.status_var.set("輸入錯誤：請確保所有欄位皆為數字")
            self.status_bar.config(fg="red")

if __name__ == "__main__":
    root = tk.Tk()
    app = HeatsinkApp(root)
    root.mainloop()
