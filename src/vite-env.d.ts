/// <reference types="vite/client" />

// vite/client declares `import.meta.env` and ambient `*.css` modules so that
// `import 'chessground/assets/chessground.base.css'` typechecks. Resolution of the
// actual files is Vite's job at dev/build time.
