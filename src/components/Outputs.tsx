import { useState } from "react";
import { Announcement, Assignment, ChangeRecord, EventPlan, approvedJson, fmtRange, timetableCsv, timetableIcs } from "../domain";
import { WebhookPanel } from "./Cloud";
import { Copy, Download, Check } from "./icons";

function download(name: string, mime: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function Outputs({ plan, assignment, version, label, announcements, changes, onToast }: {
  plan: EventPlan; assignment: Assignment; version: string; label: string; announcements: Announcement[]; changes: ChangeRecord[]; onToast: (m: string) => void;
}) {
  const [tab, setTab] = useState<"updates" | "table">("updates");
  const [copied, setCopied] = useState<string | null>(null);
  const roomName = new Map(plan.rooms.map((r) => [r.id, r.name]));
  const rows = [...plan.sessions].sort((a, b) => assignment[a.id].startMinute - assignment[b.id].startMinute || a.title.localeCompare(b.title));
  const groups: [string, Announcement["audience"]][] = [["Attendees", "attendees"], ["Speakers", "speaker"], ["Room teams", "room-team"]];

  const copy = async (a: Announcement) => {
    try { await navigator.clipboard.writeText(a.text); setCopied(a.id); setTimeout(() => setCopied(null), 1600); }
    catch { onToast("Copy was blocked by the browser. Select the text and copy it manually."); }
  };

  return (
    <section className="panel" id="outputs" aria-labelledby="out-h">
      <h2 id="out-h" className="step-title"><span className="step-no">3</span> Share the update</h2>
      <p className="lede-sm">Approved: <strong>{label}</strong>. Nothing is sent automatically.</p>
      <WebhookPanel key={version + label} plan={plan} assignment={assignment}/>
      <div className="toolbar">
        <button className="btn btn--secondary" onClick={() => download(`${plan.id}-revised.csv`, "text/csv;charset=utf-8", timetableCsv(plan, assignment))}><Download /> Download timetable</button>
        <button className="btn btn--secondary" onClick={() => download(`${plan.id}-revised.ics`, "text/calendar;charset=utf-8", timetableIcs(plan, assignment))}><Download /> Add to calendar</button>
        <button className="btn btn--secondary" onClick={() => download(`${plan.id}-approved-plan.json`, "application/json", approvedJson(plan, assignment, version, label))}><Download /> Save event backup</button>
        <button className="btn btn--secondary" onClick={() => window.print()}>Print run of show</button>
        <button className="btn btn--secondary" onClick={() => {
          const lines = [`${plan.title}`, `${plan.localDate} · ${plan.timezone}`, `Approved: ${label}`, ""];
          rows.forEach((s) => {
            const a = assignment[s.id];
            const ch = a.roomId !== s.originalRoomId || a.startMinute !== s.originalStartMinute;
            lines.push(`${fmtRange(a.startMinute, a.startMinute + s.durationMinutes)}  ${s.title}  ${roomName.get(a.roomId)}  ${ch ? "MOVED" : "same"}`);
          });
          lines.push("", "Nothing in this sheet was sent automatically.");
          navigator.clipboard.writeText(lines.join("\n")).then(() => onToast("Run of show copied.")).catch(() => onToast("Copy was blocked. Use Print or download the CSV."));
        }}>Copy run of show</button>
      </div>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === "updates"} onClick={() => setTab("updates")}>Updates to send ({announcements.length})</button>
        <button role="tab" aria-selected={tab === "table"} onClick={() => setTab("table")}>Revised timetable</button>
      </div>
      {tab === "updates" ? (
        changes.length === 0 ? <p className="empty">No sessions changed, so there is nothing to announce.</p> : (
          <div className="announce">
            {groups.map(([title, aud]) => {
              const items = announcements.filter((a) => a.audience === aud);
              if (!items.length) return null;
              return (
                <div key={aud}>
                  <h4>{title}</h4>
                  {items.map((a) => (
                    <div className="note" key={a.id}>
                      <div className="note-head"><strong>{a.heading}</strong>
                        <button className="btn btn--ghost" onClick={() => copy(a)}>{copied === a.id ? <><Check /> Copied</> : <><Copy /> Copy</>}</button>
                      </div>
                      <pre>{a.text}</pre>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )
      ) : (
        <div className="table-wrap">
          <table className="diff">
            <caption>Revised timetable</caption>
            <thead><tr><th scope="col">Time</th><th scope="col">Session</th><th scope="col">Room</th><th scope="col">Status</th></tr></thead>
            <tbody>
              {rows.map((s) => {
                const a = assignment[s.id];
                const ch = a.roomId !== s.originalRoomId || a.startMinute !== s.originalStartMinute;
                return <tr key={s.id}><td>{fmtRange(a.startMinute, a.startMinute + s.durationMinutes)}</td><th scope="row">{s.title}</th><td>{roomName.get(a.roomId)}</td><td>{ch ? "Changed" : "Unchanged"}</td></tr>;
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Printed output (hidden on screen) */}
      <div className="print-only">
        <h1>{plan.title}</h1>
        <p>{plan.localDate} · {plan.timezone} · Revised timetable</p>
        <table><thead><tr><th>Time</th><th>Session</th><th>Room</th><th>Status</th></tr></thead>
          <tbody>{rows.map((s) => { const a = assignment[s.id]; const ch = a.roomId !== s.originalRoomId || a.startMinute !== s.originalStartMinute;
            return <tr key={s.id}><td>{fmtRange(a.startMinute, a.startMinute + s.durationMinutes)}</td><td>{s.title}</td><td>{roomName.get(a.roomId)}</td><td>{ch ? "CHANGED" : "unchanged"}</td></tr>; })}</tbody></table>
        <p>Planning aid for ordinary event logistics. Not a safety or emergency system.</p>
      </div>
    </section>
  );
}
