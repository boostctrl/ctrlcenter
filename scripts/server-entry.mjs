// Production entry point: what the Docker image runs instead of Next's
// generated standalone server.js (which it then loads). It exists to tell the
// app two things about every request that Next's route handlers otherwise
// never see: the TCP peer address (#257), and whether the request arrived
// with an X-Forwarded-For header at all (#383).
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
//
// Next also fills X-Forwarded-For in before any route handler runs, so by
// then every request looks proxied. `x-ctrlcenter-forwarded` ("1" or "0",
// overwriting a client's) records whether the header was there when the
// request reached the server, for the security checklist's proxy row (#383).
import http from "node:http";

const PEER_HEADER = "x-ctrlcenter-peer";
const FORWARDED_HEADER = "x-ctrlcenter-forwarded";
process.env.CTRLCENTER_PEER_HEADER = "1";

// The socket's remote address, with IPv4-mapped IPv6 ("::ffff:10.0.0.5")
// written the way the same client appears in X-Forwarded-For.
function peerOf(req) {
  const address = (req.socket && req.socket.remoteAddress) || "";
  return address.startsWith("::ffff:") ? address.slice(7) : address;
}

// Next's start-server creates its server with http.createServer(listener);
// wrap that listener so the headers are in place before Next sees the request.
const createServer = http.createServer;
http.createServer = function (...args) {
  const i = args.findIndex((arg) => typeof arg === "function");
  if (i >= 0) {
    const listener = args[i];
    args[i] = function (req, res) {
      const peer = peerOf(req);
      if (peer) req.headers[PEER_HEADER] = peer;
      else delete req.headers[PEER_HEADER];
      req.headers[FORWARDED_HEADER] = req.headers["x-forwarded-for"] ? "1" : "0";
      return listener.call(this, req, res);
    };
  }
  return createServer.apply(this, args);
};

// Loaded only now, after the patch above, so Next's server picks it up.
await import("./server.js");
