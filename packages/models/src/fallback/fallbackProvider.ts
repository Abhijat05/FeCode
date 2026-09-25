import type {
  ModelCapabilities,
  ModelEvent,
  ModelProvider,
  ModelRequest,
  ProviderAttemptInfo
} from "../types.js";
import {
  classifyProviderError,
  type ProviderErrorCategory
} from "../errors/classification.js";

export interface FallbackCandidate {
  provider: ModelProvider;
  maxRetries?: number;
}

export interface FallbackEvent {
  fromProvider: string;
  toProvider: string;
  reason: string;
  category: ProviderErrorCategory;
  attempt: number;
  maxAttempts: number;
  timestamp: number;
  partialTextInterrupted?: boolean;
  attemptId?: string;
}

export interface FallbackModelProviderOptions {
  candidates: FallbackCandidate[];
  maxTotalFallbackSwitches?: number;
  onFallback?: (event: FallbackEvent) => void;
  onProviderAttempt?: (providerId: string, attempt: number) => void;
}

export class FallbackModelProvider implements ModelProvider {
  public readonly id = "fallback";
  private readonly candidates: FallbackCandidate[];
  private activeCandidateIndex = 0;
  private readonly maxTotalFallbackSwitches: number;
  private readonly onFallback?: (event: FallbackEvent) => void;
  private readonly onProviderAttempt?: (providerId: string, attempt: number) => void;

  private readonly attempts: ProviderAttemptInfo[] = [];
  private activeAttemptId?: string;

  constructor(options: FallbackModelProviderOptions) {
    if (!options.candidates || options.candidates.length === 0) {
      throw new Error("FallbackModelProvider requires at least one candidate provider.");
    }
    this.candidates = options.candidates;
    this.maxTotalFallbackSwitches =
      typeof options.maxTotalFallbackSwitches === "number"
        ? options.maxTotalFallbackSwitches
        : Math.max(0, this.candidates.length - 1);
    this.onFallback = options.onFallback;
    this.onProviderAttempt = options.onProviderAttempt;
  }

  public get activeProvider(): ModelProvider {
    const idx = Math.min(this.activeCandidateIndex, this.candidates.length - 1);
    return this.candidates[idx].provider;
  }

  public get capabilities(): ModelCapabilities {
    return this.activeProvider.capabilities;
  }

  public getActiveProviderId(): string {
    return this.activeProvider.id;
  }

  public getActiveAttempt(): ProviderAttemptInfo | undefined {
    return this.attempts.find((a) => a.id === this.activeAttemptId);
  }

  public getAttemptHistory(): ProviderAttemptInfo[] {
    return [...this.attempts];
  }

  public resetActiveProvider(): void {
    this.activeCandidateIndex = 0;
  }

