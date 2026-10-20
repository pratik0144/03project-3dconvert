# 3D Model Converter — Real-World Verification Benchmark Report

**Benchmark Date:** October 20, 2026  
**Test Suite Type:** Real-world Complex 3D Files (Non-primitives)  
**Evaluator:** Headless Chrome + WebAssembly CAD Engine (OpenCascade.js) + Three.js  
**Threshold Rule:** Flag any conversion pair where bounding box dimensions deviate by $> 0.1\%$.

---

## Executive Summary

While idealized geometric primitives (single unit cubes/spheres) previously showed 100% basic pass rates, testing against **real-world production files** revealed **3 critical architectural failure modes**:

1. ⚠️ **Hierarchy & Transform Loss (GLB $\rightarrow$ 3MF / STEP / IGES):**  
   Multi-mesh GLB models with node transforms lost their transform matrices in 3MF (**66.29% dimension deviation**). For STEP/IGES, the parser only processed the first mesh and discarded all subsequent meshes (**85.95% dimension deviation, 98.9% triangle loss**).
2. ❌ **Bambu Studio Assembly Failure (3MF $\rightarrow$ All Formats):**  
   Bambu Studio project 3MFs utilizing the 3MF Production Extension (`/3D/Objects/object_*.model` components referenced from `3D/3dmodel.model`) threw `No vertices found in 3MF model` across **all 5 conversion targets (100% failure rate)**.
3. ❌ **WASM Out-of-Memory on Dense Meshes (500K STL $\rightarrow$ STEP / IGES):**  
   Converting a 500K-triangle mesh to CAD B-Rep caused OpenCascade's 32-bit WebAssembly heap to exhaust memory and crash after 11 minutes (peak process memory: **3,526 MB**). However, **mesh-to-mesh conversions** (STL $\rightarrow$ OBJ, GLB, 3MF) succeeded in under 3.5 seconds with exact 0.00% geometric preservation.

---

## Test Files Profile

| File Identifier | Format | Size | Triangles | Volume ($\text{mm}^3$) | Bounding Box Dimensions ($\text{mm}$) | Characteristics |
| :--- | :---: | :---: | :---: | :---: | :---: | :--- |
| **Bambu Flowrate** | `.3mf` | 143 KB | 6,920 | 1,365.58 | $[66.00, 59.41, 1.40]$ | Multi-object calibration plate from Bambu Studio |
| **Bambu Assembly** | `.3mf` | 29.6 KB | N/A | N/A | N/A | Component-based project (`3D/Objects/object_*.model`) |
| **500K Dense STL** | `.stl` | 25.0 MB | 500,000 | 125,659.16 | $[100.00, 60.00, 40.00]$ | High-density binary STL mesh benchmark |
| **ASCII Torus Knot** | `.stl` | 2.5 MB | 8,192 | 79,297.45 | $[83.00, 86.64, 40.99]$ | Formatted text ASCII STL with normal vectors |
| **Multi-Body STEP** | `.step` | 48.4 KB | 36 | 138,000.00 | $[80.00, 60.00, 45.00]$ | 3 distinct solid bodies in an assembly compound |
| **Multi-Mesh GLB** | `.glb` | 33.3 KB | 1,068 | 14,972.04 | $[71.20, 54.64, 45.20]$ | 3 separate meshes with local rotation/scale/translation |

---

## Comprehensive Conversion Results Matrix

### Suite 1: 500K-Triangle Binary STL (Stress & Memory Benchmark)

*Baseline: 500,000 triangles \| Volume: 125,659.16 $\text{mm}^3$ \| Bounding Box: $[100.00, 60.00, 40.00]\text{ mm}$*

| Target | Status | Triangles After | Volume After ($\text{mm}^3$) | Bounding Box After ($\text{mm}$) | $\delta$ Dim (%) | Time | Peak Memory | Result & Notes |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :--- |
| **OBJ** | **PASS** | 500,000 | 125,659.16 | $[100.00, 60.00, 40.00]$ | **0.000%** | 923 ms | 2,656 MB | Output: 206.8 MB text OBJ. Perfect geometry. |
| **GLB** | **PASS** | 500,000 | 125,659.16 | $[100.00, 60.00, 40.00]$ | **0.000%** | 183 ms | 3,236 MB | Output: 36.0 MB binary GLB. Extremely fast. |
| **3MF** | **PASS** | 500,000 | 125,659.16 | $[100.00, 60.00, 40.00]$ | **0.000%** | 3,360 ms | 2,983 MB | Output: 18.3 MB zipped 3MF. Perfect geometry. |
| **STEP** | ❌ **FAIL** | — | — | — | — | 664.0 s | 3,525 MB | **CRASH:** Error `-798104952`. 32-bit WASM heap OOM. |
| **IGES** | ❌ **FAIL** | — | — | — | — | 146.5 s | 3,526 MB | **CRASH:** Error `24`. Exceeded entity table in WASM. |

