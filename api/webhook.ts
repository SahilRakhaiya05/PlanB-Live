import { createHash } from "node:crypto";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { Assignment, EventPlan, planHash } from "../src/domain";
const sqs = new SQSClient({});
export function webhookEvent(plan: EventPlan, assignment: Assignment, subject: string) {
  const placements = Object.fromEntries(Object.entries(assignment).sort(([a], [b]) => a.localeCompare(b)));
  const id = createHash("sha256").update(JSON.stringify({ subject, plan, placements })).digest("hex");
  return { id, type: "schedule.approved", schemaVersion: 1, createdAt: new Date().toISOString(), organizerId: subject,
    event: { id: plan.id, title: plan.title, date: plan.localDate, timezone: plan.timezone },
    sessions: plan.sessions.map(s => ({ id: s.id, title: s.title, room: plan.rooms.find(r => r.id === placements[s.id].roomId)!.name, roomId: placements[s.id].roomId, startMinute: placements[s.id].startMinute, durationMinutes: s.durationMinutes })),
  };
}
export async function enqueueWebhook(plan: EventPlan, assignment: Assignment, subject: string) {
  if (!process.env.WEBHOOK_QUEUE_URL) throw new Error("Webhook delivery is not configured.");
  const event = webhookEvent(plan, assignment, subject);
  const body = JSON.stringify(event);
  if (Buffer.byteLength(body) > 240_000) throw new Error("This schedule is too large for webhook delivery.");
  await sqs.send(new SendMessageCommand({ QueueUrl: process.env.WEBHOOK_QUEUE_URL, MessageBody: body, MessageGroupId: createHash("sha256").update(`${subject}:${plan.id}`).digest("hex"), MessageDeduplicationId: event.id }));
  return { deliveryId: event.id, status: "queued" };
}
