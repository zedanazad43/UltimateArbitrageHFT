import { createOpenAI } from "@ai-sdk/openai"

/**
 * Cloudflare AI Gateway — OpenAI-compatible ("compat") endpoint.
 *
 * Docs: https://developers.cloudflare.com/ai-gateway/chat-completion/
 * The base URL shape is:
 *   https://gateway.ai.cloudflare.com/v1/{ACCOUNT_ID}/{GATEWAY_ID}/compat
 * and the AI SDK's OpenAI provider appends `/chat/completions`.
 *
 * Auth:
 * - `Authorization: Bearer <token>` is forwarded to the downstream provider
 *   (Workers AI uses a Cloudflare API token here).
 * - `cf-aig-authorization: Bearer <token>` authenticates the Gateway itself
 *   when the Gateway is set to "Authenticated".
 *
 * All values come from server-side env vars and are never exposed to the client.
 */

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID
const gatewayId = process.env.CF_GATEWAY_ID
const token = process.env.CF_AIGATEWAY_TOKEN

export const cloudflareConfigured = Boolean(accountId && gatewayId && token)

export function getCloudflareAI() {
  if (!cloudflareConfigured) {
    throw new Error(
      "Cloudflare AI Gateway is not configured. Set CLOUDFLARE_ACCOUNT_ID, CF_GATEWAY_ID and CF_AIGATEWAY_TOKEN.",
    )
  }

  return createOpenAI({
    baseURL: `https://gateway.ai.cloudflare.com/v1/${accountId}/${gatewayId}/compat`,
    apiKey: token,
    headers: {
      // Authenticates the Gateway when it is set to "Authenticated" mode.
      "cf-aig-authorization": `Bearer ${token}`,
    },
  })
}

/**
 * Default model routed through the Gateway. On the compat endpoint models are
 * addressed as `<provider>/<model>` — e.g. Workers AI Llama below. Override via
 * the CF_AI_MODEL env var without touching code.
 */
export const DEFAULT_MODEL =
  process.env.CF_AI_MODEL ?? "workers-ai/@cf/meta/llama-3.3-70b-instruct-fp8-fast"
