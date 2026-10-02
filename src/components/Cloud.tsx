import { useEffect, useState } from "react";
import { Assignment, EventPlan } from "../domain";
import { accountEmail, authConfigured, cloudBase, cloudRequest, signIn, signedIn, signOut, watchAccount } from "../auth";
export function CloudAccount() {
  const [active, setActive] = useState(false);
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let current = true;
    const refresh = () => { void accountEmail().then(value => { if (current) { setEmail(value); setActive(!!value); } }).catch(() => { if (current) setError("Sign-in could not be completed. Please try again."); }); };
    refresh(); const unsubscribe = watchAccount(refresh);
    return () => { current = false; unsubscribe(); };
  }, []);
  if (!authConfigured) return null;
  const connect = async () => { setBusy(true); setError(""); try { await (active ? signOut() : signIn()); } catch { setError("We could not open sign-in. Please try again."); setBusy(false); } };
  return <div className="cloud-status">{active && <span className="account-email" title={email}><span aria-hidden="true">● </span>{email}</span>}<button className="btn btn--secondary" disabled={busy} onClick={() => { void connect(); }}>{busy ? "Opening…" : active ? "Sign out" : "Sign in to cloud"}</button>{error && <span role="alert">{error}</span>}</div>;
}
export function WebhookPanel({ plan, assignment }: { plan: EventPlan; assignment: Assignment }) {
  const [state, setState] = useState<"loading" | "offline" | "signin" | "unavailable" | "ready" | "sending" | "queued">("loading");
  const [error, setError] = useState("");
  useEffect(() => {
    let current = true;
    const check = async () => {
      if (!cloudBase || !authConfigured) return "offline" as const;
      if (!await signedIn()) return "signin" as const;
      const info = await cloudRequest("/integrations");
      return info.webhook ? "ready" as const : "unavailable" as const;
    };
    void check().then(s => { if (current) setState(s); }).catch(() => { if (current) { setState("unavailable"); setError("Could not check your connection. Reopen this event to try again."); } });
    return () => { current = false; };
  }, []);
  const send = async () => {
    setState("sending"); setError("");
    try { await cloudRequest("/publish", { plan, assignment }); setState("queued"); }
    catch (e) { setState("ready"); setError(e instanceof Error ? e.message : "Could not queue your update."); }
  };
  return <div className="cloud-panel"><h3>Keep your other tools in the loop</h3><p>Send this approved timetable to your organization’s connected service. This shares the event title, date, timezone, session titles, rooms, and times.</p>
    {state === "offline" && <p>Cloud delivery is not connected in this workspace. You can still download and share your timetable.</p>}
    {state === "signin" && <button className="btn btn--primary" onClick={() => { void signIn().catch(() => setError("Could not open sign-in.")); }}>Sign in to connect</button>}
    {state === "unavailable" && <p>Your organization has not connected a delivery service yet.</p>}
    {state === "loading" && <p role="status">Checking connection…</p>}
    {(state === "ready" || state === "sending") && <button className="btn btn--primary" disabled={state === "sending"} onClick={() => { void send(); }}>{state === "sending" ? "Queuing update…" : "Send approved timetable"}</button>}
    {state === "queued" && <p role="status">Update queued. Delivery runs in the background and retries if the connected service is unavailable. Queued does not mean delivered.</p>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
