import { runRepair } from "./domain";
self.onmessage = (event: MessageEvent) => {
  try { self.postMessage({ result: runRepair(event.data.plan, event.data.objective) }); }
  catch { self.postMessage({ error: "We could not finish planning. Please check your event and try again." }); }
};
