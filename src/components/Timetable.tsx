import { useState } from "react";
import { Assignment, EventPlan, fmtRange, fmtTime, overlaps, toHHMM } from "../domain";
import { Alert, Check } from "./icons";

export type BlockState = "normal" | "affected" | "moved" | "verified";

interface Props {
  plan: EventPlan;
  assignment: Assignment;
  original: Assignment;
  /** which sessions overlap a disruption in the ORIGINAL plan */
  affected: Set<string>;
  verified?: boolean;
  compact?: boolean;
  onSelect?: (sessionId: string) => void;
}

function stateOf(id: string, a: Assignment, o: Assignment, affected: Set<string>, showAffected: boolean, verified?: boolean): BlockState {
  const moved = a[id].roomId !== o[id].roomId || a[id].startMinute !== o[id].startMinute;
  if (moved) return verified ? "verified" : "moved";
  if (showAffected && affected.has(id)) return "affected";
  return "normal";
}

const LABEL: Record<BlockState, string> = { normal: "", affected: "Affected", moved: "Moved", verified: "Moved · verified" };

export function Timetable({ plan, assignment, original, affected, verified, compact, onSelect }: Props) {
  const minStart = Math.min(...plan.startSlots);
  const rows = Math.max(1, Math.ceil((plan.endMinute - minStart) / 30));
  const [roomFilter, setRoomFilter] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const agenda = plan.rooms.length > 6 || plan.sessions.length > 30 || plan.sessions.some(s => s.durationMinutes !== 30 || s.originalStartMinute % 30 !== 0);
  const filtered = plan.sessions.filter(s => (!roomFilter || assignment[s.id].roomId === roomFilter) && `${s.title} ${s.speakerName ?? s.speakerId}`.toLowerCase().includes(query.toLowerCase())).sort((a,b) => assignment[a.id].startMinute - assignment[b.id].startMinute || a.title.localeCompare(b.title));
  const safePage = Math.min(page, Math.max(0, Math.ceil(filtered.length / 50) - 1));
  const visibleSessions = agenda ? filtered.slice(safePage * 50, (safePage + 1) * 50) : plan.sessions;
  const n = plan.rooms.length;
  const showAffected = Object.keys(assignment).every((id) => assignment[id].roomId === original[id].roomId && assignment[id].startMinute === original[id].startMinute);
  const roomIndex = new Map(plan.rooms.map((r, i) => [r.id, i]));
  const roomName = new Map(plan.rooms.map((r) => [r.id, r.name]));

  const slots: number[] = [];
  for (let t = minStart; t < plan.endMinute; t += 30) slots.push(t);
  const listSlots = [...new Set(visibleSessions.map(s => assignment[s.id].startMinute))].sort((a,b) => a-b);

  return (
    <div className={`${compact ? "tt tt--compact" : "tt"} ${agenda ? "tt--agenda" : ""}`}>
      {agenda && <><div className="schedule-filters"><label>Find a session<input value={query} onChange={e => { setQuery(e.target.value); setPage(0); }} placeholder="Session or speaker"/></label><label>Room<select value={roomFilter} onChange={e => { setRoomFilter(e.target.value); setPage(0); }}><option value="">All rooms</option>{plan.rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label></div><p className="hint">{filtered.length} sessions · Page {safePage + 1} of {Math.max(1, Math.ceil(filtered.length / 50))}</p></>}
      {!agenda && <div className="tt-desktop" style={{ ["--rows" as string]: rows, ["--cols" as string]: n }}>
        <div className="tt-head">
          <div className="tt-gutter" />
          {plan.rooms.map((r) => (
            <div key={r.id} className="tt-room">
              <strong>{r.name}</strong>
              {!compact && (
                <span>
                  {r.capacity} seats{r.equipment.length ? ` · ${r.equipment.join(", ")}` : ""}
                  {r.accessible ? " · accessible" : " · not accessible"}
                </span>
              )}
            </div>
          ))}
        </div>
        <div className="tt-body">
          <div className="tt-times" aria-hidden="true">
            {slots.map((t) => (
              <div key={t}>{fmtTime(t)}</div>
            ))}
          </div>
          <div className="tt-grid">
            {plan.outages.map((o, i) => {
              const col = roomIndex.get(o.roomId);
              if (col === undefined) return null;
              const top = (Math.max(o.startMinute, minStart) - minStart) / 30;
              const h = (Math.min(o.endMinute, plan.endMinute) - Math.max(o.startMinute, minStart)) / 30;
              if (h <= 0) return null;
              return (
                <div key={`o${i}`} className="outage" title={`${roomName.get(o.roomId)} closed ${fmtRange(o.startMinute, o.endMinute)}`} style={{ top: `calc(${top} * var(--row))`, height: `calc(${h} * var(--row))`, left: `calc(${col} * 100% / ${n})`, width: `calc(100% / ${n})` }}>
                  <span className="outage-tag">
                    <Alert width={12} height={12} /> Closed
                  </span>
                </div>
              );
            })}
            {plan.sessions.map((s) => {
              const a = assignment[s.id];
              const col = roomIndex.get(a.roomId) ?? 0;
              const top = (a.startMinute - minStart) / 30;
              const st = stateOf(s.id, assignment, original, affected, showAffected, verified);
              const o = original[s.id];
              const speakerBlocked = plan.speakerUnavailability.some((b) => b.speakerId === s.speakerId && overlaps(a.startMinute, a.startMinute + s.durationMinutes, b.startMinute, b.endMinute));
              return (
                <div key={s.id} className="blk-pos" style={{ top: `calc(${top} * var(--row))`, left: `calc(${col} * 100% / ${n})`, width: `calc(100% / ${n})` }}>
                  <button
                    type="button"
                    className={`blk blk--${st}`}
                    onClick={() => onSelect?.(s.id)}
                    aria-label={`${s.title}, ${fmtRange(a.startMinute, a.startMinute + s.durationMinutes)}, ${roomName.get(a.roomId)}${LABEL[st] ? ", " + LABEL[st] : ""}. Open details.`}
                  >
                    <span className="blk-title">{s.title}</span>
                    <span className="blk-time">{compact ? `${toHHMM(a.startMinute)}–${toHHMM(a.startMinute + s.durationMinutes)}` : fmtRange(a.startMinute, a.startMinute + s.durationMinutes)}</span>
                    {!compact && <span className="blk-meta">{s.attendance} people</span>}
                    {(st === "moved" || st === "verified") && !compact && (
                      <span className="blk-was">was {fmtTime(o.startMinute)} · {roomName.get(o.roomId)}</span>
                    )}
                    {LABEL[st] && (
                      <span className="blk-flag">
                        {st === "affected" ? <Alert width={12} height={12} /> : <Check width={12} height={12} />} {LABEL[st]}
                      </span>
                    )}
                    {speakerBlocked && <span className="blk-flag blk-flag--bad"><Alert width={12} height={12} /> Speaker unavailable</span>}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>}

      <ol className="tt-list" aria-label="Schedule as a list">
          {listSlots.map((t) => {
            const items = visibleSessions.filter((s) => assignment[s.id].startMinute === t);
            if (!items.length) return null;
            return (
              <li key={t}>
                <h4>{fmtTime(t)}</h4>
                <ul>
                  {items.map((s) => {
                    const st = stateOf(s.id, assignment, original, affected, showAffected, verified);
                    const o = original[s.id];
                    return (
                      <li key={s.id}>
                        <button type="button" className={`blk blk--${st} blk--row`} onClick={() => onSelect?.(s.id)}>
                          <span className="blk-title">{s.title}</span>
                          <span className="blk-time">{roomName.get(assignment[s.id].roomId)} · {fmtRange(assignment[s.id].startMinute, assignment[s.id].startMinute + s.durationMinutes)} · {s.attendance} people</span>
                          {(st === "moved" || st === "verified") && <span className="blk-was">was {fmtTime(o.startMinute)} · {roomName.get(o.roomId)}</span>}
                          {LABEL[st] && <span className="blk-flag">{LABEL[st]}</span>}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </li>
            );
          })}
          {plan.outages.map((o, i) => (
            <li key={`o${i}`} className="tt-list-outage">
              <Alert width={14} height={14} /> {roomName.get(o.roomId)} closed {fmtRange(o.startMinute, o.endMinute)}
            </li>
          ))}
        </ol>
      {agenda && filtered.length === 0 && <p className="empty">No sessions match. Try a different room or search.</p>}
      {agenda && filtered.length > 50 && <div className="toolbar"><button className="btn btn--secondary" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>Previous sessions</button><button className="btn btn--secondary" disabled={(safePage + 1) * 50 >= filtered.length} onClick={() => setPage(safePage + 1)}>Next sessions</button></div>}
    </div>
  );
}
