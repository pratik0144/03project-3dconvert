import { useState, useCallback, useRef, useMemo, lazy, Suspense } from 'react';
import type { FormatId, UnitScale, ConversionRoute } from '../../lib/formats';
import { FORMATS, detectFormat, getCompatibleOutputFormats, getRoute, ALL_EXTENSIONS, UNIT_SCALES } from '../../lib/formats';
import {
  convertFile,
  analyzeModel,
  getOutputFilename,
  type ConversionStatus,
  type ModelAnalysis,
  type ModelDimensions,
  type CustomScale,
} from '../../lib/converter-engine';

const Preview3D = lazy(() => import('./Preview3D'));

interface ConverterProps {
  defaultFrom?: FormatId;
  defaultTo?: FormatId;
}

interface FileJob {
  id: string;
  file: File;
  inputFormat: FormatId;
  status: ConversionStatus;
  error?: string;
  result?: Blob;
  resultFilename?: string;

  // Analysis state
  isAnalyzing?: boolean;
  analysis?: ModelAnalysis;
  analysisError?: string;

  // Dimension & scale customizer
  customScale?: CustomScale;
  targetDimensions?: ModelDimensions;
  uniformScale?: boolean;
  scaleMultiplier?: number;
  isAdjusting?: boolean;
}

function formatDim(val: number | undefined): string {
  if (val === undefined || isNaN(val)) return '0.0';
  if (val >= 100) return val.toFixed(1);
  if (val >= 10) return val.toFixed(2);
  return val.toFixed(3);
}

function formatInputVal(val: number | undefined): string {
  if (val === undefined || isNaN(val)) return '';
  return parseFloat(val.toFixed(4)).toString();
}

function isScaled(job: FileJob): boolean {
  if (!job.customScale) return false;
  return (
    Math.abs(job.customScale.x - 1) > 0.0001 ||
    Math.abs(job.customScale.y - 1) > 0.0001 ||
    Math.abs(job.customScale.z - 1) > 0.0001
  );
}

