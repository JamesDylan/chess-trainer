// Minimal ambient types for the `stockfish` npm package (nmrugg/stockfish.js),
// which ships no type declarations. This lets `tsc` pass whether or not the
// package is installed (it is resolved at runtime via a dynamic import), so the
// repo typechecks on a fresh clone before `npm install`.
//
// Runtime shape (verified against stockfish@18 in Node):
//   const initEngine = require('stockfish');      // module.exports is a function
//   const engine = await initEngine('asm');       // build keyword or path
//   engine.listener = (line) => { ... };          // <-- output hook (dynamic)
//   engine.sendCommand('uci');                     // input
// Note: `engine.print` is captured by Emscripten at init, so reassigning it
// later does nothing — `listener` is the hook that actually works.

declare module 'stockfish' {
  interface StockfishEngine {
    /** Dynamically-checked output hook; receives one UCI line at a time. */
    listener?: (line: string) => void;
    /** Preferred input method (defined by the wrapper once the engine is ready). */
    sendCommand?: (command: string) => void;
    /** Fallback input method in worker-style builds. */
    postMessage?: (command: string) => void;
    /** Alternative output subscription in some builds. */
    addMessageListener?: (cb: (line: string) => void) => void;
    /** Tear down the underlying engine. */
    terminate?: () => void;
  }

  /**
   * @param enginePath Build keyword ('asm' | 'lite-single' | 'single' | 'lite'
   *   | 'full') or an explicit path. Returns a Promise when no callback is given.
   */
  function initEngine(enginePath?: string): Promise<StockfishEngine>;
  export = initEngine;
}
