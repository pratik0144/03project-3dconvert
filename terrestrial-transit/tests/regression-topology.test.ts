import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { unzipSync, strFromU8 } from 'fflate';

// Polyfill worker environment for node execution
globalThis.self = globalThis as any;
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
import type { FormatId } from '../src/lib/formats.ts';

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
      nonManifoldEdges += (count - revCount);
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

  // If single mesh, analyze directly
  if (geometries.length === 1) {
    return analyzeTopology(geometries[0]);
  }

  // Multi-mesh scene: aggregate topology stats across meshes
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

/**
 * Parse an exported buffer back into a Three.js scene for topology check.
 * Uses the engine's parseInput to verify how the converter loads the format.
 */
export async function parseBufferToScene(
  buffer: ArrayBuffer,
  format: FormatId,
  name: string
): Promise<THREE.Object3D> {
  return parseInput(buffer, format, name);
}

async function runRegressionAndTopologyTests(): Promise<boolean> {
  console.log('='.repeat(80));
  console.log('3D Model Converter — Topology & Regression Verification Test Suite');
  console.log('='.repeat(80));

  const results: VerificationResult[] = [];
  let allPassed = true;

  // Resolve test file path
  const owindBodyPath = path.resolve(process.cwd(), '../testing-3d/OWind_Body.stl');
  const owindFootPath = path.resolve(process.cwd(), '../testing-3d/Owind_Foot.stl');

  if (!fs.existsSync(owindBodyPath)) {
    throw new Error(`Permanent regression test file not found at: ${owindBodyPath}`);
  }

  /* ──────────────────────────────────────────────────────────────────────────
   * SUITE 1: Permanent Regression Test — OWind_Body.stl (38,236 triangles)
   * ────────────────────────────────────────────────────────────────────────── */
  console.log('\n[Suite 1] Permanent Regression Test: OWind_Body.stl');
  console.log('- Input file has 38,314 triangles in raw header, with 78 degenerate triangles.');
  console.log('- Expected valid manifold topology: 38,236 triangles, 0 open edges, 0 non-manifold edges.');

  const owindBuffer = fs.readFileSync(owindBodyPath);
  const owindArrayBuf = owindBuffer.buffer.slice(
    owindBuffer.byteOffset,
    owindBuffer.byteOffset + owindBuffer.byteLength
  );

  // Parse input
  const inputScene = await parseInput(owindArrayBuf, 'stl', 'OWind_Body.stl');
  const baselineTopo = extractSceneTopology(inputScene);

  console.log(
    `Baseline parsed: Triangles=${baselineTopo.triangles}, OpenEdges=${baselineTopo.openEdges}, NonManifoldEdges=${baselineTopo.nonManifoldEdges}`
  );

  // Assert baseline meets regression requirement
  if (baselineTopo.triangles !== 38236) {
    console.error(`❌ FAILED: OWind_Body baseline triangles = ${baselineTopo.triangles}, expected 38236`);
    allPassed = false;
  }
  if (baselineTopo.openEdges !== 0 || baselineTopo.nonManifoldEdges !== 0) {
    console.error(
      `❌ FAILED: OWind_Body baseline is not closed manifold: open=${baselineTopo.openEdges}, nonManifold=${baselineTopo.nonManifoldEdges}`
    );
    allPassed = false;
  }

  // Targets to test for OWind_Body
  const regressionTargets: FormatId[] = ['3mf', 'obj', 'glb', 'stl'];
  let saved3mfBuffer: ArrayBuffer | null = null;

  for (const target of regressionTargets) {
    const pairName = `STL -> ${target.toUpperCase()}`;
    try {
      const exported = await exportOutput(inputScene, target);
      if (target === '3mf') saved3mfBuffer = exported.buffer;

      // Reload exported file and analyze topology
      const reloadedScene = await parseBufferToScene(exported.buffer, target, `OWind_Body.${target}`);
      const reloadedTopo = extractSceneTopology(reloadedScene);

      // Check failure rule:
      // Fail any pair where triangle count changes or edge counts increase
      const triChanged = reloadedTopo.triangles !== baselineTopo.triangles;
      const openIncreased = reloadedTopo.openEdges > baselineTopo.openEdges;
      const nonManifoldIncreased = reloadedTopo.nonManifoldEdges > baselineTopo.nonManifoldEdges;

      const passed = !triChanged && !openIncreased && !nonManifoldIncreased;
      if (!passed) allPassed = false;

      let notes = 'Exact manifold match';
      if (target === '3mf') {
        notes = 'Welded shared vertices, 0 non-manifold edges';
      } else if (target === 'obj') {
        notes = 'Welded shared vertices, indexed faces';
      } else if (target === 'glb') {
        notes = 'Indexed binary glTF primitive';
      }

      results.push({
        suite: 'OWind_Body Regression',
        pair: pairName,
        trianglesBefore: baselineTopo.triangles,
        trianglesAfter: reloadedTopo.triangles,
        openEdgesBefore: baselineTopo.openEdges,
        openEdgesAfter: reloadedTopo.openEdges,
        nonManifoldBefore: baselineTopo.nonManifoldEdges,
        nonManifoldAfter: reloadedTopo.nonManifoldEdges,
        passed,
        notes,
      });
    } catch (err: any) {
      allPassed = false;
      results.push({
        suite: 'OWind_Body Regression',
        pair: pairName,
        trianglesBefore: baselineTopo.triangles,
        trianglesAfter: 0,
        openEdgesBefore: baselineTopo.openEdges,
        openEdgesAfter: 0,
        nonManifoldBefore: baselineTopo.nonManifoldEdges,
        nonManifoldAfter: 0,
        passed: false,
        notes: `Error: ${err?.message || err}`,
      });
    }
  }

  // Also test 3MF Round-Trip (3MF -> STL, 3MF -> OBJ, 3MF -> GLB)
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
          notes: 'Full round-trip topology preservation',
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
   * SUITE 3: Real-World Model — Owind_Foot.stl (1,164 triangles)
   * ────────────────────────────────────────────────────────────────────────── */
  if (fs.existsSync(owindFootPath)) {
    console.log('\n[Suite 3] Real-World Model: Owind_Foot.stl');
    const footBuf = fs.readFileSync(owindFootPath);
    const footArrayBuf = footBuf.buffer.slice(footBuf.byteOffset, footBuf.byteOffset + footBuf.byteLength);

    const footScene = await parseInput(footArrayBuf, 'stl', 'Owind_Foot.stl');
    const footBaselineTopo = extractSceneTopology(footScene);

    for (const target of regressionTargets) {
      const pairName = `STL -> ${target.toUpperCase()}`;
      try {
        const exported = await exportOutput(footScene, target);
        const reloadedScene = await parseBufferToScene(exported.buffer, target, `Owind_Foot.${target}`);
        const reloadedTopo = extractSceneTopology(reloadedScene);

        const triChanged = reloadedTopo.triangles !== footBaselineTopo.triangles;
        const openIncreased = reloadedTopo.openEdges > footBaselineTopo.openEdges;
        const nonManifoldIncreased = reloadedTopo.nonManifoldEdges > footBaselineTopo.nonManifoldEdges;

        const passed = !triChanged && !openIncreased && !nonManifoldIncreased;
        if (!passed) allPassed = false;

        results.push({
          suite: 'Owind_Foot Model',
          pair: pairName,
          trianglesBefore: footBaselineTopo.triangles,
          trianglesAfter: reloadedTopo.triangles,
          openEdgesBefore: footBaselineTopo.openEdges,
          openEdgesAfter: reloadedTopo.openEdges,
          nonManifoldBefore: footBaselineTopo.nonManifoldEdges,
          nonManifoldAfter: reloadedTopo.nonManifoldEdges,
          passed,
          notes: 'Production foot model verified',
        });
      } catch (err: any) {
        allPassed = false;
        results.push({
          suite: 'Owind_Foot Model',
          pair: pairName,
          trianglesBefore: footBaselineTopo.triangles,
          trianglesAfter: 0,
          openEdgesBefore: footBaselineTopo.openEdges,
          openEdgesAfter: 0,
          nonManifoldBefore: footBaselineTopo.nonManifoldEdges,
          nonManifoldAfter: 0,
          passed: false,
          notes: `Error: ${err?.message || err}`,
        });
      }
    }
  }

  /* ──────────────────────────────────────────────────────────────────────────
   * Print Formatted Verification Matrix Table
   * ────────────────────────────────────────────────────────────────────────── */
  console.log('\n' + '='.repeat(110));
  console.log('TOPOLOGY CHECK VERIFICATION MATRIX (FAIL IF TRIANGLE COUNT CHANGES OR EDGE COUNTS INCREASE)');
  console.log('='.repeat(110));

  console.log(
    'Suite'.padEnd(24) +
    'Pair'.padEnd(14) +
    'Status'.padEnd(8) +
    'Triangles (B -> A)'.padEnd(22) +
    'Open Edges (B -> A)'.padEnd(22) +
    'Non-Manifold (B -> A)'.padEnd(24) +
    'Result'
  );
  console.log('-'.repeat(110));

  for (const r of results) {
    const statusStr = r.passed ? 'PASS' : 'FAIL';
    const triStr = `${r.trianglesBefore.toLocaleString()} -> ${r.trianglesAfter.toLocaleString()}`;
    const openStr = `${r.openEdgesBefore} -> ${r.openEdgesAfter}`;
    const nonManStr = `${r.nonManifoldBefore} -> ${r.nonManifoldAfter}`;

    console.log(
      r.suite.padEnd(24) +
      r.pair.padEnd(14) +
      statusStr.padEnd(8) +
      triStr.padEnd(22) +
      openStr.padEnd(22) +
      nonManStr.padEnd(24) +
      (r.passed ? '✅ VERIFIED' : '❌ FAILED: ' + r.notes)
    );
  }

  console.log('='.repeat(110));

  if (allPassed) {
    console.log('\n🎉 ALL TOPOLOGY CHECKS PASSED: Zero triangle count changes and zero edge count increases!');
  } else {
    console.error('\n❌ TOPOLOGY CHECKS FAILED: One or more conversion pairs violated topology criteria.');
  }

  return allPassed;
}

runRegressionAndTopologyTests().then((ok) => {
  if (!ok) process.exit(1);
});
