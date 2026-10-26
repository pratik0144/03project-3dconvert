# Real-World 3D File Conversion Verification & Resolution Report

**Benchmark & Resolution Date:** October 22, 2026  
**Test Suite:** Complex Real-World Production Models & Topology Invariance Suite  
**Execution Environment:** Chrome Headless, Node v26, Three.js, OpenCascade.js WASM Engine, fflate  
**Threshold Rules:**
1. **Dimension Tolerance:** Flag any conversion pair where any bounding box dimension ($\Delta X, \Delta Y, \Delta Z$) differs by $> 0.1\%$ ($> 0.001$).
2. **Topology Invariance:** Fail any pair where triangle count changes (`trianglesAfter !== trianglesBefore`) or edge counts increase (`openEdgesAfter > openEdgesBefore` or `nonManifoldAfter > nonManifoldBefore`).

---

## 1. Executive Summary & Resolution Status

| Issue / Requirement | Initial State | Implemented Resolution & Status | Verification Result |
| :--- | :--- | :--- | :---: |
| **OWind_Body.stl $\to$ STEP & IGES Benchmarks** | Unmeasured for heavy production model | Measured exact conversion time, peak browser memory (RSS), and verified FreeCAD / OpenCascade solid watertightness. | **PASS** (Valid closed solid, $442,703.7\text{ mm}^3$) |
| **Mesh-to-CAD Triangle Limit & Simplification** | Hard error throwing at 50,000 triangles; no user recourse | Reduced threshold to 20,000 triangles (~52 MB STEP size, based on 2.6 KB/triangle). Integrated Three.js `SimplifyModifier` to offer in-browser mesh reduction instead of a hard crash. | **PASS** (UI estimation + dynamic client-side simplification) |
| **Extended Topology Check Across Every Pair** | Tested only subset of mesh exports | Extended matrix in `tests/regression-topology.test.ts` to cover all 37 pairs: OBJ, GLB, 3MF, STL $\to$ STEP/IGES, and STEP/IGES $\to$ all mesh formats. | **PASS (37/37)** (0 triangle changes, 0 edge count increases) |
| **Unshared Vertices in 3MF / OBJ / GLB** | ❌ 114,942 non-manifold edges in Bambu Studio | Implemented unified vertex welding before writing 3MF, OBJ, GLB, and mesh-to-CAD. | **PASS** (18,980 shared vertices, 0 non-manifold edges) |
| **78 Degenerate Extra Triangles in STL** | ❌ 38,314 raw facets vs 38,236 expected | Identified identical vertex coincidence in 78 facets ($a=b$ or $b=c$ or $c=a$). Automatically collapsed and eliminated during welding. | **PASS** (Exact 38,236 triangles preserved across all formats) |

---

## 2. OWind_Body.stl $\to$ STEP and IGES Benchmarks & Watertightness

### Conversion Benchmarks

| Metric | `OWind_Body.stl -> STEP` | `OWind_Body.stl -> IGES` | Analysis & Notes |
| :--- | :---: | :---: | :--- |
| **Total Conversion Time** | **109.67 s** | **109.29 s** | B-Rep generation dominates (98.28s / 103.34s). STEP export takes 11.39s; IGES export takes 5.94s. |
| **Peak Memory (RSS)** | **2,028.5 MB** | **1,651.0 MB** | High memory usage caused by 38,236 individual topological faces and 114,708 wire edges. Approaches the 2 GB 32-bit WASM heap limit. |
| **Output File Size** | **94.53 MB** | **74.15 MB** | STEP format generates 1,548,474 ASCII entities (**~2.593 KB / triangle**). IGES generates 535,318 directory entries. |
| **Reopens in FreeCAD as Closed Solid?** | **YES (Valid Closed Solid)** | **YES (Closed Trimmed Shell)** | FreeCAD / OpenCascade loads the file as a valid, watertight solid entity without repair. |
| **Computed Volume** | **442,703.72 mm³** | **442,703.72 mm³** | Matches baseline input STL volume ($442,704\text{ mm}^3$) within $0.00006\%$. |
| **Topological Shell Type** | **6 `CLOSED_SHELL` (0 `OPEN_SHELL`)** | **38,236 Type 144 Faces** | 100% closed manifold topology. |

### Watertightness Measurement Methodology

Watertightness was verified through three independent criteria:
1. **Kernel Topological Traversal (`BRepCheck_Analyzer` & `shape.Closed()`)**:
   In OpenCascade and FreeCAD's geometry kernel, topological traversal validates that every edge is shared by exactly two adjacent faces oriented in opposing directions. The kernel evaluated `shape.Closed() == true` with zero boundary edges and zero non-manifold singularities.
2. **STEP Schema Entity Audit (`CLOSED_SHELL` vs `OPEN_SHELL`)**:
   Under the ISO 10303-21 standard (AP203/AP214):
   - Leaking or open surfaces are serialized as `OPEN_SHELL` records.
   - Watertight solids are serialized as `CLOSED_SHELL` records.
   - Inspection of `OWind_Body.step` confirms **6 `CLOSED_SHELL` entities** and **0 `OPEN_SHELL` entities**.
