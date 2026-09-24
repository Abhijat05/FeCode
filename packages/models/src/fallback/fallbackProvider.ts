import type {
  ModelCapabilities,
  ModelEvent,
  ModelProvider,
  ModelRequest
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
        if (this.onProviderAttempt) {
          this.onProviderAttempt(candidate.provider.id, candidateAttempt);
        }

        let streamError: Error | null = null;
        const bufferedEvents: ModelEvent[] = [];

        try {
          const stream = candidate.provider.generate(request, signal);
          for await (const event of stream) {
            if (event.type === "error") {
              streamError = event.error;
              break;
            } else {
              bufferedEvents.push(event);
            }
          }
        } catch (err: unknown) {
          streamError = err instanceof Error ? err : new Error(String(err));
        }

        if (!streamError) {
          // Success! Flush buffered events and finish.
          for (const ev of bufferedEvents) {
            yield ev;
          }
          candidateSucceeded = true;
          break;
        }

        lastError = streamError;
        lastClassification = classifyProviderError(streamError);

        // If error is transient and we have retries left on this candidate, retry.
        if (lastClassification.isRetryable && candidateAttempt <= maxRetries) {
          continue;
        }

        // If error occurred, break out of candidate retry loop.
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
        const fromProvider = candidate.provider.id;
        this.activeCandidateIndex++;
        totalSwitches++;
        const toCandidate = this.candidates[this.activeCandidateIndex];
        const toProvider = toCandidate.provider.id;

        const fallbackEvent: FallbackEvent = {
          fromProvider,
          toProvider,
          reason: lastClassification.reason,
          category: lastClassification.category,
          attempt: totalSwitches,
          maxAttempts: this.maxTotalFallbackSwitches,
          timestamp: Date.now()
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
          timestamp: fallbackEvent.timestamp
        };

        // Proceed to next candidate in while loop
        continue;
      }

      // If all candidates exhausted due to quota/rate-limit
      if (lastClassification.isFallbackEligible && this.activeCandidateIndex + 1 >= this.candidates.length) {
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
      yield {
        type: "error",
        error: lastError || new Error("Provider execution failed")
      };
      return;
    }
  }
}
