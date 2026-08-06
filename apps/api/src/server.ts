import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { getConfig, type ApiConfig } from './config.js';

export function handleApiRequest(config: ApiConfig, request: IncomingMessage, response: ServerResponse): void {
  response.setHeader('Access-Control-Allow-Origin', config.webOrigin);
  response.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
  if (request.method === 'GET' && request.url === '/health') {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ status: 'ok' }));
    return;
  }
  response.writeHead(404).end();
}

export function createApiServer(config = getConfig()) {
  return createServer((request, response) => handleApiRequest(config, request, response));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const config = getConfig();
  createApiServer(config).listen(config.port, () => console.log(`API listening on http://localhost:${config.port}`));
}
