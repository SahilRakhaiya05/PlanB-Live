import { useEffect, useMemo, useRef, useState } from "react";
import {
  Assignment, EventPlan, FixSuggestion, Objective, RepairResponse, Room, Session, applyPatches, buildAnnouncements, computeChanges, decodePlan, encodePlan, originalAssignment, planHash,
} from "./domain";
import { affectedSessions } from "./domain/diagnose";
import { demoPlan, impossiblePlan } from "./fixtures";
import { engineInfo, repair } from "./engine";
import { Approved, clearDraft, loadDraft, saveDraft } from "./storage";
import { Architecture } from "./components/Architecture";
import { Assistant } from "./components/Assistant";
import { Landing } from "./components/Landing";
import { Disruption } from "./components/Disruption";
import { Timetable } from "./components/Timetable";
import { DecisionHeadline, DiffTable, InfeasiblePanel, ProposalCard } from "./components/Proposals";
import { Outputs } from "./components/Outputs";
import { ChecksModal, ImportModal, SessionModal } from "./components/Dialogs";
import { CloudAccount } from "./components/Cloud";
import { CreateEvent } from "./components/CreateEvent";
import { PipMascot } from "./components/PipMascot";
import { Alert, Spinner } from "./components/icons";

type View = "original" | "A" | "B" | "approved";
interface Results { A: RepairResponse; B: RepairResponse; version: string; priorityTitle: string }

function delayMinutes(res: RepairResponse, p: EventPlan): number {
  const id = p.selectedSessionId ?? p.sessions[0].id;
  return res.changes?.find((c) => c.sessionId === id)?.delayMinutes ?? 0;
}

