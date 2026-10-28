/// <reference lib="webworker" />

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { SimplifyModifier } from 'three/addons/modifiers/SimplifyModifier.js';
// Static imports to avoid Vite dynamic chunk resolution failures in workers
import { zipSync, strToU8, unzipSync, strFromU8 } from 'fflate';

import type { FormatId, UnitScale } from '../formats';

const OC_CDN_BASE = 'https://cdn.jsdelivr.net/npm/opencascade.js@2.0.0-beta.b5ff984/dist';

export const MAX_CAD_TRIANGLES = 20000;
export const STEP_BYTES_PER_TRIANGLE = 2660; // ~2.6 KB per triangle

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
  simplifyTarget?: number;
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

let ocInstance: any = null;

/**
 * Load OpenCascade.js from CDN using fetch + Function evaluation.
 * The CDN file is UMD-style (not ESM), so dynamic import() won't work
 * in a module Web Worker. Instead we fetch the source, evaluate it,
 * then call the factory with locateFile to point at the WASM.
 */
async function getOpenCascade() {
  if (ocInstance) return ocInstance;

  if (typeof self !== 'undefined' && typeof self.postMessage === 'function') {
    self.postMessage({ type: 'progress', message: 'Loading CAD engine (~20 MB WASM)…' });
  }

  const jsUrl = `${OC_CDN_BASE}/opencascade.full.js`;
  const wasmUrl = `${OC_CDN_BASE}/opencascade.full.wasm`;

  // Fetch the JS source
  const response = await fetch(jsUrl);
  if (!response.ok) throw new Error(`Failed to fetch OpenCascade.js: ${response.status}`);
  const source = await response.text();
  // Strip trailing "export default Module;" so new Function doesn't throw SyntaxError
  const cleanedSource = source.replace(/export\s+default\s+Module\s*;?\s*$/, '');
  const factory = new Function(`${cleanedSource}\nreturn Module;`)();

  // Call the factory with locateFile to resolve the WASM URL
  const instance = await factory({
    locateFile: (file: string) => {
      if (file.endsWith('.wasm')) return wasmUrl;
      return file;
    },
  });

  // Ensure module is ready
  if (instance && instance.ready) {
    await instance.ready;
  }

  ocInstance = instance;
  return ocInstance;
}

