// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Hand-written runtime schemas for the API (api.md §4): a handful of
 * combinators whose `check` returns the first problem as
 * `"body.items[2].id: expected a string"`, or null. A schema declared as
 * `Schema<T>` must cover every required field of `T` (the compiler checks
 * that); unknown fields are ignored, so a newer peer may add some.
 */

export interface Schema<T> {
  check(value: unknown, path?: string): string | null;
  /** Carries the type only; never set. */
  readonly _type?: T;
}

type Infer<S> = S extends Schema<infer T> ? T : never;

function make<T>(
  check: (value: unknown, path: string) => string | null,
): Schema<T> {
  return { check: (value, path = "body") => check(value, path) };
}

const expected = (path: string, what: string) => `${path}: expected ${what}`;

export const str: Schema<string> = make((v, p) =>
  typeof v === "string" ? null : expected(p, "a string")
);

export const num: Schema<number> = make((v, p) =>
  typeof v === "number" && Number.isFinite(v) ? null : expected(p, "a number")
);

export const int: Schema<number> = make((v, p) =>
  Number.isSafeInteger(v) ? null : expected(p, "an integer")
);

export const bool: Schema<boolean> = make((v, p) =>
  typeof v === "boolean" ? null : expected(p, "true or false")
);

export function lit<const T extends readonly (string | number | boolean)[]>(
  ...values: T
): Schema<T[number]> {
  return make((v, p) =>
    values.includes(v as T[number])
      ? null
      : expected(p, values.map((x) => JSON.stringify(x)).join(" | "))
  );
}

export function nullable<T>(schema: Schema<T>): Schema<T | null> {
  return make((v, p) => v === null ? null : schema.check(v, p));
}

/** For object fields that may be absent. */
export function optional<T>(schema: Schema<T>): Schema<T | undefined> {
  return make((v, p) => v === undefined ? null : schema.check(v, p));
}

export function array<T>(schema: Schema<T>): Schema<T[]> {
  return make((v, p) => {
    if (!Array.isArray(v)) return expected(p, "an array");
    for (let i = 0; i < v.length; i++) {
      const problem = schema.check(v[i], `${p}[${i}]`);
      if (problem) return problem;
    }
    return null;
  });
}

export function object<S extends Record<string, Schema<unknown>>>(
  shape: S,
): Schema<{ [K in keyof S]: Infer<S[K]> }> {
  return make((v, p) => {
    if (typeof v !== "object" || v === null || Array.isArray(v)) {
      return expected(p, "an object");
    }
    for (const [key, schema] of Object.entries(shape)) {
      const problem = schema.check(
        (v as Record<string, unknown>)[key],
        `${p}.${key}`,
      );
      if (problem) return problem;
    }
    return null;
  });
}

/** Both shapes at once (an interface that `extends` another). */
export function both<A, B>(a: Schema<A>, b: Schema<B>): Schema<A & B> {
  return make((v, p) => a.check(v, p) ?? b.check(v, p));
}

export function is<T>(schema: Schema<T>, value: unknown): value is T {
  return schema.check(value) === null;
}
