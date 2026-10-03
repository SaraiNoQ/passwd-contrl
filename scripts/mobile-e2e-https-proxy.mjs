import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import { timingSafeEqual } from "node:crypto";

const key = fs.readFileSync(process.env.ZERO_VAULT_E2E_TLS_KEY);
const cert = fs.readFileSync(process.env.ZERO_VAULT_E2E_TLS_CERT);
const controlToken = process.env.ZERO_VAULT_E2E_CONTROL_TOKEN ?? "";
let failNextItemSyncPush = process.env.ZERO_VAULT_E2E_FAIL_FIRST_ITEM_SYNC === "1"
  ? "production"
  : null;

const server = https.createServer({ key, cert }, (request, response) => {
  const remoteAddress = request.socket.remoteAddress ?? "";
  const suppliedControlToken = request.headers["x-zero-vault-e2e-control"];
  const authorizedControl = (
    /^[0-9a-f]{64}$/.test(controlToken) &&
    typeof suppliedControlToken === "string" &&
    /^[0-9a-f]{64}$/.test(suppliedControlToken) &&
    timingSafeEqual(Buffer.from(suppliedControlToken), Buffer.from(controlToken))
  );
  if (request.method === "POST" && request.url === "/__zero_vault_e2e/fail-next-item-sync") {
    if (
      !authorizedControl ||
      !(
        remoteAddress === "127.0.0.1" ||
        remoteAddress === "::1" ||
        remoteAddress === "::ffff:127.0.0.1"
      )
    ) {
      response.writeHead(403);
      response.end();
      return;
    }
    failNextItemSyncPush = "offline-restart";
    console.log("e2e-item-sync-failure-armed offline-restart");
    response.writeHead(204);
    response.end();
    return;
  }

  if (
    failNextItemSyncPush &&
    request.method === "POST" &&
    request.url === "/vault/item-sync"
  ) {
    const failureLabel = failNextItemSyncPush;
    failNextItemSyncPush = null;
    console.log(`e2e-one-shot-item-sync-network-failure ${failureLabel}`);
    request.resume();
    request.socket.destroy();
    return;
  }

  const upstream = http.request(
    {
      hostname: "127.0.0.1",
      port: 8787,
      method: request.method,
      path: request.url,
      headers: { ...request.headers, host: "127.0.0.1:8787" },
    },
    (upstreamResponse) => {
      if (
        request.url === "/vault/item-sync" &&
        (request.method === "GET" || request.method === "POST")
      ) {
        console.log(
          `e2e-item-sync-upstream ${request.method} ${upstreamResponse.statusCode ?? 502}`,
        );
      }
      response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
      upstreamResponse.pipe(response);
    },
  );
  upstream.on("error", () => {
    if (!response.headersSent) response.writeHead(502);
    response.end();
  });
  request.pipe(upstream);
});

server.listen(8788, "0.0.0.0", () => console.log("e2e-https-proxy-ready"));
