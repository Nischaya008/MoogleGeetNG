import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Proxy only for local development (Vite dev server)
    // In production, API calls use VITE_API_URL environment variable
    proxy: {
      '/api': 'http://localhost:5000'
    }
  }
})
