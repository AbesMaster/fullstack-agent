// Lets TypeScript understand static image imports (e.g. portraits) even before `next build`
// has generated next-env.d.ts, which is gitignored. CI type-checks before building.
/// <reference types="next/image-types/global" />
