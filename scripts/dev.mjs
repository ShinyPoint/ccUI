// Development: Vite dev server with hot reload for the window, Electron for everything else.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import electronPath from 'electron';

const server = await createServer({ configFile: fileURLToPath(new URL('../vite.config.mjs', import.meta.url)) });
await server.listen();
const url = server.resolvedUrls.local[0];
console.log(`renderer at ${url}`);

const child = spawn(electronPath, ['.'], { stdio: 'inherit', env: { ...process.env, VITE_DEV_SERVER_URL: url } });
child.on('exit', async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
