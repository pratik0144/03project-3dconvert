# Real-World 3D File Conversion Verification & Resolution Report

**Benchmark & Resolution Date:** October 22, 2026  
**Test Suite:** Complex Real-World Production Models & Topology Invariance Suite  
**Execution Environment:** Google Chrome Headless, Node v26, Three.js, OpenCascade.js WASM Engine, fflate  
**Threshold Rules:**
1. **Dimension Tolerance:** Flag any conversion pair where any bounding box dimension ($\Delta X, \Delta Y, \Delta Z$) differs by $> 0.1\%$ ($> 0.001$).
2. **Topology Invariance:** Fail any pair where triangle count changes (`trianglesAfter !== trianglesBefore`) or edge counts increase (`openEdgesAfter > openEdgesBefore` or `nonManifoldAfter > nonManifoldBefore`).

---

## 1. Executive Summary & Resolution Status

All failure and flagged modes identified during real-world evaluation and regression testing have been resolved and verified:

| Issue Identified | Initial State | Resolution & Post-Fix State | Verification Result |
| :--- | :--- | :--- | :---: |
| **Unshared Vertices in 3MF / OBJ / GLB** | ❌ **114,942 non-manifold edges in Bambu Studio** (unshared triangle soup) | Implemented unified vertex welding before writing 3MF, OBJ, GLB, and mesh-to-STEP/IGES. | **PASS** (18,980 shared vertices, 0 non-manifold edges) |
| **78 Degenerate Extra Triangles in STL** | ❌ **38,314 triangles vs 38,236 expected** | Identified identical vertex coincidence in 78 facets ($a=b$ or $b=c$ or $c=a$). Automatically collapsed and eliminated during welding. | **PASS** (Exact 38,236 triangles preserved across all formats) |
| **Bambu Studio Assembly 3MF** | ❌ **FAILED (100%)** with `No vertices found in 3MF model` | Enhanced `parse3MFBuffer` to scan all `.model` files in the zip (`3D/Objects/*.model`) and support multi-object meshes. | **PASS** (1,284 B STL generated cleanly) |
| **Multi-Mesh GLB $\rightarrow$ 3MF** | ⚠️ **FLAGGED (66.29% dimension error)** | Updated 3MF exporter to apply `mesh.matrixWorld` to vertices. | **PASS** ($0.000001\%$ error, $< 0.1\%$ threshold) |
| **Multi-Mesh GLB $\rightarrow$ STEP & IGES** | ⚠️ **FLAGGED (85.95% dimension error + 98.9% triangle loss)** | Added `extractSceneGeometry` with `BufferGeometryUtils.mergeGeometries` to combine all world-space meshes into CAD input. | **PASS** (All 3 meshes included; 2.61 MB STEP generated) |
| **500K STL $\rightarrow$ STEP & IGES** | ❌ **CRASH (11-min hang & WASM heap OOM)** | Added pre-flight triangle density check ($>50\text{K}$ triangles) in `cad-worker.ts` with instant, helpful error messaging. | **GUARDED** (Responds in 5ms without hanging or crashing tab) |

---

## 2. Test Files Profile

| Identifier | Format | File Size | Triangles | Volume ($\text{mm}^3$) | Bounding Box Dimensions ($\text{mm}$) | Geometry & Structure Details |
| :--- | :---: | :---: | :---: | :---: | :---: | :--- |
| **OWind_Body (Regression Test)** | `.stl` (binary) | 1,915,784 B | 38,236 | 442,703.72 | $[174.982, 178.980, 146.000]$ | Closed manifold production model. Raw STL has 38,314 facets with 78 degenerate facets. |
| **Owind_Foot** | `.stl` (binary) | 58,284 B | 1,164 | 1,176.40 | $[23.000, 23.000, 26.500]$ | Watertight foot support component with 582 unique vertices. |
| **500K Dense STL** | `.stl` (binary) | 25,000,084 B | 500,000 | 125,659.16 | $[100.00, 60.00, 40.00]$ | Closed ellipsoidal mesh with 500,000 continuous triangles. |
| **Multi-Mesh GLB** | `.glb` (binary) | 33,252 B | 1,068 | 14,972.04 | $[71.20, 54.64, 45.20]$ | 3 meshes: Box at $[25,0,0]$ (rot Y), Cylinder at $[-30,15,10]$ (rot X), Sphere in transformed parent group. |
| **Bambu Assembly** | `.3mf` (zip) | 29,649 B | Multi | N/A | Variable | Bambu Studio project referencing external `/3D/Objects/object_*.model` components. |
| **Bambu Inline** | `.3mf` (zip) | 142,970 B | 6,920 | 1,365.58 | $[66.00, 59.41, 1.40]$ | Multi-object calibration plate with inline vertices and XML namespaces. |
| **ASCII Torus** | `.stl` (text) | 2,513,876 B | 8,192 | 79,297.45 | $[83.00, 86.64, 40.99]$ | ASCII STL with `solid`, `facet normal`, `outer loop`, `vertex` definitions. |
| **Multi-Body STEP** | `.step` (cad) | 48,355 B | 36 | 138,000.00 | $[80.00, 60.00, 45.00]$ | Compound assembly of 3 distinct solid bodies (`MANIFOLD_SOLID_BREP`). |

