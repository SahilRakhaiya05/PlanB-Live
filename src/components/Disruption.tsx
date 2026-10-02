import { useState } from "react";
import { EventPlan, Room, Session, LIMITS, fmtRange, fmtTime } from "../domain";
import { Affected } from "../domain/diagnose";
import { Alert, Spinner } from "./icons";
import { VenueEditor } from "./Venue";

interface Props {
  plan: EventPlan;
  affected: Affected[];
  loading: boolean;
  onAddOutage: (roomId: string, start: number, end: number) => void;
  onRemoveOutage: (i: number) => void;
  onAddSpeaker: (speakerId: string, start: number, end: number) => void;
  onRemoveSpeaker: (i: number) => void;
  onSelectPriority: (id: string) => void;
  onCalculate: () => void;
  onImpossible: () => void;
  onDemo: () => void;
  onRoom: (roomId: string, set: Partial<Pick<Room, "name" | "capacity" | "accessible" | "equipment">>) => void;
  onSession: (sessionId: string, set: Partial<Pick<Session, "title" | "attendance" | "requiresAccessible" | "equipment">>) => void;
}

export function Disruption(p: Props) {
  const { plan } = p;
  const minStart = Math.min(...plan.startSlots);
  const marks: number[] = [];
  for (let t = minStart; t <= plan.endMinute; t += 5) marks.push(t);
  if (!marks.includes(plan.endMinute)) marks.push(plan.endMinute);

  const [roomId, setRoomId] = useState(plan.rooms[0].id);
  const [rs, setRs] = useState(minStart);
  const [re, setRe] = useState(minStart + 30);
  const speakers = [...new Map(plan.sessions.map((s) => [s.speakerId, s])).values()];
  const [spk, setSpk] = useState(speakers[0].speakerId);
  const [ss, setSs] = useState(minStart);
  const [se, setSe] = useState(minStart + 30);

  const roomName = new Map(plan.rooms.map((r) => [r.id, r.name]));
  const titleBySpeaker = new Map(plan.sessions.map((s) => [s.speakerId, s.speakerName ?? `Speaker of ${s.title}`]));
  const selected = plan.selectedSessionId ?? plan.sessions[0].id;
  const nothing = plan.outages.length + plan.speakerUnavailability.length === 0;

  return (
    <div className="panel" id="disruption">
      <h2 className="step-title"><span className="step-no">1</span> What changed?</h2>

      <fieldset className="field-group">
        <legend>A room is unavailable</legend>
        <div className="row">
          <label className="full">Room
            <select value={roomId} onChange={(e) => setRoomId(e.target.value)}>
              {plan.rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </label>
          <label>From
            <select value={rs} onChange={(e) => { const v = Number(e.target.value); setRs(v); if (re <= v) setRe(Math.min(v + 30, plan.endMinute)); }}>
              {marks.slice(0, -1).map((t) => <option key={t} value={t}>{fmtTime(t)}</option>)}
            </select>
          </label>
          <label>Until
            <select value={re} onChange={(e) => setRe(Number(e.target.value))}>
              {marks.filter((t) => t > rs).map((t) => <option key={t} value={t}>{fmtTime(t)}</option>)}
            </select>
          </label>
        </div>
        <button type="button" className="btn btn--secondary" onClick={() => p.onAddOutage(roomId, rs, re)} disabled={re <= rs || plan.outages.length >= LIMITS.maxOutages}>Close this room</button>
      </fieldset>

      <fieldset className="field-group">
        <legend>A speaker is unavailable</legend>
        <div className="row">
          <label className="full">Speaker
            <select value={spk} onChange={(e) => setSpk(e.target.value)}>
              {speakers.map((s) => <option key={s.speakerId} value={s.speakerId}>{titleBySpeaker.get(s.speakerId)}</option>)}
            </select>
          </label>
          <label>From
            <select value={ss} onChange={(e) => { const v = Number(e.target.value); setSs(v); if (se <= v) setSe(Math.min(v + 30, plan.endMinute)); }}>
              {marks.slice(0, -1).map((t) => <option key={t} value={t}>{fmtTime(t)}</option>)}
            </select>
          </label>
          <label>Until
            <select value={se} onChange={(e) => setSe(Number(e.target.value))}>
              {marks.filter((t) => t > ss).map((t) => <option key={t} value={t}>{fmtTime(t)}</option>)}
            </select>
          </label>
        </div>
        <button type="button" className="btn btn--secondary" onClick={() => p.onAddSpeaker(spk, ss, se)} disabled={se <= ss || plan.speakerUnavailability.length >= LIMITS.maxSpeakerBlocks}>Mark unavailable</button>
      </fieldset>

      {!nothing && (
        <ul className="chips" aria-label="Current disruptions">
          {plan.outages.map((o, i) => (
            <li key={`o${i}`} className="chip chip--red">
              <Alert width={13} height={13} /> {roomName.get(o.roomId)} closed {fmtRange(o.startMinute, o.endMinute)}
              <button type="button" onClick={() => p.onRemoveOutage(i)} aria-label={`Remove outage for ${roomName.get(o.roomId)}`}>Remove</button>
            </li>
          ))}
          {plan.speakerUnavailability.map((b, i) => (
            <li key={`s${i}`} className="chip chip--red">
              <Alert width={13} height={13} /> {titleBySpeaker.get(b.speakerId)} unavailable {fmtRange(b.startMinute, b.endMinute)}
              <button type="button" onClick={() => p.onRemoveSpeaker(i)} aria-label="Remove speaker unavailability">Remove</button>
            </li>
          ))}
        </ul>
      )}

      <h3 className="sub">Sessions this affects</h3>
      {p.affected.length === 0 ? (
        <p className="empty">Nothing is affected yet. Close a room or mark a speaker unavailable during a session.</p>
      ) : (
        <ul className="affected">
          {p.affected.map((a) => (
            <li key={a.sessionId}>
              <strong>{a.title}</strong>
              {a.reasons.map((r, i) => <span key={i}>{r}</span>)}
            </li>
          ))}
        </ul>
      )}

      <label className="priority">Priority session
        <select value={selected} onChange={(e) => p.onSelectPriority(e.target.value)}>
          {plan.sessions.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
        </select>
      </label>

      <button type="button" className="btn btn--primary btn--block" onClick={p.onCalculate} disabled={p.loading}>
        {p.loading ? <><Spinner /> Calculating…</> : "Calculate alternatives"}
      </button>
      {nothing && <p className="hint">You can check this schedule now, or try a sample disruption:</p>}
      <div className="preset-row">
        <button type="button" className="link" onClick={p.onDemo}>Sample disruption</button>
        <button type="button" className="link" onClick={p.onImpossible}>Full-day closure</button>
      </div>
      <VenueEditor plan={plan} onRoom={p.onRoom} onSession={p.onSession} />
    </div>
  );
}
