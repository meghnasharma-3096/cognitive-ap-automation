/**
 * Dev/prototype entry point: one process serving the API and the Vite-built UI.
 *   npm run dev   ->  http://localhost:3000
 */
import 'dotenv/config';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createVite } from 'vite';
import { createApp } from './app';
import { JsonStore } from './store';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const store = new JsonStore(
  process.env.DB_PATH ?? path.join(root, 'data', 'db.json'),
  path.join(root, 'data', 'seed.json'),
);

const app = createApp({ store });
const server = http.createServer(app);

const vite = await createVite({
  root,
  appType: 'spa',
  server: { middlewareMode: true, hmr: { server } },
});
app.use(vite.middlewares);

const port = Number(process.env.PORT ?? 3000);
server.listen(port, '0.0.0.0', () => {
  console.log(`\n  Cognitive AP running at http://localhost:${port}`);
  console.log(`  Data: ${process.env.DB_PATH ?? 'data/db.json'}  (reset: POST /api/reset or the Reset button)\n`);
});
