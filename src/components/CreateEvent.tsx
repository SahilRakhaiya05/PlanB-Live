import { useState } from "react";
import { EventPlan, LIMITS, parsePlan, parseHHMM } from "../domain";
import { Modal } from "./Dialogs";
export function CreateEvent({ onClose, onCreate }: { onClose: () => void; onCreate: (plan: EventPlan) => void }) {
  const [title, setTitle] = useState("My event");
  const [date, setDate] = useState(new Intl.DateTimeFormat("en-CA").format(new Date()));
  const [timezone, setTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [start, setStart] = useState("09:00"); const [end, setEnd] = useState("18:00");
  const [rooms, setRooms] = useState(6); const [count, setCount] = useState(24); const [duration, setDuration] = useState(45);
  const [error, setError] = useState("");
  const create = () => {
    const from = parseHHMM(start), until = parseHHMM(end);
    if (from === null || until === null || until <= from || !Number.isInteger(rooms) || rooms < 1 || rooms > LIMITS.maxRooms || !Number.isInteger(count) || count < 1 || count > LIMITS.maxSessions || !Number.isInteger(duration) || duration < 5 || duration > 480) { setError("Check the event times, room count, session count, and session length."); return; }
    const last = from + Math.floor((count - 1) / rooms) * duration;
    if (last + duration > until) { setError("These sessions will not fit in the event day. Add rooms, extend the day, or reduce the session count or length."); return; }
    const slots = Array.from({length: Math.floor((until - from - duration) / 5) + 1}, (_,i) => from + i * 5);
    const sessions = Array.from({length:count}, (_,i) => ({ id:`session-${i+1}`, title:`Session ${i+1}`, speakerId:`speaker-${i+1}`, attendance:50, equipment:[], requiresAccessible:false, durationMinutes:duration, originalStartMinute:from + Math.floor(i/rooms)*duration, originalRoomId:`room-${i%rooms+1}`, earliestStartMinute:from, latestStartMinute:until-duration }));
    const input = { schemaVersion:1, id:crypto.randomUUID(), title, localDate:date, timezone, startSlots:[...new Set([...slots,...sessions.map(s => s.originalStartMinute)])].sort((a,b)=>a-b), endMinute:until, rooms:Array.from({length:rooms},(_,i)=>({id:`room-${i+1}`,name:`Room ${i+1}`,capacity:100,equipment:[],accessible:false})), sessions, outages:[], speakerUnavailability:[], selectedSessionId:sessions[0].id };
    const parsed = parsePlan(input);
    if (!parsed.ok) { setError(parsed.issues.join(" ")); return; }
    onCreate(parsed.plan);
  };
  return <Modal title="Build your event" onClose={onClose} wide><p className="lede-sm">Start with an event day, then replace the placeholder sessions and room details with your real information. For a multi-day event, create a separate plan for each day.</p><div className="row"><label className="full">Event name<input value={title} maxLength={80} onChange={e=>setTitle(e.target.value)}/></label><label>Date<input type="date" value={date} onChange={e=>setDate(e.target.value)}/></label><label>Time zone<input value={timezone} onChange={e=>setTimezone(e.target.value)}/></label></div><div className="row"><label>Day begins<input type="time" value={start} onChange={e=>setStart(e.target.value)}/></label><label>Day ends<input type="time" value={end} onChange={e=>setEnd(e.target.value)}/></label></div><div className="row"><label>Rooms (1–40)<input type="number" min={1} max={40} value={rooms} onChange={e=>setRooms(Number(e.target.value))}/></label><label>Sessions (1–200)<input type="number" min={1} max={200} value={count} onChange={e=>setCount(Number(e.target.value))}/></label><label>Default length (minutes)<input type="number" min={5} max={480} value={duration} onChange={e=>setDuration(Number(e.target.value))}/></label></div><p className="hint">Room capacities and attendance are starting values. Review them before planning or sharing. Import a session spreadsheet for names, speakers, and individual session lengths.</p>{error && <p className="errbox" role="alert">{error}</p>}<div className="modal-actions"><button className="btn btn--primary" onClick={create}>Create event workspace</button></div></Modal>;
}