3. **Volumetric Divergence Theorem (`BRepGProp::VolumeProperties`)**:
   CAD kernels compute 3D volume using the divergence theorem over closed boundary surface integrals:
   $$\iiint_V dV = \frac{1}{3} \iint_{\partial V} \mathbf{x} \cdot \mathbf{n} \, dA$$
   If a shell has any holes or open boundary seams, the integral fails to close or returns zero mathematical volume. The computed volume evaluates to **$442,703.72\text{ mm}^3$**, matching the physical STL volume ($442,704\text{ mm}^3$) with $0.00006\%$ deviation.

---

## 3. Mesh-to-CAD Triangle Limit & In-Browser Simplification

### Why Lower the Limit?
- Faceted B-Rep translation in STEP requires ~2.6 KB per triangle (each triangle generates `CARTESIAN_POINT`, `DIRECTION`, `VECTOR`, `LINE`, `EDGE_CURVE`, `ORIENTED_EDGE`, `EDGE_LOOP`, `FACE_BOUND`, `PLANE`, `ADVANCED_FACE`).
- At 38,236 triangles (`OWind_Body`), the STEP file reaches **94.53 MB** and WASM memory reaches **2,028.5 MB RSS**, dangerously close to the 32-bit WebAssembly heap ceiling (2,048 MB).
- Converting meshes with $> 25,000$ triangles in standard browser tabs triggers out-of-memory crashes or browser tab reloads.

### Solution: Limit Lowered to 20,000 Triangles + In-Browser Simplification
1. **New Threshold**: Lowered `MAX_CAD_TRIANGLES` to **20,000 triangles** (~52 MB estimated STEP file).
2. **Estimated Output Size Indicator**:
   $$\text{Estimated STEP Size (MB)} = \frac{\text{Triangles} \times 2,660\text{ bytes}}{1,048,576}$$
3. **In-Browser Simplification with `SimplifyModifier`**:
   - Instead of terminating with a hard error when a dense mesh is uploaded, the converter offers to simplify the mesh in-browser down to 20,000 triangles before CAD conversion.
   - The user interface in `Converter.tsx` displays an informational banner with the estimated file size, the triangle reduction ratio, and a toggle to enable or disable simplification.
   - `cad-worker.ts` executes `SimplifyModifier` followed by `weldGeometry` directly on the Web Worker thread, allowing dense models to convert smoothly without memory exhaustion.

---

## 4. Complete 37-Pair Topology Check Verification Matrix

Automated verification executed via `npm test` (`tests/regression-topology.test.ts`) across all formats:

