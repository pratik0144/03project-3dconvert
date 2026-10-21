# Real-World 3D File Conversion Verification & Resolution Report

**Benchmark & Resolution Date:** October 20, 2026  
**Test Suite:** Complex Real-World Production Models (Non-Primitives)  
**Execution Environment:** Google Chrome Headless, Node v26, Three.js, OpenCascade.js WASM Engine, fflate  
**Threshold Rule:** Flag any conversion pair where any bounding box dimension ($\Delta X, \Delta Y, \Delta Z$) differs by more than **0.1%** ($> 0.001$).

---

## 1. Executive Summary & Resolution Status

All failure and flagged modes identified during the initial real-world evaluation have been resolved and verified:

| Issue Identified | Initial State | Resolution & Post-Fix State | Verification Result |
| :--- | :--- | :--- | :---: |
| **Bambu Studio Assembly 3MF** | ❌ **FAILED (100%)** with `No vertices found in 3MF model` | Enhanced `parse3MFBuffer` to scan all `.model` files in the zip (`3D/Objects/*.model`) and support multi-object meshes. | **PASS** (1,284 B STL generated cleanly) |
| **Multi-Mesh GLB $\rightarrow$ 3MF** | ⚠️ **FLAGGED (66.29% dimension error)** | Updated 3MF exporter to apply `mesh.matrixWorld` to vertices. | **PASS** ($0.000001\%$ error, $< 0.1\%$ threshold) |
| **Multi-Mesh GLB $\rightarrow$ STEP & IGES** | ⚠️ **FLAGGED (85.95% dimension error + 98.9% triangle loss)** | Added `extractSceneGeometry` with `BufferGeometryUtils.mergeGeometries` to combine all world-space meshes into CAD input. | **PASS** (All 3 meshes included; 2.61 MB STEP generated) |
| **500K STL $\rightarrow$ STEP & IGES** | ❌ **CRASH (11-min hang & WASM heap OOM)** | Added pre-flight triangle density check ($>50\text{K}$ triangles) in `cad-worker.ts` with instant, helpful error messaging. | **GUARDED** (Responds in 5ms without hanging or crashing tab) |

---

## 2. Test Files Profile

| Identifier | Format | File Size | Triangles | Volume ($\text{mm}^3$) | Bounding Box Dimensions ($\text{mm}$) | Geometry & Structure Details |
| :--- | :---: | :---: | :---: | :---: | :---: | :--- |
| **500K Dense STL** | `.stl` (binary) | 25,000,084 B | 500,000 | 125,659.16 | $[100.00, 60.00, 40.00]$ | Closed ellipsoidal mesh with 500,000 continuous triangles |
| **Multi-Mesh GLB** | `.glb` (binary) | 33,252 B | 1,068 | 14,972.04 | $[71.20, 54.64, 45.20]$ | 3 meshes: Box at $[25,0,0]$ (rot Y), Cylinder at $[-30,15,10]$ (rot X), Sphere in transformed parent group |
| **Bambu Assembly** | `.3mf` (zip) | 29,649 B | Multi | N/A | Variable | Bambu Studio project referencing external `/3D/Objects/object_*.model` components |
| **Bambu Inline** | `.3mf` (zip) | 142,970 B | 6,920 | 1,365.58 | $[66.00, 59.41, 1.40]$ | Multi-object calibration plate with inline vertices and XML namespaces |
| **ASCII Torus** | `.stl` (text) | 2,513,876 B | 8,192 | 79,297.45 | $[83.00, 86.64, 40.99]$ | ASCII STL with `solid`, `facet normal`, `outer loop`, `vertex` definitions |
| **Multi-Body STEP** | `.step` (cad) | 48,355 B | 36 | 138,000.00 | $[80.00, 60.00, 45.00]$ | Compound assembly of 3 distinct solid bodies (`MANIFOLD_SOLID_BREP`) |

---

## 3. Post-Fix Verification Matrix

### Suite A: Multi-Mesh GLB with Node Transforms

- **Source File**: `multimesh_transformed.glb`
- **Baseline Dimensions**: $\Delta X = 71.196\text{ mm}, \Delta Y = 54.640\text{ mm}, \Delta Z = 45.196\text{ mm}$
- **Baseline Volume**: $14,972.04\text{ mm}^3$
- **Baseline Triangles**: $1,068$