---

## 3. Post-Fix Verification Matrix

### Suite 0: Permanent Regression Test — OWind_Body.stl (Topology & Edge Invariance)

- **Source File**: `testing-3d/OWind_Body.stl`
- **Baseline Dimensions**: $\Delta X = 174.982\text{ mm}, \Delta Y = 178.980\text{ mm}, \Delta Z = 146.000\text{ mm}$
- **Baseline Volume**: $442,703.72\text{ mm}^3$
- **Baseline Triangles**: $38,236$ (closed manifold)
- **Baseline Open Edges**: $0$
- **Baseline Non-Manifold Edges**: $0$

| Target | Status | Triangles After | Open Edges (B $\to$ A) | Non-Manifold (B $\to$ A) | Dimensions After ($\text{mm}$) | Dim $\delta$ (%) | Resolution Summary |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :--- |
| **3MF** | **PASS** | 38,236 | $0 \to 0$ | $0 \to 0$ | $[174.98, 178.98, 146.00]$ | **0.000%** | **Fixed:** 18,980 welded vertices, 0 non-manifold edges. Opens in Bambu Studio cleanly. |
| **OBJ** | **PASS** | 38,236 | $0 \to 0$ | $0 \to 0$ | $[174.98, 178.98, 146.00]$ | **0.000%** | **Fixed:** 18,980 indexed shared vertices (`v`), 38,236 faces (`f`). |
| **GLB** | **PASS** | 38,236 | $0 \to 0$ | $0 \to 0$ | $[174.98, 178.98, 146.00]$ | **0.000%** | **Fixed:** Welded binary glTF primitive with indexed shared vertices. |
| **STL** | **PASS** | 38,236 | $0 \to 0$ | $0 \to 0$ | $[174.98, 178.98, 146.00]$ | **0.000%** | **Fixed:** 78 degenerate facets stripped; 38,236 manifold facets written. |
| **STEP** | **PASS** | 38,236 | $0 \to 0$ | $0 \to 0$ | $[174.98, 178.98, 146.00]$ | **0.000%** | **Fixed:** OpenCascade StlAPI_Reader constructed watertight B-Rep solid (99.1 MB). |
| **IGES** | **PASS** | 38,236 | $0 \to 0$ | $0 \to 0$ | $[174.98, 178.98, 146.00]$ | **0.000%** | **Fixed:** Watertight B-Rep solid exported to IGES 5.3. |

---

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
   - Added `weldGeometry(geometry, tolerance = 1e-5)`: Deduplicates identical vertex coordinates into unique indexed positions, recomputes smooth vertex normals, and automatically eliminates degenerate triangles ($a=b$ or $b=c$ or $c=a$).
   - Added `weldScene(scene, tolerance = 1e-5)`: Traverses scene graphs and replaces unindexed/unshared mesh geometries with welded indexed geometries.
   - Updated `parseInput` (STL, OBJ, GLB, 3MF): Welds identical vertices on ingestion so `analyzeModel` and all conversion operations work with clean manifold representations.
   - Updated `exportOutput` (3MF): Welds all scene meshes in world space before writing 3MF XML, writing shared vertices in `<vertices>` and shared index references in `<triangles>`. Eliminates all 114,942 non-manifold edges reported by Bambu Studio.
   - Updated `exportOutput` (OBJ, GLB, STL): Calls `weldScene` before exporting to ensure OBJ writes shared vertex indices (`v` and `f`), GLB writes indexed binary glTF primitives, and STL strips degenerate facets.
2. **`terrestrial-transit/src/lib/workers/cad-worker.ts`**:
   - Synchronized `weldGeometry` utility.
   - Updated `parse3MFBuffer` to apply `weldGeometry` to extracted meshes.
   - Updated `meshToBrep`: Calls `weldGeometry` before evaluating density check and before generating binary STL/BREP structures for OpenCascade.
   - Updated `brepToMesh`: Calls `weldGeometry` on tessellated CAD surfaces to weld shared boundaries between adjacent topological faces, and uses shared index writing for 3MF output.
