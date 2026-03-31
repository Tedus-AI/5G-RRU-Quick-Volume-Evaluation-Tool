# DRC-SSM-FIN-001: Semi-Solid Die Casting Heatsink Fin Design Rule Check

> **Version:** 1.0  
> **Date:** 2026-03-31  
> **Process:** Semi-Solid Die Casting (SSM / Rheocasting)  
> **Material:** A356 (AlSi7Mg0.3) T6  
> **Application:** 5G RRU / AAU Heatsink Housing  
> **Classification:** Internal Use  

---

## 1. Scope

This Design Rule Check (DRC) defines the geometric constraints and inter-parameter relationships for heatsink fins manufactured by the Semi-Solid Metal (SSM) die casting process, targeting 5G RRU / AAU outdoor thermal management applications.

The DRC covers three core parameters and their coupled relationships:

- **Fin Height (H)** — the vertical distance from base plate surface to fin tip
- **Fin Thickness** — at root (T_root) and at tip (T_tip), governed by draft angle
- **Fin Pitch (P)** = T_root + Gap, center-to-center distance between adjacent fins
- **Cross Ribs** — horizontal bridges between fins that enable high aspect ratio casting

> **NOTE:** All dimensions in millimeters (mm) unless stated otherwise. Tolerances per NADCA Publication #403 for SSM processes. Material baseline: A356-T6 (AlSi7Mg0.3), thermal conductivity 150–170 W/m·K.

---

## 2. Terminology & Definitions

| Symbol / Term | Definition |
|---|---|
| **H** | Fin Height — vertical distance from base plate top surface to fin tip (mm) |
| **T_tip** | Fin Tip Thickness — minimum wall thickness at the top of the fin (mm) |
| **T_root** | Fin Root Thickness — wall thickness at the base where fin meets base plate (mm) |
| **P** | Fin Pitch — center-to-center distance between two adjacent fins,即鰭片根部厚度 + 根部氣隙 (mm) |
| **G** | Fin Gap — 相鄰鰭片之間的淨空氣間隙，**以根部（最窄處）為基準**：G = P − T_root (mm)。注意：因拔模角關係，頂端間隙 G_tip = P − T_tip 會大於 G，但 DRC 所有約束均以根部最窄處 G 為檢查基準 |
| **AR** | Aspect Ratio = H / T_tip (dimensionless) |
| **α** | Draft Angle — taper angle per side for mold release (°) |
| **R_base** | Base Fillet Radius — radius at fin-to-base plate junction (mm) |
| **R_tip** | Tip Radius — radius at fin tip (mm) |
| **T_base** | Base Plate Thickness — thickness of the mounting plate below fins (mm) |
| **CR_H** | Cross Rib Height — height of horizontal bridge between fins (mm) |
| **CR_T** | Cross Rib Thickness — thickness of horizontal bridge (mm) |
| **N_CR** | Number of Cross Rib Levels along the fin height (integer) |

### Key Geometric Relationships

```
T_root = T_tip + 2 × H × tan(α)
G = P − T_root                      ← G 取根部最窄處
AR = H / T_tip
P_min = T_root + max(C1, C2, C3)    ← see Section 4.1.3
```

### Fin Cross-Section Diagram (Pitch / Gap / Thickness 關係)

```
        T_tip          G_tip (大)          T_tip
       ┌─────┐  ←──────────────────→  ┌─────┐
      ╱       ╲                      ╱       ╲        Fin Tip
     ╱         ╲                    ╱         ╲
    ╱    Fin    ╲      Air Gap     ╱    Fin    ╲      ↑
   ╱      #1     ╲               ╱      #2     ╲     H
  ╱               ╲             ╱               ╲    ↓
 ┌─────────────────┐           ┌─────────────────┐   Fin Root
      T_root         G_root(小)       T_root
 |                 | ←───────→ |                 |
 |←─────────────── P (Pitch, center-to-center) ─────────────→|

 DRC 約束檢查位置 → G = G_root = P − T_root （最窄處，為瓶頸）

 ※ 因拔模角 α 的存在：
    T_root > T_tip  （根部較厚）
    G_root < G_tip  （根部間隙較小 → 檢查基準）
```

---

## 3. SSM vs. Conventional HPDC — Capability Comparison

Semi-solid casting (rheocasting / thixocasting) enables significantly higher aspect ratios than conventional HPDC due to laminar flow filling, lower casting temperature (~580°C vs. ~680°C), and near-zero porosity.

