#!/usr/bin/env node
/**
 * Nexus beta tailnet forwarder (temporary, golden-path connectivity).
 *
 * The beta web environment binds loopback only (dsh refuses 0.0.0.0 by
 * design), but the iOS app's device build points at the Tailscale IP:
 *   NEXUS_BRIDGE_URL[iphoneos] = http://100.107.98.34:3088/nexus
 * (ATS whitelists exactly that address for plain HTTP; see the app's
 * Info.plist). This forwarder bridges the gap without touching dsh: it
 * binds ONLY the Tailscale interface address and streams both ways, so
 * SSE frames pass through unbuffered.
 *
 *   node migration/tools/nexus-beta-forwarder.mjs            # 3088 -> 3088
 *   FROM=3088 TO=3088 BIND=100.107.98.34 node …              # overrides
 *
 * Exposure is tailnet-only: the bind address is the machine's Tailscale
 * IP, unreachable from the LAN or the public internet. Kill the process
 * to remove the path.
 */
import { createServer, request as httpRequest } from 'node:http'

const FROM = Number(process.env.FROM ?? 3088)
const TO = Number(process.env.TO ?? 3088)
const BIND = process.env.BIND ?? '100.107.98.34'

const upstream = httpRequest
const server = createServer((req, res) => {
  const headers = { ...req.headers }
  delete headers.host
  delete headers.connection
  const proxyReq = upstream(
    { host: '127.0.0.1', port: TO, method: req.method, path: req.url, headers },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers)
      proxyRes.pipe(res)
    },
  )
  proxyReq.on('error', (error) => {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' })
    res.end(`forwarder upstream error: ${error.message}`)
  })
  // Flush request bodies through untouched (pairing, prompts, approvals).
  req.pipe(proxyReq)
})

server.on('clientError', (error, socket) => {
  socket.end('HTTP/1.1 400 Bad Request\r\n\r\n')
})

server.listen(FROM, BIND, () => {
  console.log(`[nexus-beta-forwarder] http://${BIND}:${FROM} -> http://127.0.0.1:${TO}`)
  console.log('[nexus-beta-forwarder] tailnet-only bind; Ctrl-C or kill to remove')
})
