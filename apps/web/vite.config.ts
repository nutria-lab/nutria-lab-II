import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    // Valor de reserva para CI y checkouts limpios, que no tienen un .env real.
    // Los tests que necesiten probar el caso "variable ausente" la pisan con vi.stubEnv.
    env: {
      VITE_API_URL: 'http://localhost:3000',
    },
  },
});
