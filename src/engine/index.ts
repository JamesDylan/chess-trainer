// Public surface of the engine layer (Stage 1).
// Importing this barrel is side-effect free and does NOT load the WASM/asm
// engine — `createNodeEngine` loads it lazily via a dynamic import on call.

export * from './types';
export { buildStrengthCommands } from './strengthCommands';
export { UciEngine } from './uciEngine';
export { NodeUciTransport, createNodeEngine } from './nodeEngine';
// Browser twin of NodeUciTransport (Web Worker + WASM Stockfish). Importing it is
// side-effect free; the worker/engine is only created when createWorkerEngine runs.
export { WorkerUciTransport, createWorkerEngine } from './workerEngine';
export type { WorkerLike } from './workerEngine';
