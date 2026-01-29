import tkinter as tk
from tkinter import ttk
import math

class HeatsinkApp:
    def __init__(self, root):
        self.root = root
        self.root.title("5G Base Station Heatsink Vol. Calculator V3.9.7")
        self.root.geometry("600x650")

        # --- 設定樣式 (Style Configuration) ---
        self.style = ttk.Style()
        self.style.theme_use('clam') # 使用 clam 主題較容易自定義顏色

        # 需求 1: 頁籤標題不夠醒目 -> 加大字體、增加背景色
        self.style.configure("TNotebook.Tab", 
                             font=("Arial", 12, "bold"), 
                             background="#E0E0E0", # 未選中時的底色
                             foreground="black",
                             padding=[10, 5])
        
        # 設定選中狀態的頁籤顏色
        self.style.map("TNotebook.Tab", 
                       background=[("selected", "#ADD8E6")], # 選中時變亮藍色
                       foreground=[("selected", "black")])

        # 建立頁籤控制項
        self.notebook = ttk.Notebook(root)
        self.notebook.pack(pady=10, expand=True, fill="both")

        # 建立主要頁面
        self.main_frame = ttk.Frame(self.notebook)
        self.notebook.add(self.main_frame, text=" 體積估算主程式 ")

        # 標題
        title_label = tk.Label(self.main_frame, text="5G 基地台散熱器體積估算", font=("Arial", 16, "bold"))
        title_label.pack(pady=10)

        # 建立輸入參數區 (表一)
        self.create_table_1()

        # 建立計算按鈕
        btn_calc = tk.Button(self.main_frame, text="執行計算 (Calculate)", command=self.calculate, 
                             bg="#4CAF50", fg="white", font=("Arial", 12, "bold"), relief="raised")
        btn_calc.pack(pady=15, fill="x", padx=20)

        # 建立計算結果區 (表二)
        self.create_table_2()
        
        # 狀態列
        self.status_var = tk.StringVar()
        self.status_var.set("就緒")
        self.status_bar = tk.Label(self.main_frame, textvariable=self.status_var, bd=1, relief=tk.SUNKEN, anchor=tk.W)
        self.status_bar.pack(side=tk.BOTTOM, fill=tk.X)

    def create_table_1(self):
        # 使用 LabelFrame 框住表一
        frame_table1 = tk.LabelFrame(self.main_frame, text="表一：輸入參數 (Input Parameters)", font=("Arial", 11, "bold"), padx=10, pady=10)
        frame_table1.pack(padx=10, pady=5, fill="x")

        # 定義表一欄位
        headers = ["參數名稱", "數值", "單位"]
        
        # 需求 3: 標題改為黑色字體 (透過 fg="black")
        for col, text in enumerate(headers):
            lbl = tk.Label(frame_table1, text=text, font=("Arial", 10, "bold"), fg="black", bg="#D3D3D3", relief="solid", bd=1)
            lbl.grid(row=0, column=col, sticky="nsew", padx=0, pady=0, ipadx=5, ipady=5)

        # 參數列表 (Label 文字, 預設值, 變數名稱)
        self.inputs = [
            ("熱源功耗 (Q)", "300", "watts"),
            ("環境溫度 (T_amb)", "40", "deg C"),
            ("允許最高溫度 (T_max)", "85", "deg C"),
            ("設計裕度 (Margin)", "1.2", "ratio"), # V3.9.6 術語修正
            ("鰭片高度 (H_fin)", "50", "mm"),
            ("基板厚度 (t_base)", "5", "mm")
        ]

        self.entries = {}

        # 建立表一內容
        # 需求 2: 格子邊框改為黑色 (使用 relief="solid", bd=1)
        for i, (label_text, default_val, unit) in enumerate(self.inputs):
            row_idx = i + 1
            
            # 參數名稱
            lbl_name = tk.Label(frame_table1, text=label_text, font=("Arial", 10), fg="black", relief="solid", bd=1, anchor="w", padx=5)
            lbl_name.grid(row=row_idx, column=0, sticky="nsew")
            
            # 輸入框 (Entry)
            entry = tk.Entry(frame_table1, font=("Arial", 10), justify="center", relief="solid", bd=1)
            entry.insert(0, default_val)
            entry.grid(row=row_idx, column=1, sticky="nsew")
            self.entries[label_text] = entry
            
            # 單位
            lbl_unit = tk.Label(frame_table1, text=unit, font=("Arial", 10), fg="black", relief="solid", bd=1)
            lbl_unit.grid(row=row_idx, column=2, sticky="nsew")

        # 設定欄位權重使其填滿
        frame_table1.grid_columnconfigure(0, weight=2)
        frame_table1.grid_columnconfigure(1, weight=1)
        frame_table1.grid_columnconfigure(2, weight=1)

    def create_table_2(self):
        # 使用 LabelFrame 框住表二
        frame_table2 = tk.LabelFrame(self.main_frame, text="表二：計算結果 (Calculation Results)", font=("Arial", 11, "bold"), padx=10, pady=10)
        frame_table2.pack(padx=10, pady=5, fill="x")

        # 定義表二欄位
        headers = ["結果項目", "數值", "單位"]
        
        # 需求 3: 標題改為黑色字體
        for col, text in enumerate(headers):
            lbl = tk.Label(frame_table2, text=text, font=("Arial", 10, "bold"), fg="black", bg="#D3D3D3", relief="solid", bd=1)
            lbl.grid(row=0, column=col, sticky="nsew", padx=0, pady=0, ipadx=5, ipady=5)

        self.results_labels = {}
        result_items = [
            ("目標熱阻 (R_th)", "deg C/W"),
            ("所需散熱面積 (A_req)", "cm^2"),
            ("預估散熱器長度 (L)", "mm"),
            ("預估散熱器寬度 (W)", "mm"),
            ("總體積 (Volume)", "cm^3")
        ]

        # 建立表二內容
        # 需求 2: 格子邊框改為黑色
        for i, (key, unit) in enumerate(result_items):
            row_idx = i + 1
            
            # 結果項目名稱
            lbl_name = tk.Label(frame_table2, text=key, font=("Arial", 10), fg="black", relief="solid", bd=1, anchor="w", padx=5)
            lbl_name.grid(row=row_idx, column=0, sticky="nsew")
            
            # 數值顯示區 (初始為空)
            lbl_val = tk.Label(frame_table2, text="-", font=("Arial", 10, "bold"), fg="blue", relief="solid", bd=1, bg="white")
            lbl_val.grid(row=row_idx, column=1, sticky="nsew")
            self.results_labels[key] = lbl_val
            
            # 單位
            lbl_unit = tk.Label(frame_table2, text=unit, font=("Arial", 10), fg="black", relief="solid", bd=1)
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
            margin = float(self.entries["設計裕度 (Margin)"].get())
            H_fin = float(self.entries["鰭片高度 (H_fin)"].get())
            
            # 2. 基礎物理計算 (簡易模型)
            delta_T = T_max - T_amb
            if delta_T <= 0:
                self.status_var.set("錯誤：最高溫度必須大於環境溫度")
                return

            # 目標熱阻 R_th = delta_T / (Q * margin)
            # 註：這裡將裕度應用在功耗上 (Q * margin)，即需解熱能力要更強
            R_th = delta_T / (Q * margin)

            # 經驗公式估算所需面積 (假設自然對流係數 h 約為 10~15 之間，這裡反推簡化模型)
            # R_th approx 1 / (h * Area) -> Area = 1 / (h * R_th)
            # 簡化參數：假設有效熱傳係數 h_eff 綜合考量輻射與對流約為 0.0012 W/(cm^2*C)
            h_eff = 0.0012 
            A_req_cm2 = 1 / (R_th * h_eff)

            # 根據鰭片高度估算體積
            # 假設這是一個正方形基底的散熱器來反推 L 和 W
            # Area_total approx Base_Area + Fin_Area
            # Fin_Area 佔比很大，這裡使用一個體積效率因子 (Volumetric Efficiency) 來估算
            # 這是非常簡化的工程估算，僅供參考
            
            # 假設散熱器長寬比 1:1
            # 體積效率估算: V approx Q_total / (Vol_performance_factor)
            # 使用更直觀的幾何反推：
            # 假設擴充表面積倍率 (Area Extension Ratio) 與鰭片高度成正比
            # 設 Ratio = 3 + (H_fin / 10)
            ratio = 3 + (H_fin / 10) 
            base_area_cm2 = A_req_cm2 / ratio
            
            side_length_cm = math.sqrt(base_area_cm2)
            L_mm = side_length_cm * 10
            W_mm = side_length_cm * 10
            
            # 總體積
            # V = L * W * (H_fin + t_base) 
            # 簡單起見，這裡只算包絡體積 L * W * H_fin (視為整體佔用空間)
            Volume_cm3 = (L_mm * W_mm * H_fin) / 1000

            # 3. 更新顯示
            self.results_labels["目標熱阻 (R_th)"].config(text=f"{R_th:.4f}")
            self.results_labels["所需散熱面積 (A_req)"].config(text=f"{A_req_cm2:.1f}")
            self.results_labels["預估散熱器長度 (L)"].config(text=f"{L_mm:.1f}")
            self.results_labels["預估散熱器寬度 (W)"].config(text=f"{W_mm:.1f}")
            self.results_labels["總體積 (Volume)"].config(text=f"{Volume_cm3:.1f}")

            self.status_var.set("計算完成")

        except ValueError:
            self.status_var.set("輸入錯誤：請確保所有欄位皆為數字")

if __name__ == "__main__":
    root = tk.Tk()
    app = HeatsinkApp(root)
    root.mainloop()
