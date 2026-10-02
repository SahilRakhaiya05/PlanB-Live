import { createHmac } from "node:crypto";
import { lookup } from "node:dns/promises";
import { request } from "node:https";
import ipaddr from "ipaddr.js";
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
const secrets = new SecretsManagerClient({});
export function publicAddress(address: string) { try { return ipaddr.process(address).range() === "unicast"; } catch { return false; } }
export function signature(body: string, timestamp: string, key: string) { return createHmac("sha256", key).update(`${timestamp}.${body}`).digest("hex"); }
export async function deliver(body: string, endpoint: string, secret: string) {
  const url = new URL(endpoint);
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") || url.hash) throw new Error("Webhook destination must use public HTTPS on port 443.");
  const addresses = await lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some(a => !publicAddress(a.address))) throw new Error("Webhook destination must resolve to public addresses.");
  const address = addresses[0];
  const timestamp = String(Math.floor(Date.now() / 1000));
  const event = JSON.parse(body);
  await new Promise<void>((resolve, reject) => {
    const req = request({ hostname: address.address, family: address.family, servername: url.hostname, port: 443, path: url.pathname + url.search, method: "POST", signal: AbortSignal.timeout(10000), headers: {
      Host: url.hostname, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body),
      "X-PlanB-Event-Id": event.id, "X-PlanB-Timestamp": timestamp, "X-PlanB-Signature": `v1=${signature(body, timestamp, secret)}`,
    } }, res => { res.resume(); res.on("error", reject); res.on("end", () => (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) ? resolve() : reject(new Error("Webhook recipient did not accept delivery."))); });
    req.on("error", reject); req.end(body);
  });
}
interface QueueEvent { Records: { messageId: string; body: string }[] }
export async function handler(event: QueueEvent) {
  // BatchSize is one; reporting only failed records preserves FIFO ordering.
  const result = { batchItemFailures: [] as { itemIdentifier: string }[] };
  try {
    const value = await secrets.send(new GetSecretValueCommand({ SecretId: process.env.WEBHOOK_SECRET_ARN }));
    const secret = JSON.parse(value.SecretString ?? "{}").signingSecret;
    if (typeof secret !== "string" || secret.length < 32) throw new Error("Signing secret is unavailable.");
    for (const record of event.Records) {
      try { await deliver(record.body, process.env.WEBHOOK_URL ?? "", secret); console.info(JSON.stringify({ event: "webhook.delivered", messageId: record.messageId })); }
      catch { result.batchItemFailures.push({ itemIdentifier: record.messageId }); console.error(JSON.stringify({ event: "webhook.failed", messageId: record.messageId })); }
    }
  } catch { result.batchItemFailures = event.Records.map(r => ({ itemIdentifier: r.messageId })); }
  return result;
}
