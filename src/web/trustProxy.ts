import net from "node:net";

// WEB_TRUST_PROXY names the reverse proxy in front of the dashboard: addresses
// or subnets, comma-separated ("192.168.40.10", "192.168.40.0/24"), or one of
// Express's ranges ("loopback", "linklocal", "uniquelocal"). Only requests
// from those addresses may set X-Forwarded-For and X-Forwarded-Proto. Unset,
// both headers are ignored, so a client can't claim another address (to get a
// fresh login rate limit) or https (to look like a Secure connection).
//
// "true" and hop counts are refused: they trust whoever connects, including a
// client that reaches the port directly instead of through the proxy.
const NAMED_RANGES = new Set(["loopback", "linklocal", "uniquelocal"]);

function isAddressOrSubnet(entry: string): boolean {
  if (NAMED_RANGES.has(entry)) return true;
  const [address, bits, extra] = entry.split("/");
  if (extra !== undefined || !address) return false;
  const family = net.isIP(address);
  if (family === 0) return false;
  if (bits === undefined) return true;
  const n = Number(bits);
  return /^\d{1,3}$/.test(bits) && n <= (family === 4 ? 32 : 128);
}

export function trustProxyFromEnv(raw = process.env.WEB_TRUST_PROXY): string[] | false {
  const entries = (raw ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (entries.length === 0) return false;
  const invalid = entries.filter((entry) => !isAddressOrSubnet(entry));
  if (invalid.length > 0) {
    throw new Error(
      `WEB_TRUST_PROXY must list the reverse proxy's addresses or subnets (e.g. 192.168.40.10 or ` +
        `192.168.40.0/24), or loopback, linklocal or uniquelocal. Not accepted: ${invalid.join(", ")}.`,
    );
  }
  return entries;
}
