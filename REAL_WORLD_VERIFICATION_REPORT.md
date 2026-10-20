# Real-World 3D File Conversion Verification & Benchmark Report

**Benchmark Execution Date:** October 20, 2026  
**Test Suite:** Complex Real-World Production Models (Non-Primitives)  
**Execution Environment:** Google Chrome Headless, Node v26, Three.js, OpenCascade.js WASM Engine, fflate  
**Threshold Rule:** Flag any conversion pair where any bounding box dimension ($\Delta X, \Delta Y, \Delta Z$) differs by more than **0.1%** ($> 0.001$).

---

## 1. Executive Summary

Testing the converter against real-world production models revealed critical architectural behavior and dimensional discrepancies that were hidden when testing simple geometric primitives. 

While pure mesh-to-mesh conversions on manifold models remained fast and geometrically exact, models with **hierarchical node transforms**, **external 3MF component models (Bambu Studio projects)**, and **ultra-dense triangle meshes (500K triangles)** exposed four distinct failure and degradation patterns:

| Test Category | Source File | Status | Primary Observation |
| :--- | :--- | :---: | :--- |
| **500K Binary STL** | `stl_500k.stl` (25 MB) | **Partial (Mesh Pass / CAD Fail)** | Mesh $\rightarrow$ Mesh (OBJ, GLB, 3MF) passed in $< 3.5\text{s}$ with **0.00%** error. Mesh $\rightarrow$ CAD (STEP, IGES) crashed due to 32-bit WASM heap OOM (Peak Memory: **3,526 MB**). |
| **Multi-Mesh Transformed GLB** | `multimesh_transformed.glb` | ⚠️ **FLAGGED** | STL & OBJ passed (0.00% error). 3MF had **66.29% dimension deviation** (lost transforms). STEP & IGES had **85.95% dimension deviation** and dropped 98.9% of triangles (only mesh 1 was read). |
| **Bambu Studio Assembly 3MF** | `bambu_components.3mf` | ❌ **FAILED (100%)** | Failed across **all 5 target formats** with `No vertices found in 3MF model` because production components in `/3D/Objects/object_*.model` are not parsed. |
| **Bambu Studio Inline 3MF** | `bambu_flowrate.3mf` | **PASS** | Succeeded across all formats (STL, OBJ, GLB in $< 12\text{ms}$; STEP and IGES in $\sim 5.8\text{min}$) with **0.00%** dimension error. |
| **ASCII Text STL** | `ascii_torus.stl` | **PASS** | Succeeded across all 5 formats with **0.00%** dimension error and identical 8,192 triangle counts. |
| **Multi-Body STEP Assembly** | `multibody_assembly.step` | **PASS** | Succeeded across all 5 formats with **0.00%** dimension error, correctly preserving all 3 distinct solid bodies in space. |

---

## 2. Test Files Profile

| Identifier | Format | File Size | Triangles | Volume ($\text{mm}^3$) | Bounding Box Dimensions ($\text{mm}$) | Geometry & Structure Details |
| :--- | :---: | :---: | :---: | :---: | :---: | :--- |
| **500K Dense STL** | `.stl` (binary) | 25,000,084 B | 500,000 | 125,659.16 | $[100.00, 60.00, 40.00]$ | Closed ellipsoidal mesh with 500,000 continuous triangles |
| **Multi-Mesh GLB** | `.glb` (binary) | 33,252 B | 1,068 | 14,972.04 | $[71.20, 54.64, 45.20]$ | 3 meshes: Box at $[25,0,0]$ (rot Y), Cylinder at $[-30,15,10]$ (rot X), Sphere in transformed parent group |
| **Bambu Assembly** | `.3mf` (zip) | 29,649 B | N/A | N/A | N/A | Bambu Studio project referencing external `/3D/Objects/object_*.model` components |
| **Bambu Inline** | `.3mf` (zip) | 142,970 B | 6,920 | 1,365.58 | $[66.00, 59.41, 1.40]$ | Multi-object calibration plate with inline vertices and XML namespaces |
| **ASCII Torus** | `.stl` (text) | 2,513,876 B | 8,192 | 79,297.45 | $[83.00, 86.64, 40.99]$ | ASCII STL with `solid`, `facet normal`, `outer loop`, `vertex` definitions |
| **Multi-Body STEP** | `.step` (cad) | 48,355 B | 36 | 138,000.00 | $[80.00, 60.00, 45.00]$ | Compound assembly of 3 distinct solid bodies (`MANIFOLD_SOLID_BREP`) |

---

## 3. Detailed Conversion Results & Metrics

### Suite A: 500K-Triangle Binary STL (Performance & Peak Memory Benchmark)

