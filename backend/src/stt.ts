/**
 * Glance STT — speech-to-text via local faster-whisper (no key, no account).
 *
 * The Node backend receives raw 16 kHz / 16-bit / mono PCM from the glasses
 * mic, wraps it in a WAV header, and transcribes it with the Python worker.
 *
 * Two worker modes (same model, faster-whisper "tiny", CPU, int8):
 *  - Daemon (preferred): backend/stt-daemon.py loads the model ONCE and
 *    serves one transcription per JSON line on stdin — ~2-4 s per request.
 *    A cold model load takes ~20 s on this VM, so the daemon is started
 *    lazily on the first request and kept alive for the server's lifetime.
 *  - One-shot fallback (backend/stt.py): if the daemon cannot start or
 *    dies, each request spawns a fresh worker (~20 s per request).
 *
 * Python interpreter: $STT_PYTHON, else the project venv at
 * <even-realities>/stt-venv/bin/python (resolved relative to this file).
 * An empty transcription means "no speech detected" — not an error.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const STT_MODEL = 'tiny';
export const STT_SAMPLE_RATE = 16000;
const MAX_PCM_BYTES = 1024 * 1024; // ~32 s of audio
const SPAWN_TIMEOUT_MS = 120_000;
const DAEMON_START_TIMEOUT_MS = 120_000;
const REQUEST_TIMEOUT_MS = 120_000;

function venvPython(): string {
  if (process.env.STT_PYTHON) return process.env.STT_PYTHON;
  const here = dirname(fileURLToPath(import.meta.url));
  // dist/stt.js -> ../../../stt-venv ; src/stt.ts -> same depth.
  return join(here, '..', '..', '..', 'stt-venv', 'bin', 'python');
}

function workerPath(name: string): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, '..', name);
}

/** True when the faster-whisper model is already cached locally. */
export function sttReady(): boolean {
  const home = process.env.HOME ?? '';
  const base = process.env.HF_HOME ?? join(home, '.cache', 'huggingface', 'hub');
  return existsSync(join(base, 'models--Systran--faster-whisper-tiny'));
}

function pcmToWav(pcm: Buffer): Buffer {
  const dataSize = pcm.length;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(STT_SAMPLE_RATE, 24);
  header.writeUInt32LE(STT_SAMPLE_RATE * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, pcm]);
}

export interface Transcription {
  text: string;
  language: string;
  duration_s: number;
}

function parseTranscription(out: string): Transcription {
  const parsed = JSON.parse(out.trim().split('\n').pop() ?? '{}') as Partial<Transcription> & {
    error?: string;
  };
  if (parsed.error) throw new Error(`stt worker: ${parsed.error}`);
  return {
    text: typeof parsed.text === 'string' ? parsed.text : '',
    language: typeof parsed.language === 'string' ? parsed.language : 'id',
    duration_s: typeof parsed.duration_s === 'number' ? parsed.duration_s : 0,
  };
}

// --- one-shot worker (fallback) --------------------------------------------

function transcribeOneShot(python: string, wavPath: string): Promise<Transcription> {
  return new Promise<Transcription>((resolve, reject) => {
    const child = spawn(python, [workerPath('stt.py'), wavPath], {
      timeout: SPAWN_TIMEOUT_MS,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString('utf8');
    });
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        try {
          resolve(parseTranscription(stdout));
        } catch (err) {
          reject(err);
        }
      } else {
        reject(new Error(`stt worker exited ${code}: ${stderr.slice(-300)}`));
      }
    });
  });
}

// --- persistent daemon ------------------------------------------------------

let daemon: ChildProcessWithoutNullStreams | null = null;
let daemonReady: Promise<void> | null = null;
let daemonQueue: Promise<unknown> = Promise.resolve();
const lineWaiters: Array<(line: string) => void> = [];
let lineBuffer = '';

function daemonAlive(): boolean {
  return daemon !== null && daemon.exitCode === null && !daemon.killed;
}

export function sttDaemonAlive(): boolean {
  return daemonAlive();
}

function onDaemonLine(line: string): void {
  const waiter = lineWaiters.shift();
  if (waiter) waiter(line);
}

function startDaemon(python: string): Promise<void> {
  if (daemonReady) return daemonReady;
  daemonReady = new Promise<void>((resolve, reject) => {
    const child = spawn(python, [workerPath('stt-daemon.py')], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    daemon = child;
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill();
        reject(new Error('stt daemon start timed out'));
      }
    }, DAEMON_START_TIMEOUT_MS);
    child.stdout.on('data', (d: Buffer) => {
      lineBuffer += d.toString('utf8');
      let idx: number;
      while ((idx = lineBuffer.indexOf('\n')) >= 0) {
        const line = lineBuffer.slice(0, idx).trim();
        lineBuffer = lineBuffer.slice(idx + 1);
        if (!line) continue;
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          try {
            const first = JSON.parse(line) as { ready?: boolean; error?: string };
            if (first.ready) resolve();
            else reject(new Error(`stt daemon failed to start: ${first.error ?? line}`));
          } catch {
            reject(new Error(`stt daemon bad first line: ${line.slice(0, 200)}`));
          }
        } else {
          onDaemonLine(line);
        }
      }
    });
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString('utf8');
    });
    child.on('error', (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(err);
      }
    });
    child.on('exit', () => {
      if (daemon === child) daemon = null;
      daemonReady = null;
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new Error(`stt daemon exited during start: ${stderr.slice(-300)}`));
      }
    });
  });
  return daemonReady;
}

function transcribeViaDaemon(wavPath: string): Promise<Transcription> {
  // Serialize requests: one in flight at a time; responses arrive in order.
  const run = daemonQueue.then(async () => {
    if (!daemonAlive()) throw new Error('stt daemon not alive');
    const line = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('stt daemon request timed out')),
        REQUEST_TIMEOUT_MS,
      );
      lineWaiters.push((l) => {
        clearTimeout(timer);
        resolve(l);
      });
      daemon?.stdin.write(`${JSON.stringify({ wav: wavPath })}\n`, (err) => {
        if (err) {
          clearTimeout(timer);
          reject(err);
        }
      });
    });
    return parseTranscription(line);
  });
  // Keep the chain alive even if this request fails.
  daemonQueue = run.catch(() => undefined);
  return run;
}

// --- public entry point -----------------------------------------------------

export async function transcribePcm(pcm: Buffer): Promise<Transcription> {
  if (pcm.length > MAX_PCM_BYTES) {
    throw new Error(`audio too long (max ${MAX_PCM_BYTES} bytes)`);
  }
  if (pcm.length % 2 === 1) pcm = pcm.subarray(0, pcm.length - 1);
  if (pcm.length < 3200) {
    // <100 ms: not enough audio to transcribe.
    return { text: '', language: 'id', duration_s: 0 };
  }
  const python = venvPython();
  if (!existsSync(python)) {
    throw new Error('STT python venv not found (run the venv setup in backend/README.md)');
  }
  const dir = mkdtempSync(join(tmpdir(), 'glance-stt-'));
  const wavPath = join(dir, 'audio.wav');
  try {
    writeFileSync(wavPath, pcmToWav(pcm));
    try {
      await startDaemon(python);
      return await transcribeViaDaemon(wavPath);
    } catch (daemonErr) {
      // Daemon path failed (start or request): fall back to one-shot.
      // eslint-disable-next-line no-console
      console.log(
        new Date().toISOString(),
        'stt daemon failed, falling back to one-shot:',
        daemonErr instanceof Error ? daemonErr.message : daemonErr,
      );
      return await transcribeOneShot(python, wavPath);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
