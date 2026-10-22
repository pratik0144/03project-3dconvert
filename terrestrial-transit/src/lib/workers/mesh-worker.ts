/// <reference lib="webworker" />

import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
// Static imports to avoid Vite dynamic chunk resolution failures in workers
import { zipSync, strToU8, unzipSync, strFromU8 } from 'fflate';

import type { FormatId, UnitScale } from '../formats';

const UNIT_FACTORS: Record<UnitScale, number> = {
  mm: 1,
  cm: 10,
  m: 1000,
  inch: 25.4,
};

interface CustomScale {
  x: number;
  y: number;
  z: number;
}

interface ConvertMessage {
  jobId: string;
  type: 'convert';
  inputBuffer: ArrayBuffer;
  inputFormat: FormatId;
  outputFormat: FormatId;
  unitScale: UnitScale;
  customScale?: CustomScale;
  fileName: string;
}

interface AnalyzeMessage {
  jobId: string;
  type: 'analyze';
  inputBuffer: ArrayBuffer;
  inputFormat: FormatId;
  fileName: string;
}

type WorkerMessage = ConvertMessage | AnalyzeMessage;

if (typeof self !== 'undefined') {
  self.addEventListener('error', (event) => {
    console.error('Unhandled mesh-worker error:', event);
  });

  self.addEventListener('unhandledrejection', (event) => {
    console.error('Unhandled mesh-worker rejection:', event.reason);
  });

  self.onmessage = async (e: MessageEvent<WorkerMessage>) => {
    try {
      if (e.data.type === 'analyze') {
        const { jobId, inputBuffer, inputFormat, fileName } = e.data;
        try {
          const scene = await parseInput(inputBuffer, inputFormat, fileName);
          scene.updateMatrixWorld(true);

          const box = new THREE.Box3();
          let triangles = 0;
          const v = new THREE.Vector3();

          scene.traverse((child) => {
            if (child instanceof THREE.Mesh && child.geometry) {
              const pos = child.geometry.getAttribute('position');
              const idx = child.geometry.getIndex();
              if (pos) {
                triangles += idx ? idx.count / 3 : pos.count / 3;
                for (let i = 0; i < pos.count; i++) {
                  v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(child.matrixWorld);
                  box.expandByPoint(v);
                }
              }
            }
          });

          const size = new THREE.Vector3();
          box.getSize(size);

          self.postMessage({
            jobId,
            type: 'analyze_done',
            data: {
              dimensions: {
                x: Math.max(0, size.x),
                y: Math.max(0, size.y),
                z: Math.max(0, size.z),
              },
              triangles: Math.round(triangles),
            },
          });
        } catch (err: any) {
          self.postMessage({
            jobId,
            type: 'analyze_error',
            error: err?.message || 'Failed to analyze 3D mesh model',
          });
        }
        return;
      }

      const { jobId, inputBuffer, inputFormat, outputFormat, unitScale, customScale, fileName } = e.data;

      try {
        // Parse input
        const scene = await parseInput(inputBuffer, inputFormat, fileName);

        // Apply custom scale if provided, or fallback to unit scale if source is STL
        if (customScale && (customScale.x !== 1 || customScale.y !== 1 || customScale.z !== 1)) {
          scene.traverse((child) => {
            if (child instanceof THREE.Mesh && child.geometry) {
              child.geometry.scale(customScale.x, customScale.y, customScale.z);
            }
          });
        } else if (inputFormat === 'stl') {
          const scaleFactor = UNIT_FACTORS[unitScale];
          if (scaleFactor !== 1) {
            scene.traverse((child) => {
              if (child instanceof THREE.Mesh && child.geometry) {
                child.geometry.scale(scaleFactor, scaleFactor, scaleFactor);
              }
            });
          }
        }

        // Export to target format
        const result = await exportOutput(scene, outputFormat);

        self.postMessage(
          { jobId, type: 'done', data: result },
          { transfer: [result.buffer] }
        );
      } catch (err: any) {
        self.postMessage({
          jobId,
          type: 'error',
          error: err?.message || 'Conversion failed',
        });
      }
    } catch (topErr: any) {
      const jobId = (e.data as any)?.jobId;
      const isAnalyze = (e.data as any)?.type === 'analyze';
      if (jobId) {
        self.postMessage({
          jobId,
          type: isAnalyze ? 'analyze_error' : 'error',
          error: topErr?.message || 'Unexpected worker error occurred',
        });
      }
    }
  };
}

