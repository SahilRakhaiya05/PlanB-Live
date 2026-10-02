import { UserManager, WebStorageStateStore } from "oidc-client-ts";
const authority = import.meta.env.VITE_AUTH_AUTHORITY as string | undefined;
const clientId = import.meta.env.VITE_AUTH_CLIENT_ID as string | undefined;
const hosted = import.meta.env.VITE_AUTH_DOMAIN as string | undefined;
export const cloudBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/+$/, "") ?? "";
export const authConfigured = !!(authority && clientId && hosted);
const manager = authConfigured ? new UserManager({
  authority: authority!, client_id: clientId!, redirect_uri: window.location.origin + "/",
  response_type: "code", scope: "openid email planb/write", automaticSilentRenew: true,
  userStore: new WebStorageStateStore({ store: window.sessionStorage }),
  metadataSeed: { authorization_endpoint: `${hosted}/oauth2/authorize`, token_endpoint: `${hosted}/oauth2/token`, revocation_endpoint: `${hosted}/oauth2/revoke` },
}) : null;
let initialized: Promise<void> | undefined;
export function initAuth() {
  return initialized ??= (async () => {
    const params = new URLSearchParams(window.location.search);
    if (manager && params.has("state") && (params.has("code") || params.has("error"))) {
      try { await manager.signinRedirectCallback(); }
      catch { await manager.removeUser(); throw new Error("Sign-in was interrupted. Please try again."); }
      finally { window.history.replaceState({}, "", window.location.pathname + window.location.hash); }
    }
  })();
}
export async function signedIn() { await initAuth(); const user = await manager?.getUser(); return !!user && !user.expired; }
export async function signIn() { if (!manager) throw new Error("Cloud sign-in is not connected yet."); await manager.clearStaleState(); await manager.signinRedirect(); }
export async function accountEmail() { await initAuth(); const user = await manager?.getUser(); return user && !user.expired ? String(user.profile.email ?? "Organizer") : ""; }
export function watchAccount(onChange: () => void) {
  if (!manager) return () => undefined;
  manager.events.addUserLoaded(onChange); manager.events.addUserUnloaded(onChange);
  manager.events.addAccessTokenExpired(onChange); manager.events.addSilentRenewError(onChange);
  return () => { manager.events.removeUserLoaded(onChange); manager.events.removeUserUnloaded(onChange); manager.events.removeAccessTokenExpired(onChange); manager.events.removeSilentRenewError(onChange); };
}
export async function signOut() {
  await manager?.revokeTokens().catch(() => undefined);
  await manager?.removeUser();
  if (hosted && clientId) window.location.assign(`${hosted}/logout?client_id=${encodeURIComponent(clientId)}&logout_uri=${encodeURIComponent(window.location.origin + "/")}`);
}
export async function cloudHeaders(): Promise<Record<string, string>> {
  await initAuth(); const user = await manager?.getUser();
  if (!user || user.expired) throw new Error("Sign in to connect your event to the cloud.");
  return { "content-type": "application/json", Authorization: `Bearer ${user.access_token}` };
}
export async function cloudRequest(path: string, body?: unknown) {
  if (!cloudBase) throw new Error("Cloud services are not connected for this workspace.");
  const res = await fetch(`${cloudBase}${path}`, { method: body === undefined ? "GET" : "POST", headers: await cloudHeaders(), body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  const data = await res.json();
  if (res.status === 401) { await manager?.removeUser(); throw new Error("Your session has ended. Sign in again to continue."); }
  if (!res.ok) throw new Error(data.error ?? "The cloud request could not be completed.");
  return data;
}
