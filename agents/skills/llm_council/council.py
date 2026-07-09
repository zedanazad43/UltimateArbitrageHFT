#!/usr/bin/env python3
"""
LLM Council Skill — Multi-provider parallel reasoning for AIMaster.

Karpathy-inspired N-way council: sends the same question to all healthy
AIMaster providers, collects structured outputs, detects conflicts,
runs directed peer review if needed, and synthesizes a final answer.

Usage:
    from aimaster.skills.llm_council import run_council

    result = run_council("What is the best arbitrage strategy for BTC?")
    print(result.confirmed_conclusions)
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import Dict, Any, List, Optional

logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────────────────────
# Prompt Templates
# ─────────────────────────────────────────────────────────────

COUNCIL_TEMPLATE = """You are an independent AI advisor in a multi-model council. Your role is to analyze the following question thoroughly and provide your best answer.

## Question
{question}

## Required Output Format
You MUST respond with EXACTLY these 6 sections:

1. **Final Conclusion** — Your single best answer to the question, stated clearly.
2. **Confidence Level** — High / Medium / Low with brief justification.
3. **Key Evidence** — The most important facts, data, or logic supporting your conclusion.
4. **Key Assumptions** — What you assume to be true that could change your answer if wrong.
5. **Most Likely Failure Point** — Where your reasoning is weakest or most likely to break.
6. **Peer Review Needed?** — YES if there is genuine ambiguity or disagreement potential, NO if the answer is straightforward.

Do NOT use any delivery tools. Return plain text analysis only."""

PEER_REVIEW_TEMPLATE = """Re-evaluate your council answer given these disagreements.

ORIGINAL QUESTION: {question}
DISAGREEMENTS: {disagreement_points}
YOUR PREVIOUS CONCLUSION: {original_position}

