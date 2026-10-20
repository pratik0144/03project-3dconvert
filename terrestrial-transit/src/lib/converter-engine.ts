import type { FormatId, UnitScale } from './formats';

export type ConversionStatus = 'queued' | 'converting' | 'done' | 'failed';

export interface ConversionJob {
  id: string;
  inputFile: File;
  inputFormat: FormatId;
  outputFormat: FormatId;
  unitScale: UnitScale;
  status: ConversionStatus;
  progress: number;
  error?: string;
  result?: Blob;
  resultFilename?: string;
}

type JobUpdateCallback = (job: ConversionJob) => void;

let meshWorker: Worker | null = null;
let cadWorker: Worker | null = null;
const pendingJobs = new Map<string, { resolve: (blob: Blob) => void; reject: (err: Error) => void }>();

function getMeshWorker(): Worker {
  if (!meshWorker) {
    meshWorker = new Worker(
      new URL('./workers/mesh-worker.ts', import.meta.url),
      { type: 'module' }
    );
    meshWorker.onmessage = handleWorkerMessage;
    meshWorker.onerror = handleWorkerError;
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
    cadWorker.onerror = handleWorkerError;
  }
  return cadWorker;
}

function handleWorkerMessage(e: MessageEvent) {
  const { jobId, type, data, error } = e.data;

  // Ignore non-job messages (e.g. progress updates from CAD worker)
  if (!jobId || type === 'progress') return;

  const pending = pendingJobs.get(jobId);
  if (!pending) return;

  if (type === 'done') {
    pending.resolve(new Blob([data.buffer], { type: data.mimeType || 'application/octet-stream' }));
    pendingJobs.delete(jobId);
  } else if (type === 'error') {
    pending.reject(new Error(error));
    pendingJobs.delete(jobId);
  }
}

function handleWorkerError(e: ErrorEvent) {
  console.error('Worker error:', e);
}

const CAD_FORMATS: FormatId[] = ['step', 'iges'];

function needsCadWorker(from: FormatId, to: FormatId): boolean {
  return CAD_FORMATS.includes(from) || CAD_FORMATS.includes(to);
}

export async function convertFile(
  file: File,
  inputFormat: FormatId,
  outputFormat: FormatId,
  unitScale: UnitScale,
): Promise<Blob> {
  const jobId = crypto.randomUUID();
  const arrayBuffer = await file.arrayBuffer();

  return new Promise<Blob>((resolve, reject) => {
    pendingJobs.set(jobId, { resolve, reject });

    const worker = needsCadWorker(inputFormat, outputFormat)
      ? getCadWorker()
      : getMeshWorker();

    worker.postMessage(
      {
        jobId,
        type: 'convert',
        inputBuffer: arrayBuffer,
        inputFormat,
        outputFormat,
        unitScale,
        fileName: file.name,
      },
      [arrayBuffer]
    );
  });
}

export function getOutputFilename(inputName: string, outputFormat: FormatId): string {
  const baseName = inputName.substring(0, inputName.lastIndexOf('.')) || inputName;
  const ext = outputFormat === 'step' ? '.step' : outputFormat === 'iges' ? '.iges' : outputFormat === '3mf' ? '.3mf' : `.${outputFormat}`;
  return baseName + ext;
}