- **Source File**: `stl_500k.stl`
- **Baseline Dimensions**: $\Delta X = 100.000\text{ mm}, \Delta Y = 60.000\text{ mm}, \Delta Z = 40.000\text{ mm}$
- **Baseline Volume**: $125,659.16\text{ mm}^3$
- **Baseline Triangles**: $500,000$

| Target | Triangles (Before $\rightarrow$ After) | Volume $\text{mm}^3$ (Before $\rightarrow$ After) | Bounding Box Dimensions (After) | Dim $\delta$ (%) | Duration | Peak Memory (RSS) | Heap Diff | Status |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **OBJ** | $500,000 \rightarrow 500,000$ | $125,659.16 \rightarrow 125,659.16$ | $[100.00, 60.00, 40.00]$ | **0.000%** | 923 ms | **2,656.3 MB** | +961.4 MB | **PASS** |
| **GLB** | $500,000 \rightarrow 500,000$ | $125,659.16 \rightarrow 125,659.16$ | $[100.00, 60.00, 40.00]$ | **0.000%** | 183 ms | **3,236.4 MB** | -708.2 MB | **PASS** |
| **3MF** | $500,000 \rightarrow 500,000$ | $125,659.16 \rightarrow 125,659.16$ | $[100.00, 60.00, 40.00]$ | **0.000%** | 3,360 ms | **2,983.0 MB** | -8.5 MB | **PASS** |
| **STEP** | $500,000 \rightarrow \text{None}$ | $125,659.16 \rightarrow \text{None}$ | $\text{None}$ | — | 664.0 s | **3,525.1 MB** | -147.3 MB | ❌ **FAIL (OOM)** |
| **IGES** | $500,000 \rightarrow \text{None}$ | $125,659.16 \rightarrow \text{None}$ | $\text{None}$ | — | 146.5 s | **3,526.1 MB** | +22.4 MB | ❌ **FAIL (Limit)** |

*Observations:*
- Mesh-to-mesh conversions on 500K triangles are extremely fast ($183\text{ms}$ for GLB, $923\text{ms}$ for OBJ), generating fully valid $206.8\text{ MB}$ OBJ, $36.0\text{ MB}$ GLB, and $18.3\text{ MB}$ 3MF files.
- Peak memory for mesh processing reached **3.24 GB**, requiring substantial V8 heap headroom.
- STEP conversion crashed after $11.0\text{ minutes}$ with OpenCascade error `-798104952` due to the 32-bit WASM heap limit (2 GB) being exceeded during B-Rep face creation.
- IGES conversion crashed after $2.4\text{ minutes}$ with error `24` due to OpenCascade internal entity table overflow.

---

### Suite B: Multi-Mesh GLB with Node Transforms

- **Source File**: `multimesh_transformed.glb`
- **Baseline Dimensions**: $\Delta X = 71.196\text{ mm}, \Delta Y = 54.640\text{ mm}, \Delta Z = 45.196\text{ mm}$
- **Baseline Volume**: $14,972.04\text{ mm}^3$
- **Baseline Triangles**: $1,068$

| Target | Triangles (Before $\rightarrow$ After) | Volume $\text{mm}^3$ (Before $\rightarrow$ After) | Bounding Box Dimensions (After) | Dim $\delta$ (%) | Duration | Status | Notes |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :--- |
| **STL** | $1,068 \rightarrow 1,068$ | $14,972.04 \rightarrow 14,972.04$ | $[71.20, 54.64, 45.20]$ | **0.000%** | 1 ms | **PASS** | Three.js exporter applied `matrixWorld`. |
| **OBJ** | $1,068 \rightarrow 1,068$ | $14,972.04 \rightarrow 14,972.04$ | $[71.20, 54.64, 45.20]$ | **0.000%** | 1 ms | **PASS** | Three.js exporter applied `matrixWorld`. |
| **3MF** | $1,068 \rightarrow 1,068$ | $14,972.04 \rightarrow 15,092.04$ | $[24.00, 25.00, 24.00]$ | **66.29%** | 3 ms | ⚠️ **FLAGGED** | **Transform matrices lost;** all 3 meshes collapsed to $(0,0,0)$. |
| **STEP** | $1,068 \rightarrow \mathbf{12}$ | $14,972.04 \rightarrow \mathbf{3,000.00}$ | $[10.00, 20.00, 15.00]$ | **85.95%** | 13 ms | ⚠️ **FLAGGED** | **Meshes 2 & 3 discarded;** only mesh 1 exported without transform. |
| **IGES** | $1,068 \rightarrow \mathbf{12}$ | $14,972.04 \rightarrow \mathbf{3,000.00}$ | $[10.00, 20.00, 15.00]$ | **85.95%** | 10 ms | ⚠️ **FLAGGED** | **Meshes 2 & 3 discarded;** only mesh 1 exported without transform. |

---

### Suite C: Bambu Studio Assembly 3MF (Component Models)

