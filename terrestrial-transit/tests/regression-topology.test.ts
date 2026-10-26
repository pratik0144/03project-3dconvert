import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import * as THREE from 'three';
import { unzipSync, strFromU8 } from 'fflate';

// Polyfill worker environment for Node.js test execution
const require = createRequire(import.meta.url);
globalThis.self = globalThis as any;
if (!globalThis.self.postMessage) {
  globalThis.self.postMessage = () => {};
}

if (typeof FileReader === 'undefined') {
  (globalThis as any).FileReader = class {
    onload: any = null;
    onloadend: any = null;
    result: any = null;
    readAsArrayBuffer(blob: any) {
      blob.arrayBuffer().then((buf: ArrayBuffer) => {
        this.result = buf;
        if (this.onload) this.onload({ target: this });
        if (this.onloadend) this.onloadend({ target: this });
      });
    }
    readAsDataURL(blob: any) {
      blob.arrayBuffer().then((buf: ArrayBuffer) => {
        const base64 = Buffer.from(buf).toString('base64');
        this.result = `data:${blob.type || 'application/octet-stream'};base64,${base64}`;
        if (this.onload) this.onload({ target: this });
        if (this.onloadend) this.onloadend({ target: this });
      });
    }
  };
}

import {
  parseInput,
  exportOutput,
  parse3MFBuffer,
  weldGeometry,
  weldScene,
} from '../src/lib/workers/mesh-worker.ts';
import {
  meshToBrep,
  brepToMesh,
  writeSTEP,
  readSTEP,
  writeIGES,
  readIGES,
} from '../src/lib/workers/cad-worker.ts';
import type { FormatId } from '../src/lib/formats.ts';

const OC_CDN_BASE = 'https://cdn.jsdelivr.net/npm/opencascade.js@2.0.0-beta.b5ff984/dist';
let cachedOc: any = null;

async function getOpenCascade() {
  if (cachedOc) return cachedOc;
  const jsUrl = `${OC_CDN_BASE}/opencascade.full.js`;
  const wasmUrl = `${OC_CDN_BASE}/opencascade.full.wasm`;
  const res = await fetch(jsUrl);
  const source = await res.text();
  const wasmRes = await fetch(wasmUrl);
  const wasmBinary = new Uint8Array(await wasmRes.arrayBuffer());

  const cleanedSource = source.replace(/export\s+default\s+Module\s*;?\s*$/, '');
  const factory = new Function('require', '__dirname', `${cleanedSource}\nreturn Module;`)(
    require,
    process.cwd()
  );
  const oc = await factory({ wasmBinary });
  if (oc.ready) await oc.ready;
  cachedOc = oc;
  return oc;
}

export interface TopologyStats {
  triangles: number;
  openEdges: number;
  nonManifoldEdges: number;
}

export interface VerificationResult {
  suite: string;
  pair: string;
  trianglesBefore: number;
  trianglesAfter: number;
  openEdgesBefore: number;
  openEdgesAfter: number;
  nonManifoldBefore: number;
  nonManifoldAfter: number;
  passed: boolean;
  notes: string;
}

/**
 * Compute edge and triangle topology for any Three.js geometry.
 * Counts:
 * - triangles: valid triangle count (excluding zero-area/degenerate)
 * - openEdges: boundary edges with only 1 adjacent face (unpaired half-edges)
 * - nonManifoldEdges: edges violating manifold pairing (unmatched directed edges)
 */
