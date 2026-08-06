import { createServer } from 'node:http';

const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const wsUrl = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3001/ws';
const port = Number(process.env.WEB_PORT || 3000);
const html = `<!doctype html><html><head><title>ArborAI</title></head><body><main><h1>ArborAI</h1><p id="status">Checking API connection…</p></main><script>window.arborAiWsUrl=${JSON.stringify(wsUrl)};fetch(${JSON.stringify(`${apiUrl}/health`)}).then(r=>r.ok?r.json():Promise.reject()).then(d=>document.querySelector('#status').textContent='API status: '+d.status).catch(()=>document.querySelector('#status').textContent='API status: unavailable')</script></body></html>`;
createServer((_request, response) => { response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); response.end(html); }).listen(port, () => console.log(`Web listening on http://localhost:${port}`));