| Target | Status | Triangles After | Dimensions After ($\text{mm}$) | Pre-Fix $\delta$ (%) | Post-Fix $\delta$ (%) | Resolution Summary |
| :---: | :---: | :---: | :---: | :---: | :---: | :--- |
| **STL** | **PASS** | 1,068 | $[71.20, 54.64, 45.20]$ | 0.00% | **0.000%** | Unchanged (standard exporter). |
| **OBJ** | **PASS** | 1,068 | $[71.20, 54.64, 45.20]$ | 0.00% | **0.000%** | Unchanged (standard exporter). |
| **3MF** | **PASS** | 1,068 | $[71.20, 54.64, 45.20]$ | 66.29% | **< 0.00001%** | **Fixed:** World transforms applied to vertices. |
| **STEP** | **PASS** | 1,068 | $[71.20, 54.64, 45.20]$ | 85.95% | **0.000%** | **Fixed:** All 3 meshes merged in world space (2.61 MB STEP). |
| **IGES** | **PASS** | 1,068 | $[71.20, 54.64, 45.20]$ | 85.95% | **0.000%** | **Fixed:** All 3 meshes merged in world space. |

---

### Suite B: Bambu Studio Assembly 3MF (Component Models)

- **Source File**: `bambu_components.3mf` (Bambu Studio project with `/3D/Objects/object_*.model`)
- **Baseline Dimensions**: $\Delta X = 25.600\text{ mm}, \Delta Y = 25.600\text{ mm}, \Delta Z = 25.600\text{ mm}$
- **Baseline Triangles**: $24$

| Target | Pre-Fix Status | Post-Fix Status | Triangles After | Dimensions After ($\text{mm}$) | Post-Fix $\delta$ (%) | Output Size | Duration | Resolution Summary |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :--- |
| **STL** | ❌ FAILED (`No vertices`) | **PASS** | 24 | $[25.60, 25.60, 25.60]$ | **0.000%** | 1,284 B | 3 ms | Scans all `.model` files in archive and extracts all object meshes. |
| **OBJ** | ❌ FAILED (`No vertices`) | **PASS** | 24 | $[25.60, 25.60, 25.60]$ | **0.000%** | 2,404 B | 2 ms | Scans all `.model` files in archive and extracts all object meshes. |
| **GLB** | ❌ FAILED (`No vertices`) | **PASS** | 24 | $[25.60, 25.60, 25.60]$ | **0.000%** | 2,664 B | 2 ms | Scans all `.model` files in archive and extracts all object meshes. |
| **STEP** | ❌ FAILED (`No vertices`) | **PASS** | 24 | $[25.60, 25.60, 25.60]$ | **0.000%** | 52,302 B | 36 ms | Passes merged assembly geometry to OpenCascade. |
| **IGES** | ❌ FAILED (`No vertices`) | **PASS** | 24 | $[25.60, 25.60, 25.60]$ | **0.000%** | 49,410 B | 30 ms | Passes merged assembly geometry to OpenCascade. |

---

### Suite C: 500K-Triangle Binary STL (Density Guard Verification)

- **Source File**: `stl_500k.stl` (500,000 triangles)

| Target | Status | Duration | Memory Behavior | User Experience |
| :---: | :---: | :---: | :---: | :--- |
| **OBJ** | **PASS** | 923 ms | Peak RSS: 2,656 MB | 206.8 MB text file generated cleanly. |
| **GLB** | **PASS** | 183 ms | Peak RSS: 3,236 MB | 36.0 MB binary glTF generated in under 0.2s. |
| **3MF** | **PASS** | 3,360 ms | Peak RSS: 2,983 MB | 18.3 MB 3MF generated cleanly. |
| **STEP** | **GUARDED** | 5 ms | < 50 MB | Clear user error: *"Mesh is too dense for CAD export (500,000 triangles)..."* |
| **IGES** | **GUARDED** | 5 ms | < 50 MB | Clear user error: *"Mesh is too dense for CAD export (500,000 triangles)..."* |

---

## 4. Code Changes Summary

1. **`terrestrial-transit/src/lib/workers/mesh-worker.ts`**:
   - `parse3MFBuffer`: Iterates over all `.model` files in the zip (`3D/Objects/*.model` and `3D/3dmodel.model`) and parses each `<object>` definition to handle Bambu Studio project archives.
   - `exportOutput` (3MF): Added `scene.updateMatrixWorld(true)` and multiplied each vertex by `mesh.matrixWorld`.
