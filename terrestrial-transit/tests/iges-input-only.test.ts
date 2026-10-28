import assert from 'node:assert';
import {
  FORMATS,
  INPUT_FORMATS,
  OUTPUT_FORMATS,
  detectFormat,
  getRoute,
  getCompatibleOutputFormats,
  isOutputFormat,
  type FormatId,
} from '../src/lib/formats.ts';
import { getOutputFilename, convertFile } from '../src/lib/converter-engine.ts';

console.log('='.repeat(80));
console.log('IGES INPUT-ONLY & EXTENDED MATRIX UNIT TESTS');
console.log('='.repeat(80));

// Test 1: FORMATS.iges specification
console.log('[Test 1] IGES is configured as input-only');
assert.strictEqual(FORMATS.iges.id, 'iges');
assert.strictEqual(FORMATS.iges.isInputOnly, true, 'FORMATS.iges must have isInputOnly=true');
assert.ok(FORMATS.iges.extensions.includes('.iges'), 'extensions must include .iges');
assert.ok(FORMATS.iges.extensions.includes('.igs'), 'extensions must include .igs');
console.log('  ✅ FORMATS.iges has isInputOnly: true and valid extensions');

// Test 2: detectFormat detects IGES files
console.log('[Test 2] detectFormat identifies IGES files');
assert.strictEqual(detectFormat('bracket.iges'), 'iges');
assert.strictEqual(detectFormat('bracket.IGES'), 'iges');
assert.strictEqual(detectFormat('impeller.igs'), 'iges');
assert.strictEqual(detectFormat('impeller.IGS'), 'iges');
assert.strictEqual(detectFormat('model.stl'), 'stl');
assert.strictEqual(detectFormat('model.step'), 'step');
console.log('  ✅ detectFormat correctly detects .iges and .igs files');

// Test 3: isOutputFormat helper
console.log('[Test 3] isOutputFormat correctly returns false for IGES and true for others');
assert.strictEqual(isOutputFormat('iges'), false, 'isOutputFormat(iges) must be false');
assert.strictEqual(isOutputFormat('stl'), true, 'isOutputFormat(stl) must be true');
assert.strictEqual(isOutputFormat('obj'), true, 'isOutputFormat(obj) must be true');
assert.strictEqual(isOutputFormat('step'), true, 'isOutputFormat(step) must be true');
assert.strictEqual(isOutputFormat('3mf'), true, 'isOutputFormat(3mf) must be true');
assert.strictEqual(isOutputFormat('glb'), true, 'isOutputFormat(glb) must be true');
console.log('  ✅ isOutputFormat verified across all 6 formats');

// Test 4: INPUT_FORMATS and OUTPUT_FORMATS
console.log('[Test 4] INPUT_FORMATS and OUTPUT_FORMATS collections');
const inputIds = INPUT_FORMATS.map(f => f.id);
const outputIds = OUTPUT_FORMATS.map(f => f.id);
assert.ok(inputIds.includes('iges'), 'INPUT_FORMATS must include iges');
assert.ok(!outputIds.includes('iges'), 'OUTPUT_FORMATS must NOT include iges');
assert.deepStrictEqual(outputIds.sort(), ['3mf', 'glb', 'obj', 'step', 'stl'].sort());
console.log('  ✅ OUTPUT_FORMATS contains all formats except IGES');

// Test 5: getRoute - converting TO IGES is disabled for all formats
console.log('[Test 5] Converting TO IGES is disabled for every source format');
const allFormats: FormatId[] = ['stl', 'obj', 'step', '3mf', 'glb', 'iges'];
for (const from of allFormats) {
  const route = getRoute(from, 'iges');
  assert.strictEqual(route.support, 'disabled', `getRoute(${from}, 'iges') must be 'disabled'`);
}
console.log('  ✅ All formats -> IGES routes are disabled');

// Test 6: getCompatibleOutputFormats never contains IGES
console.log('[Test 6] getCompatibleOutputFormats never includes IGES');
for (const from of allFormats) {
  const compat = getCompatibleOutputFormats(from);
  assert.ok(!compat.some(c => c.format.id === 'iges'), `Compatible outputs for ${from} must NOT include IGES`);
}
console.log('  ✅ No source format offers IGES as an output format');

// Test 7: IGES input offers ALL 5 output formats
console.log('[Test 7] IGES input offers all 5 target formats');
const igesCompat = getCompatibleOutputFormats('iges');
const igesTargetIds = igesCompat.map(c => c.format.id).sort();
assert.deepStrictEqual(igesTargetIds, ['3mf', 'glb', 'obj', 'step', 'stl']);

// Verify route types for IGES:
// IGES -> STEP: CAD to CAD (full support)
assert.strictEqual(getRoute('iges', 'step').support, 'full');
// IGES -> Mesh: CAD to Mesh (lossy tessellation)
assert.strictEqual(getRoute('iges', 'stl').support, 'lossy');
assert.strictEqual(getRoute('iges', 'obj').support, 'lossy');
assert.strictEqual(getRoute('iges', 'glb').support, 'lossy');
assert.strictEqual(getRoute('iges', '3mf').support, 'lossy');
console.log('  ✅ IGES input supports STL, OBJ, STEP, 3MF, and GLB');

// Test 8: Non-IGES input formats maintain their existing routes
console.log('[Test 8] Existing formats retain all their other routes');
assert.deepStrictEqual(getCompatibleOutputFormats('stl').map(c => c.format.id).sort(), ['3mf', 'glb', 'obj', 'step']);
assert.deepStrictEqual(getCompatibleOutputFormats('obj').map(c => c.format.id).sort(), ['3mf', 'glb', 'step', 'stl']);
assert.deepStrictEqual(getCompatibleOutputFormats('step').map(c => c.format.id).sort(), ['3mf', 'glb', 'obj', 'stl']);
assert.deepStrictEqual(getCompatibleOutputFormats('3mf').map(c => c.format.id).sort(), ['glb', 'obj', 'step', 'stl']);
assert.deepStrictEqual(getCompatibleOutputFormats('glb').map(c => c.format.id).sort(), ['3mf', 'obj', 'step', 'stl']);
console.log('  ✅ All other conversion routes intact');

// Test 9: convertFile guards against outputFormat='iges'
console.log('[Test 9] convertFile rejects converting to IGES');
const dummyFile = new File(['solid test'], 'test.stl', { type: 'model/stl' });
await assert.rejects(
  async () => {
    await convertFile(dummyFile, 'stl', 'iges', 'mm');
  },
  {
    message: /IGES is supported as an input format only/,
  }
);
console.log('  ✅ convertFile correctly throws descriptive error when target is IGES');

// Test 10: getOutputFilename
console.log('[Test 10] getOutputFilename produces correct extensions');
assert.strictEqual(getOutputFilename('engine_part.iges', 'step'), 'engine_part.step');
assert.strictEqual(getOutputFilename('engine_part.iges', 'stl'), 'engine_part.stl');
assert.strictEqual(getOutputFilename('engine_part.iges', 'obj'), 'engine_part.obj');
assert.strictEqual(getOutputFilename('engine_part.iges', 'glb'), 'engine_part.glb');
assert.strictEqual(getOutputFilename('engine_part.iges', '3mf'), 'engine_part.3mf');
console.log('  ✅ getOutputFilename verified for all IGES target outputs');

console.log('='.repeat(80));
console.log('🎉 ALL IGES INPUT-ONLY UNIT TESTS PASSED!');
console.log('='.repeat(80));
