export interface TokenOptimizationInput {
  text: string;
  estimatedTokens?: number;
  maxTokens?: number;
  priority?: "low" | "normal" | "high";
  metadata?: Record<string, unknown>;
}

export interface TokenOptimizationMetrics {
  originalTokens: number;
  optimizedTokens: number;
  tokensSaved: number;
  reductionRatio: number;
  strategy: string;
}

export interface TokenOptimizationResult {
  text: string;
  originalEstimatedTokens: number;
  optimizedEstimatedTokens: number;
  changed: boolean;
  strategy: string;
  metrics: TokenOptimizationMetrics;
}

export interface TokenOptimizer {
  optimize(input: TokenOptimizationInput): TokenOptimizationResult;
}
