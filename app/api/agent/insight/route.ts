import { generateObject } from "ai"
import { z } from "zod"
import { getCloudflareAI, cloudflareConfigured, DEFAULT_MODEL } from "@/lib/ai"

export const maxDuration = 30

const RequestSchema = z.object({
  aggressiveness: z.number().min(0).max(100),
  maxExposure: z.number().positive(),
  exposure: z.number(),
  realizedPnl: z.number(),
  winRate: z.number(),
  opportunities: z
    .array(
      z.object({
        pair: z.string(),
        buyVenue: z.string(),
        sellVenue: z.string(),
        spreadBps: z.number(),
        estProfit: z.number(),
      }),
    )
    .max(12),
})

const InsightSchema = z.object({
  stance: z.enum(["aggressive", "balanced", "defensive"]).describe("Overall recommended posture"),
  confidence: z.number().min(0).max(100).describe("Confidence in the assessment, 0-100"),
  headline: z.string().describe("One concise sentence summarizing the market read"),
  rationale: z.string().describe("2-3 sentences explaining the reasoning"),
  actions: z
    .array(
      z.object({
        pair: z.string(),
        action: z.enum(["execute", "watch", "skip"]),
        reason: z.string(),
      }),
    )
    .max(5)
    .describe("Per-opportunity recommendations"),
  riskFlags: z.array(z.string()).max(4).describe("Notable risks to watch"),
})

export async function POST(req: Request) {
  if (!cloudflareConfigured) {
    return Response.json(
      { error: "Cloudflare AI Gateway is not configured on the server." },
      { status: 503 },
    )
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 })
  }

  const parsed = RequestSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: "Invalid request payload.", details: parsed.error.issues }, { status: 400 })
  }

  const s = parsed.data
  const exposurePct = ((s.exposure / s.maxExposure) * 100).toFixed(1)

  try {
    const ai = getCloudflareAI()
    const { object } = await generateObject({
      model: ai(DEFAULT_MODEL),
      schema: InsightSchema,
      system:
        "You are the risk-and-execution brain of a high-frequency crypto arbitrage desk. " +
        "You are precise, unemotional, and capital-preservation focused. " +
        "Aggressiveness is a 0-100 dial set by the operator. Respect current exposure vs. the cap. " +
        "Only recommend 'execute' on opportunities whose spread comfortably covers fees and slippage.",
      prompt:
        `Desk state:\n` +
        `- Aggressiveness dial: ${s.aggressiveness}/100\n` +
        `- Exposure: $${s.exposure.toLocaleString()} of $${s.maxExposure.toLocaleString()} cap (${exposurePct}%)\n` +
        `- Realized PnL today: $${s.realizedPnl.toLocaleString()}\n` +
        `- Win rate: ${s.winRate.toFixed(1)}%\n\n` +
        `Live arbitrage opportunities:\n` +
        s.opportunities
          .map(
            (o, i) =>
              `${i + 1}. ${o.pair}: buy ${o.buyVenue} / sell ${o.sellVenue}, spread ${o.spreadBps.toFixed(
                1,
              )} bps, est. profit $${o.estProfit.toFixed(0)}`,
          )
          .join("\n") +
        `\n\nAssess the book and produce your recommendation.`,
    })

    return Response.json({ insight: object, model: DEFAULT_MODEL })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error"
    console.log("[v0] Cloudflare AI Gateway error:", message)
    return Response.json({ error: `AI Gateway request failed: ${message}` }, { status: 502 })
  }
}
