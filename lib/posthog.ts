import PostHog from "posthog-react-native";

export const posthog = new PostHog("phc_CAVtoZaoaBZybq73E6eWqwn8DPMHVxv29XqgBNkVCYjQ", {
  host: "https://us.i.posthog.com",
});

// session id refreshes whenever the app foregrounds. lets every event join on
// the same session so we can compute uploads/prompts/etc per session in PostHog
let sessionId = makeSessionId();

function makeSessionId(): string {
  return `s-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function getSessionId(): string {
  return sessionId;
}

export function resetSessionId(): string {
  sessionId = makeSessionId();
  return sessionId;
}

// thin wrapper so we don't have to remember to attach session_id everywhere
export function track(event: string, props?: Record<string, unknown>): void {
  posthog.capture(event, { session_id: sessionId, ...(props ?? {}) });
}
