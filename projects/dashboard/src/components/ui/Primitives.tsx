import React from "react";
import type { ReactNode } from "react";

type CardProps = {
  children?: ReactNode;
  className?: string;
  testid?: string;
};

export function Card({ children, className = "", testid }: CardProps) {
  return (
    <div data-testid={testid} className={`bg-surface border border-border/60 rounded-sm ${className}`}>
      {children}
    </div>
  );
}

type CardHeaderProps = {
  title?: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
  testid?: string;
};

export function CardHeader({ title, subtitle, right, testid }: CardHeaderProps) {
  return (
    <div className="flex items-start justify-between px-4 py-3 border-b border-border/60">
      <div>
        <div className="text-[10px] uppercase tracking-[0.22em] text-muted">{subtitle}</div>
        <div data-testid={testid} className="font-display text-sm font-medium mt-0.5">
          {title}
        </div>
      </div>
      {right}
    </div>
  );
}

type MetricProps = {
  label?: ReactNode;
  value: ReactNode;
  change?: ReactNode;
  changePositive?: boolean;
  mono?: boolean;
  status?: "success" | "error";
  testid?: string;
};

export function Metric({ label, value, change, changePositive, mono = true, status, testid }: MetricProps) {
  const tone =
    status === "success" ? "text-primary" : status === "error" ? "text-destructive" : "";
  return (
    <div className="px-4 py-4">
      {label !== undefined && label !== null && (
        <div className="text-[10px] uppercase tracking-[0.22em] text-muted mb-1">{label}</div>
      )}
      <div
        data-testid={testid}
        className={`text-2xl ${mono ? "font-mono" : "font-display"} font-semibold tracking-tight ${tone}`}
      >
        {value}
      </div>
      {change !== undefined && change !== null && (
        <div className={`mt-1 text-xs font-mono ${changePositive ? "text-primary" : "text-destructive"}`}>
          {changePositive ? "▲" : "▼"} {change}
        </div>
      )}
    </div>
  );
}

type PillProps = {
  children?: ReactNode;
  tone?: "neutral" | "success" | "danger" | "warn" | "accent";
  testid?: string;
};

export function Pill({ children, tone = "neutral", testid }: PillProps) {
  const tones: Record<string, string> = {
    neutral: "border-border text-muted",
    success: "border-primary/50 text-primary bg-primary/5",
    danger: "border-destructive/50 text-destructive bg-destructive/5",
    warn: "border-yellow-500/50 text-yellow-400 bg-yellow-500/5",
    accent: "border-accent/50 text-accent bg-accent/5",
  };
  return (
    <span
      data-testid={testid}
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-sm text-[10px] uppercase tracking-[0.18em] border ${tones[tone]}`}
    >
      {children}
    </span>
  );
}