| Parameter | Conventional HPDC (ADC12/A380) | Semi-Solid SSM (A356-T6) |
|---|---|---|
| Max Aspect Ratio (AR) | 8:1 ~ 10:1 | 40:1 ~ 55:1 * |
| Min Fin Tip Thickness | 1.2 ~ 1.5 mm | 0.8 ~ 1.2 mm |
| Max Fin Height | 12 ~ 20 mm | 50 ~ 80 mm |
| Min Draft Angle | 1.5° ~ 3.0° | 0.5° ~ 1.5° |
| Porosity | 0.5 ~ 2.0% | < 0.1% |
| Thermal Conductivity | 96 ~ 100 W/m·K | 150 ~ 170 W/m·K |
| Heat Treatment | Not feasible | T6 capable |
| Tooling Cost | Baseline | 1.2 ~ 1.5x baseline |
| Cross Ribs Required? | Optional (H < 15mm) | Mandatory (H > 30mm) |

> \* AR > 40:1 requires cross rib reinforcement and vacuum-assisted SSM process. Huawei 5G AAU reference case achieves AR ≈ 53:1 (H=80mm, T_tip=1.5mm) with cross ribs.

---

## 4. Core DRC Rules — Fin Geometry

### 4.1.1 Aspect Ratio Limits (H / T_tip)

DRC status definitions:
- **PASS** = AR ≤ 25:1 (standard SSM, no special measures)
- **CAUTION** = 25 < AR ≤ 45 (requires cross ribs + vacuum SSM, die caster review mandatory)
- **FAIL** = AR > 45 (requires special process validation with die caster, not standard capability)

| H \ T_tip | 0.8 mm | 1.0 mm | 1.2 mm | 1.5 mm | 2.0 mm |
|---|---|---|---|---|---|
| **10 mm** | 12.5 ✅ | 10.0 ✅ | 8.3 ✅ | 6.7 ✅ | 5.0 ✅ |
| **20 mm** | 25.0 ✅ | 20.0 ✅ | 16.7 ✅ | 13.3 ✅ | 10.0 ✅ |
| **30 mm** | 37.5 ⚠️ | 30.0 ⚠️ | 25.0 ✅ | 20.0 ✅ | 15.0 ✅ |
| **40 mm** | 50.0 ❌ | 40.0 ⚠️ | 33.3 ⚠️ | 26.7 ⚠️ | 20.0 ✅ |
| **50 mm** | 62.5 ❌ | 50.0 ❌ | 41.7 ⚠️ | 33.3 ⚠️ | 25.0 ✅ |
| **60 mm** | 75.0 ❌ | 60.0 ❌ | 50.0 ❌ | 40.0 ⚠️ | 30.0 ⚠️ |
| **70 mm** | 87.5 ❌ | 70.0 ❌ | 58.3 ❌ | 46.7 ❌ | 35.0 ⚠️ |
| **80 mm** | 100 ❌ | 80.0 ❌ | 66.7 ❌ | 53.3 ❌ | 40.0 ⚠️ |

```
Legend:  ✅ PASS (AR ≤ 25)  |  ⚠️ CAUTION (25 < AR ≤ 45)  |  ❌ FAIL (AR > 45)
```

---

### 4.1.2 Fin Root Thickness Derived from Draft Angle

**Formula:** `T_root = T_tip + 2 × H × tan(α)`

The following table shows the **additional thickness (ΔT)** added to T_tip at the root due to draft angle. T_root = T_tip + ΔT.

| H \ α | 0.5° | 1.0° | 1.25° | 1.5° | 2.0° |
|---|---|---|---|---|---|
| **20 mm** | +0.35 | +0.70 | +0.87 | +1.05 | +1.40 |
| **30 mm** | +0.52 | +1.05 | +1.31 | +1.57 | +2.09 |
| **40 mm** | +0.70 | +1.40 | +1.74 | +2.09 | +2.79 |
| **50 mm** | +0.87 | +1.75 | +2.18 | +2.62 | +3.49 |
| **60 mm** | +1.05 | +2.09 | +2.62 | +3.14 | +4.19 |
| **70 mm** | +1.22 | +2.44 | +3.05 | +3.67 | +4.89 |
| **80 mm** | +1.40 | +2.79 | +3.49 | +4.19 | +5.59 |

**Verification example:** T_tip = 1.5mm, H = 80mm, α = 1.25° → T_root = 1.5 + 3.49 = 4.99 ≈ 5.0mm (matches Huawei field measurement).

---

