// Vitest runs outside Next.js's RSC-aware bundler, which is the only thing
// that makes the real `server-only` package's client/server boundary check
// meaningful — imported anywhere else it just throws unconditionally. This
// stub replaces it in tests only (see vitest.config.mts); the real package
// still guards the actual Next.js build.
export {};
