import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['lib/**/*.test.ts', 'e2e/**/*.test.ts'], testTimeout: 60_000 } });
