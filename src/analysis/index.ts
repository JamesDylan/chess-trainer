// Public surface of the analysis layer (Stage 2). Importing this barrel is
// side-effect free and pulls in no engine/DOM — the analyzer talks to an injected
// AnalysisEngine, and the cache store is storage-agnostic behind its interface.

export * from './types';
export {
  analyzeGame,
  AnalysisCancelled,
  DEFAULT_ANALYSIS_DEPTH,
  ANALYSIS_REPORT_VERSION,
  inferLastMove,
  // Bounded-cp helpers, shared with the Stage 5 live coach (not re-derived there).
  scoreToCp,
  centipawnLoss,
} from './analyzer';
export type { AnalysisStore } from './analysisStore';
export { InMemoryAnalysisStore, IndexedDbAnalysisStore } from './analysisStore';