export default function Converter({ defaultFrom, defaultTo }: ConverterProps) {
  const [files, setFiles] = useState<FileJob[]>([]);
  const [outputFormat, setOutputFormat] = useState<FormatId | null>(defaultTo || null);
  const [unitScale, setUnitScale] = useState<UnitScale>('mm');
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isConverting, setIsConverting] = useState(false);
  const [previewFileId, setPreviewFileId] = useState<string | null>(null);

  const detectedInputFormat = useMemo(() => {
    if (defaultFrom) return defaultFrom;
    if (files.length === 0) return null;
    const formats = new Set(files.map(f => f.inputFormat));
    if (formats.size === 1) return [...formats][0];
    return null;
  }, [files, defaultFrom]);

  const compatibleOutputs = useMemo(() => {
    if (!detectedInputFormat) return [];
    return getCompatibleOutputFormats(detectedInputFormat);
  }, [detectedInputFormat]);

  const currentRoute: ConversionRoute | null = useMemo(() => {
    if (!detectedInputFormat || !outputFormat) return null;
    return getRoute(detectedInputFormat, outputFormat);
  }, [detectedInputFormat, outputFormat]);

  const showUnitSelector = detectedInputFormat === 'stl';

  const handleFiles = useCallback((newFiles: File[]) => {
    const jobs: FileJob[] = [];
    const errors: string[] = [];

    for (const file of newFiles) {
      const format = detectFormat(file.name);
      if (!format) {
        errors.push(`"${file.name}" has an unsupported file extension.`);
        continue;
      }
      jobs.push({
        id: crypto.randomUUID(),
        file,
        inputFormat: format,
        status: 'queued',
        isAnalyzing: true,
        uniformScale: true,
        scaleMultiplier: 1,
        customScale: { x: 1, y: 1, z: 1 },
      });
    }

    if (jobs.length > 0) {
      const formats = new Set([...files.map(f => f.inputFormat), ...jobs.map(j => j.inputFormat)]);
      if (formats.size > 1) {
        setFiles(jobs);
      } else {
        setFiles(prev => [...prev, ...jobs]);
      }

      const inputFormats = new Set(jobs.map(j => j.inputFormat));
      if (inputFormats.size === 1 && !outputFormat) {
        const fmt = [...inputFormats][0];
        const compat = getCompatibleOutputFormats(fmt);
        if (compat.length > 0) {
          const best = compat.find(c => c.route.support === 'full') || compat[0];
          setOutputFormat(best.format.id);
        }
      }

      // Automatically trigger 3D model geometry analysis
      for (const job of jobs) {
        analyzeModel(job.file, job.inputFormat)
          .then((analysis) => {
            setFiles(prev => prev.map(f => {
              if (f.id !== job.id) return f;
              return {
                ...f,
                isAnalyzing: false,
                analysis,
                targetDimensions: { ...analysis.dimensions },
                customScale: { x: 1, y: 1, z: 1 },
                scaleMultiplier: 1,
              };
            }));
          })
          .catch((err) => {
            setFiles(prev => prev.map(f => {
              if (f.id !== job.id) return f;
              return {
                ...f,
                isAnalyzing: false,
                analysisError: err?.message || 'Failed to analyze dimensions',
              };
            }));
          });
      }
    }
  }, [files, outputFormat]);

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedFiles = Array.from(e.dataTransfer.files);
    handleFiles(droppedFiles);
  }, [handleFiles]);

  const onFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files || []);
    handleFiles(selected);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [handleFiles]);

  const removeFile = useCallback((id: string) => {
    setFiles(prev => prev.filter(f => f.id !== id));
  }, []);

  const clearAll = useCallback(() => {
    setFiles([]);
    setOutputFormat(defaultTo || null);
  }, [defaultTo]);

  const toggleAdjusting = useCallback((id: string) => {
    setFiles(prev => prev.map(f => (f.id === id ? { ...f, isAdjusting: !f.isAdjusting } : f)));
  }, []);

  const toggleUniformScale = useCallback((id: string) => {
    setFiles(prev => prev.map(f => (f.id === id ? { ...f, uniformScale: !f.uniformScale } : f)));
  }, []);

  const applyScalePreset = useCallback((id: string, factor: number) => {
    if (isNaN(factor) || factor <= 0) return;
    setFiles(prev => prev.map(job => {
      if (job.id !== id || !job.analysis) return job;
      const orig = job.analysis.dimensions;
      return {
        ...job,
        scaleMultiplier: factor,
        customScale: { x: factor, y: factor, z: factor },
        targetDimensions: {
          x: orig.x * factor,
          y: orig.y * factor,
          z: orig.z * factor,
        },
      };
    }));
  }, []);

  const updateDimension = useCallback((id: string, axis: 'x' | 'y' | 'z', value: number) => {
    if (isNaN(value) || value <= 0) return;
    setFiles(prev => prev.map(job => {
      if (job.id !== id || !job.analysis) return job;
      const orig = job.analysis.dimensions;
      const safeVal = Math.max(0.0001, value);

      if (job.uniformScale ?? true) {
        const origAxis = orig[axis] || 1;
        const ratio = safeVal / (origAxis > 0 ? origAxis : 1);
        return {
          ...job,
          scaleMultiplier: ratio,
          customScale: { x: ratio, y: ratio, z: ratio },
          targetDimensions: {
            x: orig.x * ratio,
            y: orig.y * ratio,
            z: orig.z * ratio,
          },
        };
      } else {
        const currentTarget = job.targetDimensions || { ...orig };
        const newTarget = { ...currentTarget, [axis]: safeVal };
        return {
          ...job,
          targetDimensions: newTarget,
          customScale: {
            x: orig.x > 0 ? newTarget.x / orig.x : 1,
            y: orig.y > 0 ? newTarget.y / orig.y : 1,
            z: orig.z > 0 ? newTarget.z / orig.z : 1,
          },
        };
      }
    }));
  }, []);

  const resetDimensions = useCallback((id: string) => {
    setFiles(prev => prev.map(job => {
      if (job.id !== id || !job.analysis) return job;
      return {
        ...job,
        scaleMultiplier: 1,
        customScale: { x: 1, y: 1, z: 1 },
        targetDimensions: { ...job.analysis.dimensions },
        uniformScale: true,
      };
    }));
  }, []);

  const convertAll = useCallback(async () => {
    if (!outputFormat || files.length === 0) return;
    setIsConverting(true);

    const updatedFiles = [...files];

    for (let i = 0; i < updatedFiles.length; i++) {
      const job = updatedFiles[i];
      if (job.status === 'done') continue;

      updatedFiles[i] = { ...job, status: 'converting', error: undefined };
      setFiles([...updatedFiles]);

      try {
        const result = await convertFile(
          job.file,
          job.inputFormat,
          outputFormat,
          unitScale,
          job.customScale
        );
        const resultFilename = getOutputFilename(job.file.name, outputFormat);
        updatedFiles[i] = { ...updatedFiles[i], status: 'done', result, resultFilename };
      } catch (err: any) {
        updatedFiles[i] = { ...updatedFiles[i], status: 'failed', error: err?.message || 'Conversion failed' };
      }
      setFiles([...updatedFiles]);
    }

    setIsConverting(false);
  }, [files, outputFormat, unitScale]);

  const downloadFile = useCallback((job: FileJob) => {
    if (!job.result || !job.resultFilename) return;
    const url = URL.createObjectURL(job.result);
    const a = document.createElement('a');
    a.href = url;
    a.download = job.resultFilename;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const downloadAll = useCallback(async () => {
    const completedFiles = files.filter(f => f.status === 'done' && f.result);
    if (completedFiles.length === 0) return;

    if (completedFiles.length === 1) {
      downloadFile(completedFiles[0]);
      return;
    }

    const { zipSync } = await import('fflate');
    const zipData: Record<string, Uint8Array> = {};

    for (const job of completedFiles) {
      if (job.result && job.resultFilename) {
        const buffer = await job.result.arrayBuffer();
        zipData[job.resultFilename] = new Uint8Array(buffer);
      }
    }

    const zipped = zipSync(zipData);
    const blob = new Blob([zipped], { type: 'application/zip' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'converted-models.zip';
    a.click();
    URL.revokeObjectURL(url);
  }, [files, downloadFile]);

  const hasFiles = files.length > 0;
  const allDone = hasFiles && files.every(f => f.status === 'done' || f.status === 'failed');
  const doneCount = files.filter(f => f.status === 'done').length;
  const acceptExtensions = defaultFrom
    ? FORMATS[defaultFrom].extensions.join(',')
    : ALL_EXTENSIONS.join(',');

  return (
    <div className="w-full max-w-[1200px] mx-auto px-4 sm:px-6">
      {/* USP badges */}
      <div className="flex flex-wrap items-center justify-center gap-3 mb-8">
        {[
          { icon: '∞', label: 'Unlimited conversions' },
          { icon: '⚡', label: 'Instant' },
          { icon: '🔒', label: '100% private' },
          { icon: '📦', label: 'Batch convert' },
        ].map(({ icon, label }) => (
          <span
            key={label}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-pill bg-canvas-elevated border border-hairline text-[12px] leading-4 font-medium text-body"
          >
            <span aria-hidden="true">{icon}</span>
            {label}
          </span>
        ))}
      </div>

      {/* Drop zone */}
      <div
        role="button"
        tabIndex={0}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={() => fileInputRef.current?.click()}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click(); }}
        className={`
          relative rounded-md border-2 border-dashed transition-all duration-200 cursor-pointer
          flex flex-col items-center justify-center text-center
          ${hasFiles ? 'py-8' : 'py-16 sm:py-20'}
          ${isDragging
            ? 'border-link bg-[#d3e5ff]/20'
            : 'border-hairline hover:border-mute bg-canvas-elevated'
          }
        `}
        aria-label="Drop files here or click to browse"
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={acceptExtensions}
          onChange={onFileSelect}
          className="hidden"
          aria-hidden="true"
        />

        <div className="mb-3">
          <svg className="w-10 h-10 text-mute mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13" />
          </svg>
        </div>

        <p className="text-[14px] leading-5 font-medium text-ink mb-1">
          {isDragging ? 'Drop files here' : 'Drop 3D model files here'}
        </p>
        <p className="text-[12px] leading-4 text-mute">
          or <span className="text-link underline">browse files</span>
          {' · '}STL, OBJ, STEP, 3MF, GLB, IGES
        </p>
      </div>

      {/* File list and controls */}
      {hasFiles && (
        <div className="mt-6 space-y-4">
          {/* Controls row */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-4">
            {/* Output format selector */}
            <div className="flex items-center gap-2">
              <label className="font-mono text-[12px] font-medium leading-4 uppercase text-mute" htmlFor="output-format">
                Convert to
              </label>
              <select
                id="output-format"
                value={outputFormat || ''}
                onChange={(e) => setOutputFormat(e.target.value as FormatId)}
                className="bg-canvas-elevated border border-hairline rounded-sm px-3 py-1.5 text-[14px] leading-5 text-ink focus:outline-none focus:ring-2 focus:ring-link"
              >
                <option value="" disabled>Select format…</option>
                {compatibleOutputs.map(({ format, route }) => (
                  <option key={format.id} value={format.id}>
                    {format.name}
                    {route.support === 'lossy' ? ' ⓘ' : ''}
                  </option>
                ))}
              </select>
            </div>

            {/* Default Unit fallback selector (for STL) */}
            {showUnitSelector && (
              <div className="flex items-center gap-2">
                <label className="font-mono text-[12px] font-medium leading-4 uppercase text-mute" htmlFor="unit-scale">
                  Default Unit
                </label>
                <select
                  id="unit-scale"
                  value={unitScale}
                  onChange={(e) => setUnitScale(e.target.value as UnitScale)}
                  className="bg-canvas-elevated border border-hairline rounded-sm px-3 py-1.5 text-[14px] leading-5 text-ink focus:outline-none focus:ring-2 focus:ring-link"
                >
                  {Object.entries(UNIT_SCALES).map(([key, { label }]) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Spacer */}
            <div className="flex-1" />

            {/* Actions */}
            <div className="flex items-center gap-2">
              <button
                onClick={clearAll}
                className="px-3 py-1.5 rounded-pill bg-canvas-elevated border border-hairline text-[14px] font-medium text-ink hover:bg-hairline-soft transition-colors"
              >
                Clear all
              </button>
              <button
                onClick={convertAll}
                disabled={!outputFormat || isConverting || files.length === 0}
                className="px-4 py-1.5 rounded-pill bg-ink text-white text-[14px] font-medium hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isConverting ? 'Converting…' : `Convert ${files.length} file${files.length > 1 ? 's' : ''}`}
              </button>
            </div>
          </div>

          {/* Note message */}
          {currentRoute?.note && (
            <div className="flex items-start gap-2.5 p-3 rounded-md bg-canvas border border-hairline text-[13px] leading-5">
              <svg className="w-4 h-4 text-mute shrink-0 mt-0.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              <p className="text-body">
                <span className="font-semibold text-ink">Note:</span> {currentRoute.note}
              </p>
            </div>
          )}

          {/* File list */}
          <div className="border border-hairline rounded-md bg-canvas-elevated divide-y divide-hairline">
            {files.map((job) => {
              const currentDim = job.targetDimensions || job.analysis?.dimensions;
              const scaled = isScaled(job);

              return (
                <div key={job.id} className="divide-y divide-hairline">
                  {/* File card header row */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3">
                    {/* Left: Info & Dimensions */}
                    <div className="flex-1 min-w-0">
                      <p className="text-[14px] leading-5 text-ink font-medium truncate">{job.file.name}</p>

                      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 mt-1">
                        <span className="text-[12px] leading-4 text-mute">
                          {FORMATS[job.inputFormat].name} · {formatBytes(job.file.size)}
                        </span>

                        {job.isAnalyzing && (
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-sm bg-hairline-soft text-[11px] font-mono text-mute">
                            <span className="w-2.5 h-2.5 border border-mute border-t-transparent rounded-full animate-spin" />
                            Analyzing dimensions…
                          </span>
                        )}

                        {job.analysis && currentDim && (
                          <>
                            <span className="text-mute text-[12px] hidden sm:inline">·</span>
                            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-sm bg-canvas border border-hairline text-[11px] font-mono text-ink">
                              <span className="text-mute text-[10px] font-sans font-medium">SIZE</span>
                              <span className="font-medium">
                                {formatDim(currentDim.x)} × {formatDim(currentDim.y)} × {formatDim(currentDim.z)} mm
                              </span>
                              {scaled && (
                                <span className="ml-0.5 text-[10px] px-1 py-0.2 rounded bg-link/10 text-link font-medium">
                                  {(job.scaleMultiplier || 1).toFixed(2).replace(/\.?0+$/, '')}×
                                </span>
                              )}
                            </span>
                            <span className="text-[11px] font-mono text-mute">
                              {job.analysis.triangles.toLocaleString()} {job.analysis.isCad ? 'faces' : 'triangles'}
                            </span>
                            <button
                              type="button"
                              onClick={() => toggleAdjusting(job.id)}
                              className="text-[11px] font-mono text-link hover:underline inline-flex items-center gap-1"
                            >
                              {job.isAdjusting ? 'Close' : (scaled ? 'Edit Scale' : 'Adjust Dimensions')}
                            </button>
                          </>
                        )}

                        {job.analysisError && (
                          <span className="text-[11px] font-mono text-mute">
                            (Dimensions unavailable)
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Right: Actions & Status */}
                    <div className="flex items-center gap-3 shrink-0 self-end sm:self-center">
                      {/* Preview toggle */}
                      {job.inputFormat !== 'step' && job.inputFormat !== 'iges' && (
                        <button
                          onClick={() => setPreviewFileId(previewFileId === job.id ? null : job.id)}
                          className={`shrink-0 text-[12px] leading-4 font-mono uppercase transition-colors ${
                            previewFileId === job.id ? 'text-link' : 'text-mute hover:text-ink'
                          }`}
                          aria-label={`Preview ${job.file.name}`}
                          title="Preview 3D Model"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          </svg>
                        </button>
                      )}

                      {/* Status */}
                      <div className="flex items-center gap-2">
                        {job.status === 'queued' && (
                          <span className="text-[12px] leading-4 text-mute font-mono uppercase">Queued</span>
                        )}
                        {job.status === 'converting' && (
                          <span className="text-[12px] leading-4 text-link font-mono uppercase flex items-center gap-1.5">
                            <span className="w-3 h-3 border-2 border-link border-t-transparent rounded-full animate-spin" />
                            Converting
                          </span>
                        )}
                        {job.status === 'done' && (
                          <button
                            onClick={(e) => { e.stopPropagation(); downloadFile(job); }}
                            className="text-[12px] leading-4 text-link font-mono uppercase hover:underline flex items-center gap-1"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                            </svg>
                            Download
                          </button>
                        )}
                        {job.status === 'failed' && (
                          <span className="text-[12px] leading-4 text-error font-mono uppercase" title={job.error}>
                            Failed
                          </span>
                        )}
                      </div>

                      {/* Remove button */}
                      <button
                        onClick={() => removeFile(job.id)}
                        className="w-6 h-6 flex items-center justify-center rounded-full text-mute hover:text-ink hover:bg-hairline-soft transition-colors"
                        aria-label={`Remove ${job.file.name}`}
                      >
                        ×
                      </button>
                    </div>
                  </div>

                  {/* Expandable Dimension Adjuster Panel */}
                  {job.isAdjusting && job.analysis && currentDim && (
                    <div className="px-4 py-3 bg-canvas/60 space-y-3">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[13px] font-medium text-ink">Adjust Model Dimensions & Scale</span>
                          <span className="text-[11px] text-mute font-mono">
                            (Original: {formatDim(job.analysis.dimensions.x)} × {formatDim(job.analysis.dimensions.y)} × {formatDim(job.analysis.dimensions.z)} mm)
                          </span>
                        </div>
                        <div className="flex items-center gap-3">
                          <label className="flex items-center gap-1.5 text-[12px] text-body cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={job.uniformScale ?? true}
                              onChange={() => toggleUniformScale(job.id)}
                              className="rounded border-hairline text-link focus:ring-link w-3.5 h-3.5"
                            />
                            <span>Lock aspect ratio</span>
                          </label>
                          {scaled && (
                            <button
                              type="button"
                              onClick={() => resetDimensions(job.id)}
                              className="text-[11px] font-mono text-error hover:underline"
                            >
                              Reset
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => toggleAdjusting(job.id)}
                            className="text-[11px] font-mono px-2 py-0.5 rounded bg-canvas-elevated border border-hairline text-ink hover:bg-hairline-soft"
                          >
                            Done
                          </button>
                        </div>
                      </div>

                      {/* Quick Presets */}
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[11px] font-mono uppercase text-mute mr-1">Presets:</span>
                        {[
                          { label: '1× (Original)', factor: 1 },
                          { label: 'Inches → mm (25.4×)', factor: 25.4 },
                          { label: 'mm → Inches (0.0394×)', factor: 1 / 25.4 },
                          { label: 'cm → mm (10×)', factor: 10 },
                          { label: '2×', factor: 2 },
                          { label: '0.5×', factor: 0.5 },
                        ].map(preset => {
                          const isCurrent = Math.abs((job.scaleMultiplier || 1) - preset.factor) < 0.001;
                          return (
                            <button
                              key={preset.label}
                              type="button"
                              onClick={() => applyScalePreset(job.id, preset.factor)}
                              className={`px-2 py-0.5 rounded-sm text-[11px] font-mono border transition-colors ${
                                isCurrent
                                  ? 'bg-ink text-white border-ink'
                                  : 'bg-canvas-elevated border-hairline text-body hover:bg-hairline-soft'
                              }`}
                            >
                              {preset.label}
                            </button>
                          );
                        })}
                      </div>

                      {/* Coordinate Inputs */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
                        <div>
                          <label className="block text-[11px] font-mono text-mute mb-1">Width (X)</label>
                          <div className="relative">
                            <input
                              type="number"
                              step="any"
                              value={formatInputVal(currentDim.x)}
                              onChange={(e) => updateDimension(job.id, 'x', parseFloat(e.target.value))}
                              className="w-full bg-canvas-elevated border border-hairline rounded-sm px-2.5 py-1 text-[13px] font-mono text-ink pr-8 focus:outline-none focus:ring-1 focus:ring-link"
                            />
                            <span className="absolute right-2 top-1.5 text-[11px] font-mono text-mute">mm</span>
                          </div>
                        </div>

                        <div>
                          <label className="block text-[11px] font-mono text-mute mb-1">Depth (Y)</label>
                          <div className="relative">
                            <input
                              type="number"
                              step="any"
                              value={formatInputVal(currentDim.y)}
                              onChange={(e) => updateDimension(job.id, 'y', parseFloat(e.target.value))}
                              className="w-full bg-canvas-elevated border border-hairline rounded-sm px-2.5 py-1 text-[13px] font-mono text-ink pr-8 focus:outline-none focus:ring-1 focus:ring-link"
                            />
                            <span className="absolute right-2 top-1.5 text-[11px] font-mono text-mute">mm</span>
                          </div>
                        </div>

                        <div>
                          <label className="block text-[11px] font-mono text-mute mb-1">Height (Z)</label>
                          <div className="relative">
                            <input
                              type="number"
                              step="any"
                              value={formatInputVal(currentDim.z)}
                              onChange={(e) => updateDimension(job.id, 'z', parseFloat(e.target.value))}
                              className="w-full bg-canvas-elevated border border-hairline rounded-sm px-2.5 py-1 text-[13px] font-mono text-ink pr-8 focus:outline-none focus:ring-1 focus:ring-link"
                            />
                            <span className="absolute right-2 top-1.5 text-[11px] font-mono text-mute">mm</span>
                          </div>
                        </div>

                        <div>
                          <label className="block text-[11px] font-mono text-mute mb-1">Scale Multiplier</label>
                          <div className="relative">
                            <input
                              type="number"
                              step="any"
                              value={formatInputVal(job.scaleMultiplier || 1)}
                              onChange={(e) => applyScalePreset(job.id, parseFloat(e.target.value))}
                              className="w-full bg-canvas-elevated border border-hairline rounded-sm px-2.5 py-1 text-[13px] font-mono text-ink pr-6 focus:outline-none focus:ring-1 focus:ring-link"
                            />
                            <span className="absolute right-2 top-1.5 text-[11px] font-mono text-mute">×</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* 3D Preview panel */}
                  {previewFileId === job.id && (
                    <div className="px-4 py-4">
                      <div className="h-[300px]">
                        <Suspense fallback={
                          <div className="w-full h-full flex items-center justify-center bg-canvas-elevated border border-hairline rounded-md">
                            <div className="flex items-center gap-2 text-[12px] text-mute font-mono">
                              <span className="w-4 h-4 border-2 border-mute border-t-transparent rounded-full animate-spin" />
                              Loading 3D viewer…
                            </div>
                          </div>
                        }>
                          <Preview3D file={job.file} format={job.inputFormat} />
                        </Suspense>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Error details */}
          {files.some(f => f.status === 'failed') && (
            <div className="space-y-2">
              {files.filter(f => f.status === 'failed').map(f => (
                <div key={f.id} className="p-3 rounded-md bg-[#ee0000]/5 border border-[#ee0000]/20 text-[13px] leading-5">
                  <span className="font-medium text-error">{f.file.name}:</span>{' '}
                  <span className="text-[#c50000]">{f.error || 'Unknown error'}</span>
                </div>
              ))}
            </div>
          )}

          {/* Download all */}
          {allDone && doneCount > 0 && (
            <div className="flex items-center justify-center pt-2">
              <button
                onClick={downloadAll}
                className="px-6 py-2.5 rounded-pill bg-ink text-white text-[16px] font-medium hover:opacity-90 transition-opacity flex items-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                {doneCount === 1 ? 'Download file' : `Download all ${doneCount} files as ZIP`}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}