### 4.1.3 Minimum Pitch Rules — Three Constraints

Fin Pitch (P) must satisfy **three independent constraints simultaneously**. The binding constraint (largest value) becomes the minimum allowable pitch.

| # | Constraint Name | Formula | Rationale |
|---|---|---|---|
| **C1** | Die Steel Strength | `G ≥ max(3.0, 0.08 × H) mm` | Die blade between fins must resist injection pressure without deformation or fatigue failure |
| **C2** | Thermal Boundary Layer | `G ≥ 4.0 mm` (natural conv.) / `G ≥ 2.5 mm` (forced conv.) | Boundary layer thickness ~2mm; insufficient gap causes air choking and eliminates convective benefit |
| **C3** | Mold Filling Flow | `G ≥ 2.0 × T_tip` | Molten metal must flow through gap between die blades to fill fin cavities; gap too narrow causes cold shut / misrun |

**Minimum pitch formula:**

```
P_min = T_root + max(C1, C2, C3)
```

> **重要：** 以上 C1、C2、C3 的 G 均指**根部最窄處的氣隙** G_root = P − T_root。因為根部是模具鋼最薄處（C1 瓶頸）、也是空氣流通截面積最小處（C2 瓶頸），所以全部以根部為設計基準。

---

### 4.1.4 Minimum Pitch Lookup Table (Natural Convection, α = 1.25°)

Baseline: T_tip = 1.5 mm

| H (mm) | T_tip | T_root | G_min | Binding C | **P_min** | AR |
|---|---|---|---|---|---|---|
| 20 | 1.5 | 2.37 | 4.0 | C2 | **6.37** | 13.3 |
| 30 | 1.5 | 2.81 | 4.0 | C2 | **6.81** | 20.0 |
| 40 | 1.5 | 3.24 | 4.0 | C2 | **7.24** | 26.7 |
| 50 | 1.5 | 3.68 | 4.0 | C1/C2 | **7.68** | 33.3 |
| 60 | 1.5 | 4.12 | 4.8 | C1 | **8.92** | 40.0 |
| 70 | 1.5 | 4.55 | 5.6 | C1 | **10.15** | 46.7 |
| 80 | 1.5 | 4.99 | 6.4 | C1 | **11.39** | 53.3 |

> **NOTE:** When H ≥ 50mm, die steel strength (C1: G ≥ 0.08×H) typically becomes the binding constraint, not thermal boundary layer (C2). For forced convection scenarios, C2 relaxes to 2.5mm and C1 becomes dominant earlier.

---

## 5. Cross Rib Design Rules

Cross ribs (horizontal bridges between adjacent fins) are critical structural features that enable high aspect ratio (AR > 20) fin casting. They serve four functions:

1. Provide intermediate flow paths for mold filling
2. Structurally reinforce thin die steel blades
3. Stiffen the fin array for demolding
4. Add surface area and promote flow turbulence for enhanced convective heat transfer

### 5.1 Cross Rib Requirement by Fin Height

| Fin Height H | Cross Ribs Required? | Recommended N_CR | Max Spacing Between Ribs |
|---|---|---|---|
| H ≤ 15 mm | Not required | 0 | N/A |
| 15 < H ≤ 30 mm | Recommended | 1 | ≤ 25 mm |
| 30 < H ≤ 50 mm | Mandatory | 1 ~ 2 | ≤ 25 mm |
| 50 < H ≤ 80 mm | Mandatory | 2 ~ 3 | ≤ 25 mm |
| H > 80 mm | Mandatory + special validation | 3+ | ≤ 20 mm |

### 5.2 Cross Rib Dimensional Rules

| # | Rule | Recommended | Limit |
|---|---|---|---|
| R1 | Cross rib thickness (CR_T) | ≥ 1.5 mm | Min 1.0 mm |
| R2 | Cross rib height (CR_H) | 2.0 ~ 4.0 mm | Min 1.5 mm |
| R3 | Rib fillet to fin (R_cr) | ≥ 0.5 mm | Min 0.3 mm |
| R4 | Vertical spacing between ribs | 20 ~ 25 mm | Max 30 mm |
| R5 | First rib height from base | 15 ~ 20 mm | Max 25 mm |
| R6 | Last rib to fin tip | ≥ 8 mm | Min 5 mm |
| R7 | Rib draft angle | ≥ 1.0° (per side) | Min 0.5° |