/* ────────── 3MF manual parser (DOMParser unavailable in Workers) ────────── */

/**
 * Weld identical vertices (within tolerance) and eliminate degenerate triangles.
 * Returns an indexed BufferGeometry with unique positions and vertex normals.
 */
export function weldGeometry(geometry: THREE.BufferGeometry, tolerance = 1e-5): THREE.BufferGeometry {
  const pos = geometry.getAttribute('position');
  if (!pos) return geometry;

  const idx = geometry.getIndex();
  const triCount = idx ? idx.count / 3 : pos.count / 3;

  const factor = tolerance > 0 ? 1 / tolerance : 100000;
  const vertexMap = new Map<string, number>();
  const tempPositions: number[] = [];
  const rawTriangles: [number, number, number][] = [];

  function getVertexIndex(x: number, y: number, z: number): number {
    const qx = Math.round(x * factor) / factor;
    const qy = Math.round(y * factor) / factor;
    const qz = Math.round(z * factor) / factor;
    const key = `${qx}_${qy}_${qz}`;
    let vIndex = vertexMap.get(key);
    if (vIndex === undefined) {
      vIndex = tempPositions.length / 3;
      vertexMap.set(key, vIndex);
      tempPositions.push(x, y, z);
    }
    return vIndex;
  }

  for (let i = 0; i < triCount; i++) {
    const i0 = idx ? idx.getX(i * 3) : i * 3;
    const i1 = idx ? idx.getX(i * 3 + 1) : i * 3 + 1;
    const i2 = idx ? idx.getX(i * 3 + 2) : i * 3 + 2;

    const x0 = pos.getX(i0), y0 = pos.getY(i0), z0 = pos.getZ(i0);
    const x1 = pos.getX(i1), y1 = pos.getY(i1), z1 = pos.getZ(i1);
    const x2 = pos.getX(i2), y2 = pos.getY(i2), z2 = pos.getZ(i2);

    const v0 = getVertexIndex(x0, y0, z0);
    const v1 = getVertexIndex(x1, y1, z1);
    const v2 = getVertexIndex(x2, y2, z2);

    // Skip degenerate triangles where vertices are identical
    if (v0 === v1 || v1 === v2 || v2 === v0) continue;

    rawTriangles.push([v0, v1, v2]);
  }

  // Remap indices to keep only vertices that belong to valid triangles
  const remap = new Int32Array(tempPositions.length / 3).fill(-1);
  const finalPositions: number[] = [];
  const finalIndices: number[] = [];

  for (const [v0, v1, v2] of rawTriangles) {
    let r0 = remap[v0];
    if (r0 === -1) {
      r0 = finalPositions.length / 3;
      remap[v0] = r0;
      finalPositions.push(tempPositions[v0 * 3], tempPositions[v0 * 3 + 1], tempPositions[v0 * 3 + 2]);
    }
    let r1 = remap[v1];
    if (r1 === -1) {
      r1 = finalPositions.length / 3;
      remap[v1] = r1;
      finalPositions.push(tempPositions[v1 * 3], tempPositions[v1 * 3 + 1], tempPositions[v1 * 3 + 2]);
    }
    let r2 = remap[v2];
    if (r2 === -1) {
      r2 = finalPositions.length / 3;
      remap[v2] = r2;
      finalPositions.push(tempPositions[v2 * 3], tempPositions[v2 * 3 + 1], tempPositions[v2 * 3 + 2]);
    }
    finalIndices.push(r0, r1, r2);
  }

  const result = new THREE.BufferGeometry();
  result.setAttribute('position', new THREE.Float32BufferAttribute(finalPositions, 3));
  result.setIndex(finalIndices);
  result.computeVertexNormals();
  return result;
}

export function weldScene(scene: THREE.Object3D, tolerance = 1e-5): void {
  scene.traverse((child: any) => {
    if (child.isMesh && child.geometry) {
      child.geometry = weldGeometry(child.geometry, tolerance);
    }
  });
}

