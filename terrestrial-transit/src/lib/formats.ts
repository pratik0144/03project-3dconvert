export type FormatId = 'stl' | 'obj' | 'step' | '3mf' | 'glb' | 'iges';

export interface FormatInfo {
  id: FormatId;
  name: string;
  extensions: string[];
  mimeTypes: string[];
  category: 'mesh' | 'cad';
  description: string;
}

export const FORMATS: Record<FormatId, FormatInfo> = {
  stl: {
    id: 'stl',
    name: 'STL',
    extensions: ['.stl'],
    mimeTypes: ['model/stl', 'application/sla'],
    category: 'mesh',
    description: 'Stereolithography',
  },
  obj: {
    id: 'obj',
    name: 'OBJ',
    extensions: ['.obj'],
    mimeTypes: ['model/obj', 'text/plain'],
    category: 'mesh',
    description: 'Wavefront OBJ',
  },
  step: {
    id: 'step',
    name: 'STEP',
    extensions: ['.step', '.stp'],
    mimeTypes: ['model/step', 'application/step'],
    category: 'cad',
    description: 'ISO 10303 STEP',
  },
  '3mf': {
    id: '3mf',
    name: '3MF',
    extensions: ['.3mf'],
    mimeTypes: ['model/3mf', 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml'],
    category: 'mesh',
    description: '3D Manufacturing Format',
  },
  glb: {
    id: 'glb',
    name: 'GLB',
    extensions: ['.glb'],
    mimeTypes: ['model/gltf-binary'],
    category: 'mesh',
    description: 'glTF Binary',
  },
  iges: {
    id: 'iges',
    name: 'IGES',
    extensions: ['.iges', '.igs'],
    mimeTypes: ['model/iges'],
    category: 'cad',
    description: 'Initial Graphics Exchange Specification',
  },
};

export type ConversionSupport = 'full' | 'lossy' | 'disabled';

export interface ConversionRoute {
  support: ConversionSupport;
  note?: string;
}

// Every format converts to every other format. The only question is lossiness.
function getConversionRoute(from: FormatId, to: FormatId): ConversionRoute {
  if (from === to) return { support: 'disabled' };

  const fromInfo = FORMATS[from];
  const toInfo = FORMATS[to];

  // CAD → Mesh (tessellation)
  if (fromInfo.category === 'cad' && toInfo.category === 'mesh') {
    return {
      support: 'lossy',
      note: 'Tessellation only. Parametric/BREP data is lost — the result is a mesh approximation.',
    };
  }

  // Mesh → CAD (faceted BREP)
  if (fromInfo.category === 'mesh' && toInfo.category === 'cad') {
    return {
      support: 'lossy',
      note: 'Creates faceted BREP geometry. This is NOT editable parametric CAD — each triangle becomes a flat face.',
    };
  }

  // CAD → CAD (STEP ↔ IGES)
  if (fromInfo.category === 'cad' && toInfo.category === 'cad') {
    return { support: 'full' };
  }

  // Mesh → Mesh — mostly full, a few lossy notes
  if (from === 'stl' && (to === 'glb' || to === '3mf')) {
    return {
      support: 'lossy',
      note: 'STL has no units — default scale is applied. Binary STL vertex colors are preserved if present.',
    };
  }

  if (from === 'obj' && (to === 'glb' || to === '3mf')) {
    return {
      support: 'lossy',
      note: 'OBJ materials (.mtl) are not bundled — material references may be lost.',
    };
  }

  return { support: 'full' };
}

export function getCompatibleOutputFormats(inputFormat: FormatId): Array<{ format: FormatInfo; route: ConversionRoute }> {
  const results: Array<{ format: FormatInfo; route: ConversionRoute }> = [];
  for (const [id, info] of Object.entries(FORMATS)) {
    const route = getConversionRoute(inputFormat, id as FormatId);
    if (route.support !== 'disabled') {
      results.push({ format: info, route });
    }
  }
  return results;
}

export function detectFormat(filename: string): FormatId | null {
  const ext = '.' + filename.split('.').pop()?.toLowerCase();
  for (const [id, info] of Object.entries(FORMATS)) {
    if (info.extensions.includes(ext)) {
      return id as FormatId;
    }
  }
  return null;
}

export function getRoute(from: FormatId, to: FormatId): ConversionRoute {
  return getConversionRoute(from, to);
}

export const ALL_EXTENSIONS = Object.values(FORMATS).flatMap(f => f.extensions);

export type UnitScale = 'mm' | 'cm' | 'm' | 'inch';

export const UNIT_SCALES: Record<UnitScale, { label: string; factor: number }> = {
  mm: { label: 'Millimeters (mm)', factor: 1 },
  cm: { label: 'Centimeters (cm)', factor: 10 },
  m: { label: 'Meters (m)', factor: 1000 },
  inch: { label: 'Inches (in)', factor: 25.4 },
};