2. **`terrestrial-transit/src/lib/workers/cad-worker.ts`**:
   - Added `import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'`.
   - `parse3MFBuffer`: Synchronized multi-file 3MF extraction logic.
   - Added `extractSceneGeometry`: Traverses all child meshes in a scene, transforms them into world space, and merges them using `mergeGeometries`.
   - `meshToBrep`: Replaced single-mesh traversal with `extractSceneGeometry` for OBJ, GLB, and 3MF.
   - Added triangle density threshold guard ($>50\text{K}$ triangles) to protect against WebAssembly memory exhaustion.

---

## 5. Live Verification Matrix (Production Web Workers in Chrome CDP)

Automated end-to-end verification executed inside headless Google Chrome using Web Workers on the live conversion engine:

| Suite | Conversion Pair | Status | Triangles Before | Triangles After | Dimensions $\Delta$ (%) | Duration | Result |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Suite A: Multi-Mesh GLB** | `GLB -> 3MF` | **PASS** | 1,068 | 1,068 | **0.0000%** | 75 ms | ✅ VERIFIED |
| | `GLB -> STEP` | **PASS** | 1,068 | 1,068 | **0.0000%** | 6,224 ms | ✅ VERIFIED |
| | `GLB -> IGES` | **PASS** | 1,068 | 1,068 | **0.0000%** | 1,011 ms | ✅ VERIFIED |
| | `GLB -> STL` | **PASS** | 1,068 | 1,068 | **0.0000%** | 2 ms | ✅ VERIFIED |
| | `GLB -> OBJ` | **PASS** | 1,068 | 1,068 | **0.0000%** | 2 ms | ✅ VERIFIED |
| **Suite B: Bambu Assembly** | `3MF -> STL` | **PASS** | 24 | 24 | **0.0000%** | 3 ms | ✅ VERIFIED |
| | `3MF -> OBJ` | **PASS** | 24 | 24 | **0.0000%** | 2 ms | ✅ VERIFIED |
| | `3MF -> GLB` | **PASS** | 24 | 24 | **0.0000%** | 2 ms | ✅ VERIFIED |
| | `3MF -> STEP` | **PASS** | 24 | 24 | **0.0000%** | 36 ms | ✅ VERIFIED |
| | `3MF -> IGES` | **PASS** | 24 | 24 | **0.0000%** | 30 ms | ✅ VERIFIED |
| **Suite C: 500K STL** | `STL -> STEP` | **GUARDED** | 500,000 | — | N/A (Guarded) | 39 ms | ✅ VERIFIED |
| | `STL -> IGES` | **GUARDED** | 500,000 | — | N/A (Guarded) | 16 ms | ✅ VERIFIED |
| | `STL -> OBJ` | **PASS** | 500,000 | 500,000 | **0.0000%** | 968 ms | ✅ VERIFIED |
| | `STL -> GLB` | **PASS** | 500,000 | 500,000 | **0.0000%** | 166 ms | ✅ VERIFIED |
| | `STL -> 3MF` | **PASS** | 500,000 | 500,000 | **0.0000%** | 3,449 ms | ✅ VERIFIED |
| **Suite D: Multi-Body STEP** | `STEP -> STL` | **PASS** | 36 | 36 | **0.0000%** | 117 ms | ✅ VERIFIED |
| | `STEP -> OBJ` | **PASS** | 36 | 36 | **0.0000%** | 47 ms | ✅ VERIFIED |
| | `STEP -> GLB` | **PASS** | 36 | 36 | **0.0000%** | 48 ms | ✅ VERIFIED |
| | `STEP -> 3MF` | **PASS** | 36 | 36 | **0.0000%** | 48 ms | ✅ VERIFIED |
| **Suite E: ASCII Torus STL** | `STL -> OBJ` | **PASS** | 8,192 | 8,192 | **0.0000%** | 19 ms | ✅ VERIFIED |
| | `STL -> GLB` | **PASS** | 8,192 | 8,192 | **0.0000%** | 12 ms | ✅ VERIFIED |
| | `STL -> 3MF` | **PASS** | 8,192 | 8,192 | **0.0000%** | 52 ms | ✅ VERIFIED |
| | `STL -> STEP` | **PASS** | 8,192 | 8,192 | **0.0000%** | 9,248 ms | ✅ VERIFIED |
| | `STL -> IGES` | **PASS** | 8,192 | 8,192 | **0.0000%** | 7,671 ms | ✅ VERIFIED |
| **Baseline Regression** | **All 30/30 Primitive Pairs** | **PASS** | Standard | Standard | **0.0000%** | Total ~4s | ✅ 30/30 PASS |
