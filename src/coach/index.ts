// Public surface of the coach layer (Stage 4). Importing this barrel is side-effect
// free and pulls in NO engine and NO DOM — it's pure analytics over the data the first
// three pillars persist. The Progress UI calls `buildProgressSnapshot`; the per-source
// functions are exported for direct unit testing.

export * from './types';
export * from './thresholds';
export * from './puzzleStats';
export * from './gameStats';
export * from './openingStats';
export * from './coach';

// Stage 5 — live coaching core (still engine-less + DOM-less: pure per-move math +
// a thin, engine-agnostic single-position eval helper that talks to the injected
// AnalysisEngine slice). The Coach UI on the Play tab consumes these.
export * from './liveFeedback';
export * from './evaluatePosition';
