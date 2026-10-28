import { FORMATS, getRoute, type FormatId, type UnitScale } from './formats.ts';

export type ConversionStatus = 'queued' | 'converting' | 'done' | 'failed';

export interface ModelDimensions {
  x: number;
  y: number;
  z: number;
}

export interface ModelAnalysis {
  dimensions: ModelDimensions;
  triangles: number;
  isCad?: boolean;
}

export interface CustomScale {
  x: number;
  y: number;
  z: number;
}

export interface ConversionJob {
  id: string;
  inputFile: File;
  inputFormat: FormatId;
  outputFormat: FormatId;
  unitScale: UnitScale;
  customScale?: CustomScale;
  status: ConversionStatus;
  progress: number;
  error?: string;
  result?: Blob;
  resultFilename?: string;
}

type JobUpdateCallback = (job: ConversionJob) => void;

let meshWorker: Worker | null = null;
let cadWorker: Worker | null = null;

interface PendingJob {
  resolve: (blob: Blob) => void;
  reject: (err: Error) => void;
  workerType: 'mesh' | 'cad';
}

interface PendingAnalysis {
  resolve: (analysis: ModelAnalysis) => void;
  reject: (err: Error) => void;
  workerType: 'mesh' | 'cad';
}

const pendingJobs = new Map<string, PendingJob>();
const pendingAnalysis = new Map<string, PendingAnalysis>();

function getMeshWorker(): Worker {
  if (!meshWorker) {
    meshWorker = new Worker(
      new URL('./workers/mesh-worker.ts', import.meta.url),
      { type: 'module' }
    );
    meshWorker.onmessage = handleWorkerMessage;
    meshWorker.onerror = (e) => handleWorkerFailure('mesh', e);
  }
  return meshWorker;
}

function getCadWorker(): Worker {
  if (!cadWorker) {
    cadWorker = new Worker(
      new URL('./workers/cad-worker.ts', import.meta.url),
      { type: 'module' }
    );
    cadWorker.onmessage = handleWorkerMessage;
    cadWorker.onerror = (e) => handleWorkerFailure('cad', e);
  }
  return cadWorker;
}

function handleWorkerFailure(workerType: 'mesh' | 'cad', e: ErrorEvent) {
  console.error(`${workerType.toUpperCase()} worker failure:`, e);
  const errMsg = e?.message || `${workerType === 'cad' ? 'CAD' : '3D mesh'} processing worker failed to respond.`;

  // Terminate and discard broken worker instance so future jobs create a fresh one
  if (workerType === 'mesh' && meshWorker) {
    try { meshWorker.terminate(); } catch {}
    meshWorker = null;
  } else if (workerType === 'cad' && cadWorker) {
    try { cadWorker.terminate(); } catch {}
    cadWorker = null;
  }

  // Reject all pending analysis requests for this worker type
  for (const [jobId, item] of Array.from(pendingAnalysis.entries())) {
    if (item.workerType === workerType) {
      item.reject(new Error(errMsg));
      pendingAnalysis.delete(jobId);
    }
  }

  // Reject all pending conversion jobs for this worker type
  for (const [jobId, item] of Array.from(pendingJobs.entries())) {
    if (item.workerType === workerType) {
      item.reject(new Error(errMsg));
      pendingJobs.delete(jobId);
    }
  }
}

function handleWorkerMessage(e: MessageEvent) {
  const { jobId, type, data, error } = e.data || {};

  // Ignore non-job messages (e.g. progress updates from CAD worker)
  if (!jobId || type === 'progress') return;

  // Handle model analysis responses
  if (type === 'analyze_done') {
    const pending = pendingAnalysis.get(jobId);
    if (pending) {
      pending.resolve(data);
      pendingAnalysis.delete(jobId);
    }
    return;
  }

  if (type === 'analyze_error') {
    const pending = pendingAnalysis.get(jobId);
    if (pending) {
      pending.reject(new Error(error || 'Failed to analyze model dimensions'));
      pendingAnalysis.delete(jobId);
    }
    return;
  }

  const pending = pendingJobs.get(jobId);
  if (!pending) return;

  if (type === 'done') {
    pending.resolve(new Blob([data.buffer], { type: data.mimeType || 'application/octet-stream' }));
    pendingJobs.delete(jobId);
  } else if (type === 'error') {
    pending.reject(new Error(error || 'Conversion failed'));
    pendingJobs.delete(jobId);
  }
}

