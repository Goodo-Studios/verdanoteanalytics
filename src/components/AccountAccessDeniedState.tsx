import { ShieldAlert } from "lucide-react";

/**
 * AccountAccessDeniedState — rendered by AccountProvider (US-008) in place of
 * the app when the URL's `?account=` id doesn't exist or isn't accessible to
 * the signed-in user. This deliberately replaces the entire child tree rather
 * than rendering inline: the whole point of US-008 is that an unrecognised
 * account id must never fall through to whatever account was last selected,
 * so nothing downstream gets a chance to render another account's data.
 */
export function AccountAccessDeniedState() {
  return (
    <div
      data-testid="account-access-denied"
      className="min-h-screen flex flex-col items-center justify-center bg-background text-center px-6"
    >
      <span
        className="flex h-12 w-12 items-center justify-center rounded-full bg-sage/10 mb-4"
        aria-hidden="true"
      >
        <ShieldAlert className="h-6 w-6 text-sage" />
      </span>
      <p className="font-heading text-[16px] text-forest">This account isn't available</p>
      <p className="font-body text-[13px] text-slate font-light mt-1.5 max-w-[340px]">
        The account in this link doesn't exist or you don't have access to it.
        Double-check the link, or pick an account from your account list.
      </p>
    </div>
  );
}