export default function App() {
  const [screen, setScreen] = useState<"landing" | "work">("landing");
  const [plan, setPlan] = useState<EventPlan>(() => demoPlan());
  const [results, setResults] = useState<Results | null>(null);
  const [approved, setApproved] = useState<Approved | null>(null);
  const [view, setView] = useState<View>("original");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checks, setChecks] = useState<"A" | "B" | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [draft, setDraft] = useState(() => loadDraft());
  const [playing, setPlaying] = useState(false);
  const [caption, setCaption] = useState<string | null>(null);
  const [beat, setBeat] = useState<string | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  const resultsRef = useRef<HTMLDivElement>(null);
  const stopDemo = useRef(false);

  const say = (m: string) => { setToast(m); window.clearTimeout(toastTimer.current); toastTimer.current = window.setTimeout(() => setToast(null), 4500); };

  useEffect(() => {
    const match = /^#plan=(.+)$/.exec(window.location.hash);
    if (!match) return;
    let token = match[1];
    try { token = decodeURIComponent(token); } catch { say("That link is not a readable PlanB schedule."); return; }
    const parsed = decodePlan(token);
    if (!parsed.ok) { say(parsed.issues[0] ?? "That link is not a readable PlanB schedule."); return; }
    setPlan(parsed.plan);
    setResults(null);
    setApproved(null);
    setView("original");
    setScreen("work");
  }, []);

  const version = useMemo(() => planHash(plan), [plan]);
  const original = useMemo(() => originalAssignment(plan), [plan]);
  const affected = useMemo(() => affectedSessions(plan), [plan]);
  const affectedIds = useMemo(() => new Set(affected.map((a) => a.sessionId)), [affected]);
  const stale = !!results && results.version !== version;
  const approvedValid = !!approved && approved.version === version;
  const approvedStale = !!approved && !approvedValid;

  useEffect(() => { if (screen === "work") saveDraft({ plan, approved }); }, [plan, approved, screen]);

  // The view can only show something that still matches the current inputs.
  const effectiveView: View = (view === "approved" && !approvedValid) || ((view === "A" || view === "B") && (stale || !results?.[view].assignment)) ? "original" : view;
  const shown: Assignment =
    effectiveView === "A" ? results!.A.assignment! : effectiveView === "B" ? results!.B.assignment! : effectiveView === "approved" ? approved!.assignment : original;
  const shownRes = effectiveView === "A" ? results?.A : effectiveView === "B" ? results?.B : undefined;
  const previewChanges = effectiveView === "approved" && approved ? computeChanges(plan, approved.assignment) : shownRes?.changes ?? [];
  const priorityId = plan.selectedSessionId ?? plan.sessions[0].id;
  const priorityTitle = plan.sessions.find((s) => s.id === priorityId)?.title ?? "";

  const edit = (fn: (p: EventPlan) => EventPlan) => setPlan((p) => fn(structuredClone(p)));

  const calculate = async () => {
    if (loading || playing) return;
    setLoading(true); setError(null);
    const pid = priorityId;
    try {
      const [A, B] = await Promise.all([repair(plan, { mode: "A" } as Objective), repair(plan, { mode: "B", sessionId: pid } as Objective)]);
      const bad = [A, B].find((r) => r.status === "INVALID_INPUT");
      if (bad) { setError((bad.issues ?? [bad.message]).join(" ")); setResults(null); return; }
      setResults({ A, B, version: A.inputVersion, priorityTitle: plan.sessions.find((s) => s.id === pid)!.title });
      setView(A.assignment ? "A" : "original");
      window.setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" }), 60);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong while calculating.");
    } finally { setLoading(false); }
  };

  const approve = (which: "A" | "B") => {
    if (!results || stale) { say("Inputs changed since this was calculated. Recalculate before approving."); return; }
    const res = results[which];
    if (!res.assignment || !res.report?.valid) return;
    setApproved({ assignment: res.assignment, version: results.version, label: which === "A" ? "Fewest changes" : `Restart “${results.priorityTitle}” sooner` });
    setView("approved");
    say("Schedule approved. Your updates are ready to share.");
    window.setTimeout(() => document.getElementById("outputs")?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
  };

  const resetAll = (to: EventPlan, msg: string) => { setPlan(to); setResults(null); setApproved(null); setView("original"); setError(null); say(msg); };
  const applyFix = (f: FixSuggestion) => { setPlan((p) => applyPatches(p, f.patches)); say(`Applied: ${f.label}. Calculate again to see your options.`); };
  const editRoom = (roomId: string, set: Partial<Pick<Room, "name" | "capacity" | "accessible" | "equipment">>) => edit((p) => {
    const room = p.rooms.find((r) => r.id === roomId);
    if (room) Object.assign(room, set);
    return p;
  });
  const editSession = (sessionId: string, set: Partial<Pick<Session, "title" | "attendance" | "requiresAccessible" | "equipment">>) => edit((p) => {
    const session = p.sessions.find((s) => s.id === sessionId);
    if (session) Object.assign(session, set);
    return p;
  });
  const share = async () => {
    if (JSON.stringify(plan).length > 12000) { say("This event is too large for a reliable link. Save and share an event backup instead."); return; }
    const url = `${window.location.origin}${window.location.pathname}${window.location.search}#plan=${encodeURIComponent(encodePlan(plan))}`;
    window.history.replaceState(null, "", url);
    try { await navigator.clipboard.writeText(url); say("Link copied. It opens this exact schedule."); }
    catch { say("The link is in the address bar. Copy was blocked by the browser."); }
  };
  const delayOf = (res: RepairResponse | undefined) => res?.changes?.find((c) => c.sessionId === priorityId)?.delayMinutes ?? 0;

  const startDemo = () => { setCaption(null); setBeat(null); setPlan(demoPlan()); setResults(null); setApproved(null); setView("original"); setScreen("work"); };
  const hold = (ms: number) => new Promise<void>((resolve, reject) => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.setTimeout(() => (stopDemo.current ? reject(new Error("stop")) : resolve()), reduce ? Math.min(400, ms) : ms);
  });
  const solveBoth = async (p: EventPlan): Promise<Results> => {
    const pid = p.selectedSessionId ?? p.sessions[0].id;
    const [A, B] = await Promise.all([repair(p, { mode: "A" }), repair(p, { mode: "B", sessionId: pid })]);
    return { A, B, version: A.inputVersion, priorityTitle: p.sessions.find((s) => s.id === pid)?.title ?? "" };
  };
  const playDemo = async () => {
    if (playing) { stopDemo.current = true; return; }
    stopDemo.current = false;
    setPlaying(true);
    setScreen("work");
    setError(null);
    const quiet = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    try {
      const first = demoPlan();
      setBeat("1 of 6");
      setPlan(first); setResults(null); setApproved(null); setView("original");
      setCaption("Main Hall just closed from 10:00 to 10:30. The AI demo needs 60 seats, a projector, and an accessible room.");
      await hold(1300);
      setBeat("2 of 6");
      setLoading(true);
      const open = await solveBoth(first);
      setLoading(false);
      if (open.A.status === "INVALID_INPUT") throw new Error(open.A.message);
      setResults(open);
      setView("A");
      setCaption(`Fewest changes moves ${open.A.metrics?.changedSessions ?? 0} sessions. “${open.priorityTitle}” starts ${delayMinutes(open.A, first)} minutes later. Compare both options to find the right balance.`);
      await hold(2000);
      setBeat("3 of 6");
      setView("B");
      setCaption(`Restart sooner moves ${open.B.metrics?.changedSessions ?? 0} sessions, and “${open.priorityTitle}” slips ${delayMinutes(open.B, first)} minutes.`);
      await hold(2000);
      const hard = impossiblePlan();
      setBeat("4 of 6");
      setPlan(hard); setResults(null); setApproved(null); setView("original");
      setCaption("Main Hall is now closed all day. It is the only room that can hold 60 people.");
      await hold(1100);
      setLoading(true);
      const blocked = await solveBoth(hard);
      setLoading(false);
      setResults(blocked);
      setCaption(blocked.A.message || "No valid schedule exists under these constraints.");
      await hold(1800);
      const fix = blocked.A.fixes?.[0];
      if (!fix) { setCaption("No proven edit is available. The demo stops here rather than inventing a plan."); return; }
      const next = applyPatches(hard, fix.patches);
      setBeat("5 of 6");
      setPlan(next); setResults(null); setApproved(null);
      setCaption(`You choose “${fix.label}”. PlanB checks the updated schedule again.`);
      await hold(900);
      setLoading(true);
      const fixed = await solveBoth(next);
      setLoading(false);
      setResults(fixed);
      if (!fixed.A.assignment || !fixed.A.report?.valid) { setCaption("The edit did not produce an approvable plan, so nothing was approved."); return; }
      setBeat("6 of 6");
      setApproved({ assignment: fixed.A.assignment, version: fixed.version, label: "Fewest changes" });
      setView("approved");
      setCaption("Approved on this computer. The drafts below are only for people whose session moved. Nothing was sent.");
      window.setTimeout(() => document.getElementById("outputs")?.scrollIntoView({ behavior: quiet ? "auto" : "smooth", block: "start" }), 80);
    } catch (e) {
      if (!(e instanceof Error && e.message === "stop")) setError(e instanceof Error ? e.message : "The demo stopped.");
      if (e instanceof Error && e.message === "stop") setCaption(null);
    } finally {
      setPlaying(false);
      setLoading(false);
      setBeat(null);
      stopDemo.current = false;
    }
  };
  const resume = () => { if (draft) { setPlan(draft.plan); setApproved(draft.approved); setResults(null); setView(draft.approved ? "approved" : "original"); setScreen("work"); } };

  if (screen === "landing") {
    return (
      <>
        <Landing onCreate={() => setCreating(true)} plan={demoPlan()} hasDraft={!!draft} onDemo={startDemo} onScenario={(p) => { resetAll(p, "Mission loaded. Let’s find your next move."); setScreen("work"); }} onPlay={() => { void playDemo(); }} onImport={() => { setScreen("work"); setImporting(true); }} onResume={resume} />
        {toast && <div className="toast" role="status">{toast}</div>}
        {creating && <CreateEvent onClose={() => setCreating(false)} onCreate={p => { resetAll(p, "Event created. Review your rooms and sessions to make it yours."); setCreating(false); setScreen("work"); }}/>}
        <Assistant plan={demoPlan()} results={null} approvedLabel={null} />
        {importing && <ImportModal plan={plan} onClose={() => setImporting(false)} onImport={(p) => { resetAll(p, "Schedule imported."); setImporting(false); }} />}
      </>
    );
  }

  const tabs: { id: View; label: string; disabled: boolean }[] = [
    { id: "original", label: "Original", disabled: false },
    { id: "A", label: "Fewest changes", disabled: stale || !results?.A.assignment },
    { id: "B", label: `Restart “${priorityTitle}” sooner`, disabled: stale || !results?.B.assignment },
    { id: "approved", label: "Approved", disabled: !approvedValid },
  ];
  const announcements = approvedValid && approved ? buildAnnouncements(plan, computeChanges(plan, approved.assignment)) : [];
  const infeasible = results && !stale && (results.A.status === "INFEASIBLE" || results.B.status === "INFEASIBLE") ? results.A : null;

  return (
    <div className="app">
      <a className="skip" href="#main">Skip to schedule</a>
      <header className="topbar">
        <div className="tb-left">
          <button className="wordmark wordmark--btn" onClick={() => { setDraft(loadDraft()); setScreen("landing"); }} disabled={playing} aria-label="PlanB Live home"><i aria-hidden="true">P</i> PlanB Live</button>
          <div className="tb-event">
            <strong>{plan.title}</strong>
            <span>{plan.localDate} · {plan.timezone}{plan.fictional ? " · Sample event" : ""}</span>
          </div>
        </div>
        <div className="tb-right">
          <span className="engine" title={engineInfo.detail}><span className={`dot ${engineInfo.remote ? "dot--aws" : ""}`} aria-hidden="true" /> {engineInfo.label}</span>
          <CloudAccount/>
          <div className="tb-actions">
            <button className="btn btn--secondary" disabled={playing} onClick={() => setCreating(true)}>New event</button>
            <button className="btn btn--primary" onClick={() => { void playDemo(); }}>{playing ? "Stop demo" : "Play demo"}</button>
            <button className="btn btn--secondary" disabled={playing} onClick={share}>Copy link</button>
            <button className="btn btn--secondary" disabled={playing} onClick={() => setImporting(true)}>Import</button>
            <button className="btn btn--secondary" disabled={playing} onClick={() => { clearDraft(); setDraft(null); resetAll(demoPlan(), "Reset to the fictional demo."); }}>Reset</button>
          </div>
        </div>
      </header>

      {caption && (
        <div className="livecap" role="status">
          <span className="livecap-dot" aria-hidden="true" />
          <p>{beat ? <strong>{beat}. </strong> : null}{caption}</p>
        </div>
      )}
      <div className="workspace-heading"><div><p className="kicker">Your event control room</p><h1>Let’s turn this day around.</h1><p>One plot twist at a time. You’re in charge.</p></div><div className="overview-stats"><div><strong>{plan.sessions.length}</strong><span>Sessions</span></div><div><strong>{plan.rooms.length}</strong><span>Rooms</span></div><div><strong>{affected.length}</strong><span>Affected sessions</span></div></div></div>
      <ol className="rail" aria-label="Progress">
        <li className={affected.length ? "rail--on" : ""}><i>1</i> Update availability</li>
        <li className={results && !stale ? "rail--on" : ""}><i>2</i> Compare options</li>
        <li className={approvedValid ? "rail--on" : ""}><i>3</i> Approve and export</li>
      </ol>
      <div className={`mission-guide ${approvedValid ? "mission-guide--complete" : ""}`} role="status"><PipMascot celebrate={approvedValid}/><div><span className="kicker">{approvedValid ? "Mission complete" : results && !stale ? "Your next move" : "Pip’s mission briefing"}</span><strong>{approvedValid ? "Nice save. Your new plan is ready!" : results && !stale ? (results.A.assignment || results.B.assignment ? "Your options are in. Take a look." : "Let’s rethink a few details.") : affected.length ? "Plot twist spotted. Ready for a new plan?" : "First, tell me what changed."}</strong><p>{approvedValid ? "Download your timetable and copy updates for the people affected." : results && !stale ? (results.A.assignment || results.B.assignment ? "Compare the changes below, preview a plan, and approve your favorite when all checks pass." : "Review the result below and explore the suggested changes to your event requirements.") : affected.length ? "Your availability changes are ready. Choose Calculate alternatives to find your next move." : "Add a room closure or speaker delay, then calculate alternatives. I’ll help you compare."}</p></div><span className="mission-progress">{approvedValid ? "3 / 3" : results && !stale ? "2 / 3" : "1 / 3"}<small>MISSION STAGE</small></span></div>
      <div className="layout" inert={playing}>
        <aside className="side"><Disruption key={`${plan.id}:${plan.rooms.map(r => r.id).join()}:${plan.sessions.map(s => s.speakerId).join()}:${plan.startSlots.join()}`}
          plan={plan} affected={affected} loading={loading}
          onAddOutage={(roomId, s, e) => edit((p) => { p.outages.push({ roomId, startMinute: s, endMinute: e }); return p; })}
          onRemoveOutage={(i) => edit((p) => { p.outages.splice(i, 1); return p; })}
          onAddSpeaker={(speakerId, s, e) => edit((p) => { p.speakerUnavailability.push({ speakerId, startMinute: s, endMinute: e }); return p; })}
          onRemoveSpeaker={(i) => edit((p) => { p.speakerUnavailability.splice(i, 1); return p; })}
          onSelectPriority={(id) => edit((p) => { p.selectedSessionId = id; return p; })}
          onCalculate={calculate}
          onDemo={() => resetAll(demoPlan(), "Loaded the demo disruption: Main Hall closed 10:00–10:30.")}
          onImpossible={() => resetAll(impossiblePlan(), "Main Hall is now closed all day. It is the only room that fits the 60-person AI demo.")}
          onRoom={editRoom}
          onSession={editSession}
        /></aside>

        <main id="main" className="main" ref={resultsRef}>
          <section className="panel" aria-labelledby="cmp-h">
            <h2 id="cmp-h" className="step-title"><span className="step-no">2</span> Your schedule</h2>
            {error && (
              <div className="errbox" role="alert"><Alert width={16} height={16} />
                <div><strong>Could not calculate.</strong> {error} <button className="link" onClick={calculate}>Try again</button></div>
              </div>
            )}
            {stale && <div className="banner" role="status"><Alert width={16} height={16} /> You changed the disruption after calculating, so these results no longer match. Calculate again to compare current options and approve one.</div>}
            {approvedStale && <div className="banner" role="status"><Alert width={16} height={16} /> Your approval was cleared because the inputs changed. Exports are available again after you approve a new plan.</div>}

            <div className="tabs" role="tablist" aria-label="Schedule version">
              {tabs.map((t) => (
                <button key={t.id} role="tab" aria-selected={effectiveView === t.id} disabled={t.disabled} onClick={() => setView(t.id)}>{t.label}</button>
              ))}
            </div>
            <Timetable plan={plan} assignment={shown} original={original} affected={affectedIds} verified={effectiveView === "approved"} onSelect={setDetail} />
            <p className="legend" aria-label="Legend">
              <span><i className="sw sw--red" /> Closed or affected</span>
              <span><i className="sw sw--amber" /> Proposed change</span>
              <span><i className="sw sw--green" /> Approved and checked</span>
            </p>

            {loading && <p className="loading" role="status"><Spinner /> Searching schedules and re-checking every constraint…</p>}

            {!loading && !results && !error && (
              <p className="empty">{affected.length ? "Press “Calculate alternatives” to see your options." : "Choose “Calculate alternatives” to check room capacity, availability, and all session requirements."}</p>
            )}

            {results && !stale && (
              <>
                {results.A.assignment && results.B.assignment && results.A.metrics && results.B.metrics && (
                  <DecisionHeadline priorityTitle={results.priorityTitle} changedA={results.A.metrics.changedSessions} delayA={delayOf(results.A)} changedB={results.B.metrics.changedSessions} delayB={delayOf(results.B)} />
                )}
                <div className="cards">
                  <ProposalCard title="Fewest changes" objective="Changes as few sessions as possible, then the least total delay, then the fewest room moves."
                    res={results.A} active={effectiveView === "A"} approved={approvedValid && approved?.label === "Fewest changes"} stale={stale}
                    focus={results.A.metrics ? { kicker: "Sessions that move", value: String(results.A.metrics.changedSessions) } : undefined}
                    note={results.A.changes ? `${buildAnnouncements(plan, results.A.changes).length} drafts ready for the people affected` : undefined}
                    onPreview={() => setView("A")} onApprove={() => approve("A")} onChecks={() => setChecks("A")} />
                  <ProposalCard title={`Restart “${results.priorityTitle}” sooner`} objective={`Minimizes the delay to “${results.priorityTitle}” first, then sessions changed, then total delay.`}
                    res={results.B} active={effectiveView === "B"} approved={approvedValid && approved?.label.startsWith("Restart")} stale={stale}
                    focus={results.B.assignment ? { kicker: `${results.priorityTitle} starts`, value: delayOf(results.B) === 0 ? "On time" : `+${delayOf(results.B)} min` } : undefined}
                    note={results.B.changes ? `${buildAnnouncements(plan, results.B.changes).length} drafts ready for the people affected` : undefined}
                    onPreview={() => setView("B")} onApprove={() => approve("B")} onChecks={() => setChecks("B")} />
                </div>
                {(effectiveView === "A" || effectiveView === "B") && shownRes && <DiffTable plan={plan} res={shownRes} />}
                {effectiveView === "approved" && approved && <p className="lede-sm">Showing the approved plan: <strong>{approved.label}</strong>.</p>}
              </>
            )}
          </section>

          {infeasible && <InfeasiblePanel res={infeasible} onApplyFix={applyFix} />}

          {approvedValid && approved && (
            <Outputs plan={plan} assignment={approved.assignment} version={approved.version} label={approved.label} announcements={announcements} changes={computeChanges(plan, approved.assignment)} onToast={say} />
          )}
        </main>
      </div>

      {creating && <CreateEvent onClose={() => setCreating(false)} onCreate={p => { resetAll(p, "Event created. Review your rooms and sessions to make it yours."); setCreating(false); }}/>}
      {checks && results?.[checks].report && <ChecksModal title={checks === "A" ? "Fewest changes" : `Restart “${results.priorityTitle}” sooner`} report={results[checks].report!} onClose={() => setChecks(null)} />}
      {detail && <SessionModal plan={plan} sessionId={detail} assignment={shown} onClose={() => setDetail(null)} />}
      {importing && <ImportModal plan={plan} onClose={() => setImporting(false)} onImport={(p) => { resetAll(p, "Schedule imported."); setImporting(false); }} />}
      {toast && <div className="toast" role="status">{toast}</div>}
      <Assistant plan={plan} results={results && !stale ? results : null} approvedLabel={approvedValid && approved ? approved.label : null} />
      <footer className="app-foot">
        <Architecture variant="strip" />
        <p>Planning aid for ordinary event logistics. Not an emergency, evacuation or venue-safety system. Accessibility and capacity are organizer-supplied constraints, not certifications.</p>
      </footer>
    </div>
  );
}