if (typeof self !== 'undefined') {
  self.addEventListener('error', (event) => {
    console.error('Unhandled cad-worker error:', event);
  });

  self.addEventListener('unhandledrejection', (event) => {
    console.error('Unhandled cad-worker rejection:', event.reason);
  });

  self.onmessage = async (e: MessageEvent<WorkerMessage>) => {
    try {
      if (e.data.type === 'analyze') {
    const { jobId, inputBuffer, inputFormat } = e.data;
    try {
      const oc = await getOpenCascade();
      const tempName = `/analyze_${Date.now()}${getExtension(inputFormat)}`;
      oc.FS.writeFile(tempName, new Uint8Array(inputBuffer));
      let shape: any;
      if (inputFormat === 'step') {
        shape = readSTEP(oc, tempName);
      } else if (inputFormat === 'iges') {
        shape = readIGES(oc, tempName);
      } else {
        shape = await meshToBrep(oc, inputBuffer, inputFormat, 'mm');
      }
      try { oc.FS.unlink(tempName); } catch {}

      new oc.BRepMesh_IncrementalMesh_2(shape, 0.1, false, 0.5, false);
      let minX = Infinity, minY = Infinity, minZ = Infinity;
      let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
      let triCount = 0;

      const explorer = new oc.TopExp_Explorer_2(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
      while (explorer.More()) {
        const face = oc.TopoDS.Face_1(explorer.Current());
        const location = new oc.TopLoc_Location_1();
        const triangulation = oc.BRep_Tool.Triangulation(face, location, 0);
        if (!triangulation.IsNull()) {
          const tri = triangulation.get();
          const nbNodes = tri.NbNodes();
          triCount += tri.NbTriangles();
          const trsf = location.Transformation();
          for (let i = 1; i <= nbNodes; i++) {
            const p = tri.Node(i).Transformed(trsf);
            const x = p.X(), y = p.Y(), z = p.Z();
            if (x < minX) minX = x; if (x > maxX) maxX = x;
            if (y < minY) minY = y; if (y > maxY) maxY = y;
            if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
            p.delete();
          }
        }
        location.delete();
        explorer.Next();
      }
      explorer.delete();
      if (shape && shape.delete) shape.delete();

      self.postMessage({
        jobId,
        type: 'analyze_done',
        data: {
          dimensions: {
            x: isFinite(maxX - minX) ? Math.max(0, maxX - minX) : 0,
            y: isFinite(maxY - minY) ? Math.max(0, maxY - minY) : 0,
            z: isFinite(maxZ - minZ) ? Math.max(0, maxZ - minZ) : 0,
          },
          triangles: triCount,
          isCad: true,
        },
      });
    } catch (err: any) {
      self.postMessage({
        jobId,
        type: 'analyze_error',
        error: err?.message || 'Failed to analyze CAD model',
      });
    }
    return;
  }

  const { jobId, inputBuffer, inputFormat, outputFormat, unitScale, customScale, simplifyTarget, fileName } = e.data;

  try {
    const oc = await getOpenCascade();

    if (!oc || !oc.FS) {
      throw new Error('OpenCascade loaded but FS not available. Keys: ' + (oc ? Object.keys(oc).slice(0, 10).join(',') : 'null'));
    }

    const uint8 = new Uint8Array(inputBuffer);

    // Write input file to virtual filesystem
    const inputFileName = `input${getExtension(inputFormat)}`;
    try {
      oc.FS.writeFile(`/${inputFileName}`, uint8);
    } catch (fsErr: any) {
      throw new Error(`FS.writeFile(/${inputFileName}) failed: ${fsErr?.message || fsErr}`);
    }

    let shape: any;

    // Read input
    if (inputFormat === 'step') {
      shape = readSTEP(oc, `/${inputFileName}`);
    } else if (inputFormat === 'iges') {
      shape = readIGES(oc, `/${inputFileName}`);
    } else {
      // Mesh input -> STEP/IGES: read the mesh, create faceted BREP
      shape = await meshToBrep(oc, inputBuffer, inputFormat, unitScale, customScale, simplifyTarget);
    }

    // Apply scale to CAD shape if input was CAD and scale is uniform
    if ((inputFormat === 'step' || inputFormat === 'iges') && customScale && (customScale.x !== 1 || customScale.y !== 1 || customScale.z !== 1)) {
      if (customScale.x === customScale.y && customScale.y === customScale.z) {
        const trsf = new oc.gp_Trsf_1();
        trsf.SetScale(new oc.gp_Pnt_3(0, 0, 0), customScale.x);
        const transformer = new oc.BRepBuilderAPI_Transform_2(shape, trsf, true);
        const scaledShape = transformer.Shape();
        if (shape && shape.delete) shape.delete();
        shape = scaledShape;
        transformer.delete();
        trsf.delete();
      }
    }

    // Write output
    let resultBuffer: ArrayBuffer;
    let mimeType: string;

    if (outputFormat === 'step') {
      resultBuffer = writeSTEP(oc, shape);
      mimeType = 'model/step';
    } else if (outputFormat === 'iges') {
      throw new Error('IGES is supported as an input format only.');
    } else {
      // CAD -> Mesh: tessellate the shape
      resultBuffer = await brepToMesh(oc, shape, outputFormat, customScale);
      mimeType = getMimeType(outputFormat);
    }

    // Cleanup virtual filesystem
    try { oc.FS.unlink(`/${inputFileName}`); } catch {}
    try { oc.FS.unlink('/output.step'); } catch {}
    try { oc.FS.unlink('/output.iges'); } catch {}
    try { oc.FS.unlink('/mesh_temp.stl'); } catch {}
    if (shape && shape.delete) shape.delete();

    self.postMessage(
      { jobId, type: 'done', data: { buffer: resultBuffer, mimeType } },
      { transfer: [resultBuffer] }
    );
  } catch (err: any) {
    self.postMessage({
      jobId,
      type: 'error',
      error: err?.message || 'CAD conversion failed',
    });
  }
} catch (topErr: any) {
  const jobId = (e.data as any)?.jobId;
  const isAnalyze = (e.data as any)?.type === 'analyze';
  if (jobId) {
    self.postMessage({
      jobId,
      type: isAnalyze ? 'analyze_error' : 'error',
      error: topErr?.message || 'Unexpected CAD worker error occurred',
    });
  }
}
};
}

/* ────────── STEP / IGES Readers with fallback strategies ────────── */

/**
 * Read a STEP file with multiple transfer fallback strategies.
 * Strategy 1: TransferRoots (standard bulk transfer)
 * Strategy 2: TransferRoot(i) for each root individually
 * Strategy 3: Retrieve shapes by index if transfer reported success
 */
export function readSTEP(oc: any, filePath: string): any {
  const reader = new oc.STEPControl_Reader_1();
  const status = reader.ReadFile(filePath);
  if (status !== oc.IFSelect_ReturnStatus.IFSelect_RetDone) {
    reader.delete();
    throw new Error('Failed to read STEP file');
  }

  const nbRoots = reader.NbRootsForTransfer();
  let transferred = 0;

  // Strategy 1: TransferRoots with progress range
  try {
    transferred = reader.TransferRoots(new oc.Message_ProgressRange_1());
  } catch { /* fallback below */ }

  // Strategy 2: Transfer individual roots if bulk transfer failed
  if (transferred === 0 && nbRoots > 0) {
    for (let i = 1; i <= nbRoots; i++) {
      try {
        const ok = reader.TransferRoot(i, new oc.Message_ProgressRange_1());
        if (ok) transferred++;
      } catch { /* continue to next root */ }
    }
  }

  let shape: any = null;

  // Try OneShape first
  try {
    shape = reader.OneShape();
  } catch { /* fallback */ }

  // Strategy 3: Get shapes individually if OneShape returned null
  if (!shape || shape.IsNull()) {
    const nbShapes = reader.NbShapes();
    if (nbShapes > 0) {
      if (nbShapes === 1) {
        try { shape = reader.Shape(1); } catch { /* fallback */ }
      } else {
        // Multiple shapes - combine into a compound
        try {
          const builder = new oc.BRep_Builder();
          const compound = new oc.TopoDS_Compound();
          builder.MakeCompound(compound);
          for (let i = 1; i <= nbShapes; i++) {
            try {
              const s = reader.Shape(i);
              if (s && !s.IsNull()) builder.Add(compound, s);
            } catch { /* skip */ }
          }
          shape = compound;
        } catch { /* fallback */ }
      }
    }
  }

  reader.delete();

  if (!shape || shape.IsNull()) {
    throw new Error('No geometry could be extracted from the STEP file');
  }

  return shape;
}

/**
 * Read an IGES file with multiple transfer fallback strategies.
 */
export function readIGES(oc: any, filePath: string): any {
  const reader = new oc.IGESControl_Reader_1();
  const status = reader.ReadFile(filePath);
  if (status !== oc.IFSelect_ReturnStatus.IFSelect_RetDone) {
    reader.delete();
    throw new Error('Failed to read IGES file');
  }

  const nbRoots = reader.NbRootsForTransfer();
  let transferred = 0;

  // Strategy 1: TransferRoots with progress range
  try {
    transferred = reader.TransferRoots(new oc.Message_ProgressRange_1());
  } catch { /* fallback below */ }

  // Strategy 2: Transfer individual roots
  if (transferred === 0 && nbRoots > 0) {
    for (let i = 1; i <= nbRoots; i++) {
      try {
        const ok = reader.TransferRoot(i, new oc.Message_ProgressRange_1());        if (ok) transferred++;
      } catch { /* continue */ }
    }
  }

  let shape: any = null;

  try {
    shape = reader.OneShape();
  } catch { /* fallback */ }

  if (!shape || shape.IsNull()) {
    const nbShapes = reader.NbShapes();
    if (nbShapes > 0) {
      if (nbShapes === 1) {
        try { shape = reader.Shape(1); } catch { /* fallback */ }
      } else {
        try {
          const builder = new oc.BRep_Builder();
          const compound = new oc.TopoDS_Compound();
          builder.MakeCompound(compound);
          for (let i = 1; i <= nbShapes; i++) {
            try {
              const s = reader.Shape(i);
              if (s && !s.IsNull()) builder.Add(compound, s);
            } catch { /* skip */ }
          }
          shape = compound;
        } catch { /* fallback */ }
      }
    }
  }

  reader.delete();

  if (!shape || shape.IsNull()) {
    throw new Error('No geometry could be extracted from the IGES file');
  }

  return shape;
}

/* ────────── STEP / IGES Writers ────────── */

/**
 * Write a shape to STEP format.
 */
export function writeSTEP(oc: any, shape: any): ArrayBuffer {
  const writer = new oc.STEPControl_Writer_1();

  try {
    writer.Transfer(shape, oc.STEPControl_StepModelType.STEPControl_AsIs, true, new oc.Message_ProgressRange_1());
  } catch (e: any) {
    writer.delete();
    throw new Error(`STEP Transfer failed: ${e?.message || e}`);
  }

  try {
    writer.Write('/output.step');
  } catch (e: any) {
    writer.delete();
    throw new Error(`STEP Write failed: ${e?.message || e}`);
  }

  let data: Uint8Array;
  try {
    data = oc.FS.readFile('/output.step');
  } catch (e: any) {
    writer.delete();
    throw new Error(`STEP FS.readFile failed: ${e?.message || e}`);
  }

  // Copy data from WASM heap into a standalone ArrayBuffer
  const result = new Uint8Array(data).slice(0).buffer as ArrayBuffer;
  writer.delete();
  return result;
}

/**
 * Write a shape to IGES format.
 */
export function writeIGES(oc: any, shape: any): ArrayBuffer {
  const writer = new oc.IGESControl_Writer_1();
  writer.AddShape(shape, new oc.Message_ProgressRange_1());
  writer.ComputeModel();
  writer.Write_2('/output.iges', false);
  const data = oc.FS.readFile('/output.iges');
  const result = new Uint8Array(data).slice(0).buffer as ArrayBuffer;
  writer.delete();
  return result;
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

/* ────────── Build binary STL from BufferGeometry ────────── */

/**
 * Serialize a three.js BufferGeometry into binary STL format.
 * Used to feed mesh data to OpenCascade's StlAPI_Reader for
 * proper BREP construction that round-trips through STEP/IGES.
 */
function buildBinarySTL(geometry: THREE.BufferGeometry): ArrayBuffer {
  const pos = geometry.getAttribute('position');
  const idx = geometry.getIndex();
  const triCount = idx ? idx.count / 3 : pos.count / 3;

  // Binary STL: 80-byte header + 4-byte count + 50 bytes per triangle
  const bufferSize = 80 + 4 + triCount * 50;
  const buffer = new ArrayBuffer(bufferSize);
  const view = new DataView(buffer);

  // Header is zeros by default; write triangle count
  view.setUint32(80, triCount, true);

  let offset = 84;
  const v0 = new THREE.Vector3();
  const v1 = new THREE.Vector3();
  const v2 = new THREE.Vector3();
  const edge1 = new THREE.Vector3();
  const edge2 = new THREE.Vector3();
  const normal = new THREE.Vector3();

  for (let i = 0; i < triCount; i++) {
    const i0 = idx ? idx.getX(i * 3) : i * 3;
    const i1 = idx ? idx.getX(i * 3 + 1) : i * 3 + 1;
    const i2 = idx ? idx.getX(i * 3 + 2) : i * 3 + 2;

    v0.set(pos.getX(i0), pos.getY(i0), pos.getZ(i0));
    v1.set(pos.getX(i1), pos.getY(i1), pos.getZ(i1));
    v2.set(pos.getX(i2), pos.getY(i2), pos.getZ(i2));

    edge1.subVectors(v1, v0);
    edge2.subVectors(v2, v0);
    normal.crossVectors(edge1, edge2).normalize();
    if (!isFinite(normal.x)) normal.set(0, 0, 1);

    // Normal
    view.setFloat32(offset, normal.x, true); offset += 4;
    view.setFloat32(offset, normal.y, true); offset += 4;
    view.setFloat32(offset, normal.z, true); offset += 4;
    // Vertex 1
    view.setFloat32(offset, v0.x, true); offset += 4;
    view.setFloat32(offset, v0.y, true); offset += 4;
    view.setFloat32(offset, v0.z, true); offset += 4;
    // Vertex 2
    view.setFloat32(offset, v1.x, true); offset += 4;
    view.setFloat32(offset, v1.y, true); offset += 4;
    view.setFloat32(offset, v1.z, true); offset += 4;
    // Vertex 3
    view.setFloat32(offset, v2.x, true); offset += 4;
    view.setFloat32(offset, v2.y, true); offset += 4;
    view.setFloat32(offset, v2.z, true); offset += 4;
    // Attribute byte count
    view.setUint16(offset, 0, true); offset += 2;
  }

  return buffer;
}

/* ────────── Mesh → BREP conversion ────────── */

function extractSceneGeometry(scene: THREE.Object3D): THREE.BufferGeometry {
  scene.updateMatrixWorld(true);
  const geometries: THREE.BufferGeometry[] = [];

  scene.traverse((child: any) => {
    if (child.isMesh && child.geometry) {
      const cloned = child.geometry.clone();
      cloned.applyMatrix4(child.matrixWorld);
      geometries.push(cloned);
    }
  });

  if (geometries.length === 0) throw new Error('No geometry found in model');
  if (geometries.length === 1) return geometries[0];

  const merged = mergeGeometries(geometries);
  if (!merged) throw new Error('Failed to merge scene geometries');
  return merged;
}

/**
 * Convert a mesh (STL/OBJ/GLB/3MF) buffer into an OpenCascade TopoDS_Shape.
 *
 * Tries multiple strategies in order:
 * 1. StlAPI_Reader - cleanest, OC builds its own proper shape from STL
 * 2. RWStl + BRep_Builder::MakeFace - reads triangulation, attaches to a face
 * 3. Manual BREP - creates individual planar faces from triangles, then sews
 */
export async function meshToBrep(
  oc: any,
  buffer: ArrayBuffer,
  format: FormatId,
  unitScale: UnitScale,
  customScale?: CustomScale,
  simplifyTarget?: number
): Promise<any> {
  // Parse mesh using three.js to get BufferGeometry
  let geometry: THREE.BufferGeometry;

  if (format === 'stl') {
    const loader = new STLLoader();
    geometry = loader.parse(buffer);
  } else if (format === 'obj') {
    const loader = new OBJLoader();
    const text = new TextDecoder().decode(buffer);
    const group = loader.parse(text);
    geometry = extractSceneGeometry(group);
  } else if (format === 'glb') {
    const loader = new GLTFLoader();
    const gltf = await new Promise<any>((resolve, reject) => {
      loader.parse(buffer, '', resolve, reject);
    });
    geometry = extractSceneGeometry(gltf.scene);
  } else if (format === '3mf') {
    // Custom parser - DOMParser is not available in Web Workers
    const group = parse3MFBuffer(buffer);
    geometry = extractSceneGeometry(group);
  } else {
    throw new Error(`Cannot convert ${format} to BREP`);
  }

  // Apply custom scale if provided, or fallback to unit scale for STL
  if (customScale && (customScale.x !== 1 || customScale.y !== 1 || customScale.z !== 1)) {
    geometry.scale(customScale.x, customScale.y, customScale.z);
  } else if (format === 'stl') {
    const factor = UNIT_FACTORS[unitScale];
    if (factor !== 1) geometry.scale(factor, factor, factor);
  }

  // Weld identical vertices and eliminate degenerate triangles
  geometry = weldGeometry(geometry);

  // Initial triangle count
  const initialTriangles = geometry.getIndex()
    ? geometry.getIndex()!.count / 3
    : geometry.getAttribute('position').count / 3;

  // In-browser simplification based on estimated STEP size (~2.6 KB per triangle)
  // 20,000 triangles corresponds to ~52 MB STEP file (safe for browser WASM memory)
  const targetTriangles = simplifyTarget !== undefined
    ? simplifyTarget
    : (initialTriangles > MAX_CAD_TRIANGLES ? MAX_CAD_TRIANGLES : 0);

  if (targetTriangles > 0 && initialTriangles > targetTriangles) {
    const estMbBefore = ((initialTriangles * STEP_BYTES_PER_TRIANGLE) / (1024 * 1024)).toFixed(1);
    const estMbAfter = ((targetTriangles * STEP_BYTES_PER_TRIANGLE) / (1024 * 1024)).toFixed(1);

    if (typeof self !== 'undefined' && typeof self.postMessage === 'function') {
      self.postMessage({
        type: 'progress',
        message: `Simplifying mesh for CAD export (${Math.round(initialTriangles).toLocaleString()} → ${targetTriangles.toLocaleString()} triangles; estimated STEP size: ${estMbBefore} MB → ~${estMbAfter} MB)…`,
      });
    }

    try {
      const modifier = new SimplifyModifier();
      const posCount = geometry.getAttribute('position').count;
      const ratio = Math.max(0.01, targetTriangles / initialTriangles);
      const countToRemove = Math.floor(posCount * (1 - ratio));
      geometry = await modifier.modify(geometry, countToRemove);
      geometry = weldGeometry(geometry);
    } catch (simErr: any) {
      console.warn('Mesh simplification fallback warning:', simErr);
    }
  }

  // Ensure indexed geometry for consistent access
  if (!geometry.getIndex()) {
    const pos = geometry.getAttribute('position');
    const indices: number[] = [];
    for (let i = 0; i < pos.count; i++) indices.push(i);
    geometry.setIndex(indices);
  }

  // Build binary STL from the mesh geometry
  const stlBytes = buildBinarySTL(geometry);
  try {
    oc.FS.writeFile('/mesh_temp.stl', new Uint8Array(stlBytes));
  } catch (e: any) {
    throw new Error(`meshToBrep FS.writeFile(/mesh_temp.stl) failed (${stlBytes.byteLength} bytes): ${e?.message || e}`);
  }

  let shape: any = null;

  // Strategy 1: StlAPI_Reader - produces proper shapes that round-trip through STEP/IGES
  if (!shape || shape.IsNull?.()) {
    try {
      const Reader = oc.StlAPI_Reader_1 || oc.StlAPI_Reader;
      if (typeof Reader === 'function') {
        const stlReader = new Reader();
        const tempShape = new oc.TopoDS_Shape();
        stlReader.Read(tempShape, '/mesh_temp.stl');
        if (tempShape && !tempShape.IsNull()) {
          shape = tempShape;
        }
        if (stlReader.delete) stlReader.delete();
      }
    } catch { /* StlAPI_Reader not available - try next */ }
  }

  // Strategy 2: RWStl to read triangulation, then attach to a face via BRep_Builder
  if (!shape || shape.IsNull?.()) {
    try {
      let triangulation: any = null;

      // Try different RWStl::ReadFile overloads (use plain string paths)
      try {
        triangulation = oc.RWStl.ReadFile_2
          ? oc.RWStl.ReadFile_2('/mesh_temp.stl', new oc.Message_ProgressRange_1())
          : oc.RWStl.ReadFile_1
            ? oc.RWStl.ReadFile_1('/mesh_temp.stl', new oc.Message_ProgressRange_1())
            : oc.RWStl.ReadFile
              ? oc.RWStl.ReadFile('/mesh_temp.stl', new oc.Message_ProgressRange_1())
              : null;
      } catch {
        try {
          triangulation = oc.RWStl.ReadFile('/mesh_temp.stl');
        } catch { /* RWStl not available */ }
      }

      if (triangulation && !triangulation.IsNull()) {
        const builder = new oc.BRep_Builder();
        const face = new oc.TopoDS_Face();

        // Try MakeFace overloads that accept a triangulation handle
        let faceCreated = false;
        const makeFaceOverloads = ['MakeFace_2', 'MakeFace_3', 'MakeFace'];
        for (const method of makeFaceOverloads) {
          if (typeof builder[method] === 'function' && !faceCreated) {
            try {
              builder[method](face, triangulation);
              faceCreated = true;
            } catch { /* try next overload */ }
          }
        }

        if (faceCreated && !face.IsNull()) {
          const compound = new oc.TopoDS_Compound();
          builder.MakeCompound(compound);
          builder.Add(compound, face);
          shape = compound;
        }
      }
    } catch { /* RWStl approach not available - try next */ }
  }

  // Strategy 3: Manual BREP - build individual planar faces from triangles
  if (!shape || shape.IsNull?.()) {
    shape = buildManualBrep(oc, geometry);
  }

  // Cleanup temp STL file
  try { oc.FS.unlink('/mesh_temp.stl'); } catch {}

  return shape;
}

/**
 * Fallback: build BREP manually from triangles.
 * Uses onlyPlane=true for BRepBuilderAPI_MakeFace to ensure proper
 * Geom_Plane surface creation for STEP/IGES compatibility.
 */
function buildManualBrep(oc: any, geometry: THREE.BufferGeometry): any {
  const builder = new oc.BRep_Builder();
  const compound = new oc.TopoDS_Compound();
  builder.MakeCompound(compound);

  const pos = geometry.getAttribute('position');
  const idx = geometry.getIndex();
  const triCount = idx ? idx.count / 3 : pos.count / 3;

  for (let i = 0; i < triCount; i++) {
    const i0 = idx ? idx.getX(i * 3) : i * 3;
    const i1 = idx ? idx.getX(i * 3 + 1) : i * 3 + 1;
    const i2 = idx ? idx.getX(i * 3 + 2) : i * 3 + 2;

    const p1 = new oc.gp_Pnt_3(pos.getX(i0), pos.getY(i0), pos.getZ(i0));
    const p2 = new oc.gp_Pnt_3(pos.getX(i1), pos.getY(i1), pos.getZ(i1));
    const p3 = new oc.gp_Pnt_3(pos.getX(i2), pos.getY(i2), pos.getZ(i2));

    try {
      // MakePolygon_3 = (P1, P2, P3, Close) for triangular wire
      const wire = new oc.BRepBuilderAPI_MakePolygon_3(p1, p2, p3, true).Wire();
      // onlyPlane=true forces Geom_Plane surface - better STEP/IGES compatibility
      const face = new oc.BRepBuilderAPI_MakeFace_15(wire, true).Face();
      builder.Add(compound, face);
    } catch {
      // Skip degenerate triangles
    }

    p1.delete();
    p2.delete();
    p3.delete();
  }

  // Sew with a relaxed tolerance to handle float32 vertex precision
  const sewing = new oc.BRepBuilderAPI_Sewing(0.01, true, true, true, false);
  sewing.Add(compound);
  sewing.Perform(new oc.Message_ProgressRange_1());
  const result = sewing.SewedShape();
  sewing.delete();
  compound.delete();

  return result;
}

function getExtension(format: FormatId): string {
  switch (format) {
    case 'step': return '.step';
    case 'iges': return '.iges';
    case 'stl': return '.stl';
    case 'obj': return '.obj';
    case 'glb': return '.glb';
    case '3mf': return '.3mf';
  }
}

function getMimeType(format: FormatId): string {
  switch (format) {
    case 'stl': return 'model/stl';
    case 'obj': return 'text/plain';
    case 'glb': return 'model/gltf-binary';
    case '3mf': return 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml';
    default: return 'application/octet-stream';
  }
}

/**
 * Helper: convert whatever GLTFExporter produces (ArrayBuffer, Blob, or JSON object)
 * into a guaranteed ArrayBuffer.
 */
async function gltfResultToArrayBuffer(result: unknown): Promise<ArrayBuffer> {
  if (result instanceof ArrayBuffer) return result;
  if (typeof Blob !== 'undefined' && result instanceof Blob) {
    return await result.arrayBuffer();
  }
  const json = JSON.stringify(result);
  return new TextEncoder().encode(json).buffer as ArrayBuffer;
}

export async function brepToMesh(oc: any, shape: any, outputFormat: FormatId, customScale?: CustomScale): Promise<ArrayBuffer> {
  // Tessellate the shape
  new oc.BRepMesh_IncrementalMesh_2(shape, 0.1, false, 0.5, false);

  // Extract triangulation
  const vertices: number[] = [];
  const indices: number[] = [];
  let vertexOffset = 0;

  const explorer = new oc.TopExp_Explorer_2(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);

  while (explorer.More()) {
    const face = oc.TopoDS.Face_1(explorer.Current());
    const location = new oc.TopLoc_Location_1();
    const triangulation = oc.BRep_Tool.Triangulation(face, location, 0);

    if (!triangulation.IsNull()) {
      const tri = triangulation.get();
      const nbNodes = tri.NbNodes();
      const nbTriangles = tri.NbTriangles();
      const transformation = location.Transformation();

      for (let i = 1; i <= nbNodes; i++) {
        const pnt = tri.Node(i).Transformed(transformation);
        vertices.push(pnt.X(), pnt.Y(), pnt.Z());
        pnt.delete();
      }

      for (let i = 1; i <= nbTriangles; i++) {
        const triangle = tri.Triangle(i);
        const orient = face.Orientation_1();
        if (orient === oc.TopAbs_Orientation.TopAbs_REVERSED) {
          indices.push(
            triangle.Value(1) - 1 + vertexOffset,
            triangle.Value(3) - 1 + vertexOffset,
            triangle.Value(2) - 1 + vertexOffset
          );
        } else {
          indices.push(
            triangle.Value(1) - 1 + vertexOffset,
            triangle.Value(2) - 1 + vertexOffset,
            triangle.Value(3) - 1 + vertexOffset
          );
        }
      }

      vertexOffset += nbNodes;
    }

    location.delete();
    explorer.Next();
  }
  explorer.delete();

  if (vertices.length === 0) {
    throw new Error('No geometry could be extracted from the CAD file');
  }

  // Build three.js geometry and weld shared boundary vertices between CAD faces
  const rawGeometry = new THREE.BufferGeometry();
  rawGeometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  rawGeometry.setIndex(indices);
  rawGeometry.computeVertexNormals();

  const geometry = weldGeometry(rawGeometry);

  // If customScale was non-uniform (uniform scale was already applied to B-Rep shape)
  if (customScale && (customScale.x !== customScale.y || customScale.y !== customScale.z)) {
    geometry.scale(customScale.x, customScale.y, customScale.z);
  }

  const material = new THREE.MeshStandardMaterial({ color: 0xcccccc });
  const mesh = new THREE.Mesh(geometry, material);
  const scene = new THREE.Group();
  scene.add(mesh);

  // Export to target format
  if (outputFormat === 'stl') {
    const exporter = new STLExporter();
    const result = exporter.parse(scene, { binary: true });
    const buffer = result instanceof DataView ? result.buffer : new TextEncoder().encode(result as string).buffer;
    return buffer as ArrayBuffer;
  } else if (outputFormat === 'obj') {
    const exporter = new OBJExporter();
    const result = exporter.parse(scene);
    return new TextEncoder().encode(result).buffer as ArrayBuffer;
  } else if (outputFormat === 'glb') {
    const exporter = new GLTFExporter();
    // Use parseAsync if available (three.js r186+)
    if (typeof exporter.parseAsync === 'function') {
      const result = await exporter.parseAsync(scene, { binary: true });
      return await gltfResultToArrayBuffer(result);
    }
    return new Promise((resolve, reject) => {
      exporter.parse(
        scene,
        async (result) => {
          try {
            resolve(await gltfResultToArrayBuffer(result));
          } catch (e) {
            reject(e);
          }
        },
        (err) => reject(new Error(String(err))),
        { binary: true },
      );
    });
  } else if (outputFormat === '3mf') {
    // Build 3MF with welded vertices and shared triangle indices
    const pos = geometry.getAttribute('position');
    const idx = geometry.getIndex();
    const triCount = idx ? idx.count / 3 : pos.count / 3;

    let verticesXml = '';
    let trianglesXml = '';

    for (let i = 0; i < pos.count; i++) {
      verticesXml += `        <vertex x="${pos.getX(i)}" y="${pos.getY(i)}" z="${pos.getZ(i)}" />\n`;
    }

    if (idx) {
      for (let i = 0; i < triCount; i++) {
        trianglesXml += `        <triangle v1="${idx.getX(i * 3)}" v2="${idx.getX(i * 3 + 1)}" v3="${idx.getX(i * 3 + 2)}" />\n`;
      }
    }

    const modelXml = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <resources>
    <object id="1" type="model">
      <mesh>
        <vertices>\n${verticesXml}        </vertices>
        <triangles>\n${trianglesXml}        </triangles>
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

    return zipped.buffer as ArrayBuffer;
  }

  throw new Error(`Cannot export to ${outputFormat}`);
}
