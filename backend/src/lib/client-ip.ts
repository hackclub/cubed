// The IP used to key rate limits. X-Real-IP is only believed when the direct
// peer is one of config.trustedProxies (your ingress / the Astro server);
// otherwise the socket address wins, so a client talking to the backend
// directly can't choose its own bucket by sending the header.

import { BlockList, isIP } from "node:net";
import type { Context } from "hono";
import { getConnInfo } from "@hono/node-server/conninfo";
import { config } from "../config.js";

const trusted = new BlockList();
let trustAll = false;
for (const entry of config.trustedProxies) {
  if (entry === "*") {
    trustAll = true;
    continue;
  }
  const [address, prefix] = entry.split("/");
  const family = isIP(address) === 6 ? "ipv6" : "ipv4";
  if (isIP(address) === 0) continue;
  if (prefix === undefined) trusted.addAddress(address, family);
  else trusted.addSubnet(address, Number(prefix), family);
}

// "::ffff:1.2.3.4" (IPv4 over a dual-stack socket) -> "1.2.3.4"
function normalize(ip: string): string {
  return ip.startsWith("::ffff:") && isIP(ip.slice(7)) === 4 ? ip.slice(7) : ip;
}

export function isTrustedPeer(peer: string | undefined): boolean {
  if (trustAll) return true;
  if (!peer) return false;
  const ip = normalize(peer);
  const family = isIP(ip);
  return family !== 0 && trusted.check(ip, family === 6 ? "ipv6" : "ipv4");
}

export function clientIp(c: Context): string {
  let peer: string | undefined;
  try {
    peer = getConnInfo(c).remote.address;
  } catch {
    // No real socket (in-process test requests): nothing to distrust, use the header.
    peer = undefined;
  }
  if (peer === undefined) return c.req.header("x-real-ip") ?? "unknown";
  if (isTrustedPeer(peer)) {
    const header = c.req.header("x-real-ip")?.trim();
    if (header && isIP(header) !== 0) return normalize(header);
  }
  return normalize(peer);
}