/**
 * Parse a 3MF archive without DOMParser by unzipping with fflate
 * and extracting vertices/triangles via regex from all model XML files.
 * Supports standard single-model files, multi-object models, and
 * Bambu Studio / PrusaSlicer assemblies (3D/Objects/*.model).
 */
export function parse3MFBuffer(buffer: ArrayBuffer): THREE.Group {
  const archive = unzipSync(new Uint8Array(buffer));
  const group = new THREE.Group();

  const modelEntries = Object.entries(archive).filter(([name]) => name.endsWith('.model'));
  if (modelEntries.length === 0) throw new Error('No .model file found in 3MF archive');

  for (const [, fileData] of modelEntries) {
    const modelXml = strFromU8(fileData as Uint8Array);
    if (!modelXml.includes('<mesh')) continue;

    const objectRe = /<object\b[^>]*>([\s\S]*?)<\/object>/gi;
    let objMatch: RegExpExecArray | null;
    let foundInFile = false;

    while ((objMatch = objectRe.exec(modelXml)) !== null) {
      const objXml = objMatch[1];
      if (!objXml.includes('<mesh')) continue;

      const vertices: number[] = [];
      const indices: number[] = [];

      const vertexRe = /<vertex\b([^>]+)\/>/gi;
      let m: RegExpExecArray | null;
      while ((m = vertexRe.exec(objXml)) !== null) {
        const a = m[1];
        const x = parseFloat(a.match(/\bx=["']([^"']+)["']/i)?.[1] || '0');
        const y = parseFloat(a.match(/\by=["']([^"']+)["']/i)?.[1] || '0');
        const z = parseFloat(a.match(/\bz=["']([^"']+)["']/i)?.[1] || '0');
        vertices.push(x, y, z);
      }

      const triRe = /<triangle\b([^>]+)\/>/gi;
      while ((m = triRe.exec(objXml)) !== null) {
        const a = m[1];
        const v1 = parseInt(a.match(/\bv1=["']([^"']+)["']/i)?.[1] || '0', 10);
        const v2 = parseInt(a.match(/\bv2=["']([^"']+)["']/i)?.[1] || '0', 10);
        const v3 = parseInt(a.match(/\bv3=["']([^"']+)["']/i)?.[1] || '0', 10);
        indices.push(v1, v2, v3);
      }

      if (vertices.length > 0) {
        foundInFile = true;
        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        if (indices.length > 0) geom.setIndex(indices);
        geom.computeVertexNormals();

        const welded = weldGeometry(geom);
        const mat = new THREE.MeshStandardMaterial({ color: 0xcccccc });
        group.add(new THREE.Mesh(welded, mat));
      }
    }

    if (!foundInFile) {
      const vertices: number[] = [];
      const indices: number[] = [];
      const vertexRe = /<vertex\b([^>]+)\/>/gi;
      let m: RegExpExecArray | null;
      while ((m = vertexRe.exec(modelXml)) !== null) {
        const a = m[1];
        const x = parseFloat(a.match(/\bx=["']([^"']+)["']/i)?.[1] || '0');
        const y = parseFloat(a.match(/\by=["']([^"']+)["']/i)?.[1] || '0');
        const z = parseFloat(a.match(/\bz=["']([^"']+)["']/i)?.[1] || '0');
        vertices.push(x, y, z);
      }
      const triRe = /<triangle\b([^>]+)\/>/gi;
      while ((m = triRe.exec(modelXml)) !== null) {
        const a = m[1];
        const v1 = parseInt(a.match(/\bv1=["']([^"']+)["']/i)?.[1] || '0', 10);
        const v2 = parseInt(a.match(/\bv2=["']([^"']+)["']/i)?.[1] || '0', 10);
        const v3 = parseInt(a.match(/\bv3=["']([^"']+)["']/i)?.[1] || '0', 10);
        indices.push(v1, v2, v3);
      }
      if (vertices.length > 0) {
        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        if (indices.length > 0) geom.setIndex(indices);
        geom.computeVertexNormals();
        const welded = weldGeometry(geom);
        group.add(new THREE.Mesh(welded, new THREE.MeshStandardMaterial({ color: 0xcccccc })));
      }
    }
  }

  if (group.children.length === 0) {
    throw new Error('No vertices found in 3MF model');
  }

  return group;
}

