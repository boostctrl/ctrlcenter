// Next.js startup hook (runs once when the server process boots). Everything
// it does needs Node (the status poller uses fs and outbound fetch), so the
// body lives in instrumentation-node.ts and is imported only in the Node
// branch (#404): the Edge compile of this file then carries none of it, and
// stops warning about every fs and crypto import under lib/config.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { registerNode } = await import("./instrumentation-node");
  await registerNode();
}