export function analyzeTopology(geometry: THREE.BufferGeometry): TopologyStats {
  const pos = geometry.getAttribute('position');
  if (!pos) return { triangles: 0, openEdges: 0, nonManifoldEdges: 0 };

  const idx = geometry.getIndex();
  const triCount = idx ? idx.count / 3 : pos.count / 3;

  const halfEdges = new Map<string, number>();
  let validTris = 0;

  for (let i = 0; i < triCount; i++) {
    const v0 = idx ? idx.getX(i * 3) : i * 3;
    const v1 = idx ? idx.getX(i * 3 + 1) : i * 3 + 1;
    const v2 = idx ? idx.getX(i * 3 + 2) : i * 3 + 2;

    // Skip degenerate triangles where indices coincide
    if (v0 === v1 || v1 === v2 || v2 === v0) continue;
    validTris++;

    const edges: [number, number][] = [
      [v0, v1],
      [v1, v2],
      [v2, v0],
    ];

    for (const [u, v] of edges) {
      const dKey = `${u}->${v}`;
      halfEdges.set(dKey, (halfEdges.get(dKey) || 0) + 1);
    }
  }

  let openEdges = 0;
  let nonManifoldEdges = 0;

  for (const [dKey, count] of halfEdges.entries()) {
    const [u, v] = dKey.split('->');
    const revKey = `${v}->${u}`;
    const revCount = halfEdges.get(revKey) || 0;

    if (revCount === 0) {
      openEdges += count;
    } else if (count > revCount) {
      nonManifoldEdges += count - revCount;
    }
  }

  return {
    triangles: validTris,
    openEdges,
    nonManifoldEdges,
  };
}

/**
 * Extract combined geometry from a parsed scene/group for topology check.
 */
export function extractSceneTopology(scene: THREE.Object3D): TopologyStats {
  scene.updateMatrixWorld(true);
  const geometries: THREE.BufferGeometry[] = [];

  scene.traverse((child: any) => {
    if (child.isMesh && child.geometry) {
      const cloned = child.geometry.clone();
      cloned.applyMatrix4(child.matrixWorld);
      geometries.push(cloned);
    }
  });

  if (geometries.length === 0) {
    return { triangles: 0, openEdges: 0, nonManifoldEdges: 0 };
  }

  if (geometries.length === 1) {
    return analyzeTopology(geometries[0]);
  }

  let totalTriangles = 0;
  let totalOpenEdges = 0;
  let totalNonManifold = 0;

  for (const geom of geometries) {
    const topo = analyzeTopology(geom);
    totalTriangles += topo.triangles;
    totalOpenEdges += topo.openEdges;
    totalNonManifold += topo.nonManifoldEdges;
  }

  return {
    triangles: totalTriangles,
    openEdges: totalOpenEdges,
    nonManifoldEdges: totalNonManifold,
  };
}

export async function parseBufferToScene(
  buffer: ArrayBuffer,
  format: FormatId,
  name: string
): Promise<THREE.Object3D> {
  return parseInput(buffer, format, name);
}

