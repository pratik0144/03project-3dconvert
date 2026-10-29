export type FormatKey = 'stl' | 'obj' | 'step' | '3mf' | 'glb' | 'iges';

export const FORMATS: Record<string, string> = {
  stl: 'STL',
  obj: 'OBJ',
  step: 'STEP',
  '3mf': '3MF',
  glb: 'GLB',
  iges: 'IGES',
  STL: 'STL',
  OBJ: 'OBJ',
  STEP: 'STEP',
  '3MF': '3MF',
  GLB: 'GLB',
  IGES: 'IGES',
};

export const slug = (from: string, to: string): string =>
  `${from.toLowerCase()}-to-${to.toLowerCase()}`;

export interface ConversionPair {
  from: FormatKey;
  to: FormatKey;
}

export const CONVERSIONS: readonly ConversionPair[] = [
  // STL conversions (4)
  { from: 'stl', to: 'obj' },
  { from: 'stl', to: 'step' },
  { from: 'stl', to: '3mf' },
  { from: 'stl', to: 'glb' },

  // OBJ conversions (4)
  { from: 'obj', to: 'stl' },
  { from: 'obj', to: 'step' },
  { from: 'obj', to: '3mf' },
  { from: 'obj', to: 'glb' },

  // STEP conversions (4)
  { from: 'step', to: 'stl' },
  { from: 'step', to: 'obj' },
  { from: 'step', to: '3mf' },
  { from: 'step', to: 'glb' },

  // 3MF conversions (4)
  { from: '3mf', to: 'stl' },
  { from: '3mf', to: 'obj' },
  { from: '3mf', to: 'step' },
  { from: '3mf', to: 'glb' },

  // GLB conversions (4)
  { from: 'glb', to: 'stl' },
  { from: 'glb', to: 'obj' },
  { from: 'glb', to: 'step' },
  { from: 'glb', to: '3mf' },

  // IGES conversions (5) - IGES is input-only
  { from: 'iges', to: 'stl' },
  { from: 'iges', to: 'obj' },
  { from: 'iges', to: 'step' },
  { from: 'iges', to: '3mf' },
  { from: 'iges', to: 'glb' },
] as const;
