// How long the app waits between attempts to look up a signed-in user's role (milliseconds): after
// the first failure, then after the second. A failed lookup is tried again this way before the app
// shows its no-access screen. Kept apart from AuthContext so the context file exports only its
// provider and hook, and so a test can shorten the waits.
export const ROLE_RETRY_DELAYS_MS = [400, 1200];