> **NOTE:** Cross ribs slightly obstruct airflow between fins. The thermal benefit (added area + turbulence) typically outweighs the airflow penalty for natural convection, but for forced convection with tight pressure drop budgets, CFD (e.g., FloTHERM) simulation is recommended to validate.

---

## 6. Base Plate & Fillet Rules

| # | Rule | Recommended | Limit |
|---|---|---|---|
| B1 | Base plate thickness (T_base) | 5.0 ~ 8.0 mm | Min 3.0 mm |
| B2 | Fin-to-base fillet radius (R_base) | 1.0 ~ 1.5 mm | Min 0.5 mm |
| B3 | Fin tip radius (R_tip) | 0.3 ~ 0.5 mm | Min 0.2 mm |
| B4 | Base plate flatness (post-machining) | ≤ 0.10 mm | Max 0.15 mm |
| B5 | Min distance: fin to casting edge | ≥ 3.0 mm | Min 2.0 mm |
| B6 | Base plate T_base / H ratio | ≥ 0.06 | Min 0.04 |

---

## 7. Quick DRC Checklist

Use this checklist to validate any fin design before submitting to the die caster for DFM review. **All items must PASS.**

| # | Check Item | Acceptance Criteria |
|---|---|---|
| 1 | Fin Aspect Ratio (H / T_tip) | ≤ 25 (std) or ≤ 45 (w/ cross ribs) |
| 2 | Fin Tip Thickness (T_tip) | ≥ 1.0 mm (SSM) or ≥ 1.2 mm (HPDC) |
| 3 | Fin Root Thickness (T_root) | = T_tip + 2×H×tan(α) |
| 4 | Draft Angle (α) | ≥ 0.5° (SSM) or ≥ 1.5° (HPDC) |
| 5 | Fin Gap (G = P − T_root) | ≥ max(3.0, 0.08×H, 2×T_tip) mm |
| 6 | Fin Gap for natural convection | ≥ 4.0 mm |
| 7 | Base Fillet Radius (R_base) | ≥ 0.5 mm |
| 8 | Tip Radius (R_tip) | ≥ 0.2 mm |
| 9 | Base Plate Thickness (T_base) | ≥ 3.0 mm and T_base/H ≥ 0.04 |
| 10 | Cross ribs if H > 30mm | N_CR per Section 5.1, spacing ≤ 25mm |
| 11 | Cross rib thickness (CR_T) | ≥ 1.0 mm (if cross ribs present) |
| 12 | Fin-to-edge clearance | ≥ 2.0 mm from casting boundary |

---

## 8. Worked Example: Huawei-Class 80mm Fin

Reference case based on field measurement of a Huawei 5G AAU heatsink housing:

| Parameter | Value | DRC Check |
|---|---|---|
| H (Fin Height) | 80 mm | Check AR, cross ribs |
| T_tip (Fin Tip) | 1.5 mm | ≥ 1.0 mm → PASS |
| AR (Aspect Ratio) | 53.3 : 1 | > 45, CAUTION zone, needs special validation |
| α (Draft Angle) | 1.25° (estimated) | ≥ 0.5° → PASS |
| T_root (computed) | 1.5 + 2×80×tan(1.25°) = 4.99 mm | ≈ 5.0 mm measured → PASS |
| G_min (C1: 0.08×80) | 6.4 mm | Binding constraint |
| G_min (C2: natural conv.) | 4.0 mm | Not binding |
| G_min (C3: 2×T_tip) | 3.0 mm | Not binding |
| P_min | 4.99 + 6.4 = 11.39 mm | Minimum pitch |
| Cross ribs (N_CR) | 2 ~ 3 levels visible | H=80mm requires 2~3 → PASS |
| Process | Semi-Solid (Rheocasting) + Vacuum | Mandatory for AR > 25 |
| Material | A356-T6 (estimated) | k ≈ 150~170 W/m·K |

---

## 9. Programmatic DRC Validation

For integration with automated design tools or scripts, use the following logic:

