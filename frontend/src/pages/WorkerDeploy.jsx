import React, { useEffect, useState } from "react";
import api from "../lib/api";
import { Card, CardHeader, Pill } from "../components/ui/Primitives";
import {
  Cloud,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Terminal,
  ExternalLink,
  Copy,
  AlertTriangle,
  Globe,
  Activity,
  Beaker,
} from "lucide-react";

const RUNBOOK = [
  {
    id: "login",
    title: "Authenticate with Cloudflare",
    cmd: "npx wrangler login",
    hint: "Opens a browser; sign in to the same Cloudflare account that owns the ecostamp.net zone.",
  },
  {
    id: "cd",
    title: "Enter the worker directory",
    cmd: "cd ArbitrageBots/ultimate-arbitrage-hft",
    hint: "All wrangler commands must be run from the worker root (the folder containing wrangler.toml).",
  },
  {
    id: "deploy",
    title: "Publish the worker",
    cmd: "npx wrangler deploy",
    hint: "Pushes the optimized index.js to Cloudflare's edge. You should see a https://*.workers.dev URL on success.",
  },
  {
    id: "route",
    title: "Bind the custom route ecostamp.net",
    cmd: "npx wrangler triggers deploy",
    hint: "If wrangler.toml has [[routes]] for ecostamp.net, this attaches the worker. Otherwise add the route in the Cloudflare dashboard → Workers → your worker → Triggers.",
  },
  {
    id: "dns",
    title: "Verify DNS is proxied (orange-cloud)",
    cmd: "dig +short ecostamp.net",
    hint: "The A/AAAA record must be Proxied (orange cloud) in Cloudflare DNS, otherwise the worker route does not apply and you'll see error 1014.",
  },
  {
    id: "smoke",
    title: "Smoke-test /health",
    cmd: "curl -s https://ecostamp.net/health | jq .",
    hint: "Should return JSON like {\"status\":\"ok\"}. If you see HTML or 1014, the worker is not bound to the route.",
  },
];

