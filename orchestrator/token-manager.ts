/**
 * Token Manager - Aggressive token optimization with headroom
 * Uses: Headroom allocation (20% reserve) + Lean-Context compression
 * Fallback: CodeGeeX → Ollama → CLI (all free)
 */

export interface TokenBudget {
    total: number;
    headroom: number; // 20% reserve
    available: number;
    used: number;
}

export interface LeanContext {
    original_tokens: number;
    compressed_tokens: number;
    compression_ratio: number;
    removed: string[];
    compressed: string;
}

export class TokenManager {
    private budget: TokenBudget;
    private readonly HEADROOM_RATIO = 0.2; // 20% reserve
    private readonly MAX_CONTEXT_SIZE = 100_000; // tokens

    constructor(totalTokens = 100_000) {
        this.budget = {
            total: totalTokens,
            headroom: Math.floor(totalTokens * this.HEADROOM_RATIO),
            available: Math.floor(totalTokens * (1 - this.HEADROOM_RATIO)),
            used: 0,
        };
    }

    /**
     * Compress context aggressively to save tokens
     * Removes: verbose logs, examples, redundant newlines, comments
     */
    compressContext(context: string): LeanContext {
        const original = context;
        const originalTokens = this.estimateTokens(original);

        let compressed = original
            // Remove verbose logging
            .replace(/DEBUG:.*?\n/g, "")
            .replace(/VERBOSE:.*?\n/g, "")
            // Remove multiple newlines
            .replace(/\n\n+/g, "\n")
            // Remove leading/trailing whitespace on lines
            .split("\n")
            .map(line => line.trim())
            .filter(line => line.length > 0)
            .join("\n")
            // Remove code examples (keep only essential)
            .replace(/```[\s\S]*?```/g, "[CODE_EXAMPLE]")
            // Remove URLs (keep only domain)
            .replace(/https?:\/\/[^\s]+/g, "[URL]")
            // Collapse multiple spaces
            .replace(/  +/g, " ");

        const compressedTokens = this.estimateTokens(compressed);
        const ratio = compressedTokens / originalTokens;

        return {
            original_tokens: originalTokens,
            compressed_tokens: compressedTokens,
            compression_ratio: ratio,
            removed: [
                "verbose_logs",
                "extra_newlines",
                "code_examples",
                "full_urls",
                "extra_spaces",
            ],
            compressed,
        };
    }

    /**
     * Estimate token count (rough: 1 token ≈ 4 chars)
     */
    private estimateTokens(text: string): number {
        return Math.ceil(text.length / 4);
    }

    /**
     * Check if request fits in available budget
     */
    canFitRequest(estimatedTokens: number): boolean {
        return this.budget.used + estimatedTokens <= this.budget.available;
    }

    /**
     * Get fallback model when budget tight
     * Priority: CodeGeeX (free) → Ollama (local) → CLI
     */
    getFallbackModel(preferredModel: string): string {
        const used_ratio = this.budget.used / this.budget.available;

        if (used_ratio > 0.9) return "ollama"; // <10% left
        if (used_ratio > 0.75) return "codegeex"; // <25% left
        return preferredModel;
    }

    /**
     * Reserve headroom for emergencies (don't exceed this)
     */
    getEmergencyHeadroom(): number {
        return this.budget.headroom;
    }

    /**
     * Get current budget status
     */
    getStatus() {
        return {
            ...this.budget,
            used_percent: Math.round((this.budget.used / this.budget.available) * 100),
            remaining: this.budget.available - this.budget.used,
            in_headroom: this.budget.used > this.budget.available,
        };
    }

    /**
     * Deduct tokens from budget
     */
    consumeTokens(tokens: number) {
        this.budget.used += tokens;
    }

    /**
     * Reset budget (for new session)
     */
    reset(newTotal = 100_000) {
        this.budget = {
            total: newTotal,
            headroom: Math.floor(newTotal * this.HEADROOM_RATIO),
            available: Math.floor(newTotal * (1 - this.HEADROOM_RATIO)),
            used: 0,
        };
    }
}