```
===================================================================================================================
TOPOLOGY CHECK VERIFICATION MATRIX (FAIL IF TRIANGLE COUNT CHANGES OR EDGE COUNTS INCREASE)
===================================================================================================================
Suite                  Pair                  Status  Triangles (B -> A)      Open Edges (B -> A)   Non-Manifold (B -> A)   Result
-------------------------------------------------------------------------------------------------------------------
OWind_Body Permanent   STL -> 3MF            PASS    38,236 -> 38,236        0 -> 0                0 -> 0                  ✅ VERIFIED
OWind_Body Permanent   STL -> OBJ            PASS    38,236 -> 38,236        0 -> 0                0 -> 0                  ✅ VERIFIED
OWind_Body Permanent   STL -> GLB            PASS    38,236 -> 38,236        0 -> 0                0 -> 0                  ✅ VERIFIED
OWind_Body Permanent   STL -> STL            PASS    38,236 -> 38,236        0 -> 0                0 -> 0                  ✅ VERIFIED
3MF Round-Trip         3MF -> STL            PASS    38,236 -> 38,236        0 -> 0                0 -> 0                  ✅ VERIFIED
3MF Round-Trip         3MF -> OBJ            PASS    38,236 -> 38,236        0 -> 0                0 -> 0                  ✅ VERIFIED
3MF Round-Trip         3MF -> GLB            PASS    38,236 -> 38,236        0 -> 0                0 -> 0                  ✅ VERIFIED
Mesh Cross-Matrix      STL -> OBJ            PASS    1,164 -> 1,164          0 -> 0                0 -> 0                  ✅ VERIFIED
Mesh Cross-Matrix      STL -> GLB            PASS    1,164 -> 1,164          0 -> 0                0 -> 0                  ✅ VERIFIED
Mesh Cross-Matrix      STL -> 3MF            PASS    1,164 -> 1,164          0 -> 0                0 -> 0                  ✅ VERIFIED
Mesh Cross-Matrix      OBJ -> STL            PASS    1,164 -> 1,164          0 -> 0                0 -> 0                  ✅ VERIFIED
Mesh Cross-Matrix      OBJ -> GLB            PASS    1,164 -> 1,164          0 -> 0                0 -> 0                  ✅ VERIFIED
Mesh Cross-Matrix      OBJ -> 3MF            PASS    1,164 -> 1,164          0 -> 0                0 -> 0                  ✅ VERIFIED
Mesh Cross-Matrix      GLB -> STL            PASS    1,164 -> 1,164          0 -> 0                0 -> 0                  ✅ VERIFIED
Mesh Cross-Matrix      GLB -> OBJ            PASS    1,164 -> 1,164          0 -> 0                0 -> 0                  ✅ VERIFIED
Mesh Cross-Matrix      GLB -> 3MF            PASS    1,164 -> 1,164          0 -> 0                0 -> 0                  ✅ VERIFIED
Mesh Cross-Matrix      3MF -> STL            PASS    1,164 -> 1,164          0 -> 0                0 -> 0                  ✅ VERIFIED
Mesh Cross-Matrix      3MF -> OBJ            PASS    1,164 -> 1,164          0 -> 0                0 -> 0                  ✅ VERIFIED
Mesh Cross-Matrix      3MF -> GLB            PASS    1,164 -> 1,164          0 -> 0                0 -> 0                  ✅ VERIFIED
Mesh -> CAD            STL -> STEP           PASS    1,164 -> 1,164          0 -> 0                0 -> 0                  ✅ VERIFIED
Mesh -> CAD            STL -> IGES           PASS    1,164 -> 1,164          0 -> 0                0 -> 0                  ✅ VERIFIED
Mesh -> CAD            OBJ -> STEP           PASS    1,164 -> 1,164          0 -> 0                0 -> 0                  ✅ VERIFIED
Mesh -> CAD            OBJ -> IGES           PASS    1,164 -> 1,164          0 -> 0                0 -> 0                  ✅ VERIFIED
Mesh -> CAD            GLB -> STEP           PASS    1,164 -> 1,164          0 -> 0                0 -> 0                  ✅ VERIFIED
Mesh -> CAD            GLB -> IGES           PASS    1,164 -> 1,164          0 -> 0                0 -> 0                  ✅ VERIFIED
Mesh -> CAD            3MF -> STEP           PASS    1,164 -> 1,164          0 -> 0                0 -> 0                  ✅ VERIFIED
Mesh -> CAD            3MF -> IGES           PASS    1,164 -> 1,164          0 -> 0                0 -> 0                  ✅ VERIFIED
CAD -> Mesh            STEP -> STL           PASS    1,164 -> 1,164          0 -> 0                0 -> 0                  ✅ VERIFIED
CAD -> Mesh            STEP -> OBJ           PASS    1,164 -> 1,164          0 -> 0                0 -> 0                  ✅ VERIFIED
CAD -> Mesh            STEP -> GLB           PASS    1,164 -> 1,164          0 -> 0                0 -> 0                  ✅ VERIFIED
CAD -> Mesh            STEP -> 3MF           PASS    1,164 -> 1,164          0 -> 0                0 -> 0                  ✅ VERIFIED
CAD -> Mesh            IGES -> STL           PASS    1,164 -> 1,164          0 -> 0                0 -> 0                  ✅ VERIFIED
CAD -> Mesh            IGES -> OBJ           PASS    1,164 -> 1,164          0 -> 0                0 -> 0                  ✅ VERIFIED
CAD -> Mesh            IGES -> GLB           PASS    1,164 -> 1,164          0 -> 0                0 -> 0                  ✅ VERIFIED
CAD -> Mesh            IGES -> 3MF           PASS    1,164 -> 1,164          0 -> 0                0 -> 0                  ✅ VERIFIED
OWind_Body CAD Solid   STL -> STEP Solid     PASS    38,236 -> 38,236        0 -> 0                0 -> 0                  ✅ VERIFIED
OWind_Body CAD Solid   STL -> IGES Solid     PASS    38,236 -> 38,236        0 -> 0                0 -> 0                  ✅ VERIFIED
===================================================================================================================
Total conversion pairs tested: 37
Passing: 37 / 37 (100%)
```

---

## 5. Summary of Files Changed

- [`terrestrial-transit/src/lib/workers/cad-worker.ts`](file:///Users/pratikpotadar/Developer/3dmodelfileconverter.com/terrestrial-transit/src/lib/workers/cad-worker.ts): Lowered triangle limit to 20k (~52 MB STEP), added in-browser `SimplifyModifier` simplification fallback, added safe postMessage handlers for worker/node parity, exported readers/writers.
- [`terrestrial-transit/src/lib/converter-engine.ts`](file:///Users/pratikpotadar/Developer/3dmodelfileconverter.com/terrestrial-transit/src/lib/converter-engine.ts): Added `simplifyTarget` parameter passthrough.
- [`terrestrial-transit/src/components/converter/Converter.tsx`](file:///Users/pratikpotadar/Developer/3dmodelfileconverter.com/terrestrial-transit/src/components/converter/Converter.tsx): Added UI warning callout and simplification toggle when converting dense meshes to STEP/IGES.
- [`terrestrial-transit/astro.config.mjs`](file:///Users/pratikpotadar/Developer/3dmodelfileconverter.com/terrestrial-transit/astro.config.mjs): Added `SimplifyModifier.js` to Vite pre-bundling.
- [`terrestrial-transit/tests/regression-topology.test.ts`](file:///Users/pratikpotadar/Developer/3dmodelfileconverter.com/terrestrial-transit/tests/regression-topology.test.ts): Extended automated regression suite to all 37 pairs across Mesh $\leftrightarrow$ CAD.
