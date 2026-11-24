import fs from 'fs';
import http from 'http';
import type { AddressInfo } from 'net';
import path from 'path';
import { createApiMiddleware } from './api';
import { closeAllTerminals } from './pty';
import { stopComputerDriver } from './computerUse';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

export interface StandaloneOptions {
  /** The built UI (the `dist` folder from `vite build`). */
  staticDir: string;
  host?: string;
  /** Ports to try in order; 0 means any free port. */
  ports?: number[];
}

export interface StandaloneServer {
  url: string;
  port: number;
  close: () => Promise<void>;
}

function serveStatic(staticDir: string, req: http.IncomingMessage, res: http.ServerResponse): void {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405;
    res.end();
    return;
  }
  const root = path.resolve(staticDir);
  let rel: string;
  try {
    rel = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
  } catch {
    res.statusCode = 400;
    res.end();
    return;
  }
  let file = path.resolve(root, '.' + rel);
  if (file !== root && !file.startsWith(root + path.sep)) {
    res.statusCode = 403;
    res.end();
    return;
  }
  const isFile = (p: string) => {
    try {
      return fs.statSync(p).isFile();
    } catch {
      return false;
    }
  };
  if (!isFile(file)) {
    if (path.extname(rel)) {
      res.statusCode = 404;
      res.end('Not found');
      return;
    }
    file = path.join(root, 'index.html');
  }
  const ext = path.extname(file).toLowerCase();
  res.setHeader('Content-Type', MIME[ext] ?? 'application/octet-stream');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', rel.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
  if (ext === '.html') {
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'");
  }
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  fs.createReadStream(file).pipe(res);
}

function listen(server: http.Server, port: number, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (err: Error) => {
      server.off('listening', onListening);
      reject(err);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve((server.address() as AddressInfo).port);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

/** Serves the built UI and the Agent HQ API from one local HTTP server, without Vite. */
export async function startStandaloneServer(opts: StandaloneOptions): Promise<StandaloneServer> {
  const host = opts.host ?? '127.0.0.1';
  const api = createApiMiddleware();
  const server = http.createServer((req, res) => {
    void api(req, res, () => serveStatic(opts.staticDir, req, res));
  });
  const ports = opts.ports?.length ? opts.ports : [0];
  let lastError: unknown;
  for (const candidate of ports) {
    try {
      const port = await listen(server, candidate, host);
      return {
        port,
        url: `http://${host}:${port}`,
        close: () => {
          closeAllTerminals();
          stopComputerDriver();
          return new Promise((resolve) => {
            server.close(() => resolve());
            server.closeAllConnections();
          });
        },
      };
    } catch (err) {
      lastError = err;
      if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('No free port.');
}