Respond with:
1. REVISED CONCLUSION (or confirm original)
2. WHAT CHANGED and why
3. REMAINING UNCERTAINTY"""


@dataclass
class CouncilVerdict:
    """Structured output from a single council member."""
    provider: str
    model: str
    conclusion: str
    confidence: str
    evidence: str
    assumptions: str
    failure_point: str
    peer_review_needed: bool
    latency_ms: float
    raw_content: str


@dataclass
class CouncilResult:
    """Final synthesized council result."""
    question: str
    confirmed_conclusions: str
    assumption_dependent: str
    remaining_uncertainty: str
    verdicts: List[CouncilVerdict] = field(default_factory=list)
    total_latency_ms: float = 0.0
    providers_used: int = 0
    peer_review_rounds: int = 0
    execution_mode: str = "balanced"
    provider_names: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "question": self.question,
            "confirmed_conclusions": self.confirmed_conclusions,
            "assumption_dependent": self.assumption_dependent,
            "remaining_uncertainty": self.remaining_uncertainty,
            "verdicts": [
                {
                    "provider": v.provider,
                    "model": v.model,
                    "conclusion": v.conclusion,
                    "confidence": v.confidence,
                    "evidence": v.evidence,
                    "assumptions": v.assumptions,
                    "failure_point": v.failure_point,
                    "peer_review_needed": v.peer_review_needed,
                    "latency_ms": v.latency_ms,
                }
                for v in self.verdicts
            ],
            "total_latency_ms": self.total_latency_ms,
            "providers_used": self.providers_used,
            "peer_review_rounds": self.peer_review_rounds,
        }


def _parse_verdict(content: str) -> Optional[Dict[str, Any]]:
    """Parse a council member structured output into a dict."""
    sections = {
        "conclusion": "",
        "confidence": "",
        "evidence": "",
        "assumptions": "",
        "failure_point": "",
        "peer_review_needed": False,
    }
    current_section = None
    for line in content.split("\n"):
        ls = line.strip()
        if not ls:
            current_section = None
            continue
        low = ls.lower()
        if "**" in ls:
            if "conclusion:" in low or "final conclusion" in low:
                current_section = "conclusion"; continue
            elif "confidence:" in low or "confidence level" in low:
                current_section = "confidence"; continue
            elif "evidence:" in low or "key evidence" in low:
                current_section = "evidence"; continue
            elif "assumptions:" in low or "key assumption" in low:
                current_section = "assumptions"; continue
            elif "failure point:" in low or "failure point" in low:
                current_section = "failure_point"; continue
            elif "review needed" in low or "peer review needed" in low:
                current_section = "peer_review_needed"; continue
        if current_section == "peer_review_needed":
            if "yes" in low:
                sections["peer_review_needed"] = True
        elif current_section and current_section in sections:
            sections[current_section] += ls + " "
    for key in sections:
        if isinstance(sections[key], str):
            sections[key] = sections[key].strip()
    return sections if sections["conclusion"] else None


def _detect_material_conflict(verdicts: List[CouncilVerdict]) -> List[str]:
    """Detect material conflicts warranting peer review."""
    if len(verdicts) < 2:
        return []
    conflicts = []
    for v in verdicts:
        if v.peer_review_needed:
            conflicts.append(f"Member ({v.provider}/{v.model}) flagged peer review needed")
    conclusions = [v.conclusion.lower() for v in verdicts]
    unique = set(c[:80] for c in conclusions if c)
    if len(unique) > max(1, len(verdicts) // 2):
        conflicts.append("Conclusions diverge significantly across council members")
    assumptions = [v.assumptions.lower() for v in verdicts]
    unique_a = set(a[:80] for a in assumptions if a)
    if len(unique_a) > max(1, len(verdicts) // 2):
        conflicts.append("Key assumptions differ across council members")
    return conflicts


def run_council(
    question: str,
    mode: str = "balanced",
    max_peers: int = 3,
) -> CouncilResult:
    """
    Run the LLM Council on a question using all healthy AIMaster providers.

    Args:
        question: The question or task to analyze.
        mode: 'balanced' (default) or 'debate'.
        max_peers: Maximum number of providers to use (default 3).

    Returns:
        CouncilResult with synthesized answer.
    """
    from aimaster.master import AIMasterAgent

    t_start = time.time()
    agent = AIMasterAgent()

    available = agent.get_available_providers()
    if not available:
        return CouncilResult(
            question=question,
            confirmed_conclusions="No AI providers available for council.",
            assumption_dependent="",
            remaining_uncertainty="All providers offline.",
            providers_used=0,
        )

    council_members = available[:max_peers]
    logger.info(f"LLM Council: {len(council_members)} members -> {council_members}")

    # Phase 1: Independent parallel round
    verdicts: List[CouncilVerdict] = []
    prompt = COUNCIL_TEMPLATE.format(question=question)

    for provider_name in council_members:
        t1 = time.time()
        try:
            result = agent.chat(prompt=prompt, provider=provider_name)
            latency = (time.time() - t1) * 1000
            if result.success:
                parsed = _parse_verdict(result.content)
                if parsed:
                    verdicts.append(CouncilVerdict(
                        provider=provider_name, model=result.model,
                        conclusion=parsed["conclusion"], confidence=parsed["confidence"],
                        evidence=parsed["evidence"], assumptions=parsed["assumptions"],
                        failure_point=parsed["failure_point"],
                        peer_review_needed=parsed["peer_review_needed"],
                        latency_ms=latency, raw_content=result.content,
                    ))
                else:
                    verdicts.append(CouncilVerdict(
                        provider=provider_name, model=result.model,
                        conclusion=result.content[:500], confidence="Unknown",
                        evidence="", assumptions="",
                        failure_point="Parse failed", peer_review_needed=False,
                        latency_ms=latency, raw_content=result.content,
                    ))
                logger.info(f"  OK {provider_name} ({result.model}): {latency:.0f}ms")
            else:
                logger.warning(f"  FAIL {provider_name}: {result.error}")
        except Exception as e:
            logger.error(f"  EXC {provider_name}: {e}")

    # Phase 2: Conflict detection + optional peer review
    peer_review_rounds = 0
    if len(verdicts) >= 2:
        conflicts = _detect_material_conflict(verdicts)
        if conflicts and (mode == "debate" or mode == "balanced"):
            peer_review_rounds = 1
            logger.info(f"  Conflicts: {conflicts}")
            disagreement_text = "\n".join(f"- {c}" for c in conflicts)
            for v in verdicts:
                try:
                    review_prompt = PEER_REVIEW_TEMPLATE.format(
                        question=question, disagreement_points=disagreement_text,
                        original_position=v.conclusion,
                    )
                    result = agent.chat(prompt=review_prompt, provider=v.provider)
                    if result.success:
                        v.conclusion = result.content[:500]
                        v.peer_review_needed = False
                        logger.info(f"  PEER {v.provider}: reviewed")
                except Exception as e:
                    logger.warning(f"  PEER FAIL {v.provider}: {e}")

    # Phase 3: Synthesis
    confirmed = []
    assumptions = []
    uncertain = []
    for v in verdicts:
        tag = f"[{v.provider}/{v.model}]"
        if v.confidence.lower().startswith("high"):
            confirmed.append(f"- {tag}: {v.conclusion}")
        else:
            assumptions.append(f"- {tag}: {v.conclusion}")
        if v.failure_point:
            uncertain.append(f"- {tag}: {v.failure_point}")

    total_latency = (time.time() - t_start) * 1000

    return CouncilResult(
        question=question,
        confirmed_conclusions="\n".join(confirmed) if confirmed else "No high-confidence consensus.",
        assumption_dependent="\n".join(assumptions) if assumptions else "None.",
        remaining_uncertainty="\n".join(uncertain) if uncertain else "None identified.",
        verdicts=verdicts,
        total_latency_ms=total_latency,
        providers_used=len(verdicts),
        peer_review_rounds=peer_review_rounds,
        execution_mode=mode,
        provider_names=[v.provider for v in verdicts],
    )