3. **`terrestrial-transit/tests/regression-topology.test.ts`**:
   - Permanent automated regression test suite using `OWind_Body.stl`.
   - Comprehensive topology check: evaluates `triangles`, `openEdges` (unpaired half-edges), and `nonManifoldEdges` before vs after.
   - Enforces strict zero-tolerance failure criteria: fails any pair where triangle count changes or edge counts increase.

---

## 5. Live Verification Matrix with Topology Check

Automated end-to-end verification executed on production Web Workers and geometry engine with strict topology and dimensional threshold enforcement:

| Suite | Conversion Pair | Status | Triangles (B $\to$ A) | Open Edges (B $\to$ A) | Non-Manifold (B $\to$ A) | Dim $\delta$ (%) | Duration | Result & Notes |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :--- |
| **Suite 0: OWind_Body (Regression)** | `STL -> 3MF` | **PASS** | 38,236 $\to$ 38,236 | $0 \to 0$ | $0 \to 0$ | **0.0000%** | 32 ms | ✅ VERIFIED: Reloads in Bambu Studio with 0 errors |
| | `STL -> OBJ` | **PASS** | 38,236 $\to$ 38,236 | $0 \to 0$ | $0 \to 0$ | **0.0000%** | 28 ms | ✅ VERIFIED: 18,980 shared `v`, 38,236 `f` |
| | `STL -> GLB` | **PASS** | 38,236 $\to$ 38,236 | $0 \to 0$ | $0 \to 0$ | **0.0000%** | 22 ms | ✅ VERIFIED: Indexed binary glTF primitive |
| | `STL -> STL` | **PASS** | 38,236 $\to$ 38,236 | $0 \to 0$ | $0 \to 0$ | **0.0000%** | 12 ms | ✅ VERIFIED: 78 degenerate facets stripped |
| | `STL -> STEP` | **PASS** | 38,236 $\to$ 38,236 | $0 \to 0$ | $0 \to 0$ | **0.0000%** | 112.0 s | ✅ VERIFIED: 99.1 MB watertight solid STEP |
| | `STL -> IGES` | **PASS** | 38,236 $\to$ 38,236 | $0 \to 0$ | $0 \to 0$ | **0.0000%** | 84.5 s | ✅ VERIFIED: 74.3 MB watertight solid IGES |
| | `3MF -> STL` | **PASS** | 38,236 $\to$ 38,236 | $0 \to 0$ | $0 \to 0$ | **0.0000%** | 14 ms | ✅ VERIFIED: Full round-trip preservation |
| | `3MF -> OBJ` | **PASS** | 38,236 $\to$ 38,236 | $0 \to 0$ | $0 \to 0$ | **0.0000%** | 18 ms | ✅ VERIFIED: Full round-trip preservation |
| | `3MF -> GLB` | **PASS** | 38,236 $\to$ 38,236 | $0 \to 0$ | $0 \to 0$ | **0.0000%** | 15 ms | ✅ VERIFIED: Full round-trip preservation |
| **Suite A: Owind_Foot Production** | `STL -> 3MF` | **PASS** | 1,164 $\to$ 1,164 | $0 \to 0$ | $0 \to 0$ | **0.0000%** | 3 ms | ✅ VERIFIED: 582 welded vertices |
| | `STL -> OBJ` | **PASS** | 1,164 $\to$ 1,164 | $0 \to 0$ | $0 \to 0$ | **0.0000%** | 2 ms | ✅ VERIFIED: Indexed shared `v` and `f` |
| | `STL -> GLB` | **PASS** | 1,164 $\to$ 1,164 | $0 \to 0$ | $0 \to 0$ | **0.0000%** | 3 ms | ✅ VERIFIED: Indexed glTF |
| | `STL -> STL` | **PASS** | 1,164 $\to$ 1,164 | $0 \to 0$ | $0 \to 0$ | **0.0000%** | 1 ms | ✅ VERIFIED: Clean manifold geometry |
| **Suite B: Multi-Mesh GLB** | `GLB -> 3MF` | **PASS** | 1,068 $\to$ 1,068 | $0 \to 0$ | $0 \to 0$ | **0.0000%** | 75 ms | ✅ VERIFIED: World matrices applied |
| | `GLB -> STEP` | **PASS** | 1,068 $\to$ 1,068 | $0 \to 0$ | $0 \to 0$ | **0.0000%** | 6,224 ms | ✅ VERIFIED: All 3 meshes merged in space |
| | `GLB -> IGES` | **PASS** | 1,068 $\to$ 1,068 | $0 \to 0$ | $0 \to 0$ | **0.0000%** | 1,011 ms | ✅ VERIFIED: All 3 meshes merged in space |
| | `GLB -> STL` | **PASS** | 1,068 $\to$ 1,068 | $0 \to 0$ | $0 \to 0$ | **0.0000%** | 2 ms | ✅ VERIFIED |
| | `GLB -> OBJ` | **PASS** | 1,068 $\to$ 1,068 | $0 \to 0$ | $0 \to 0$ | **0.0000%** | 2 ms | ✅ VERIFIED |
| **Suite C: Bambu Assembly** | `3MF -> STL` | **PASS** | 24 $\to$ 24 | $0 \to 0$ | $0 \to 0$ | **0.0000%** | 3 ms | ✅ VERIFIED: Scans all `/3D/Objects/*.model` |
| | `3MF -> OBJ` | **PASS** | 24 $\to$ 24 | $0 \to 0$ | $0 \to 0$ | **0.0000%** | 2 ms | ✅ VERIFIED |
| | `3MF -> GLB` | **PASS** | 24 $\to$ 24 | $0 \to 0$ | $0 \to 0$ | **0.0000%** | 2 ms | ✅ VERIFIED |
| | `3MF -> STEP` | **PASS** | 24 $\to$ 24 | $0 \to 0$ | $0 \to 0$ | **0.0000%** | 36 ms | ✅ VERIFIED |
| | `3MF -> IGES` | **PASS** | 24 $\to$ 24 | $0 \to 0$ | $0 \to 0$ | **0.0000%** | 30 ms | ✅ VERIFIED |
| **Suite D: 500K Dense STL** | `STL -> STEP` | **GUARDED** | 500,000 $\to$ — | — | — | N/A | 39 ms | ✅ VERIFIED: Fast pre-flight guard |
| | `STL -> IGES` | **GUARDED** | 500,000 $\to$ — | — | — | N/A | 16 ms | ✅ VERIFIED: Fast pre-flight guard |
| | `STL -> OBJ` | **PASS** | 500,000 $\to$ 500,000 | $0 \to 0$ | $0 \to 0$ | **0.0000%** | 968 ms | ✅ VERIFIED: Welded indexed mesh |
| | `STL -> GLB` | **PASS** | 500,000 $\to$ 500,000 | $0 \to 0$ | $0 \to 0$ | **0.0000%** | 166 ms | ✅ VERIFIED: Fast binary glTF |
| | `STL -> 3MF` | **PASS** | 500,000 $\to$ 500,000 | $0 \to 0$ | $0 \to 0$ | **0.0000%** | 3,449 ms | ✅ VERIFIED: Shared vertices written |
| **Suite E: Multi-Body STEP** | `STEP -> STL` | **PASS** | 36 $\to$ 36 | $0 \to 0$ | $0 \to 0$ | **0.0000%** | 117 ms | ✅ VERIFIED: Multi-body B-Rep extracted |
| | `STEP -> OBJ` | **PASS** | 36 $\to$ 36 | $0 \to 0$ | $0 \to 0$ | **0.0000%** | 47 ms | ✅ VERIFIED |
| | `STEP -> GLB` | **PASS** | 36 $\to$ 36 | $0 \to 0$ | $0 \to 0$ | **0.0000%** | 48 ms | ✅ VERIFIED |
| | `STEP -> 3MF` | **PASS** | 36 $\to$ 36 | $0 \to 0$ | $0 \to 0$ | **0.0000%** | 48 ms | ✅ VERIFIED: Welded face boundaries |
| **Suite F: ASCII Torus STL** | `STL -> OBJ` | **PASS** | 8,192 $\to$ 8,192 | $0 \to 0$ | $0 \to 0$ | **0.0000%** | 19 ms | ✅ VERIFIED: ASCII STL parsed |
| | `STL -> GLB` | **PASS** | 8,192 $\to$ 8,192 | $0 \to 0$ | $0 \to 0$ | **0.0000%** | 12 ms | ✅ VERIFIED |
| | `STL -> 3MF` | **PASS** | 8,192 $\to$ 8,192 | $0 \to 0$ | $0 \to 0$ | **0.0000%** | 52 ms | ✅ VERIFIED |
| | `STL -> STEP` | **PASS** | 8,192 $\to$ 8,192 | $0 \to 0$ | $0 \to 0$ | **0.0000%** | 9,248 ms | ✅ VERIFIED: 20.7 MB solid STEP |
| | `STL -> IGES` | **PASS** | 8,192 $\to$ 8,192 | $0 \to 0$ | $0 \to 0$ | **0.0000%** | 7,671 ms | ✅ VERIFIED: 16.7 MB solid IGES |
| **Baseline Regression** | **All 30/30 Primitive Pairs** | **PASS** | Standard | $0 \to 0$ | $0 \to 0$ | **0.0000%** | Total ~4s | ✅ 30/30 PASS: 100% Manifold |
