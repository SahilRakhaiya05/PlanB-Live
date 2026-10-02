import { useEffect, useRef, useState, ReactNode } from "react";
import { Assignment, ConstraintReport, EventPlan, LIMITS, fmtRange, fmtTime, importSessionsCsv, parsePlan, sessionsTemplateCsv } from "../domain";
import { Alert, Check, Cross } from "./icons";

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return (
    <dialog ref={ref} className={wide ? "modal modal--wide" : "modal"} onClose={onClose} onClick={(e) => { if (e.target === ref.current) ref.current?.close(); }} aria-label={title}>
      <div className="modal-in">
        <header><h2>{title}</h2><button className="btn btn--ghost" onClick={() => ref.current?.close()}>Close</button></header>
        {children}
      </div>
    </dialog>
  );
}

export function ChecksModal({ title, report, onClose }: { title: string; report: ConstraintReport; onClose: () => void }) {
  return (
    <Modal title={`Checks: ${title}`} onClose={onClose}>
      <p className="lede-sm">Each requirement is checked independently before you approve this schedule.</p>
      <ul className="checks">
        {report.checks.map((c) => (
          <li key={c.id} className={c.passed ? "ok" : "bad"}>
            {c.passed ? <Check width={15} height={15} /> : <Cross width={15} height={15} />}
            <div><strong>{c.label}</strong> <span>{c.passed ? "Passed" : "Failed"}</span>
              {c.violations.map((v, i) => <p key={i}>{v.message}</p>)}</div>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

export function SessionModal({ plan, sessionId, assignment, onClose }: { plan: EventPlan; sessionId: string; assignment: Assignment; onClose: () => void }) {
  const s = plan.sessions.find((x) => x.id === sessionId)!;
  const a = assignment[sessionId];
  const room = plan.rooms.find((r) => r.id === a.roomId)!;
  const end = a.startMinute + s.durationMinutes;
  const rows: { ok: boolean; label: string; detail: string }[] = [
    { ok: room.capacity >= s.attendance, label: "Capacity", detail: `${room.name} seats ${room.capacity}; ${s.attendance} expected.` },
    { ok: s.equipment.every((e) => room.equipment.includes(e)), label: "Equipment", detail: s.equipment.length ? `Needs ${s.equipment.join(", ")}; ${room.name} has ${room.equipment.join(", ") || "none"}.` : "No equipment needed." },
    { ok: !s.requiresAccessible || room.accessible, label: "Accessibility", detail: s.requiresAccessible ? `Needs an accessible room; ${room.name} is ${room.accessible ? "accessible" : "not accessible"}.` : "No accessibility requirement set." },
    { ok: a.startMinute >= s.originalStartMinute && a.startMinute >= s.earliestStartMinute && a.startMinute <= s.latestStartMinute && end <= plan.endMinute, label: "Timing", detail: `${fmtRange(a.startMinute, end)}. Original start ${fmtTime(s.originalStartMinute)}; cannot move earlier; must finish by ${fmtTime(plan.endMinute)}.` },
    { ok: !plan.outages.some((o) => o.roomId === a.roomId && a.startMinute < o.endMinute && o.startMinute < end), label: "Room open", detail: plan.outages.filter((o) => o.roomId === a.roomId).map((o) => `${room.name} closed ${fmtRange(o.startMinute, o.endMinute)}.`).join(" ") || `${room.name} has no outage.` },
    { ok: !plan.speakerUnavailability.some((b) => b.speakerId === s.speakerId && a.startMinute < b.endMinute && b.startMinute < end), label: "Speaker available", detail: plan.speakerUnavailability.filter((b) => b.speakerId === s.speakerId).map((b) => `Unavailable ${fmtRange(b.startMinute, b.endMinute)}.`).join(" ") || "No speaker restriction." },
  ];
  return (
    <Modal title={s.title} onClose={onClose}>
      <p className="lede-sm">{fmtRange(a.startMinute, end)} in {room.name}</p>
      <ul className="checks">
        {rows.map((r) => (
          <li key={r.label} className={r.ok ? "ok" : "bad"}>
            {r.ok ? <Check width={15} height={15} /> : <Cross width={15} height={15} />}
            <div><strong>{r.label}</strong> <span>{r.ok ? "Met" : "Not met in this view"}</span><p>{r.detail}</p></div>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

export function ImportModal({ plan, onClose, onImport }: { plan: EventPlan; onClose: () => void; onImport: (p: EventPlan) => void }) {
  const [tab, setTab] = useState<"json" | "csv">("csv");
  const [text, setText] = useState("");
  const [issues, setIssues] = useState<string[]>([]);

  const readFile = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 250_000) { setIssues(["That upload is larger than 250 KB. Try a smaller event day."]); return; }
    setText(await f.text()); setIssues([]);
  };
  const submit = () => {
    if (tab === "json") {
      let raw: unknown;
      try { raw = JSON.parse(text); } catch { setIssues(["This event backup could not be read. Please choose a backup saved from PlanB."]); return; }
      const candidate = raw && typeof raw === "object" && "kind" in raw && raw.kind === "planb-live-approved-plan" && "plan" in raw ? raw.plan : raw;
      const r = parsePlan(candidate);
      if (!r.ok) { setIssues(r.issues); return; }
      onImport({ ...r.plan, fictional: r.plan.fictional ?? false });
    } else {
      const r = importSessionsCsv(text, plan);
      if (!r.ok) { setIssues(r.issues); return; }
      onImport(r.plan);
    }
  };
  const tpl = () => {
    const url = URL.createObjectURL(new Blob([sessionsTemplateCsv(plan)], { type: "text/csv" }));
    const a = document.createElement("a"); a.href = url; a.download = "planb-sessions-template.csv"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <Modal title="Import a schedule" onClose={onClose} wide>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === "csv"} onClick={() => { setTab("csv"); setIssues([]); }}>Session spreadsheet</button>
        <button role="tab" aria-selected={tab === "json"} onClick={() => { setTab("json"); setIssues([]); }}>Event backup</button>
      </div>
      {tab === "csv" ? (
        <p className="lede-sm">Up to {LIMITS.maxSessions} sessions. Rooms and start slots stay as they are now; the sessions are replaced. <button className="link" onClick={tpl}>Download the template</button> to see the columns, including session length in minutes.</p>
      ) : (
        <p className="lede-sm">Restore a saved event backup, including its rooms, sessions, and availability.</p>
      )}
      <label className="file">Choose a file<input type="file" accept={tab === "csv" ? ".csv,text/csv" : ".json,application/json"} onChange={(e) => readFile(e.target.files?.[0])} /></label>
      <label>Or paste it here
        <textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
      </label>
      {issues.length > 0 && (
        <div className="errbox" role="alert"><Alert width={16} height={16} /><ul>{issues.map((i, k) => <li key={k}>{i}</li>)}</ul></div>
      )}
      <div className="modal-actions"><button className="btn btn--primary" onClick={submit} disabled={!text.trim()}>Import schedule</button></div>
    </Modal>
  );
}
