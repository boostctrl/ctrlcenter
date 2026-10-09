// Normalizes what people paste into an app or bookmark URL field. A bare host
// ("plex.local:32400", "192.168.1.5:8096", "nas") is what homelab users type
// most often, and the http(s)-only schema used to reject it with an error
// (#277); assume http:// for those. Anything that already names a scheme is
// left alone, so a wrong one ("ftp://…") still reaches the schema's message.
export function withHttpScheme(input: string): string {
  const value = input.trim();
  if (value === "" || /^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return value;
  return `http://${value.replace(/^\/+/, "")}`;
}

// Ports whose service doesn't speak HTTP, so a bare "host:port" on one of them
// is better watched by opening a TCP connection than by an HTTP request.
const TCP_PORTS = new Set([
  21, 22, 23, 25, 110, 139, 143, 445, 465, 587, 993, 995, 1883, 2049, 3306,
  3389, 5432, 5900, 6379, 8883, 11211, 27017,
]);

// A sensible check method for an app from what was typed in its URL field
// (#296): a bare "host:port" on a well-known non-HTTP port gets a TCP check,
// port 53 a DNS check, and everything else (any URL with a scheme, or a bare
// host on a web port) HTTP.
export function guessCheckType(input: string): "http" | "tcp" | "dns" {
  const value = input.trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return "http";
  const m = /^(?:\[[^\]]+\]|[^/:?#]+):(\d+)(?:[/?#]|$)/.exec(value);
  const port = m ? Number(m[1]) : null;
  if (port === 53) return "dns";
  if (port !== null && TCP_PORTS.has(port)) return "tcp";
  return "http";
}
