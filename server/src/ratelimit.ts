// Per-key token bucket, used to throttle the unauthenticated session-lookup
// events so 5-char join codes can't be enumerated. Buckets refill continuously:
// short bursts (a draft party joining at once) pass, sustained guessing doesn't.

interface Bucket {
  tokens: number;
  last: number; // epoch ms of the last refill
}

export class RateLimiter {
  private buckets = new Map<string, Bucket>();

  constructor(
    private capacity: number,
    private refillPerSec: number
  ) {
    // Sweep idle buckets so the map can't grow unbounded across many IPs.
    setInterval(() => this.prune(), 60_000).unref();
  }

  /** Consume one token for `key`; false means the caller should be rejected. */
  allow(key: string): boolean {
    const now = Date.now();
    let b = this.buckets.get(key);
    if (!b) {
      b = { tokens: this.capacity, last: now };
      this.buckets.set(key, b);
    }
    b.tokens = Math.min(
      this.capacity,
      b.tokens + ((now - b.last) / 1000) * this.refillPerSec
    );
    b.last = now;
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }

  private prune(): void {
    const idleMs = (this.capacity / this.refillPerSec) * 1000;
    const cutoff = Date.now() - idleMs;
    for (const [key, b] of this.buckets) {
      // A bucket untouched long enough to be full again carries no state worth keeping.
      if (b.last < cutoff) this.buckets.delete(key);
    }
  }
}
