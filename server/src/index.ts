import { buildApp } from './app.js';
import { config } from './config.js';
import { migrate } from './db/migrate.js';
import { seed } from './db/seed.js';

await migrate();
await seed();

const app = await buildApp();
await app.listen({ host: '0.0.0.0', port: config.PORT });

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, async () => {
    await app.close();
    process.exit(0);
  });
}
