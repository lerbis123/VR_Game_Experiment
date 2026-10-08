import { appendFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// Errors and warnings from the headset (sent by src/features/logger.js) are printed here
// and appended to headset.log, so problems that only happen in VR can be diagnosed.
function headsetLogs() {
  return {
    name: 'headset-logs',
    configureServer(server) {
      server.ws.on('vr:log', (data) => {
        const line = `[${new Date().toISOString()}] ${data?.level ?? 'log'}: ${data?.message ?? ''}`;
        console.log(`[headset] ${line}`);
        try {
          appendFileSync('headset.log', `${line}\n`);
        } catch {
          // ignore
        }
      });
    },
  };
}

// WebXR only works on HTTPS, so serve with a self-signed cert and
// expose the server on the local network so the Quest can reach it.
export default defineConfig({
  plugins: [basicSsl(), headsetLogs()],
  server: { host: true, port: 5173 },
});
