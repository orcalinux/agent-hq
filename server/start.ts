import path from 'path';
import { startStandaloneServer } from './standalone';

const port = Number(process.env.PORT) || 5173;
const host = process.argv.includes('--lan') ? '0.0.0.0' : '127.0.0.1';

startStandaloneServer({ staticDir: path.resolve(__dirname, '..', 'dist'), host, ports: [port] })
  .then((server) => console.log(`Agent HQ is running at http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${server.port}`))
  .catch((err) => {
    console.error(`Agent HQ could not start: ${(err as Error).message}`);
    process.exit(1);
  });