export async function parseInput(
  buffer: ArrayBuffer,
  format: FormatId,
  fileName: string,
): Promise<THREE.Group | THREE.Mesh> {
  switch (format) {
    case 'stl': {
      const loader = new STLLoader();
      const rawGeometry = loader.parse(buffer);
      const geometry = weldGeometry(rawGeometry);
      const material = new THREE.MeshStandardMaterial({ color: 0xcccccc });
      const mesh = new THREE.Mesh(geometry, material);
      const group = new THREE.Group();
      group.add(mesh);
      return group;
    }
    case 'obj': {
      const loader = new OBJLoader();
      const text = new TextDecoder().decode(buffer);
      const group = loader.parse(text);
      weldScene(group);
      return group;
    }
    case 'glb': {
      const loader = new GLTFLoader();
      return new Promise((resolve, reject) => {
        loader.parse(buffer, '', (gltf) => {
          weldScene(gltf.scene);
          resolve(gltf.scene);
        }, (err) => {
          reject(new Error(err?.message || 'Failed to parse GLB'));
        });
      });
    }
    case '3mf': {
      // Manual parser - DOMParser is not available in Web Workers
      return parse3MFBuffer(buffer);
    }
    default:
      throw new Error(`Unsupported input format: ${format}`);
  }
}

/**
 * Helper: convert whatever GLTFExporter produces (ArrayBuffer, Blob, or JSON object)
 * into a guaranteed ArrayBuffer, since the behaviour varies across three.js versions
 * and environments (main thread vs. Web Worker).
 */
async function gltfResultToArrayBuffer(result: unknown): Promise<ArrayBuffer> {
  if (result instanceof ArrayBuffer) {
    return result;
  }
  // three.js r186+ may return a Blob in some environments
  if (typeof Blob !== 'undefined' && result instanceof Blob) {
    return await result.arrayBuffer();
  }
  // Fallback: JSON glTF (shouldn't happen with binary: true, but be safe)
  const json = JSON.stringify(result);
  return new TextEncoder().encode(json).buffer as ArrayBuffer;
}

