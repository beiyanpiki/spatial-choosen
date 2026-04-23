import path from 'node:path';

import { defineConfig } from 'vitest/config';

const alias = {
  '@': path.resolve(__dirname, 'src'),
};

export default defineConfig({
  test: {
    projects: [
      {
        resolve: {
          alias,
        },
        test: {
          name: 'node',
          environment: 'node',
          include: ['src/**/*.test.ts'],
        },
      },
      {
        resolve: {
          alias,
        },
        test: {
          name: 'jsdom',
          environment: 'jsdom',
          include: ['src/**/*.test.tsx'],
          setupFiles: ['src/test/setup.ts'],
        },
      },
    ],
  },
});
