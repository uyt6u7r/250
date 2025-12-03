import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './', // Vital for GitHub Pages to load assets correctly from a subdirectory
  define: {
    // Polyfill process.env for compatibility if needed, though import.meta.env is preferred in Vite
    'process.env': {} 
  }
});