export async function exportOutput(
  scene: THREE.Group | THREE.Mesh | THREE.Object3D,
  format: FormatId,
): Promise<{ buffer: ArrayBuffer; mimeType: string }> {
  switch (format) {
    case 'stl': {
      weldScene(scene);
      const exporter = new STLExporter();
      const result = exporter.parse(scene, { binary: true });
      // STLExporter returns DataView for binary
      const buffer = result instanceof DataView ? result.buffer : new TextEncoder().encode(result as string).buffer;
      return { buffer: buffer as ArrayBuffer, mimeType: 'model/stl' };
    }
    case 'obj': {
      weldScene(scene);
      const exporter = new OBJExporter();
      const result = exporter.parse(scene);
      const buffer = new TextEncoder().encode(result).buffer;
      return { buffer: buffer as ArrayBuffer, mimeType: 'text/plain' };
    }
    case 'glb': {
      weldScene(scene);
      const exporter = new GLTFExporter();
      // Use parseAsync if available (three.js r186+), otherwise fall back to callback
      if (typeof exporter.parseAsync === 'function') {
        const result = await exporter.parseAsync(scene, { binary: true });
        const buffer = await gltfResultToArrayBuffer(result);
        return { buffer, mimeType: 'model/gltf-binary' };
      }
      // Callback fallback
      return new Promise((resolve, reject) => {
        exporter.parse(
          scene,
          async (result) => {
            try {
              const buffer = await gltfResultToArrayBuffer(result);
              resolve({ buffer, mimeType: 'model/gltf-binary' });
            } catch (e) {
              reject(e);
            }
          },
          (err) => reject(new Error(String(err))),
          { binary: true },
        );
      });
    }
    case '3mf': {
      // three.js doesn't have a 3MF exporter built-in.
      // We'll create a minimal 3MF file (it's a ZIP with XML).
      scene.updateMatrixWorld(true);

      // Collect all meshes
      const meshes: THREE.Mesh[] = [];
      scene.traverse((child) => {
        if (child instanceof THREE.Mesh && child.geometry) meshes.push(child);
      });

      if (meshes.length === 0) throw new Error('No meshes found to export');

      // Weld all mesh vertices in world space and eliminate degenerate triangles
      const factor = 100000; // 1e-5 tolerance
      const vertexMap = new Map<string, number>();
      const tempVertices: THREE.Vector3[] = [];
      const rawTriangles: [number, number, number][] = [];
      const worldPos = new THREE.Vector3();

      function getVertexIndex(v: THREE.Vector3): number {
        const qx = Math.round(v.x * factor) / factor;
        const qy = Math.round(v.y * factor) / factor;
        const qz = Math.round(v.z * factor) / factor;
        const key = `${qx}_${qy}_${qz}`;
        let idx = vertexMap.get(key);
        if (idx === undefined) {
          idx = tempVertices.length;
          vertexMap.set(key, idx);
          tempVertices.push(v.clone());
        }
        return idx;
      }

      for (const mesh of meshes) {
        const geom = mesh.geometry;
        const pos = geom.getAttribute('position');
        if (!pos) continue;
        const idx = geom.getIndex();
        const triCount = idx ? idx.count / 3 : pos.count / 3;

        for (let i = 0; i < triCount; i++) {
          const i0 = idx ? idx.getX(i * 3) : i * 3;
          const i1 = idx ? idx.getX(i * 3 + 1) : i * 3 + 1;
          const i2 = idx ? idx.getX(i * 3 + 2) : i * 3 + 2;

          worldPos.set(pos.getX(i0), pos.getY(i0), pos.getZ(i0)).applyMatrix4(mesh.matrixWorld);
          const v0 = getVertexIndex(worldPos);

          worldPos.set(pos.getX(i1), pos.getY(i1), pos.getZ(i1)).applyMatrix4(mesh.matrixWorld);
          const v1 = getVertexIndex(worldPos);

          worldPos.set(pos.getX(i2), pos.getY(i2), pos.getZ(i2)).applyMatrix4(mesh.matrixWorld);
          const v2 = getVertexIndex(worldPos);

          // Skip degenerate triangles where vertices are identical
          if (v0 === v1 || v1 === v2 || v2 === v0) continue;

          rawTriangles.push([v0, v1, v2]);
        }
      }

      // Remap to ensure strictly contiguous vertex indices and no orphan vertices
      const remap = new Int32Array(tempVertices.length).fill(-1);
      const uniqueVertices: THREE.Vector3[] = [];
      const triangles: [number, number, number][] = [];

      for (const [v0, v1, v2] of rawTriangles) {
        let r0 = remap[v0];
        if (r0 === -1) {
          r0 = uniqueVertices.length;
          remap[v0] = r0;
          uniqueVertices.push(tempVertices[v0]);
        }
        let r1 = remap[v1];
        if (r1 === -1) {
          r1 = uniqueVertices.length;
          remap[v1] = r1;
          uniqueVertices.push(tempVertices[v1]);
        }
        let r2 = remap[v2];
        if (r2 === -1) {
          r2 = uniqueVertices.length;
          remap[v2] = r2;
          uniqueVertices.push(tempVertices[v2]);
        }
        triangles.push([r0, r1, r2]);
      }

      // Build 3MF XML
      let verticesXml = '';
      for (const v of uniqueVertices) {
        verticesXml += `        <vertex x="${v.x}" y="${v.y}" z="${v.z}" />\n`;
      }

      let trianglesXml = '';
      for (const [v0, v1, v2] of triangles) {
        trianglesXml += `        <triangle v1="${v0}" v2="${v1}" v3="${v2}" />\n`;
      }

      const modelXml = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <resources>
    <object id="1" type="model">
      <mesh>
        <vertices>
${verticesXml}        </vertices>
        <triangles>
${trianglesXml}        </triangles>
      </mesh>
    </object>
  </resources>
  <build>
    <item objectid="1" />
  </build>
</model>`;

      const contentTypes = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml" />
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" />
</Types>`;

      const rels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" />
</Relationships>`;

      const zipped = zipSync({
        '[Content_Types].xml': strToU8(contentTypes),
        '_rels/.rels': strToU8(rels),
        '3D/3dmodel.model': strToU8(modelXml),
      });

      return { buffer: zipped.buffer as ArrayBuffer, mimeType: 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml' };
    }
    default:
      throw new Error(`Unsupported output format: ${format}`);
  }
}