  async *generate(
    request: ModelRequest,
    signal?: AbortSignal
  ): AsyncIterable<ModelEvent> {
    if (signal?.aborted) {
      yield { type: "error", error: new Error("Request aborted") };
      return;
    }

    let totalSwitches = 0;

    while (this.activeCandidateIndex < this.candidates.length) {
      if (signal?.aborted) {
        yield { type: "error", error: new Error("Request aborted") };
        return;
      }

      const candidate = this.candidates[this.activeCandidateIndex];
      const maxRetries = typeof candidate.maxRetries === "number" ? candidate.maxRetries : 0;
      let candidateAttempt = 0;
      let candidateSucceeded = false;
      let lastError: Error | null = null;
      let lastClassification: ReturnType<typeof classifyProviderError> | null = null;

      while (candidateAttempt <= maxRetries) {
        if (signal?.aborted) {
          yield { type: "error", error: new Error("Request aborted") };
          return;
        }

        candidateAttempt++;
        const attemptId = `att-${candidate.provider.id}-${Date.now()}-${candidateAttempt}-${Math.random().toString(36).slice(2, 6)}`;
        const attemptInfo: ProviderAttemptInfo = {
          id: attemptId,
          providerId: candidate.provider.id,
          attemptNumber: candidateAttempt,
          state: "streaming",
          startedAt: Date.now(),
          tokensEmitted: 0
        };
        this.attempts.push(attemptInfo);
        this.activeAttemptId = attemptId;

        if (this.onProviderAttempt) {
          this.onProviderAttempt(candidate.provider.id, candidateAttempt);
        }

        let streamError: Error | null = null;
        let attemptTokensEmitted = 0;

        try {
          const stream = candidate.provider.generate(request, signal);
          for await (const event of stream) {
            if (signal?.aborted) {
              attemptInfo.state = "cancelled";
              attemptInfo.completedAt = Date.now();
              yield { type: "error", error: new Error("Request aborted") };
              return;
            }

            // Reject late events from superseded attempts
            if (this.activeAttemptId !== attemptId || attemptInfo.state !== "streaming") {
              continue;
            }

            if (event.type === "error") {
              streamError = event.error;
              break;
            } else if (event.type === "text_delta") {
              attemptTokensEmitted++;
              attemptInfo.tokensEmitted = attemptTokensEmitted;
              yield event;
            } else if (event.type === "completed") {
              attemptInfo.state = "completed";
              attemptInfo.completedAt = Date.now();
              yield event;
              candidateSucceeded = true;
              return;
            } else {
              yield event;
            }
          }
        } catch (err: unknown) {
          streamError = err instanceof Error ? err : new Error(String(err));
        }

        if (candidateSucceeded) {
          return;
        }

        if (signal?.aborted) {
          attemptInfo.state = "cancelled";
          attemptInfo.completedAt = Date.now();
          yield { type: "error", error: new Error("Request aborted") };
          return;
        }

        lastError = streamError;
        lastClassification = classifyProviderError(streamError);
        attemptInfo.error = streamError ? streamError.message : undefined;

        // If error is transient and we have retries left on this candidate, retry.
        if (lastClassification.isRetryable && candidateAttempt <= maxRetries) {
          attemptInfo.state = "failed";
          attemptInfo.completedAt = Date.now();
          continue;
        }

        break;
      }

      if (candidateSucceeded) {
        return;
      }

      // If we reach here, this candidate failed.
      if (!lastClassification) {
        lastClassification = classifyProviderError(lastError);
      }

      // Check if eligible for fallback across providers (quota exhaustion / rate limit)
      if (
        lastClassification.isFallbackEligible &&
        this.activeCandidateIndex + 1 < this.candidates.length &&
        totalSwitches < this.maxTotalFallbackSwitches
      ) {
        if (signal?.aborted) {
          yield { type: "error", error: new Error("Request aborted") };
          return;
        }

        const fromProvider = candidate.provider.id;
        const currentAttempt = this.attempts.find((a) => a.id === this.activeAttemptId);
        if (currentAttempt) {
          currentAttempt.state = "exhausted";
          currentAttempt.completedAt = Date.now();
        }

        const partialTextInterrupted = (currentAttempt?.tokensEmitted || 0) > 0;

        this.activeCandidateIndex++;
        totalSwitches++;
        const toCandidate = this.candidates[this.activeCandidateIndex];
        const toProvider = toCandidate.provider.id;

        if (currentAttempt) {
          currentAttempt.state = "superseded";
        }

        const fallbackEvent: FallbackEvent = {
          fromProvider,
          toProvider,
          reason: lastClassification.reason,
          category: lastClassification.category,
          attempt: totalSwitches,
          maxAttempts: this.maxTotalFallbackSwitches,
          timestamp: Date.now(),
          partialTextInterrupted,
          attemptId: currentAttempt?.id
        };

        if (this.onFallback) {
          this.onFallback(fallbackEvent);
        }

        yield {
          type: "fallback",
          fromProvider,
          toProvider,
          reason: lastClassification.reason,
          category: lastClassification.category,
          attempt: totalSwitches,
          maxAttempts: this.maxTotalFallbackSwitches,
          timestamp: fallbackEvent.timestamp,
          partialTextInterrupted,
          attemptId: currentAttempt?.id
        };

        // Proceed to next candidate in while loop
        continue;
      }

      // If all candidates exhausted due to quota/rate-limit
      if (lastClassification.isFallbackEligible && this.activeCandidateIndex + 1 >= this.candidates.length) {
        const currentAttempt = this.attempts.find((a) => a.id === this.activeAttemptId);
        if (currentAttempt) {
          currentAttempt.state = "exhausted";
          currentAttempt.completedAt = Date.now();
        }
        const chain = this.candidates.map((c) => c.provider.id).join(" -> ");
        yield {
          type: "error",
          error: new Error(
            `All configured model providers exhausted (${chain}). Last error: ${lastClassification.reason}`
          )
        };
        return;
      }

      // For all other errors (401 auth, 400 invalid, non-fallback transient after retries, abort, etc.), yield error and terminate
      const currentAttempt = this.attempts.find((a) => a.id === this.activeAttemptId);
      if (currentAttempt) {
        currentAttempt.state = signal?.aborted ? "cancelled" : "failed";
        currentAttempt.completedAt = Date.now();
      }
      yield {
        type: "error",
        error: lastError || new Error("Provider execution failed")
      };
      return;
    }
  }
}
