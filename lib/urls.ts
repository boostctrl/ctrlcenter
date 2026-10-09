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