const CAD_FORMATS: FormatId[] = ['step', 'iges'];

function needsCadWorker(from: FormatId, to: FormatId): boolean {
  return CAD_FORMATS.includes(from) || CAD_FORMATS.includes(to);
}

export async function analyzeModel(
  file: File,
  inputFormat: FormatId,
): Promise<ModelAnalysis> {
  const jobId = crypto.randomUUID();
  const workerType: 'mesh' | 'cad' = CAD_FORMATS.includes(inputFormat) ? 'cad' : 'mesh';

  let arrayBuffer: ArrayBuffer;
  try {
    arrayBuffer = await file.arrayBuffer();
  } catch (err: any) {
    throw new Error(`Failed to read file "${file.name}": ${err?.message || err}`);
  }

  return new Promise<ModelAnalysis>((resolve, reject) => {
    pendingAnalysis.set(jobId, { resolve, reject, workerType });

    try {
      const worker = workerType === 'cad' ? getCadWorker() : getMeshWorker();
      worker.postMessage(
        {
          jobId,
          type: 'analyze',
          inputBuffer: arrayBuffer,
          inputFormat,
          fileName: file.name,
        },
        [arrayBuffer]
      );
    } catch (err: any) {
      pendingAnalysis.delete(jobId);
      reject(new Error(`Failed to dispatch analysis to worker: ${err?.message || err}`));
    }
  });
}

export async function convertFile(
  file: File,
  inputFormat: FormatId,
  outputFormat: FormatId,
  unitScale: UnitScale,
  customScale?: CustomScale,
  simplifyTarget?: number,
): Promise<Blob> {
  if (FORMATS[outputFormat]?.isInputOnly) {
    throw new Error(`${FORMATS[outputFormat].name} is supported as an input format only.`);
  }

  const route = getRoute(inputFormat, outputFormat);
  if (route.support === 'disabled') {
    throw new Error(`Conversion from ${FORMATS[inputFormat]?.name || inputFormat} to ${FORMATS[outputFormat]?.name || outputFormat} is not supported.`);
  }

  const jobId = crypto.randomUUID();
  const workerType: 'mesh' | 'cad' = needsCadWorker(inputFormat, outputFormat) ? 'cad' : 'mesh';

  let arrayBuffer: ArrayBuffer;
  try {
    arrayBuffer = await file.arrayBuffer();
  } catch (err: any) {
    throw new Error(`Failed to read file "${file.name}": ${err?.message || err}`);
  }

  return new Promise<Blob>((resolve, reject) => {
    pendingJobs.set(jobId, { resolve, reject, workerType });

    try {
      const worker = workerType === 'cad' ? getCadWorker() : getMeshWorker();
      worker.postMessage(
        {
          jobId,
          type: 'convert',
          inputBuffer: arrayBuffer,
          inputFormat,
          outputFormat,
          unitScale,
          customScale,
          simplifyTarget,
          fileName: file.name,
        },
        [arrayBuffer]
      );
    } catch (err: any) {
      pendingJobs.delete(jobId);
      reject(new Error(`Failed to dispatch conversion to worker: ${err?.message || err}`));
    }
  });
}

export function getOutputFilename(inputName: string, outputFormat: FormatId): string {
  const baseName = inputName.substring(0, inputName.lastIndexOf('.')) || inputName;
  const ext = outputFormat === 'step' ? '.step' : outputFormat === 'iges' ? '.iges' : outputFormat === '3mf' ? '.3mf' : `.${outputFormat}`;
  return baseName + ext;
}
