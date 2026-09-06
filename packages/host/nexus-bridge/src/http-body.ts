/**
 * Shared HTTP JSON helpers for the Nexus Bridge routes: one bounded body
 * reader and one JSON responder so admin, handshake, and command surfaces
 * cannot drift on limits or headers.
 * @module
 */

import type { IncomingMessage, ServerResponse } from 'node:http'

/**
 * Read and parse one JSON request body.
 * @param req - incoming request.
 * @param maxBytes - request size cap; larger bodies throw.
 * @returns the parsed JSON value.
 * @throws Error when the body exceeds `maxBytes` or is not valid JSON.
 */
export async function readJsonBody(req: IncomingMessage, maxBytes: number): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const bytes: Buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
    size += bytes.length
    if (size > maxBytes) throw new Error('request too large')
    chunks.push(bytes)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

/**
 * Write one JSON response.
 * @param res - response writer.
 * @param status - HTTP status code.
 * @param body - JSON-serializable body.
 */
export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}
