import { useState } from "react";
import { EventPlan, originalAssignment } from "../domain";
import { affectedSessions } from "../domain/diagnose";
import { impossiblePlan } from "../fixtures";
import { CloudAccount } from "./Cloud";
import { Architecture } from "./Architecture";
import { Timetable } from "./Timetable";
import { SessionModal } from "./Dialogs";
import { PipMascot } from "./PipMascot";

export function Landing({ plan, hasDraft, onDemo, onPlay, onImport, onResume, onScenario, onCreate }: { plan: EventPlan; hasDraft: boolean; onDemo: () => void; onPlay: () => void; onImport: () => void; onResume: () => void; onScenario: (plan: EventPlan) => void; onCreate: () => void }) {
  const [mission, setMission] = useState(0);
  const [detail, setDetail] = useState<string | null>(null);
  const speakerPlan = structuredClone(plan);
  speakerPlan.outages = [];
  speakerPlan.speakerUnavailability = [{ speakerId: plan.sessions[0].speakerId, startMinute: 600, endMinute: 630 }];
  const selected = [plan, speakerPlan, impossiblePlan()][mission];
  const orig = originalAssignment(selected);
  const aff = new Set(affectedSessions(selected).map(a => a.sessionId));
  const missions = [
    { name: "Room rescue", icon: "▦", level: "LEVEL 01", story: "Main Hall is closed for 30 minutes. Help the AI demo find its next move.", tag: "A little reshuffle" },
    { name: "Speaker shuffle", icon: "◉", level: "LEVEL 02", story: "The AI demo speaker is running late. Find a new slot without a schedule clash.", tag: "Timing is everything" },
    { name: "The big rethink", icon: "✦", level: "LEVEL 03", story: "The biggest room is out all day. Explore what needs to change to make the event work.", tag: "Challenge accepted?" },
  ];
  return <main className="landing">
    <a className="skip" href="#welcome">Skip to content</a>
    <header className="land-nav"><span className="wordmark"><i aria-hidden="true">P</i> PlanB<span className="live-sticker">LIVE</span></span><nav aria-label="Page"><a href="#decision">How to play</a><a href="#architecture">Under the hood</a></nav><CloudAccount/><button className="btn btn--primary" onClick={hasDraft ? onResume : onDemo}>{hasDraft ? "Continue your mission →" : "Enter control room →"}</button></header>
    <section className="hero" id="welcome"><div className="hero-copy"><p className="kicker"><span className="tiny-star">✦</span> Plot twist? You’ve got this.</p><h1>Plans change.<br/><span>Save the day.</span><svg className="hero-scribble" viewBox="0 0 350 20" aria-hidden="true"><path d="M5 12Q175-4 344 10M38 19Q188 6 299 17" stroke="currentColor" strokeWidth="5" fill="none" strokeLinecap="round"/></svg></h1><p className="lede">A closed room. A late speaker. A very fixable day. Turn event chaos into a plan everyone can follow.</p><div className="hero-actions"><button className="btn btn--primary btn--lg" onClick={() => onScenario(selected)}>Let’s fix this <span aria-hidden="true">↗</span></button><button className="btn btn--secondary btn--lg" onClick={onPlay}><span aria-hidden="true">▷</span> Show me how</button></div><button className="link import-link" onClick={onCreate}>Create your own event →</button><div className="hero-trust"><span>✓ No sign-up quest</span><span>✓ Your call, always</span></div></div>
      <div className="mission-preview"><div className="mission-sticker">SMALL CRISIS.<br/>BIG COMEBACK.</div><div className="hero-frame"><div className="preview-heading"><span><span className="dot dot--aws"/> THE CONTROL ROOM</span><span>Sample event</span></div><figure className="hero-board"><Timetable plan={selected} assignment={orig} original={orig} affected={aff} compact onSelect={setDetail}/><figcaption><span className="preview-alert">{aff.size} {aff.size === 1 ? "session needs" : "sessions need"} a hand</span> {missions[mission].tag}</figcaption></figure></div><div className="pip-intro"><PipMascot/><div><strong>Hey, I’m Pip. Your planning sidekick.</strong><p>{missions[mission].story}</p></div></div></div>
    </section>
    <section className="mission-select" aria-labelledby="mission-h"><div className="mission-section-head"><div><p className="kicker">Your next move</p><h2 id="mission-h">Pick a plot twist.</h2></div><p>Three little challenges. Real planning power.</p></div><div className="mission-choices">{missions.map((m,i) => <button key={m.name} className={`mission-choice mission-choice--${i} ${mission === i ? "is-selected" : ""}`} aria-pressed={mission === i} onClick={() => setMission(i)}><span className="mission-icon" aria-hidden="true">{m.icon}</span><span className="mission-choice-copy"><small>{m.level}</small><strong>{m.name}</strong><span>{m.tag}</span></span><span className="mission-check" aria-hidden="true">{mission === i ? "✓" : "↗"}</span></button>)}</div></section>
    <section className="path" id="decision" aria-labelledby="path-h"><p className="kicker">The game plan</p><h2 id="path-h">Three moves. One happy event.</h2><ol><li><span>01</span><div><strong>Spot the plot twist</strong><p>Mark a room or speaker unavailable. See exactly who needs a new plan.</p></div></li><li><span>02</span><div><strong>Pick your power move</strong><p>Fewer changes or a faster restart? Compare both before you choose.</p></div></li><li><span>03</span><div><strong>Make your comeback</strong><p>Approve your checked plan. Grab the timetable and share the good news.</p></div></li></ol></section>
    <div className="promise-banner"><span aria-hidden="true">✳</span><p>A playful sidekick.<br/><strong>Serious about the details.</strong></p><div>Capacity, accessibility, equipment, and speaker availability.<br/>Every plan gets checked before your victory lap.</div></div>
    <Architecture/>
    <footer className="landing-footer"><span className="wordmark">PlanB Live <span aria-hidden="true">✦</span></span><p>Workshops to conferences. Up to 200 sessions, 40 rooms, and flexible session lengths.</p><button className="link" onClick={onDemo}>Let’s make a plan ↗</button></footer>
    {detail && <SessionModal plan={selected} sessionId={detail} assignment={orig} onClose={() => setDetail(null)}/>}
  </main>;
}
