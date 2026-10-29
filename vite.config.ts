import { defineConfig } from 'vitest/config';
export default defineConfig({ base: './', server: { host: '0.0.0.0' }, test: { include: ['tests/**/*.test.ts'], exclude: ['reviews/**', 'node_modules/**', 'dist/**'] }, build: { target: 'es2022' } });