function StatusBlock({ worker, probing, onProbe }) {
  const configured = !!worker?.configured;
  const ok = !!worker?.ok;
  const code = worker?.status_code;

  let tone = "neutral";
  let title = "Worker URL not set";
  let icon = <Cloud size={22} />;

  if (configured && ok) {
    tone = "success";
    title = "Worker is LIVE and reachable";
    icon = <CheckCircle2 size={22} />;
  } else if (configured && !ok && code) {
    tone = "warn";
    title = `Worker reachable but returned ${code}`;
    icon = <AlertTriangle size={22} />;
  } else if (configured) {
    tone = "danger";
    title = "Worker unreachable";
    icon = <XCircle size={22} />;
  }

  return (
    <Card className={tone === "success" ? "glow-primary" : tone === "danger" ? "glow-destructive" : ""} testid="worker-deploy-status-card">
      <div className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div
            className={`h-12 w-12 rounded-sm border flex items-center justify-center ${
              tone === "success"
                ? "border-primary/60 bg-primary/10 text-primary"
                : tone === "warn"
                ? "border-yellow-500/60 bg-yellow-500/10 text-yellow-400"
                : tone === "danger"
                ? "border-destructive/60 bg-destructive/10 text-destructive"
                : "border-border text-muted"
            }`}
          >
            {icon}
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-[0.22em] text-muted">Cloudflare Worker</div>
            <div className="font-display text-xl tracking-tight" data-testid="worker-deploy-status-title">
              {title}
            </div>
            <div className="text-xs text-muted font-mono mt-1 flex flex-wrap gap-x-3 gap-y-1">
              <span>
                url: <span className="text-white">{worker?.url || "—"}</span>
              </span>
              {code != null && (
                <span>
                  status: <span className="text-white">{code}</span>
                </span>
              )}
              {worker?.last_check && (
                <span>
                  last_check: <span className="text-white">{new Date(worker.last_check).toLocaleTimeString()}</span>
                </span>
              )}
            </div>
            {worker?.error && (
              <div className="text-[11px] text-destructive font-mono mt-1">err: {worker.error}</div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Pill
            tone={tone === "success" ? "success" : tone === "warn" ? "warn" : tone === "danger" ? "danger" : "neutral"}
            testid="worker-deploy-pill"
          >
            {ok ? "online" : configured ? "offline" : "unset"}
          </Pill>
          <button
            data-testid="worker-deploy-probe-button"
            onClick={onProbe}
            disabled={probing}
            className="flex items-center gap-1.5 text-xs border border-primary/60 text-primary hover:bg-primary/10 px-3 py-2 rounded-sm disabled:opacity-50"
          >
            <RefreshCw size={12} className={probing ? "animate-spin" : ""} />
            {probing ? "Probing..." : "Re-probe now"}
          </button>
        </div>
      </div>
    </Card>
  );
}

function Step({ index, step, onCopy, copied }) {
  return (
    <div
      className="grid grid-cols-[28px_1fr] gap-3 px-4 py-3 border-b border-border/40 last:border-b-0"
      data-testid={`worker-deploy-step-${step.id}`}
    >
      <div className="h-7 w-7 rounded-sm border border-primary/40 bg-primary/10 text-primary font-mono text-xs flex items-center justify-center">
        {index + 1}
      </div>
      <div className="min-w-0">
        <div className="text-sm font-medium">{step.title}</div>
        <div className="text-[11px] text-muted font-mono mt-0.5">{step.hint}</div>
        <div className="mt-2 flex items-stretch gap-0 border border-border rounded-sm overflow-hidden bg-elevated">
          <code className="flex-1 px-3 py-2 font-mono text-xs text-white whitespace-pre overflow-x-auto" data-testid={`worker-deploy-cmd-${step.id}`}>
            $ {step.cmd}
          </code>
          <button
            onClick={() => onCopy(step.id, step.cmd)}
            className="px-3 border-l border-border text-muted hover:text-primary hover:bg-primary/5 flex items-center gap-1 text-[10px] uppercase tracking-wider"
            data-testid={`worker-deploy-copy-${step.id}`}
          >
            <Copy size={11} />
            {copied === step.id ? "copied" : "copy"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function WorkerDeploy() {
  const [worker, setWorker] = useState(null);
  const [probing, setProbing] = useState(false);
  const [copied, setCopied] = useState(null);
  const [smoke, setSmoke] = useState(null);
  const [smoking, setSmoking] = useState(false);

  const load = async (force = false) => {
    try {
      if (force) {
        setProbing(true);
        const { data } = await api.post("/worker/probe");
        setWorker(data);
      } else {
        const { data } = await api.get("/worker/health");
        setWorker(data);
      }
    } catch (err) {
      console.error("worker probe failed", err);
    } finally {
      setProbing(false);
    }
  };

  const runSmoke = async () => {
    setSmoking(true);
    try {
      const { data } = await api.get("/worker/smoke");
      setSmoke(data);
    } catch (err) {
      console.error("worker smoke failed", err);
    } finally {
      setSmoking(false);
    }
  };

  useEffect(() => {
    load();
    const id = setInterval(() => load(false), 10000);
    return () => clearInterval(id);
  }, []);

  const handleCopy = (id, cmd) => {
    try {
      navigator.clipboard.writeText(cmd);
      setCopied(id);
      setTimeout(() => setCopied(null), 1500);
    } catch (err) {
      console.error("clipboard write failed", err);
    }
  };

  return (
    <div className="space-y-4 max-w-5xl" data-testid="worker-deploy-page">
      <StatusBlock worker={worker} probing={probing} onProbe={() => load(true)} />

      <SmokePanel smoke={smoke} smoking={smoking} onRun={runSmoke} />

      <Card>
        <CardHeader
          subtitle="[ Step-by-step ]"
          title="Deploy Runbook"
          right={
            <a
              href="https://developers.cloudflare.com/workers/wrangler/commands/#deploy"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] uppercase tracking-wider text-muted hover:text-primary flex items-center gap-1"
              data-testid="worker-deploy-docs-link"
            >
              <ExternalLink size={11} /> wrangler docs
            </a>
          }
        />
        <div className="text-[11px] font-mono text-muted px-4 py-3 border-b border-border/40 flex items-start gap-2">
          <Terminal size={12} className="mt-0.5 shrink-0 text-primary" />
          <span>
            Run these on the machine where you have <span className="text-white">Node.js</span> and Cloudflare access. The dashboard will auto-detect when the worker comes online.
          </span>
        </div>
        <div>
          {RUNBOOK.map((step, i) => (
            <Step key={step.id} index={i} step={step} onCopy={handleCopy} copied={copied} />
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader subtitle="[ Common errors ]" title="Troubleshooting" />
        <div className="p-4 space-y-3 text-sm">
          <Trouble
            code="Error 1014"
            desc="CNAME Cross-User Banned — the ecostamp.net DNS record points to another Cloudflare account / a host that isn't tied to your worker route. Either fix the DNS record so the apex is Proxied on YOUR account, or change the route to a *.workers.dev subdomain."
          />
          <Trouble
            code="403 Forbidden (HTML page)"
            desc="A Cloudflare zone is intercepting the request before your worker. Confirm the worker route is bound (Dashboard → Workers → Triggers → Routes) and that the DNS record is orange-cloud proxied."
          />
          <Trouble
            code="525 / 526 SSL"
            desc="The origin behind ecostamp.net has no valid TLS cert. Switch SSL mode to 'Flexible' or 'Full' in Cloudflare → SSL/TLS, or — better — delete the origin so Cloudflare serves the worker directly."
          />
          <Trouble
            code="200 OK but unexpected JSON"
            desc="The worker is reachable but exposes different endpoint paths. Open backend/worker_client.py to confirm /health, /status, /spreads, /opportunities, /balances all return the expected shapes."
          />
        </div>
      </Card>

      <Card>
        <CardHeader subtitle="[ Override ]" title="Custom Worker URL" />
        <div className="p-4 text-[12px] font-mono text-muted leading-relaxed">
          <div className="flex items-start gap-2">
            <Globe size={13} className="mt-0.5 shrink-0 text-primary" />
            <div>
              The backend reads <span className="text-white">WORKER_URL</span> from <span className="text-white">/app/backend/.env</span>. To swap targets (e.g. use the workers.dev URL while DNS is being fixed):
              <div className="mt-2 px-3 py-2 bg-elevated border border-border rounded-sm text-white">
                WORKER_URL=https://ultimate-arbitrage-hft.YOUR-ACCOUNT.workers.dev
              </div>
              <div className="mt-2">Then restart the backend: <span className="text-white">sudo supervisorctl restart backend</span></div>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}

function Trouble({ code, desc }) {
  return (
    <div className="flex items-start gap-3 border border-border/60 rounded-sm px-3 py-2.5" data-testid={`worker-deploy-trouble-${code.replace(/\s+/g, "-").toLowerCase()}`}>
      <Pill tone="warn">{code}</Pill>
      <div className="text-[12px] text-muted leading-relaxed">{desc}</div>
    </div>
  );
}

function SmokePanel({ smoke, smoking, onRun }) {
  const allOk = smoke?.all_ok;
  return (
    <Card testid="worker-smoke-card" className={smoke && allOk ? "glow-primary" : ""}>
      <CardHeader
        subtitle="[ Shape diff ]"
        title="Smoke-test Worker Endpoints"
        right={
          <div className="flex items-center gap-2">
            {smoke && (
              <Pill tone={allOk ? "success" : "danger"} testid="worker-smoke-overall-pill">
                {allOk ? "all green" : "issues"}
              </Pill>
            )}
            <button
              data-testid="worker-smoke-run-button"
              onClick={onRun}
              disabled={smoking}
              className="flex items-center gap-1.5 text-xs border border-primary/60 text-primary hover:bg-primary/10 px-3 py-2 rounded-sm disabled:opacity-50"
            >
              <Beaker size={12} className={smoking ? "animate-pulse" : ""} />
              {smoking ? "Running..." : "Run smoke test"}
            </button>
          </div>
        }
      />
      <div className="text-[11px] font-mono text-muted px-4 py-3 border-b border-border/40 flex items-start gap-2">
        <Activity size={12} className="mt-0.5 shrink-0 text-primary" />
        <span>
          Probes <span className="text-white">/health</span>, <span className="text-white">/status</span>, <span className="text-white">/spreads</span>, <span className="text-white">/opportunities</span>, <span className="text-white">/balances</span> on your worker and verifies each response matches the shape the backend expects. Run this after every <span className="text-white">wrangler deploy</span> — before flipping LIVE.
        </span>
      </div>
      {!smoke && (
        <div className="px-4 py-6 text-center text-[12px] font-mono text-muted">
          No smoke test run yet. Click &quot;Run smoke test&quot; to probe all endpoints.
        </div>
      )}
      {smoke && !smoke.configured && (
        <div className="px-4 py-4 text-[12px] font-mono text-destructive">
          WORKER_URL is not configured in /app/backend/.env — set it first.
        </div>
      )}
      {smoke && smoke.configured && (
        <div className="divide-y divide-border/40">
          {smoke.results.map((r) => (
            <SmokeRow key={r.path} row={r} />
          ))}
        </div>
      )}
    </Card>
  );
}

function SmokeRow({ row }) {
  const greenHttp = row.ok;
  const greenShape = row.shape_ok;
  const fullyGreen = greenHttp && greenShape;
  const Icon = fullyGreen ? CheckCircle2 : XCircle;
  return (
    <div className="px-4 py-3" data-testid={`worker-smoke-row-${row.path.replace("/", "")}`}>
      <div className="flex items-start gap-3">
        <Icon
          size={16}
          className={`mt-0.5 shrink-0 ${fullyGreen ? "text-primary" : "text-destructive"}`}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <code className="font-mono text-sm text-white">{row.path}</code>
            <Pill tone={greenHttp ? "success" : "danger"}>
              {row.status_code ? `http ${row.status_code}` : "unreachable"}
            </Pill>
            <Pill tone={greenShape ? "success" : greenHttp ? "warn" : "neutral"}>
              shape {greenShape ? "ok" : "mismatch"}
            </Pill>
            <span className="text-[11px] font-mono text-muted">
              expects <span className="text-white">{row.expected_type}</span>
              {row.expected_keys && (
                <> with <span className="text-white">{row.expected_keys.join(", ")}</span></>
              )}
            </span>
          </div>
          {row.error && (
            <div className="text-[11px] font-mono text-destructive mt-1">err: {row.error}</div>
          )}
          {row.missing_keys && row.missing_keys.length > 0 && (
            <div className="text-[11px] font-mono text-yellow-400 mt-1">
              missing keys: {row.missing_keys.join(", ")}
            </div>
          )}
          {row.sample != null && (
            <details className="mt-2">
              <summary className="text-[10px] uppercase tracking-wider text-muted cursor-pointer hover:text-primary">
                sample payload
              </summary>
              <pre className="mt-2 bg-elevated border border-border rounded-sm px-3 py-2 text-[11px] font-mono text-white overflow-x-auto max-h-48">
                {JSON.stringify(row.sample, null, 2)}
              </pre>
            </details>
          )}
        </div>
      </div>
    </div>
  );
}