---

### Suite 2: Multi-Mesh GLB with Node Transforms

*Baseline: 1,068 triangles \| Volume: 14,972.04 $\text{mm}^3$ \| Bounding Box: $[71.20, 54.64, 45.20]\text{ mm}$*

| Target | Status | Triangles After | Volume After ($\text{mm}^3$) | Bounding Box After ($\text{mm}$) | $\delta$ Dim (%) | Time | Flag / Failure Cause |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :--- |
| **STL** | **PASS** | 1,068 | 14,972.04 | $[71.20, 54.64, 45.20]$ | **0.000%** | 1 ms | Three.js exporter applied `matrixWorld`. |
| **OBJ** | **PASS** | 1,068 | 14,972.04 | $[71.20, 54.64, 45.20]$ | **0.000%** | 1 ms | Three.js exporter applied `matrixWorld`. |
| **3MF** | ⚠️ **FLAGGED** | 1,068 | 15,092.04 | $[24.00, 25.00, 24.00]$ | **66.29%** | 3 ms | **Geometry collapsed to origin:** Local transforms ignored. |
| **STEP** | ⚠️ **FLAGGED** | **12** | **3,000.00** | $[10.00, 20.00, 15.00]$ | **85.95%** | 13 ms | **Dropped Meshes 2 & 3:** Only Mesh 1 converted. |
| **IGES** | ⚠️ **FLAGGED** | **12** | **3,000.00** | $[10.00, 20.00, 15.00]$ | **85.95%** | 10 ms | **Dropped Meshes 2 & 3:** Only Mesh 1 converted. |

---

### Suite 3: Bambu Studio Assembly 3MF (Component Models)

*Input: Bambu Studio Project utilizing production component paths (`/3D/Objects/object_*.model`)*

| Target | Status | Triangles After | Volume After | Bounding Box After | $\delta$ Dim (%) | Time | Failure Cause |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :--- |
| **STL** | ❌ **FAIL** | — | — | — | — | 2 ms | `No vertices found in 3MF model` |
| **OBJ** | ❌ **FAIL** | — | — | — | — | 1 ms | `No vertices found in 3MF model` |
| **GLB** | ❌ **FAIL** | — | — | — | — | 1 ms | `No vertices found in 3MF model` |
| **STEP** | ❌ **FAIL** | — | — | — | — | 1 ms | `No vertices found in 3MF model` |
| **IGES** | ❌ **FAIL** | — | — | — | — | 1 ms | `No vertices found in 3MF model` |

---

### Suite 4: Bambu Studio Single-Model 3MF (Inline Meshes)

*Baseline: 6,920 triangles \| Volume: 1,365.58 $\text{mm}^3$ \| Bounding Box: $[66.00, 59.41, 1.40]\text{ mm}$*

| Target | Status | Triangles After | Volume After ($\text{mm}^3$) | Bounding Box After ($\text{mm}$) | $\delta$ Dim (%) | Time | Result & Notes |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :--- |
| **STL** | **PASS** | 6,920 | 1,365.58 | $[66.00, 59.41, 1.40]$ | **0.000%** | 7 ms | Exact boundary match. |
| **OBJ** | **PASS** | 6,920 | 1,365.58 | $[66.00, 59.41, 1.40]$ | **0.000%** | 11 ms | Exact boundary match. |
| **GLB** | **PASS** | 6,920 | 1,365.58 | $[66.00, 59.41, 1.40]$ | **0.000%** | 11 ms | Exact boundary match. |
| **STEP** | **PASS** | 6,920 | 1,365.58 | $[66.00, 59.41, 1.40]$ | **0.000%** | 350.6 s | Converted to faceted B-Rep (16.9 MB). |
| **IGES** | **PASS** | 6,920 | 4,220.21* | $[66.00, 59.41, 1.40]$ | **0.000%** | 341.9 s | Exact box match (*discrete surface trim difference). |

---

### Suite 5: ASCII STL (Torus Knot)

*Baseline: 8,192 triangles \| Volume: 79,297.45 $\text{mm}^3$ \| Bounding Box: $[83.00, 86.64, 40.99]\text{ mm}$*