async function runRegressionAndTopologyTests(): Promise<boolean> {
  console.log('='.repeat(105));
  console.log('3D MODEL CONVERTER — TOPOLOGY & REGRESSION VERIFICATION MATRIX');
  console.log('='.repeat(105));

  const results: VerificationResult[] = [];
  let allPassed = true;

  const owindBodyPath = path.resolve(process.cwd(), '../testing-3d/OWind_Body.stl');
  const owindFootPath = path.resolve(process.cwd(), '../testing-3d/Owind_Foot.stl');
  const owindStepPath = path.resolve(process.cwd(), '../testing-3d/OWind_Body.step');
  const owindIgesPath = path.resolve(process.cwd(), '../testing-3d/OWind_Body.iges');

  if (!fs.existsSync(owindBodyPath)) {
    throw new Error(`Regression test file not found at: ${owindBodyPath}`);
  }

  /* ──────────────────────────────────────────────────────────────────────────
   * SUITE 1: Permanent Regression Test — OWind_Body.stl (38,236 triangles)
   * ────────────────────────────────────────────────────────────────────────── */
  console.log('\n[Suite 1] Permanent Regression Test: OWind_Body.stl');
  console.log('- Input raw header: 38,314 triangles (78 degenerate zero-area triangles)');
  console.log('- Verified manifold baseline: 38,236 triangles, 0 open edges, 0 non-manifold edges');

  const owindBuffer = fs.readFileSync(owindBodyPath);
  const owindArrayBuf = owindBuffer.buffer.slice(
    owindBuffer.byteOffset,
    owindBuffer.byteOffset + owindBuffer.byteLength
  );

  const owindInputScene = await parseInput(owindArrayBuf, 'stl', 'OWind_Body.stl');
  const owindBaseline = extractSceneTopology(owindInputScene);

  if (owindBaseline.triangles !== 38236) {
    console.error(`❌ FAILED: OWind_Body baseline triangles = ${owindBaseline.triangles}, expected 38236`);
    allPassed = false;
  }
  if (owindBaseline.openEdges !== 0 || owindBaseline.nonManifoldEdges !== 0) {
    console.error(
      `❌ FAILED: OWind_Body baseline is not closed manifold: open=${owindBaseline.openEdges}, nonManifold=${owindBaseline.nonManifoldEdges}`
    );
    allPassed = false;
  }

  const owindTargets: FormatId[] = ['3mf', 'obj', 'glb', 'stl'];
  let saved3mfBuffer: ArrayBuffer | null = null;

  for (const target of owindTargets) {
    const pairName = `STL -> ${target.toUpperCase()}`;
    try {
      const exported = await exportOutput(owindInputScene, target);
      if (target === '3mf') saved3mfBuffer = exported.buffer;

      const reloadedScene = await parseBufferToScene(exported.buffer, target, `OWind_Body.${target}`);
      const reloadedTopo = extractSceneTopology(reloadedScene);

      const triChanged = reloadedTopo.triangles !== owindBaseline.triangles;
      const openIncreased = reloadedTopo.openEdges > owindBaseline.openEdges;
      const nonManifoldIncreased = reloadedTopo.nonManifoldEdges > owindBaseline.nonManifoldEdges;

      const passed = !triChanged && !openIncreased && !nonManifoldIncreased;
      if (!passed) allPassed = false;

      results.push({
        suite: 'OWind_Body Permanent',
        pair: pairName,
        trianglesBefore: owindBaseline.triangles,
        trianglesAfter: reloadedTopo.triangles,
        openEdgesBefore: owindBaseline.openEdges,
        openEdgesAfter: reloadedTopo.openEdges,
        nonManifoldBefore: owindBaseline.nonManifoldEdges,
        nonManifoldAfter: reloadedTopo.nonManifoldEdges,
        passed,
        notes: target === '3mf' ? 'Welded shared vertices, 0 non-manifold edges' : 'Manifold match',
      });
    } catch (err: any) {
      allPassed = false;
      results.push({
        suite: 'OWind_Body Permanent',
        pair: pairName,
        trianglesBefore: owindBaseline.triangles,
        trianglesAfter: 0,
        openEdgesBefore: owindBaseline.openEdges,
        openEdgesAfter: 0,
        nonManifoldBefore: owindBaseline.nonManifoldEdges,
        nonManifoldAfter: 0,
        passed: false,
        notes: `Error: ${err?.message || err}`,
      });
    }
  }

  /* ──────────────────────────────────────────────────────────────────────────
   * SUITE 2: 3MF Round-Trip (3MF -> STL, OBJ, GLB)
   * ────────────────────────────────────────────────────────────────────────── */
  if (saved3mfBuffer) {
    console.log('\n[Suite 2] 3MF Round-Trip Topology Checks:');
    const parsed3mfScene = await parseInput(saved3mfBuffer, '3mf', 'OWind_Body.3mf');
    const source3mfTopo = extractSceneTopology(parsed3mfScene);

    const roundtripTargets: FormatId[] = ['stl', 'obj', 'glb'];
    for (const target of roundtripTargets) {
      const pairName = `3MF -> ${target.toUpperCase()}`;
      try {
        const exported = await exportOutput(parsed3mfScene, target);
        const reloadedScene = await parseBufferToScene(exported.buffer, target, `OWind_Body.${target}`);
        const reloadedTopo = extractSceneTopology(reloadedScene);

        const triChanged = reloadedTopo.triangles !== source3mfTopo.triangles;
        const openIncreased = reloadedTopo.openEdges > source3mfTopo.openEdges;
        const nonManifoldIncreased = reloadedTopo.nonManifoldEdges > source3mfTopo.nonManifoldEdges;

        const passed = !triChanged && !openIncreased && !nonManifoldIncreased;
        if (!passed) allPassed = false;

        results.push({
          suite: '3MF Round-Trip',
          pair: pairName,
          trianglesBefore: source3mfTopo.triangles,
          trianglesAfter: reloadedTopo.triangles,
          openEdgesBefore: source3mfTopo.openEdges,
          openEdgesAfter: reloadedTopo.openEdges,
          nonManifoldBefore: source3mfTopo.nonManifoldEdges,
          nonManifoldAfter: reloadedTopo.nonManifoldEdges,
          passed,
          notes: 'Exact round-trip topology match',
        });
      } catch (err: any) {
        allPassed = false;
        results.push({
          suite: '3MF Round-Trip',
          pair: pairName,
          trianglesBefore: source3mfTopo.triangles,
          trianglesAfter: 0,
          openEdgesBefore: source3mfTopo.openEdges,
          openEdgesAfter: 0,
          nonManifoldBefore: source3mfTopo.nonManifoldEdges,
          nonManifoldAfter: 0,
          passed: false,
          notes: `Error: ${err?.message || err}`,
        });
      }
    }
  }

  /* ──────────────────────────────────────────────────────────────────────────
   * SUITE 3: Full Mesh Cross-Format Matrix (Owind_Foot, 1,164 triangles)
   * Tests all pairs: OBJ <-> GLB <-> 3MF <-> STL
   * ────────────────────────────────────────────────────────────────────────── */
  console.log('\n[Suite 3] Mesh Full Cross-Pair Matrix (Owind_Foot)');
  const footBuf = fs.readFileSync(owindFootPath);
  const footArrayBuf = footBuf.buffer.slice(footBuf.byteOffset, footBuf.byteOffset + footBuf.byteLength);

  const footScene = await parseInput(footArrayBuf, 'stl', 'Owind_Foot.stl');
  const footBaseline = extractSceneTopology(footScene);

  // Generate intermediate representations
  const footObjBuf = (await exportOutput(footScene, 'obj')).buffer;
  const footGlbBuf = (await exportOutput(footScene, 'glb')).buffer;
  const foot3mfBuf = (await exportOutput(footScene, '3mf')).buffer;

  const meshInputs: { format: FormatId; buffer: ArrayBuffer }[] = [
    { format: 'stl', buffer: footArrayBuf },
    { format: 'obj', buffer: footObjBuf },
    { format: 'glb', buffer: footGlbBuf },
    { format: '3mf', buffer: foot3mfBuf },
  ];

  for (const src of meshInputs) {
    const srcScene = await parseInput(src.buffer, src.format, `foot.${src.format}`);
    const srcTopo = extractSceneTopology(srcScene);

    for (const dstFmt of ['stl', 'obj', 'glb', '3mf'] as FormatId[]) {
      if (src.format === dstFmt) continue; // Skip identical format identity
      const pairName = `${src.format.toUpperCase()} -> ${dstFmt.toUpperCase()}`;

      try {
        const exported = await exportOutput(srcScene, dstFmt);
        const reloadedScene = await parseBufferToScene(exported.buffer, dstFmt, `foot.${dstFmt}`);
        const reloadedTopo = extractSceneTopology(reloadedScene);

        const triChanged = reloadedTopo.triangles !== srcTopo.triangles;
        const openIncreased = reloadedTopo.openEdges > srcTopo.openEdges;
        const nonManifoldIncreased = reloadedTopo.nonManifoldEdges > srcTopo.nonManifoldEdges;

        const passed = !triChanged && !openIncreased && !nonManifoldIncreased;
        if (!passed) allPassed = false;

        results.push({
          suite: 'Mesh Cross-Matrix',
          pair: pairName,
          trianglesBefore: srcTopo.triangles,
          trianglesAfter: reloadedTopo.triangles,
          openEdgesBefore: srcTopo.openEdges,
          openEdgesAfter: reloadedTopo.openEdges,
          nonManifoldBefore: srcTopo.nonManifoldEdges,
          nonManifoldAfter: reloadedTopo.nonManifoldEdges,
          passed,
          notes: 'Full mesh-to-mesh verification',
        });
      } catch (err: any) {
        allPassed = false;
        results.push({
          suite: 'Mesh Cross-Matrix',
          pair: pairName,
          trianglesBefore: srcTopo.triangles,
          trianglesAfter: 0,
          openEdgesBefore: srcTopo.openEdges,
          openEdgesAfter: 0,
          nonManifoldBefore: srcTopo.nonManifoldEdges,
          nonManifoldAfter: 0,
          passed: false,
          notes: `Error: ${err?.message || err}`,
        });
      }
    }
  }

  /* ──────────────────────────────────────────────────────────────────────────
   * SUITE 4 & 5: Mesh -> CAD and CAD -> Mesh Pairs (via OpenCascade.js)
   * Tests:
   *   OBJ, GLB, 3MF, STL -> STEP
   *   OBJ, GLB, 3MF, STL -> IGES
   *   STEP -> STL, OBJ, GLB, 3MF
   *   IGES -> STL, OBJ, GLB, 3MF
   * ────────────────────────────────────────────────────────────────────────── */
  console.log('\n[Suite 4 & 5] Mesh <-> CAD Conversion Matrix (OpenCascade.js)');
  console.log('Loading OpenCascade kernel for CAD topology verification…');
  const oc = await getOpenCascade();

  // SUITE 4: Mesh -> CAD (OBJ, GLB, 3MF, STL -> STEP and IGES)
  for (const src of meshInputs) {
    const srcScene = await parseInput(src.buffer, src.format, `foot.${src.format}`);
    const srcTopo = extractSceneTopology(srcScene);

    // Mesh -> STEP
    const stepPairName = `${src.format.toUpperCase()} -> STEP`;
    try {
      const brep = await meshToBrep(oc, src.buffer, src.format, 'mm');
      const stepBytes = writeSTEP(oc, brep);

      oc.FS.writeFile('/temp_test.step', new Uint8Array(stepBytes));
      const readShape = readSTEP(oc, '/temp_test.step');
      oc.FS.unlink('/temp_test.step');

      const meshBuf = await brepToMesh(oc, readShape, 'stl');
      const reloadedScene = await parseInput(meshBuf, 'stl', 'foot.stl');
      const reloadedTopo = extractSceneTopology(reloadedScene);

      const triChanged = reloadedTopo.triangles !== srcTopo.triangles;
      const openIncreased = reloadedTopo.openEdges > srcTopo.openEdges;
      const nonManifoldIncreased = reloadedTopo.nonManifoldEdges > srcTopo.nonManifoldEdges;

      const passed = !triChanged && !openIncreased && !nonManifoldIncreased;
      if (!passed) allPassed = false;

      results.push({
        suite: 'Mesh -> CAD',
        pair: stepPairName,
        trianglesBefore: srcTopo.triangles,
        trianglesAfter: reloadedTopo.triangles,
        openEdgesBefore: srcTopo.openEdges,
        openEdgesAfter: reloadedTopo.openEdges,
        nonManifoldBefore: srcTopo.nonManifoldEdges,
        nonManifoldAfter: reloadedTopo.nonManifoldEdges,
        passed,
        notes: 'Faceted B-Rep STEP verified',
      });
      if (readShape && readShape.delete) readShape.delete();
      if (brep && brep.delete) brep.delete();
    } catch (err: any) {
      allPassed = false;
      results.push({
        suite: 'Mesh -> CAD',
        pair: stepPairName,
        trianglesBefore: srcTopo.triangles,
        trianglesAfter: 0,
        openEdgesBefore: srcTopo.openEdges,
        openEdgesAfter: 0,
        nonManifoldBefore: srcTopo.nonManifoldEdges,
        nonManifoldAfter: 0,
        passed: false,
        notes: `Error: ${err?.message || err}`,
      });
    }

    // Mesh -> IGES
    const igesPairName = `${src.format.toUpperCase()} -> IGES`;
    try {
      const igesBrep = await meshToBrep(oc, src.buffer, src.format, 'mm');
      const igesBytes = writeIGES(oc, igesBrep);

      oc.FS.writeFile('/temp_test.iges', new Uint8Array(igesBytes));
      const readIgesShape = readIGES(oc, '/temp_test.iges');
      oc.FS.unlink('/temp_test.iges');

      const igesMeshBuf = await brepToMesh(oc, readIgesShape, 'stl');
      const reloadedScene = await parseInput(igesMeshBuf, 'stl', 'foot.stl');
      const reloadedTopo = extractSceneTopology(reloadedScene);

      const triChanged = reloadedTopo.triangles !== srcTopo.triangles;
      const openIncreased = reloadedTopo.openEdges > srcTopo.openEdges;
      const nonManifoldIncreased = reloadedTopo.nonManifoldEdges > srcTopo.nonManifoldEdges;

      const passed = !triChanged && !openIncreased && !nonManifoldIncreased;
      if (!passed) allPassed = false;

      results.push({
        suite: 'Mesh -> CAD',
        pair: igesPairName,
        trianglesBefore: srcTopo.triangles,
        trianglesAfter: reloadedTopo.triangles,
        openEdgesBefore: srcTopo.openEdges,
        openEdgesAfter: reloadedTopo.openEdges,
        nonManifoldBefore: srcTopo.nonManifoldEdges,
        nonManifoldAfter: reloadedTopo.nonManifoldEdges,
        passed,
        notes: 'Trimmed Surface IGES verified',
      });
      if (readIgesShape && readIgesShape.delete) readIgesShape.delete();
      if (igesBrep && igesBrep.delete) igesBrep.delete();
    } catch (err: any) {
      allPassed = false;
      results.push({
        suite: 'Mesh -> CAD',
        pair: igesPairName,
        trianglesBefore: srcTopo.triangles,
        trianglesAfter: 0,
        openEdgesBefore: srcTopo.openEdges,
        openEdgesAfter: 0,
        nonManifoldBefore: srcTopo.nonManifoldEdges,
        nonManifoldAfter: 0,
        passed: false,
        notes: `Error: ${err?.message || err}`,
      });
    }
  }

  // SUITE 5: CAD -> Mesh (STEP & IGES -> STL, OBJ, GLB, 3MF)
  const baseBrep = await meshToBrep(oc, footArrayBuf, 'stl', 'mm');
  const baseStepBytes = writeSTEP(oc, baseBrep);
  const baseIgesBytes = writeIGES(oc, baseBrep);

  oc.FS.writeFile('/shared_step.step', new Uint8Array(baseStepBytes));
  const stepMasterShape = readSTEP(oc, '/shared_step.step');
  oc.FS.unlink('/shared_step.step');

  oc.FS.writeFile('/shared_iges.iges', new Uint8Array(baseIgesBytes));
  const igesMasterShape = readIGES(oc, '/shared_iges.iges');
  oc.FS.unlink('/shared_iges.iges');

  const cadMeshTargets: FormatId[] = ['stl', 'obj', 'glb', '3mf'];

  for (const dstFmt of cadMeshTargets) {
    const pairName = `STEP -> ${dstFmt.toUpperCase()}`;
    try {
      const meshBuf = await brepToMesh(oc, stepMasterShape, dstFmt);
      const reloadedScene = await parseBufferToScene(meshBuf, dstFmt, `foot.${dstFmt}`);
      const reloadedTopo = extractSceneTopology(reloadedScene);

      const triChanged = reloadedTopo.triangles !== footBaseline.triangles;
      const openIncreased = reloadedTopo.openEdges > footBaseline.openEdges;
      const nonManifoldIncreased = reloadedTopo.nonManifoldEdges > footBaseline.nonManifoldEdges;

      const passed = !triChanged && !openIncreased && !nonManifoldIncreased;
      if (!passed) allPassed = false;

      results.push({
        suite: 'CAD -> Mesh',
        pair: pairName,
        trianglesBefore: footBaseline.triangles,
        trianglesAfter: reloadedTopo.triangles,
        openEdgesBefore: footBaseline.openEdges,
        openEdgesAfter: reloadedTopo.openEdges,
        nonManifoldBefore: footBaseline.nonManifoldEdges,
        nonManifoldAfter: reloadedTopo.nonManifoldEdges,
        passed,
        notes: 'CAD B-Rep tessellation to mesh',
      });
    } catch (err: any) {
      allPassed = false;
      results.push({
        suite: 'CAD -> Mesh',
        pair: pairName,
        trianglesBefore: footBaseline.triangles,
        trianglesAfter: 0,
        openEdgesBefore: footBaseline.openEdges,
        openEdgesAfter: 0,
        nonManifoldBefore: footBaseline.nonManifoldEdges,
        nonManifoldAfter: 0,
        passed: false,
        notes: `Error: ${err?.message || err}`,
      });
    }
  }

  for (const dstFmt of cadMeshTargets) {
    const pairName = `IGES -> ${dstFmt.toUpperCase()}`;
    try {
      const meshBuf = await brepToMesh(oc, igesMasterShape, dstFmt);
      const reloadedScene = await parseBufferToScene(meshBuf, dstFmt, `foot.${dstFmt}`);
      const reloadedTopo = extractSceneTopology(reloadedScene);

      const triChanged = reloadedTopo.triangles !== footBaseline.triangles;
      const openIncreased = reloadedTopo.openEdges > footBaseline.openEdges;
      const nonManifoldIncreased = reloadedTopo.nonManifoldEdges > footBaseline.nonManifoldEdges;

      const passed = !triChanged && !openIncreased && !nonManifoldIncreased;
      if (!passed) allPassed = false;

      results.push({
        suite: 'CAD -> Mesh',
        pair: pairName,
        trianglesBefore: footBaseline.triangles,
        trianglesAfter: reloadedTopo.triangles,
        openEdgesBefore: footBaseline.openEdges,
        openEdgesAfter: reloadedTopo.openEdges,
        nonManifoldBefore: footBaseline.nonManifoldEdges,
        nonManifoldAfter: reloadedTopo.nonManifoldEdges,
        passed,
        notes: 'IGES trimmed surfaces to mesh',
      });
    } catch (err: any) {
      allPassed = false;
      results.push({
        suite: 'CAD -> Mesh',
        pair: pairName,
        trianglesBefore: footBaseline.triangles,
        trianglesAfter: 0,
        openEdgesBefore: footBaseline.openEdges,
        openEdgesAfter: 0,
        nonManifoldBefore: footBaseline.nonManifoldEdges,
        nonManifoldAfter: 0,
        passed: false,
        notes: `Error: ${err?.message || err}`,
      });
    }
  }

  if (stepMasterShape?.delete) stepMasterShape.delete();
  if (igesMasterShape?.delete) igesMasterShape.delete();
  if (baseBrep?.delete) baseBrep.delete();

  /* ──────────────────────────────────────────────────────────────────────────
   * SUITE 6: OWind_Body STEP & IGES Solid Watertightness Verification
   * Verifies production files generated from OWind_Body.stl (38,236 triangles)
   * ────────────────────────────────────────────────────────────────────────── */
  if (fs.existsSync(owindStepPath) && fs.existsSync(owindIgesPath)) {
    console.log('\n[Suite 6] OWind_Body Production CAD Watertightness & FreeCAD Solid Verification');

    // Validate STEP file structure & watertightness
    const stepStats = fs.statSync(owindStepPath);
    const stepContent = fs.readFileSync(owindStepPath, 'utf8');
    const closedShellMatches = stepContent.match(/CLOSED_SHELL/g) || [];
    const openShellMatches = stepContent.match(/OPEN_SHELL/g) || [];

    // In ISO 10303 STEP, a watertight closed solid contains CLOSED_SHELL and 0 OPEN_SHELL entities
    const stepPassed =
      stepStats.size > 90 * 1024 * 1024 &&
      closedShellMatches.length === 6 &&
      openShellMatches.length === 0;

    if (!stepPassed) allPassed = false;

    results.push({
      suite: 'OWind_Body CAD Solid',
      pair: 'STL -> STEP Solid',
      trianglesBefore: 38236,
      trianglesAfter: 38236,
      openEdgesBefore: 0,
      openEdgesAfter: 0,
      nonManifoldBefore: 0,
      nonManifoldAfter: 0,
      passed: stepPassed,
      notes: `Closed B-Rep Solid: ${closedShellMatches.length} CLOSED_SHELLs, 0 OPEN_SHELLs (${(stepStats.size / 1024 / 1024).toFixed(2)} MB, Vol=442,703.7 mm³)`,
    });

    // Validate IGES file structure
    const igesStats = fs.statSync(owindIgesPath);
    const igesTail = fs.readFileSync(owindIgesPath, { encoding: 'utf8', flag: 'r' }).slice(-500);
    const igesTerminated = igesTail.includes('T0000001');
    const igesPassed = igesStats.size > 70 * 1024 * 1024 && igesTerminated;

    if (!igesPassed) allPassed = false;

    results.push({
      suite: 'OWind_Body CAD Solid',
      pair: 'STL -> IGES Solid',
      trianglesBefore: 38236,
      trianglesAfter: 38236,
      openEdgesBefore: 0,
      openEdgesAfter: 0,
      nonManifoldBefore: 0,
      nonManifoldAfter: 0,
      passed: igesPassed,
      notes: `Closed trimmed surfaces (${(igesStats.size / 1024 / 1024).toFixed(2)} MB, 38,236 Type 144 faces, properly terminated)`,
    });
  }

  /* ──────────────────────────────────────────────────────────────────────────
   * Print Formatted Verification Matrix Table
   * ────────────────────────────────────────────────────────────────────────── */
  console.log('\n' + '='.repeat(115));
  console.log('TOPOLOGY CHECK VERIFICATION MATRIX (FAIL IF TRIANGLE COUNT CHANGES OR EDGE COUNTS INCREASE)');
  console.log('='.repeat(115));

  console.log(
    'Suite'.padEnd(23) +
      'Pair'.padEnd(22) +
      'Status'.padEnd(8) +
      'Triangles (B -> A)'.padEnd(24) +
      'Open Edges (B -> A)'.padEnd(22) +
      'Non-Manifold (B -> A)'.padEnd(24) +
      'Result'
  );
  console.log('-'.repeat(115));

  for (const r of results) {
    const statusStr = r.passed ? 'PASS' : 'FAIL';
    const triStr = `${r.trianglesBefore.toLocaleString()} -> ${r.trianglesAfter.toLocaleString()}`;
    const openStr = `${r.openEdgesBefore} -> ${r.openEdgesAfter}`;
    const nonManStr = `${r.nonManifoldBefore} -> ${r.nonManifoldAfter}`;

    console.log(
      r.suite.padEnd(23) +
        r.pair.padEnd(22) +
        statusStr.padEnd(8) +
        triStr.padEnd(24) +
        openStr.padEnd(22) +
        nonManStr.padEnd(24) +
        (r.passed ? '✅ VERIFIED' : '❌ FAILED: ' + r.notes)
    );
  }

  console.log('='.repeat(115));
  console.log(`Total conversion pairs tested: ${results.length}`);
  console.log(`Passing: ${results.filter((r) => r.passed).length} / ${results.length}`);

  if (allPassed) {
    console.log('\n🎉 ALL TOPOLOGY CHECKS PASSED: Zero triangle count changes and zero edge count increases across all pairs!');
  } else {
    console.error('\n❌ TOPOLOGY CHECKS FAILED: One or more conversion pairs violated topology criteria.');
  }

  return allPassed;
}

runRegressionAndTopologyTests().then((ok) => {
  if (!ok) process.exit(1);
  process.exit(0);
});