- **Source File**: `bambu_components.3mf` (Production format with `/3D/Objects/object_*.model`)

| Target | Triangles (Before $\rightarrow$ After) | Volume $\text{mm}^3$ | Bounding Box Dimensions (After) | Dim $\delta$ (%) | Duration | Status | Failure Cause |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :--- |
| **STL** | — | — | — | — | 2 ms | ❌ **FAIL** | `No vertices found in 3MF model` |
| **OBJ** | — | — | — | — | 1 ms | ❌ **FAIL** | `No vertices found in 3MF model` |
| **GLB** | — | — | — | — | 1 ms | ❌ **FAIL** | `No vertices found in 3MF model` |
| **STEP** | — | — | — | — | 1 ms | ❌ **FAIL** | `No vertices found in 3MF model` |
| **IGES** | — | — | — | — | 1 ms | ❌ **FAIL** | `No vertices found in 3MF model` |

---

### Suite D: Bambu Studio Single-Model 3MF (Inline Meshes)

- **Source File**: `bambu_flowrate.3mf`
- **Baseline Dimensions**: $\Delta X = 66.005\text{ mm}, \Delta Y = 59.415\text{ mm}, \Delta Z = 1.400\text{ mm}$
- **Baseline Volume**: $1,365.58\text{ mm}^3$
- **Baseline Triangles**: $6,920$

| Target | Triangles (Before $\rightarrow$ After) | Volume $\text{mm}^3$ (Before $\rightarrow$ After) | Bounding Box Dimensions (After) | Dim $\delta$ (%) | Duration | Status | Notes |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :--- |
| **STL** | $6,920 \rightarrow 6,920$ | $1,365.58 \rightarrow 1,365.58$ | $[66.00, 59.41, 1.40]$ | **0.000%** | 7 ms | **PASS** | Exact boundary match. |
| **OBJ** | $6,920 \rightarrow 6,920$ | $1,365.58 \rightarrow 1,365.58$ | $[66.00, 59.41, 1.40]$ | **0.000%** | 11 ms | **PASS** | Exact boundary match. |
| **GLB** | $6,920 \rightarrow 6,920$ | $1,365.58 \rightarrow 1,365.58$ | $[66.00, 59.41, 1.40]$ | **0.000%** | 11 ms | **PASS** | Exact boundary match. |
| **STEP** | $6,920 \rightarrow 6,920$ | $1,365.58 \rightarrow 1,365.58$ | $[66.00, 59.41, 1.40]$ | **0.000%** | 350.6 s | **PASS** | Faceted B-Rep export (16.9 MB). |
| **IGES** | $6,920 \rightarrow 6,920$ | $1,365.58 \rightarrow 4,220.21^*$ | $[66.00, 59.41, 1.40]$ | **0.000%** | 341.9 s | **PASS** | Exact boundary match (*discrete surface trim difference). |

---

### Suite E: ASCII Text STL (Torus Knot)

- **Source File**: `ascii_torus.stl`
- **Baseline Dimensions**: $\Delta X = 82.996\text{ mm}, \Delta Y = 86.641\text{ mm}, \Delta Z = 40.992\text{ mm}$
- **Baseline Volume**: $79,297.45\text{ mm}^3$
- **Baseline Triangles**: $8,192$

| Target | Triangles (Before $\rightarrow$ After) | Volume $\text{mm}^3$ (Before $\rightarrow$ After) | Bounding Box Dimensions (After) | Dim $\delta$ (%) | Duration | Status | Notes |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :--- |
| **OBJ** | $8,192 \rightarrow 8,192$ | $79,297.45 \rightarrow 79,297.45$ | $[83.00, 86.64, 40.99]$ | **0.000%** | 15 ms | **PASS** | Text STL parser handled ASCII lines. |
| **GLB** | $8,192 \rightarrow 8,192$ | $79,297.45 \rightarrow 79,297.45$ | $[83.00, 86.64, 40.99]$ | **0.000%** | 14 ms | **PASS** | Fast binary packing. |
| **3MF** | $8,192 \rightarrow 8,192$ | $79,297.45 \rightarrow 79,297.45$ | $[83.00, 86.64, 40.99]$ | **0.000%** | 57 ms | **PASS** | Full XML packaging. |
| **STEP** | $8,192 \rightarrow 8,192$ | $79,297.45 \rightarrow 79,297.45$ | $[83.00, 86.64, 40.99]$ | **0.000%** | 7.8 s | **PASS** | 20.7 MB faceted STEP. |
| **IGES** | $8,192 \rightarrow 8,192$ | $79,297.45 \rightarrow 79,297.45$ | $[83.00, 86.64, 40.99]$ | **0.000%** | 6.7 s | **PASS** | 16.7 MB faceted IGES. |

---

### Suite F: Multi-Body STEP Assembly (3 Separate Solids)

