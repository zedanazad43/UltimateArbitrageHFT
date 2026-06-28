import React, { useEffect, useState, useRef } from "react";
import api from "../lib/api";
import { Card, CardHeader, Pill } from "../components/ui/Primitives";

const levelColor = {
  INFO: "text-primary",
  WARN: "text-yellow-400",
  ERROR: "text-destructive",
  DEBUG: "text-muted",
};

export default function Logs() {
  const [lines, setLines] = useState([]);
  const [follow, setFollow] = useState(true);
  const boxRef = useRef(null);

  useEffect(() => {
    let m = true;
    const tick = async () => {
      try {
        const { data } = await api.get("/logs?limit=200");
        if (m) setLines(data);
      } catch {}
    };
    tick();
    const id = setInterval(tick, 1500);
    return () => {
      m = false;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    if (follow && boxRef.current) {
      boxRef.current.scrollTop = 0;
    }
  }, [lines, follow]);

  return (
    <div className="space-y-4" data-testid="logs-page">
      <Card>
        <CardHeader
          subtitle="[ Live ]"
          title="Engine Logs"
          right={
            <div className="flex items-center gap-2">
              <Pill tone="success">{lines.length} lines</Pill>
              <button
                onClick={() => setFollow((f) => !f)}
                data-testid="logs-follow-toggle"
                className={`text-xs px-3 py-1 rounded-sm border ${
                  follow ? "border-primary text-primary" : "border-border text-muted"
                }`}
              >
                {follow ? "auto-scroll: ON" : "auto-scroll: OFF"}
              </button>
            </div>
          }
        />
        <div ref={boxRef} className="h-[560px] overflow-auto bg-black border-t border-border/60" data-testid="logs-viewer">
          <div className="px-4 py-3 space-y-0.5">
            {lines.map((l, i) => (
              <div key={`${l.ts}-${i}`} className="terminal-line flex gap-2">
                <span className="text-muted">{new Date(l.ts).toISOString().slice(11, 19)}</span>
                <span className={`${levelColor[l.level] || "text-white"} w-12 shrink-0`}>{l.level}</span>
                <span className="text-white/90 break-words">{l.msg}</span>
              </div>
            ))}
            {lines.length === 0 && <div className="text-muted terminal-line">[ awaiting logs ]</div>}
          </div>
        </div>
      </Card>
    </div>
  );
}
