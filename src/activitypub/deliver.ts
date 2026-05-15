// Federate an activity to a list of follower inbox URLs. Each
// delivery is a signed POST per the host's actor key. We fan out
// sequentially with short timeouts so a slow inbox doesn't stall the
// publish path. Hosts that need higher fan-out or retry queues should
// wrap this in their own worker.

import { signHttpRequest } from "./httpsig.js";

export type DeliverOpts = {
  /** Actor URL — the keyId becomes `<actorId>#main-key`. */
  actorId: string;
  /** Actor's PEM private key. */
  privateKeyPem: string;
  /** Follower inbox URLs. */
  inboxUrls: string[];
  /** The activity (Create/Accept/etc.) to deliver. */
  activity: unknown;
  /** Per-request timeout. Default 8s. */
  timeoutMs?: number;
  /** Override fetch — testing. */
  fetchImpl?: typeof fetch;
};

export type DeliverResult = {
  delivered: number;
  failed: Array<{ url: string; status: number | null; error?: string }>;
};

export async function deliverToInboxes(opts: DeliverOpts): Promise<DeliverResult> {
  const body = JSON.stringify(opts.activity);
  const keyId = `${opts.actorId}#main-key`;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 8000;
  let delivered = 0;
  const failed: DeliverResult["failed"] = [];

  for (const url of opts.inboxUrls) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers = signHttpRequest({
        url,
        method: "POST",
        body,
        keyId,
        privateKeyPem: opts.privateKeyPem,
      });
      const res = await fetchImpl(url, {
        method: "POST",
        headers: headers as unknown as Record<string, string>,
        body,
        signal: controller.signal,
      });
      if (res.status >= 200 && res.status < 300) {
        delivered++;
      } else {
        failed.push({ url, status: res.status });
      }
    } catch (err) {
      failed.push({
        url,
        status: null,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      clearTimeout(timer);
    }
  }

  return { delivered, failed };
}
