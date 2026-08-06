import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function loadLocalEnv(): void {
  try {
    for (const line of readFileSync(resolve(process.cwd(), '.env'), 'utf8').split(/\r?\n/)) {
      const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
      if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
    }
  } catch { /* .env is optional when variables are supplied by the environment. */ }
}

export type ApiConfig = { port: number; webOrigin: string; aiProvider: string; wsPath: string };

export function getConfig(env = process.env): ApiConfig {
  loadLocalEnv();
  const required = ['API_PORT', 'WEB_ORIGIN', 'AI_PROVIDER'];
  const missing = required.filter((key) => !env[key]);
  if (missing.length) throw new Error(`Missing required environment variables: ${missing.join(', ')}. Copy .env.example to .env or export them.`);
  const port = Number(env.API_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('API_PORT must be an integer between 1 and 65535.');
  if (env.AI_PROVIDER !== 'mock') throw new Error(`Unsupported local AI_PROVIDER “${env.AI_PROVIDER}”; use “mock” for offline development.`);
  return { port, webOrigin: env.WEB_ORIGIN!, aiProvider: env.AI_PROVIDER, wsPath: env.WS_PATH || '/ws' };
}
