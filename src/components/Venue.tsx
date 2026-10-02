import { useState } from "react";
import { EventPlan, Room, Session } from "../domain";

const PRESETS = ["projector", "computers", "microphone", "whiteboard"];

function gearOf(plan: EventPlan): string[] {
  const found = new Set<string>(PRESETS);
  plan.rooms.forEach((r) => r.equipment.forEach((e) => found.add(e)));
  plan.sessions.forEach((s) => s.equipment.forEach((e) => found.add(e)));
  return [...found];
}

function Toggles({ items, on, onToggle }: { items: string[]; on: string[]; onToggle: (item: string) => void }) {
  return (
    <div className="toggles" role="group" aria-label="Equipment">
      {items.map((item) => (
        <button key={item} type="button" aria-pressed={on.includes(item)} onClick={() => onToggle(item)}>{item}</button>
      ))}
    </div>
  );
}

export function VenueEditor({ plan, onRoom, onSession }: {
  plan: EventPlan;
  onRoom: (roomId: string, set: Partial<Pick<Room, "name" | "capacity" | "accessible" | "equipment">>) => void;
  onSession: (sessionId: string, set: Partial<Pick<Session, "title" | "attendance" | "requiresAccessible" | "equipment">>) => void;
}) {
  const gear = gearOf(plan);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const sessions = plan.sessions.filter(s => s.title.toLowerCase().includes(search.toLowerCase()));
  const toggle = (list: string[], item: string) => (list.includes(item) ? list.filter((x) => x !== item) : list.length >= 8 ? list : [...list, item]);
  const num = (raw: string, min: number, max: number) => {
    const n = Number(raw);
    return Number.isInteger(n) && n >= min && n <= max ? n : null;
  };

  return (
    <details className="venue">
      <summary>Change a room or a requirement</summary>
      <p className="lede-sm">Capacity, equipment and accessibility stay as you set them. PlanB will not relax them to force a plan.</p>
      {plan.rooms.map((room) => (
        <div className="venue-block" key={room.id}>
          <strong>{room.name}</strong>
          <div className="row">
            <label className="full">Room name
              <input value={room.name} maxLength={80} onChange={(e) => { if (e.target.value.trim()) onRoom(room.id, { name: e.target.value }); }} />
            </label>
            <label>Seats
              <input type="number" min={1} max={5000} value={room.capacity} onChange={(e) => { const n = num(e.target.value, 1, 5000); if (n !== null) onRoom(room.id, { capacity: n }); }} />
            </label>
          </div>
          <label className="checkline">
            <input type="checkbox" checked={room.accessible} onChange={(e) => onRoom(room.id, { accessible: e.target.checked })} />
            Accessible room
          </label>
          <Toggles items={gear} on={room.equipment} onToggle={(item) => onRoom(room.id, { equipment: toggle(room.equipment, item) })} />
        </div>
      ))}
      <label>Find a session to edit<input value={search} onChange={e=>{setSearch(e.target.value);setPage(0);}} placeholder="Session title"/></label>
      {sessions.slice(page * 20, (page + 1) * 20).map((s) => (
        <div className="venue-block" key={s.id}>
          <strong>{s.title}</strong>
          <div className="row">
            <label className="full">Session
              <input value={s.title} maxLength={80} onChange={(e) => { if (e.target.value.trim()) onSession(s.id, { title: e.target.value }); }} />
            </label>
            <label>Expected people
              <input type="number" min={0} max={5000} value={s.attendance} onChange={(e) => { const n = num(e.target.value, 0, 5000); if (n !== null) onSession(s.id, { attendance: n }); }} />
            </label>
          </div>
          <label className="checkline">
            <input type="checkbox" checked={s.requiresAccessible} onChange={(e) => onSession(s.id, { requiresAccessible: e.target.checked })} />
            Needs an accessible room
          </label>
          <Toggles items={gear} on={s.equipment} onToggle={(item) => onSession(s.id, { equipment: toggle(s.equipment, item) })} />
        </div>
      ))}
      {sessions.length > 20 && <div className="toolbar"><button className="btn btn--secondary" disabled={!page} onClick={()=>setPage(page-1)}>Previous</button><button className="btn btn--secondary" disabled={(page+1)*20>=sessions.length} onClick={()=>setPage(page+1)}>Next</button></div>}
    </details>
  );
}
