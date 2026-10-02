import { EventPlan, FixSuggestion, RepairResponse, SolverStatus, fmtTime } from "../domain";
import { explainChanges } from "../domain/diagnose";
import { Alert, Arrow, Check } from "./icons";

const STATUS: Record<SolverStatus, { text: string; tone: "green" | "amber" | "red" }> = {
  OPTIMAL: { text: "Best possible plan", tone: "green" },
  FEASIBLE: { text: "Valid plan, not proven best", tone: "amber" },
  INFEASIBLE: { text: "No valid plan exists", tone: "red" },
  SEARCH_LIMIT: { text: "Search limit reached", tone: "amber" },
  INVALID_INPUT: { text: "Input could not be used", tone: "red" },
};

interface CardProps {
  title: string;
  objective: string;
  res: RepairResponse;
  active: boolean;
  approved: boolean;
  stale: boolean;
  focus?: { kicker: string; value: string };
  note?: string;
  onPreview: () => void;
  onApprove: () => void;
  onChecks: () => void;
}

export function DecisionHeadline({ priorityTitle, changedA, delayA, changedB, delayB }: {
  priorityTitle: string; changedA: number; delayA: number; changedB: number; delayB: number;
}) {
  const later = (n: number) => (n === 0 ? "on time" : `${n} minutes later`);
  return (
    <div className="decision" role="status">
      <p className="decision-kicker">Compare your options</p>
      <p>
        <strong>Fewest changes</strong> moves {changedA} session{changedA === 1 ? "" : "s"} and starts “{priorityTitle}” {later(delayA)}.{" "}
        <strong>Restart sooner</strong> moves {changedB} session{changedB === 1 ? "" : "s"} and starts “{priorityTitle}” {later(delayB)}.
      </p>
    </div>
  );
}

export function ProposalCard({ title, objective, res, active, approved, stale, focus, note, onPreview, onApprove, onChecks }: CardProps) {
  const st = STATUS[res.status];
  const passed = res.report?.checks.filter((c) => c.passed).length ?? 0;
  const total = res.report?.checks.length ?? 0;
  const usable = !!res.assignment && !!res.report?.valid;
  return (
    <article className={`card ${active ? "card--active" : ""}`} aria-label={title}>
      <header>
        <h3>{title}</h3>
        <span className={`badge badge--${st.tone}`}>
          {st.tone === "green" ? <Check width={13} height={13} /> : <Alert width={13} height={13} />} {st.text}
        </span>
      </header>
      <p className="card-obj">{objective}</p>
      {usable && res.metrics ? (
        <>
          {focus && <p className="card-focus"><span>{focus.kicker}</span><strong>{focus.value}</strong></p>}
          <dl className="metrics">
            <div><dt>Sessions changed</dt><dd>{res.metrics.changedSessions}</dd></div>
            <div><dt>Total delay</dt><dd>{res.metrics.totalDelayMinutes} min</dd></div>
            <div><dt>Room changes</dt><dd>{res.metrics.roomChanges}</dd></div>
          </dl>
          {note && <p className="card-note">{note}</p>}
          <p className="card-check">
            <Check width={14} height={14} /> {passed} of {total} independent checks passed.{" "}
            <button type="button" className="link" onClick={onChecks}>See checks</button>
          </p>
          <div className="card-actions">
            <button type="button" className="btn btn--secondary" onClick={onPreview} disabled={stale}>{active ? "Showing on timetable" : "Preview on timetable"}</button>
            <button type="button" className="btn btn--primary" onClick={onApprove} disabled={stale || approved}>{approved ? "Approved" : "Approve this plan"}</button>
          </div>
        </>
      ) : (
        <p className="card-msg">{res.message}</p>
      )}
    </article>
  );
}

export function DiffTable({ plan, res }: { plan: EventPlan; res: RepairResponse }) {
  if (!res.assignment || !res.changes) return null;
  const why = explainChanges(plan, res.assignment, res.changes);
  const roomName = new Map(plan.rooms.map((r) => [r.id, r.name]));
  if (!res.changes.length) return <p className="empty">No sessions change in this plan.</p>;
  return (
    <div className="table-wrap">
      <table className="diff">
        <caption>What changes in this plan</caption>
        <thead><tr><th scope="col">Session</th><th scope="col">Before</th><th scope="col">After</th><th scope="col">Delay</th><th scope="col">Why</th></tr></thead>
        <tbody>
          {res.changes.map((c) => (
            <tr key={c.sessionId}>
              <th scope="row">{c.title}</th>
              <td data-label="Before">{roomName.get(c.from.roomId)}<br />{fmtTime(c.from.startMinute)}</td>
              <td data-label="After"><Arrow width={12} height={12} className="inline-ic" /> {roomName.get(c.to.roomId)}<br />{fmtTime(c.to.startMinute)}</td>
              <td data-label="Delay">{c.delayMinutes > 0 ? `+${c.delayMinutes} min` : c.roomChanged ? "Room only" : "None"}</td>
              <td data-label="Why">{why[c.sessionId]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function InfeasiblePanel({ res, onApplyFix }: { res: RepairResponse; onApplyFix: (f: FixSuggestion) => void }) {
  return (
    <section className="panel panel--red" aria-live="polite">
      <h3><Alert width={18} height={18} /> No valid schedule under the current constraints</h3>
      <p>{res.message} PlanB will not cancel sessions, shrink them, or drop requirements for you.</p>
      {res.blockers?.map((b) => (
        <div key={b.sessionId} className="blocker">
          <strong>{b.summary}</strong>
          <ul>{b.perRoom.map((r) => <li key={r.roomId}><b>{r.roomName}:</b> {r.reasons.length ? r.reasons.join("; ") : "no obstacle found"}</li>)}</ul>
        </div>
      ))}
      <h4>Edits you could choose</h4>
      {res.fixes && res.fixes.length > 0 ? (
        <>
          <p className="hint">Each option below was re-solved and does produce a valid schedule. Applying one is your decision.</p>
          <ul className="fixes">
            {res.fixes.map((f) => (
              <li key={f.id}>
                <div><strong>{f.label}</strong><span>{f.detail} Result: {f.resultingChangedSessions} sessions changed, {f.resultingTotalDelay} min total delay.</span></div>
                <button type="button" className="btn btn--secondary" onClick={() => onApplyFix(f)}>Apply edit</button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="empty">No single edit PlanB tried makes this schedulable. Change the disruption, or edit a room or a requirement on the left.</p>
      )}
    </section>
  );
}
