# PlanB Live

A playful event recovery workspace for one event day: up to 200 sessions, 40 rooms, 288 start times, and session lengths of 5–480 minutes. It compares minimal disruption with a priority-session restart, independently checks every proposed assignment, and exports the approved timetable.

## Run locally

```sh
npm ci
npm run dev
npm run check
```

The guest workspace runs scheduling in a Web Worker and saves drafts in this browser. Use **Create your own event** to build a workspace, review the placeholder room capacities and sessions, or import a session spreadsheet. Variable-length and larger schedules use a searchable, paginated agenda.

## Cloud deployment

The production template provisions Cognito, JWT-protected API Gateway, a planning Lambda, and optional SQS-backed signed webhook delivery with a separate worker, Secrets Manager, a dead-letter queue, and CloudWatch alarms. It serves a single organization with invited users and one operator-managed webhook recipient. It is not a multi-tenant SaaS backend.

See [deployment](docs/DEPLOY.md), [webhook contract](docs/WEBHOOKS.md), and [release checks](docs/PRODUCTION.md). Build frontend hosting assets with `npm run build` and Lambda bundles with `npm run build:server` before running SAM.

Authentication and webhook delivery require an actual deployment. No cloud resources are created merely by running this project. No webhook is sent on approval: an organizer must separately choose **Send approved timetable**.

## Scheduling guarantees and limits

The deterministic branch-and-bound search orders constrained sessions first, tries low-cost placements first, uses lower bounds and indexed room/speaker occupancy, and has both node and wall-time budgets. A result is `OPTIMAL` only if the search proves it; a checked incumbent is `FEASIBLE` when the budget ends, and `SEARCH_LIMIT` is never described as impossible. Constraint validation is independent of the search implementation. Capacity is bounded, not unlimited; dense adversarial schedules may exhaust the budget.

One plan represents one calendar date and time zone. Create a separate plan per day for multi-day events. Drafts are local, not synchronized across accounts or devices. Plans do not model travel time, setup buffers, recurring events, or emergency operations. These are explicit scope boundaries, not guarantees implied by the larger input limit.
