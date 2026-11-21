import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // `npm run test:coverage` (SonarQube Cloud CI analysis reads coverage/lcov.info)
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'lcov'],
      include: ['src/**/*.ts'],
      // VS Code API code runs only inside VS Code, not in unit tests (same list as .sonarcloud.properties)
      exclude: ['src/ui/**', 'src/extension.ts'],
    },
  },
});