```python
import math

def drc_check(H, T_tip, alpha_deg, P, convection="natural", has_cross_ribs=False, N_CR=0, CR_spacing=None):
    """
    Run DRC validation on a semi-solid die casting heatsink fin design.
    
    Parameters:
        H           : Fin height (mm)
        T_tip       : Fin tip thickness (mm)
        alpha_deg   : Draft angle per side (degrees)
        P           : Fin pitch, center-to-center (mm). P = T_root + G_root
        convection  : "natural" or "forced"
        has_cross_ribs : Whether cross ribs are present
        N_CR        : Number of cross rib levels
        CR_spacing  : Max vertical spacing between ribs (mm), None = auto
    
    Returns:
        dict with pass/fail status and details for each rule
    """
    alpha_rad = math.radians(alpha_deg)
    results = {}
    
    # --- Derived values ---
    T_root = T_tip + 2 * H * math.tan(alpha_rad)
    G = P - T_root  # G = root gap (最窄處氣隙，DRC 檢查基準)
    AR = H / T_tip
    
    results["derived"] = {
        "T_root": round(T_root, 2),
        "G": round(G, 2),
        "AR": round(AR, 1),
    }
    
    # --- Rule 1: Aspect Ratio ---
    if AR <= 25:
        ar_status = "PASS"
    elif AR <= 45 and has_cross_ribs:
        ar_status = "CAUTION"
    elif AR > 45:
        ar_status = "FAIL"
    else:
        ar_status = "FAIL — cross ribs required for AR > 25"
    results["AR_check"] = {"value": round(AR, 1), "status": ar_status}
    
    # --- Rule 2: Fin Tip Thickness ---
    results["T_tip_check"] = {
        "value": T_tip,
        "status": "PASS" if T_tip >= 1.0 else "FAIL",
        "limit": ">= 1.0 mm (SSM)"
    }
    
    # --- Rule 3: Draft Angle ---
    results["alpha_check"] = {
        "value": alpha_deg,
        "status": "PASS" if alpha_deg >= 0.5 else "FAIL",
        "limit": ">= 0.5 deg (SSM)"
    }
    
    # --- Rule 4: Gap constraints ---
    C1 = max(3.0, 0.08 * H)
    C2 = 4.0 if convection == "natural" else 2.5
    C3 = 2.0 * T_tip
    G_min = max(C1, C2, C3)
    binding = "C1" if C1 >= C2 and C1 >= C3 else ("C2" if C2 >= C3 else "C3")
    
    results["gap_check"] = {
        "G_actual": round(G, 2),
        "G_min": round(G_min, 2),
        "C1": round(C1, 2),
        "C2": C2,
        "C3": round(C3, 2),
        "binding": binding,
        "status": "PASS" if G >= G_min else "FAIL"
    }
    
    # --- Rule 5: Pitch ---
    P_min = T_root + G_min
    results["pitch_check"] = {
        "P_actual": P,
        "P_min": round(P_min, 2),
        "status": "PASS" if P >= P_min else "FAIL"
    }
    
    # --- Rule 6: Cross rib requirement ---
    if H <= 15:
        cr_required = "not_required"
        ncr_min = 0
    elif H <= 30:
        cr_required = "recommended"
        ncr_min = 1
    elif H <= 50:
        cr_required = "mandatory"
        ncr_min = 1
    elif H <= 80:
        cr_required = "mandatory"
        ncr_min = 2
    else:
        cr_required = "mandatory_special"
        ncr_min = 3
    
    cr_status = "PASS"
    if cr_required in ("mandatory", "mandatory_special") and not has_cross_ribs:
        cr_status = "FAIL — cross ribs mandatory for H > 30mm"
    elif cr_required in ("mandatory", "mandatory_special") and N_CR < ncr_min:
        cr_status = f"FAIL — need at least {ncr_min} cross rib levels"
    
    results["cross_rib_check"] = {
        "requirement": cr_required,
        "N_CR_min": ncr_min,
        "N_CR_actual": N_CR,
        "status": cr_status
    }
    
    # --- Overall ---
    all_statuses = [
        results["AR_check"]["status"],
        results["T_tip_check"]["status"],
        results["alpha_check"]["status"],
        results["gap_check"]["status"],
        results["pitch_check"]["status"],
        results["cross_rib_check"]["status"],
    ]
    
    if any("FAIL" in s for s in all_statuses):
        overall = "FAIL"
    elif any("CAUTION" in s for s in all_statuses):
        overall = "CAUTION"
    else:
        overall = "PASS"
    
    results["overall"] = overall
    return results


# === Example: Huawei-class 80mm fin ===
if __name__ == "__main__":
    result = drc_check(
        H=80, T_tip=1.5, alpha_deg=1.25, P=12.0,
        convection="natural", has_cross_ribs=True, N_CR=3
    )
    
    print("=== DRC Result ===")
    for key, val in result.items():
        print(f"  {key}: {val}")
```

---

## 10. Revision History

| Rev | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-03-31 | Thermal Engineering | Initial release. Covers SSM and HPDC fin design rules for 5G RRU application. |