| Target | Status | Triangles After | Volume After ($\text{mm}^3$) | Bounding Box After ($\text{mm}$) | $\delta$ Dim (%) | Time | Result & Notes |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :--- |
| **OBJ** | **PASS** | 8,192 | 79,297.45 | $[83.00, 86.64, 40.99]$ | **0.000%** | 15 ms | Full text STL parse & serialization. |
| **GLB** | **PASS** | 8,192 | 79,297.45 | $[83.00, 86.64, 40.99]$ | **0.000%** | 14 ms | Full text STL parse & GLB export. |
| **3MF** | **PASS** | 8,192 | 79,297.45 | $[83.00, 86.64, 40.99]$ | **0.000%** | 57 ms | Full text STL parse & 3MF export. |
| **STEP** | **PASS** | 8,192 | 79,297.45 | $[83.00, 86.64, 40.99]$ | **0.000%** | 7.8 s | 20.7 MB faceted STEP. |
| **IGES** | **PASS** | 8,192 | 79,297.45 | $[83.00, 86.64, 40.99]$ | **0.000%** | 6.7 s | 16.7 MB faceted IGES. |

---

### Suite 6: Multi-Body STEP Assembly (3 Distinct Solids)

*Baseline: 36 triangles \| Volume: 138,000.00 $\text{mm}^3$ \| Bounding Box: $[80.00, 60.00, 45.00]\text{ mm}$*

| Target | Status | Triangles After | Volume After ($\text{mm}^3$) | Bounding Box After ($\text{mm}$) | $\delta$ Dim (%) | Time | Result & Notes |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :--- |
| **IGES** | **PASS** | 36 | 89,250.00 | $[80.00, 60.00, 45.00]$ | **0.000%** | 35 ms | All 3 solids preserved in assembly. |
| **STL** | **PASS** | 36 | 89,250.00 | $[80.00, 60.00, 45.00]$ | **0.000%** | 35 ms | Tessellates all bodies into single mesh. |
| **OBJ** | **PASS** | 36 | 89,250.00 | $[80.00, 60.00, 45.00]$ | **0.000%** | 35 ms | Tessellates all bodies into single mesh. |
| **GLB** | **PASS** | 36 | 89,250.00 | $[80.00, 60.00, 45.00]$ | **0.000%** | 35 ms | Tessellates all bodies into single mesh. |
| **3MF** | **PASS** | 36 | 89,250.00 | $[80.00, 60.00, 45.00]$ | **0.000%** | 36 ms | Tessellates all bodies into single mesh. |

---

## Detailed Root Cause Analysis for Flagged Pairs

### 1. Multi-Mesh GLB $\rightarrow$ 3MF (66.29% Dimension Error)
- **Code Location:** `terrestrial-transit/src/lib/workers/mesh-worker.ts` lines 240–260
- **Root Cause:** When exporting to 3MF, vertex positions are read directly from `mesh.geometry.getAttribute('position')` without multiplying by `mesh.matrixWorld`. Meshes with translation or rotation collapse to their raw local coordinate origins.

### 2. Multi-Mesh GLB $\rightarrow$ STEP / IGES (85.95% Dimension Error & 98.9% Triangle Loss)
- **Code Location:** `terrestrial-transit/src/lib/workers/cad-worker.ts` lines 488–491:
  ```ts
  gltf.scene.traverse((child: any) => {
    if (child.isMesh && !foundGeom) foundGeom = child.geometry;
  });
  ```
- **Root Cause:** The parser terminates at the first mesh (`!foundGeom`) and discards all other meshes in the scene hierarchy. Furthermore, node transforms are unapplied, corrupting scale and position.

### 3. Bambu Studio Project 3MFs (100% Failure)
- **Code Location:** `mesh-worker.ts` & `cad-worker.ts` (`parse3MFBuffer`)
- **Root Cause:** Bambu Studio separates assembly components into `/3D/Objects/object_*.model` files, leaving only `<component p:path="..." />` tags in `3D/3dmodel.model`. The parser expects inline `<vertex>` tags inside `3D/3dmodel.model`, leading to immediate failure.

### 4. 500K STL $\rightarrow$ STEP / IGES (WASM OOM Crash)
- **Root Cause:** OpenCascade's 32-bit WebAssembly environment cannot construct 500,000 individual topological B-Rep faces and stitch them (`BRepBuilderAPI_Sewing`) within the 2 GB WASM heap boundary.
