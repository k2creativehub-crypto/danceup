import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' позволяет открывать сайт по любому адресу GitHub Pages
export default defineConfig({
  base: './',
  plugins: [react()],
});
