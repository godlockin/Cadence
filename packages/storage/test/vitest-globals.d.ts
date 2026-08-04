/**
 * Vitest global type augmentation for `tsc` strict mode.
 *
 * `vitest.config.ts` enables `globals: true`, but `tsc -p tsconfig.json`
 * still requires explicit types. This file pulls in the vitest globals
 * so test files don't need `import { describe, it, expect } from 'vitest'`.
 */
/// <reference types="vitest/globals" />