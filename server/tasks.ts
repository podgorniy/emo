// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * In-flight background task registry for graceful shutdown draining.
 * Ensures asynchronous operations (e.g. background email dispatches) are
 * completed before the server closes database connections and exits.
 */

const inFlight = new Set<Promise<unknown>>();

/** Tracks an asynchronous task until it settles. */
export function trackTask<T>(promise: Promise<T>): Promise<T> {
  inFlight.add(promise);
  promise.finally(() => inFlight.delete(promise)).catch(() => {});
  return promise;
}

/** Waits for all currently in-flight background tasks to complete or time out. */
export async function drainTasks(timeoutMs = 5000): Promise<void> {
  if (inFlight.size === 0) return;
  const drain = Promise.allSettled(Array.from(inFlight));
  const timeout = new Promise<void>((resolve) =>
    setTimeout(resolve, timeoutMs)
  );
  await Promise.race([drain, timeout]);
}

/** Returns the count of active in-flight background tasks. */
export function inFlightTaskCount(): number {
  return inFlight.size;
}