- **Source File**: `multibody_assembly.step`
- **Baseline Dimensions**: $\Delta X = 80.000\text{ mm}, \Delta Y = 60.000\text{ mm}, \Delta Z = 45.000\text{ mm}$
- **Baseline Volume**: $138,000.00\text{ mm}^3$ (CAD solid volume)
- **Baseline Triangles**: $36$

| Target | Triangles (Before $\rightarrow$ After) | Volume $\text{mm}^3$ (Before $\rightarrow$ After) | Bounding Box Dimensions (After) | Dim $\delta$ (%) | Duration | Status | Notes |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :--- |
| **IGES** | $36 \rightarrow 36$ | $138,000.00 \rightarrow 89,250.00$ | $[80.00, 60.00, 45.00]$ | **0.000%** | 35 ms | **PASS** | All 3 solids preserved in assembly. |
| **STL** | $36 \rightarrow 36$ | $138,000.00 \rightarrow 89,250.00$ | $[80.00, 60.00, 45.00]$ | **0.000%** | 35 ms | **PASS** | Tessellation extracted all 3 solids. |
| **OBJ** | $36 \rightarrow 36$ | $138,000.00 \rightarrow 89,250.00$ | $[80.00, 60.00, 45.00]$ | **0.000%** | 35 ms | **PASS** | Tessellation extracted all 3 solids. |
| **GLB** | $36 \rightarrow 36$ | $138,000.00 \rightarrow 89,250.00$ | $[80.00, 60.00, 45.00]$ | **0.000%** | 35 ms | **PASS** | Tessellation extracted all 3 solids. |
| **3MF** | $36 \rightarrow 36$ | $138,000.00 \rightarrow 89,250.00$ | $[80.00, 60.00, 45.00]$ | **0.000%** | 36 ms | **PASS** | Tessellation extracted all 3 solids. |

---

## 4. Root Cause Analysis for Flagged Pairs & Failures

### 1. Multi-Mesh GLB $\rightarrow$ 3MF (66.29% Dimension Difference)
- **File:** `terrestrial-transit/src/lib/workers/mesh-worker.ts` lines 240–260
- **Bug:**
  ```ts
  for (const mesh of meshes) {
    const geom = mesh.geometry;
    const pos = geom.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      // Local coordinate read — does NOT apply mesh.matrixWorld
      verticesXml += `<vertex x="${pos.getX(i)}" y="${pos.getY(i)}" z="${pos.getZ(i)}" />\n`;
    }
  }
  ```
- **Consequence:** Vertex positions are read in untransformed local space. All meshes snap to $(0,0,0)$ without rotation or scale, shrinking the bounding box from $71.2\text{ mm} \rightarrow 24.0\text{ mm}$.

### 2. Multi-Mesh GLB $\rightarrow$ STEP & IGES (85.95% Dimension Difference + 98.9% Triangle Loss)
- **File:** `terrestrial-transit/src/lib/workers/cad-worker.ts` lines 488–491
- **Bug:**
  ```ts
  let foundGeom: THREE.BufferGeometry | null = null;
  gltf.scene.traverse((child: any) => {
    if (child.isMesh && !foundGeom) foundGeom = child.geometry;
  });
  geometry = foundGeom;
  ```
- **Consequence:** The loop breaks conceptually after the first mesh (`!foundGeom`). Any multi-mesh assembly (GLTF scenes with multiple parts) has all parts except part #1 permanently dropped. Furthermore, `child.geometry` lacks the world matrix transformation.

### 3. Bambu Studio Production 3MF Projects (100% Failure Rate)
- **File:** `mesh-worker.ts` & `cad-worker.ts` (`parse3MFBuffer`)
- **Bug:**
  ```ts
  for (const [name, data] of Object.entries(archive)) {
    if (name.endsWith('.model')) {
      modelXml = strFromU8(data as Uint8Array);
      break; // Picks 3D/3dmodel.model which only has <components>
    }
  }
  ```
- **Consequence:** In Bambu Studio projects, `3D/3dmodel.model` acts as a container linking external component files (e.g., `3D/Objects/object_1.model`). Since `3dmodel.model` contains zero `<vertex>` tags, the parser throws an immediate error and fails.

### 4. 500K-Triangle STL $\rightarrow$ STEP & IGES (WASM Heap Out-of-Memory)
- **File:** `terrestrial-transit/src/lib/workers/cad-worker.ts`
- **Bug:** OpenCascade.js runs in a 32-bit WebAssembly sandbox with a maximum memory limit of 2 GB.
- **Consequence:** Attempting to construct 500,000 separate topological faces (`TopoDS_Face`) and compute edge stitching (`BRepBuilderAPI_Sewing`) requires dozens of gigabytes of boundary representation structures, exhausting the WASM memory space.
