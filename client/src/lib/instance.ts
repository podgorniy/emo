// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * `GET /api/instance`, kept in `meta.instance` so About and the invite
 * switch work offline. Specification: api.md §2.11.
 */

import type { InstanceRes } from "../../../shared/protocol.ts";
import { apiGetInstance } from "./api.ts";
import { getMeta, setMeta } from "./db.ts";

export async function cachedInstance(): Promise<InstanceRes | null> {
  return await getMeta<InstanceRes>("instance");
}

/** The server's answer when it can be reached, else the cached one. */
export async function loadInstance(): Promise<InstanceRes | null> {
  try {
    const fresh = await apiGetInstance();
    await setMeta("instance", fresh);
    return fresh;
  } catch {
    return await cachedInstance();
  }
}
