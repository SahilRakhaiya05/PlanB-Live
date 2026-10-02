import { useEffect, useRef, useState } from "react";
import { EventPlan } from "../domain";
import { RepairPair, planFacts } from "../assistantFacts";


import { PipMascot } from "./PipMascot";
import { cloudBase, cloudHeaders } from "../auth";
import { quickAnswer } from "../assistantHelp";

interface Msg { from: "you" | "pip"; text: string }

const STARTERS = ["What broke?", "Which repair moves fewer sessions?", "What if nothing fits?"];

export function Assistant({ plan, results, approvedLabel }: { plan: EventPlan; results: RepairPair | null; approvedLabel: string | null }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const log = useRef<HTMLDivElement>(null);
  useEffect(() => { if (log.current) log.current.scrollTop = log.current.scrollHeight; }, [msgs, busy]);

  const ask = async (message: string) => {
    const q = message.trim();
    if (!q || busy) return;
    const prior = msgs;
    setMsgs((m) => [...m, { from: "you", text: q }]);
    setText("");
    const answer = quickAnswer(q, plan, results);
    if (answer) { setMsgs(m => [...m, { from: "pip", text: answer }]); return; }
    setBusy(true);
    const ctl = new AbortController();
    const timer = window.setTimeout(() => ctl.abort(), 12000);
    try {
      const base = cloudBase;
      const res = await fetch(base ? `${base}/assist` : "/api/assist", {
        signal: ctl.signal,
        method: "POST",
        headers: base ? await cloudHeaders() : { "content-type": "application/json" },
        body: JSON.stringify({
          message: q,
          history: prior.slice(-6).map((m) => ({ role: m.from === "pip" ? "model" : "user", text: m.text })),
          facts: planFacts(plan, results, approvedLabel),
        }),
      });
      const data = (await res.json()) as { reply?: string; error?: string; model?: string };

      setMsgs((m) => [...m, { from: "pip", text: (res.ok && data.reply) || "Live assistance is unavailable right now. Try one of the quick questions below for help with this schedule." }]);
    } catch {
      setMsgs((m) => [...m, { from: "pip", text: "Could not reach Pip. The schedule was not changed." }]);
    } finally {
      window.clearTimeout(timer);
      setBusy(false);
    }
  };

  return (
    <div className="pip">
      {open && (
        <section className="pip-panel" aria-label="Pip, the schedule assistant">
          <header>
            <PipMascot />
            <div>
              <strong>Pip</strong>
              <span>Your event-saving sidekick.</span>
            </div>
            <button type="button" className="btn btn--ghost" onClick={() => setOpen(false)} aria-label="Close Pip">Close</button>
          </header>
          <div className="pip-log" ref={log} role="log" aria-live="polite">
            {msgs.length === 0 && <p className="pip-hello">Ask about the rooms and the two repairs. I only use what is already on this page.</p>}
            {msgs.map((m, i) => <p key={i} className={m.from === "you" ? "pip-you" : "pip-say"}>{m.text}</p>)}
            {busy && <p className="pip-say">Reading the board…</p>}
          </div>
          <div className="pip-starters">
            {STARTERS.map((s) => <button key={s} type="button" disabled={busy} onClick={() => { void ask(s); }}>{s}</button>)}
          </div>
          <form onSubmit={(e) => { e.preventDefault(); void ask(text); }}>
            <input value={text} maxLength={600} onChange={(e) => setText(e.target.value)} placeholder="Ask Pip" aria-label="Question for Pip" />
            <button className="btn btn--primary" type="submit" disabled={busy || !text.trim()}>Send</button>
          </form>
        </section>
      )}
      <button type="button" className="pip-btn" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <PipMascot />
        <span>Ask Pip</span>
      </button>
    </div>
  );
}
