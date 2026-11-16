import handler from "vinext/server/fetch-handler";
import { runWithConnectorBinding } from "../lib/connector-context";
import type { ConnectorBinding } from "../lib/connector-contract.mjs";
import { handleTaskTrackerMcp } from "./mcp";

const worker = {
  fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext<{ CONNECTORS?: ConnectorBinding }>) {
    let binding = ctx.props?.CONNECTORS;
    // Local preview emulates the same request-scoped capability. This branch and
    // the auxiliary service binding are absent from production builds.
    if (import.meta.env.DEV && !binding && env.CONNECTORS) {
      const preview = env.CONNECTORS;
      const expiresAt = Date.now() + 60_000;
      binding = {
        async getContext() {
          if (Date.now() >= expiresAt) return { status: "request_context_expired" };
          return preview.getContext?.() ?? { status: "binding_unavailable" };
        },
        async invoke(connectorId, actionName, args) {
          if (Date.now() >= expiresAt) {
            return { status: "request_context_expired", message: "This request has expired. Please try again." };
          }
          return preview.invoke(connectorId, actionName, args);
        },
      };
    }
    return runWithConnectorBinding(binding, () => {
      if (new URL(request.url).pathname !== "/mcp") return handler.fetch(request, env, ctx);
      return handleTaskTrackerMcp(request, (body) => {
        // Reuse the website's authenticated API so task writes share validation,
        // permanent-ID allocation, and audit history with browser edits.
        const headers = new Headers({ "content-type": "application/json" });
        for (const name of ["oai-authenticated-user-id", "oai-authenticated-user-email", "oai-authenticated-user-full-name", "oai-authenticated-user-full-name-encoding"]) {
          const value = request.headers.get(name);
          if (value) headers.set(name, value);
        }
        return handler.fetch(new Request(new URL("/api/data", request.url), {
          method: "POST", headers, body: JSON.stringify(body),
        }), env, ctx);
      });
    });
  },
};

export default worker;
