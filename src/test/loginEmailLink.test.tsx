import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const signInWithOtp = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { signInWithOtp: (...args: unknown[]) => signInWithOtp(...args) } },
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ signIn: vi.fn(async () => ({ error: null })), user: null, isLoading: false }),
}));

import LoginPage from "@/pages/LoginPage";

const NEUTRAL = "If that email has an account, a sign-in link is on its way.";
const RATE = "Too many requests, try again in a minute.";
const LINK_BUTTON = /email me a sign-in link/i;

function setup() {
  render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>,
  );
  fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "client@example.com" } });
  return screen.getByRole("button", { name: LINK_BUTTON });
}

describe("LoginPage email sign-in link", () => {
  beforeEach(() => signInWithOtp.mockReset());
  afterEach(() => cleanup());

  it("calls signInWithOtp without creating users and shows the neutral notice", async () => {
    signInWithOtp.mockResolvedValue({ data: {}, error: null });
    fireEvent.click(setup());
    expect(await screen.findByText(NEUTRAL)).toBeTruthy();
    expect(signInWithOtp).toHaveBeenCalledWith({
      email: "client@example.com",
      options: { shouldCreateUser: false, emailRedirectTo: window.location.origin + "/" },
    });
  });

  it("shows the same neutral notice when the user does not exist", async () => {
    signInWithOtp.mockResolvedValue({ data: {}, error: { status: 400, code: "otp_disabled", message: "Signups not allowed for otp" } });
    const button = setup();
    fireEvent.click(button);
    expect(await screen.findByText(NEUTRAL)).toBeTruthy();

    signInWithOtp.mockResolvedValue({ data: {}, error: { status: 400, message: "User not found" } });
    fireEvent.click(button);
    await waitFor(() => expect(signInWithOtp).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(NEUTRAL)).toBeTruthy();
    expect(screen.queryByText(/not found|not allowed/i)).toBeNull();
  });

  it("shows a plain rate-limit message", async () => {
    signInWithOtp.mockResolvedValue({
      data: {},
      error: { status: 429, code: "over_email_send_rate_limit", message: "email rate limit exceeded" },
    });
    fireEvent.click(setup());
    expect(await screen.findByText(RATE)).toBeTruthy();
    expect(screen.queryByText(NEUTRAL)).toBeNull();
  });

  it("disables the button while sending", async () => {
    let resolve: (v: unknown) => void = () => {};
    signInWithOtp.mockReturnValue(new Promise((r) => { resolve = r; }));
    const button = setup();
    fireEvent.click(button);
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(true));
    resolve({ data: {}, error: null });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
  });
});
