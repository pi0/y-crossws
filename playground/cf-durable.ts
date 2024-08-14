import { createHandler } from "../src/index.ts";
import { getAssetFromKV } from "@cloudflare/kv-asset-handler";
import { DurableObject } from "cloudflare:workers";
import crossws from "crossws/adapters/cloudflare-durable";

// @ts-ignore
import manifestJSON from "__STATIC_CONTENT_MANIFEST";
const assetManifest = JSON.parse(manifestJSON);

const ws = crossws(createHandler());

export default {
  async fetch(request: Request, env: any, ctx: any) {
    // Handle websocket
    if (request.headers.get("upgrade") === "websocket") {
      return ws.handleUpgrade(request as any, env, ctx);
    }
    // Handle static assets
    try {
      return await getAssetFromKV(
        { request, waitUntil: ctx.waitUntil.bind(ctx) },
        {
          ASSET_NAMESPACE: env.__STATIC_CONTENT,
          ASSET_MANIFEST: assetManifest,
        },
      );
    } catch {
      const pathname = new URL(request.url).pathname;
      return new Response(`"${pathname}" not found`, { status: 404 });
    }
  },
};

export class $DurableObject extends DurableObject {
  fetch(request) {
    return ws.handleDurableUpgrade(this, request);
  }
  webSocketMessage(client, message) {
    return ws.handleDurableMessage(this, client, message);
  }
  webSocketClose(client, code, reason, wasClean) {
    return ws.handleDurableClose(this, client, code, reason, wasClean);
  }
}
