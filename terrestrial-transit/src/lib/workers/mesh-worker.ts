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

interface ConvertMessage {
  jobId: string;
  type: 'convert';
  inputBuffer: ArrayBuffer;
  inputFormat: FormatId;
  outputFormat: FormatId;
  unitScale: UnitScale;
  fileName: string;
}

self.onmessage = async (e: MessageEvent<ConvertMessage>) => {
  const { jobId, inputBuffer, inputFormat, outputFormat, unitScale, fileName } = e.data;

  try {
    // Parse input
    const scene = await parseInput(inputBuffer, inputFormat, fileName);

    // Apply unit scale if source is STL (no embedded units)
    if (inputFormat === 'stl') {
      const scaleFactor = UNIT_FACTORS[unitScale];
      if (scaleFactor !== 1) {
        scene.traverse((child) => {
          if (child instanceof THREE.Mesh) {
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
};

/* ────────── 3MF manual parser (DOMParser unavailable in Workers) ────────── */

/**
 * Parse a 3MF archive without DOMParser by unzipping with fflate
 * and extracting vertices/triangles via regex from all model XML files.
 * Supports standard single-model files, multi-object models, and
 * Bambu Studio / PrusaSlicer assemblies (3D/Objects/*.model).
 */
function parse3MFBuffer(buffer: ArrayBuffer): THREE.Group {
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

        const mat = new THREE.MeshStandardMaterial({ color: 0xcccccc });
        group.add(new THREE.Mesh(geom, mat));
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
        group.add(new THREE.Mesh(geom, new THREE.MeshStandardMaterial({ color: 0xcccccc })));
      }
    }
  }

  if (group.children.length === 0) {
    throw new Error('No vertices found in 3MF model');
  }

  return group;
}

async function parseInput(
  buffer: ArrayBuffer,
  format: FormatId,
  fileName: string,
): Promise<THREE.Group | THREE.Mesh> {
  switch (format) {
    case 'stl': {
      const loader = new STLLoader();
      const geometry = loader.parse(buffer);
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
      return group;
    }
    case 'glb': {
      const loader = new GLTFLoader();
      return new Promise((resolve, reject) => {
        loader.parse(buffer, '', (gltf) => {
          resolve(gltf.scene);
        }, (err) => {
          reject(new Error(err?.message || 'Failed to parse GLB'));
        });
      });
    }
    case '3mf': {
      // Manual parser — DOMParser is not available in Web Workers
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

async function exportOutput(
  scene: THREE.Group | THREE.Mesh | THREE.Object3D,
  format: FormatId,
): Promise<{ buffer: ArrayBuffer; mimeType: string }> {
  switch (format) {
    case 'stl': {
      const exporter = new STLExporter();
      const result = exporter.parse(scene, { binary: true });
      // STLExporter returns DataView for binary
      const buffer = result instanceof DataView ? result.buffer : new TextEncoder().encode(result as string).buffer;
      return { buffer: buffer as ArrayBuffer, mimeType: 'model/stl' };
    }
    case 'obj': {
      const exporter = new OBJExporter();
      const result = exporter.parse(scene);
      const buffer = new TextEncoder().encode(result).buffer;
      return { buffer: buffer as ArrayBuffer, mimeType: 'text/plain' };
    }
    case 'glb': {
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
        if (child instanceof THREE.Mesh) meshes.push(child);
      });

      if (meshes.length === 0) throw new Error('No meshes found to export');

      // Build 3MF XML
      let verticesXml = '';
      let trianglesXml = '';
      let vertexOffset = 0;
      const worldPos = new THREE.Vector3();

      for (const mesh of meshes) {
        const geom = mesh.geometry;
        const pos = geom.getAttribute('position');
        const idx = geom.getIndex();

        // Vertices transformed to world space
        for (let i = 0; i < pos.count; i++) {
          worldPos.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(mesh.matrixWorld);
          verticesXml += `        <vertex x="${worldPos.x}" y="${worldPos.y}" z="${worldPos.z}" />\n`;
        }

        // Triangles
        if (idx) {
          for (let i = 0; i < idx.count; i += 3) {
            trianglesXml += `        <triangle v1="${idx.getX(i) + vertexOffset}" v2="${idx.getX(i+1) + vertexOffset}" v3="${idx.getX(i+2) + vertexOffset}" />\n`;
          }
        } else {
          for (let i = 0; i < pos.count; i += 3) {
            trianglesXml += `        <triangle v1="${i + vertexOffset}" v2="${i+1 + vertexOffset}" v3="${i+2 + vertexOffset}" />\n`;
          }
        }

        vertexOffset += pos.count;
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
