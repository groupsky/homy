/**
 * Custom error classes for detect-changes tooling.
 */

/**
 * Raised when Dockerfile validation fails.
 * Used for validation issues like ARG variables in FROM statements.
 */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}

/**
 * Base exception for GHCR-related errors.
 */
export class GHCRError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GHCRError';
    Object.setPrototypeOf(this, GHCRError.prototype);
  }
}

/**
 * Exception raised when GHCR rate limit is hit (503 errors).
 */
export class GHCRRateLimitError extends GHCRError {
  constructor(message: string) {
    super(message);
    this.name = 'GHCRRateLimitError';
    Object.setPrototypeOf(this, GHCRRateLimitError.prototype);
  }
}
