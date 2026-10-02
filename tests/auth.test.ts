import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const oidc = vi.hoisted(() => ({ getUser: vi.fn(), removeUser: vi.fn(), clearStaleState: vi.fn(), signinRedirect: vi.fn(), signinRedirectCallback: vi.fn(), revokeTokens: vi.fn(), events: { addUserLoaded: vi.fn(), removeUserLoaded: vi.fn(), addUserUnloaded: vi.fn(), removeUserUnloaded: vi.fn(), addAccessTokenExpired: vi.fn(), removeAccessTokenExpired: vi.fn(), addSilentRenewError: vi.fn(), removeSilentRenewError: vi.fn() } }));
vi.mock("oidc-client-ts", () => ({ UserManager: class { constructor() { return oidc; } }, WebStorageStateStore: class {} }));
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks();
  vi.stubEnv("VITE_API_BASE_URL", "https://api.example.com");
  vi.stubEnv("VITE_AUTH_AUTHORITY", "https://issuer.example.com");
  vi.stubEnv("VITE_AUTH_CLIENT_ID", "client"); vi.stubEnv("VITE_AUTH_DOMAIN", "https://login.example.com");
  vi.stubGlobal("window", { location: { origin: "https://app.example.com", search: "", pathname: "/", hash: "" }, sessionStorage: {}, history: { replaceState: vi.fn() } });
  oidc.getUser.mockResolvedValue({ expired: false, access_token: "test-token", profile: { email: "organizer@example.com" } });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe("organizer sessions", () => {
  it("rejects expired sessions before transmitting a request", async () => {
    oidc.getUser.mockResolvedValue({ expired: true }); const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const auth = await import("../src/auth"); await expect(auth.cloudRequest("/repair", {})).rejects.toThrow("Sign in"); expect(fetch).not.toHaveBeenCalled();
  });
  it("clears a rejected session and asks for a new sign-in", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 401, ok: false, json: async () => ({ error: "Unauthorized" }) }));
    const auth = await import("../src/auth"); await expect(auth.cloudRequest("/integrations")).rejects.toThrow("session has ended"); expect(oidc.removeUser).toHaveBeenCalledOnce();
  });
  it("cleans stale authorization state before a new login", async () => {
    const auth = await import("../src/auth"); await auth.signIn(); expect(oidc.clearStaleState).toHaveBeenCalledOnce(); expect(oidc.signinRedirect).toHaveBeenCalledOnce();
  });
  it("removes all session subscriptions when a control unmounts", async () => {
    const auth = await import("../src/auth"); const callback = vi.fn(); const unsubscribe = auth.watchAccount(callback); unsubscribe();
    expect(oidc.events.removeAccessTokenExpired).toHaveBeenCalledWith(callback); expect(oidc.events.removeSilentRenewError).toHaveBeenCalledWith(callback); expect(oidc.events.removeUserLoaded).toHaveBeenCalledWith(callback); expect(oidc.events.removeUserUnloaded).toHaveBeenCalledWith(callback);
  });
});
