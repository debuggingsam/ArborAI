import { createHash, randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Socket } from 'node:net';
import { WebSocketEvent, WebSocketEventEnvelopeSchema, WebSocketPayloadSchema, type WebSocketPayload } from '@arborai/shared';

/** Minimal RFC6455 transport: rooms and payload contracts remain independent of HTTP handlers. */
export class RealtimeGateway {
  private readonly rooms = new Map<string, Set<Socket>>();

  attach(server: { on(event: 'upgrade', listener: (request: IncomingMessage, socket: Socket) => void): unknown }, path: string) {
    server.on('upgrade', (request, socket) => {
      if (new URL(request.url ?? '/', 'http://localhost').pathname !== path || request.headers.upgrade?.toLowerCase() !== 'websocket' || !request.headers['sec-websocket-key']) { socket.destroy(); return; }
      const accept = createHash('sha1').update(`${request.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
      socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
      socket.on('data', (buffer) => this.onFrame(socket, buffer));
      socket.on('close', () => this.leaveAll(socket)); socket.on('error', () => this.leaveAll(socket));
    });
  }

  publish(workspaceId: string, generationId: string | null, payload: WebSocketPayload) {
    if (!WebSocketPayloadSchema.safeParse(payload).success) return;
    const envelope = { eventId: randomUUID(), eventType: payload.eventType, workspaceId, generationId, occurredAt: new Date().toISOString(), payload };
    if (!WebSocketEventEnvelopeSchema.safeParse(envelope).success) return;
    const frame = textFrame(JSON.stringify(envelope));
    for (const socket of this.rooms.get(workspaceId) ?? []) if (!socket.destroyed) socket.write(frame);
  }

  private onFrame(socket: Socket, buffer: Buffer) {
    const text = decodeClientTextFrame(buffer); if (text === null) return;
    try {
      const payload = JSON.parse(text) as WebSocketPayload;
      if (!WebSocketPayloadSchema.safeParse(payload).success) return;
      if (payload.eventType === WebSocketEvent.ConversationJoin) { this.join(payload.workspaceId, socket); this.publishTo(socket, payload.workspaceId, null, { eventType: WebSocketEvent.ConversationJoined, workspaceId: payload.workspaceId }); }
      if (payload.eventType === WebSocketEvent.ConversationLeave) this.leave(payload.workspaceId, socket);
    } catch { /* Invalid client frames never affect a room. */ }
  }
  private join(workspaceId: string, socket: Socket) { const room = this.rooms.get(workspaceId) ?? new Set<Socket>(); room.add(socket); this.rooms.set(workspaceId, room); }
  private leave(workspaceId: string, socket: Socket) { const room = this.rooms.get(workspaceId); if (!room) return; room.delete(socket); if (!room.size) this.rooms.delete(workspaceId); }
  private leaveAll(socket: Socket) { for (const workspaceId of this.rooms.keys()) this.leave(workspaceId, socket); }
  private publishTo(socket: Socket, workspaceId: string, generationId: string | null, payload: WebSocketPayload) { const envelope = { eventId: randomUUID(), eventType: payload.eventType, workspaceId, generationId, occurredAt: new Date().toISOString(), payload }; socket.write(textFrame(JSON.stringify(envelope))); }
}

function textFrame(text: string) { const data = Buffer.from(text); if (data.length < 126) return Buffer.concat([Buffer.from([0x81, data.length]), data]); if (data.length < 65_536) { const header = Buffer.alloc(4); header[0] = 0x81; header[1] = 126; header.writeUInt16BE(data.length, 2); return Buffer.concat([header, data]); } throw new Error('Realtime event exceeds WebSocket frame limit.'); }
function decodeClientTextFrame(buffer: Buffer): string | null { if (buffer.length < 6 || (buffer[0]! & 0x0f) !== 1 || !(buffer[1]! & 0x80)) return null; let offset = 2; let length = buffer[1]! & 0x7f; if (length === 126) { if (buffer.length < 8) return null; length = buffer.readUInt16BE(offset); offset += 2; } if (length > 65_535 || buffer.length < offset + 4 + length) return null; const mask = buffer.subarray(offset, offset + 4); offset += 4; const data = Buffer.alloc(length); for (let index = 0; index < length; index += 1) data[index] = buffer[offset + index]! ^ mask[index % 4]!; return data.toString('utf8'); }
