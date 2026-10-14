import { defineConfig } from 'vitest/config';

// Comparison tables for the docs: `yarn workspace seaq report [filter]`
export default defineConfig({ test: { include: ['test/reports/**/*.test.ts'] } });
