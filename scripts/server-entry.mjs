// Production entry point: what the Docker image runs instead of Next's
// generated standalone server.js (which it then loads). It exists for one job —
// giving the app the TCP peer address of every request, which Next's route
// handlers otherwise never see (#257).
//
// Next only fills X-Forwarded-For from the socket when the client sent none,
// so without this a client talking to ctrlcenter directly can forge the header
// and get a fresh login-throttle bucket per request — or, with
// TRUSTED_PROXY_HOPS=0, every client shares one bucket and five bad guesses
// lock the real admin out. Here each request gets an `x-ctrlcenter-peer`
// header set from the socket (overwriting anything a client sent under that
// name), and CTRLCENTER_PEER_HEADER tells lib/rate-limit.ts it can trust it.
// Without this entry (`next start`, a custom command) that flag is absent and
// the header is ignored, so a client can't forge its way in through it.
import http from "node:http";

const PEER_HEADER = "x-ctrlcenter-peer";
process.env.CTRLCENTER_PEER_HEADER = "1";

// The socket's remote address, with IPv4-mapped IPv6 ("::ffff:10.0.0.5")
// written the way the same client appears in X-Forwarded-For.
function peerOf(req) {
  const address = (req.socket && req.socket.remoteAddress) || "";
  return address.startsWith("::ffff:") ? address.slice(7) : address;
}

// Next's start-server creates its server with http.createServer(listener);
// wrap that listener so the header is in place before Next sees the request.
const createServer = http.createServer;
http.createServer = function (...args) {
  const i = args.findIndex((arg) => typeof arg === "function");
  if (i >= 0) {
    const listener = args[i];
    args[i] = function (req, res) {
      const peer = peerOf(req);
      if (peer) req.headers[PEER_HEADER] = peer;
      else delete req.headers[PEER_HEADER];
      return listener.call(this, req, res);
    };
  }
  return createServer.apply(this, args);
};

// Loaded only now, after the patch above, so Next's server picks it up.
await import("./server.js");
