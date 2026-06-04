// Public surface of the coach layer (Stage 4). Importing this barrel is side-effect
// free and pulls in NO engine and NO DOM — it's pure analytics over the data the first
// three pillars persist. The Progress UI calls `buildProgressSnapshot`; the per-source
// functions are exported for direct unit testing.

export * from './types';
export * from './thresholds';
export * from './puzzleStats';
export * from './gameStats';
export * from './coach';
