import type { IncomingMessage, ServerResponse } from 'node:http';
import { createApiApp } from '../server.ts';

const app = createApiApp(true);
const routes = new Set(['health','models','test-connection','test-openai','analyze-video','analyze-upload','extract-frames','parse-pptx-template','parse-pdf','refine-slide','regenerate-slide','verify-slide-frames','inspect-captured-frames','export-source-zip']);
export default function handler(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url || '/', 'https://localhost');
  const route = url.pathname === '/api/index' ? url.searchParams.get('__route') : url.pathname.replace(/^\/api\//, '');
  if (!route || !routes.has(route)) {
    res.statusCode = 404;
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify({ error: 'Unknown API endpoint' }));
    return;
  }
  req.url = '/api/' + route;
  return app(req, res);
}
