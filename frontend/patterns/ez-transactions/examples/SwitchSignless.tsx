import {
  useAccount,
  useProgram,
  usePrepareProgramTransaction,
} from "@gear-js/react-hooks";
import {
  useSignlessTransactions,
  usePrepareEzTransactionParams,
  useGaslessTransactions,
  EnableSignlessSession,
} from "gear-ez-transactions";
import { useEffect, useRef, useState } from "react";
import { useSignAndSend } from "../hooks/use-sign-and-send";

// ─── Types ─────────────────────────────────────────────────────────────────────

/// Sails-generated program class for the target contract.
/// Replace with your actual generated client.
declare const Program: any;

/// Actions that may be delegated to the signless session key.
/// Must match the `ActionsForSession` enum defined in the smart contract.
const ALLOWED_SIGNLESS_ACTIONS = ["SayHello", "SayPersonalHello"];

// ─── Component ─────────────────────────────────────────────────────────────────

/// SwitchSignlessAndSendHello
///
/// A complete example of the signless + gasless transaction pattern using
/// the `gear-ez-transactions` library.
///
/// Responsibilities:
/// 1. Request a gasless voucher automatically when the user connects
/// 2. Let the user activate/deactivate a signless session via a UI switcher
/// 3. Submit a "HelloWorld" transaction without requiring a wallet pop-up
///
/// The user experience after setup:
/// - Gas is paid by the voucher (user holds no VARA)
/// - Messages are signed by an ephemeral key (user clicks no wallet pop-up)
export function SwitchSignlessAndSendHello() {
  const { account } = useAccount();
  const signless = useSignlessTransactions();
  const gasless = useGaslessTransactions();

  // Load the Sails program client from the on-chain program ID
  const { data: program } = useProgram({
    library: Program,
    id: import.meta.env.VITE_PROGRAMID,
  });

  // Prepare the transaction builder — does not sign or send yet
  const { prepareTransactionAsync } = usePrepareProgramTransaction({
    program,
    serviceName: "service",
    functionName: "helloWorld",
  });

  // Provides `sessionForAccount` + other params needed for delegated calls
  const { prepareEzTransactionParams } = usePrepareEzTransactionParams();

  // Orchestrates balance check + signAndSend
  const { signAndSend } = useSignAndSend();

  const [loading, setLoading] = useState(false);
  const [voucherPending, setVoucherPending] = useState(false);

  // Ref to prevent requesting the voucher more than once per account.
  // Using `useRef` instead of `useState` avoids triggering re-renders
  // and prevents double-invocation in React 18 StrictMode.
  const hasRequestedOnceRef = useRef(false);

  // Reset the request flag when the connected account changes.
  useEffect(() => {
    hasRequestedOnceRef.current = false;
  }, [account?.address]);

  // ─── Auto-request gasless voucher ────────────────────────────────────────────
  //
  // When gasless mode is enabled and the user is connected, request a voucher
  // automatically so the user doesn't have to do it manually.
  //
  // The voucher is requested only once per account (tracked via ref).
  // If a voucher already exists (voucherStatus.enabled), we skip the request.
  useEffect(() => {
    if (!account?.address || !gasless.isEnabled || hasRequestedOnceRef.current)
      return;

    hasRequestedOnceRef.current = true;
    setVoucherPending(true);

    const requestVoucherSafely = async () => {
      try {
        if (gasless.voucherStatus?.enabled) {
          console.log("[SwitchSignless] Voucher already active — skipping");
          setVoucherPending(false);
          return;
        }

        console.log("[SwitchSignless] Requesting voucher...");
        await gasless.requestVoucher(account.address);

        // Poll briefly for confirmation that the voucher was activated on-chain.
        // In production, prefer subscribing to the VoucherIssued event.
        let retries = 5;
        while (retries-- > 0) {
          await new Promise((r) => setTimeout(r, 300));
          if (gasless.voucherStatus?.enabled) {
            console.log("[SwitchSignless] Voucher confirmed active");
            setVoucherPending(false);
            return;
          }
        }

        console.warn("[SwitchSignless] Voucher not confirmed after polling");
        setVoucherPending(false);
      } catch (err) {
        console.error("[SwitchSignless] Error requesting voucher:", err);
        // Reset the flag so the user can retry on the next render cycle
        hasRequestedOnceRef.current = false;
        setVoucherPending(false);
      }
    };

    void requestVoucherSafely();
  }, [account?.address, gasless.isEnabled]);

  // ─── Send HelloWorld ──────────────────────────────────────────────────────────
  //
  // Prepares and submits the HelloWorld transaction using the active signless session.
  //
  // `prepareEzTransactionParams(false)` returns:
  //   { sessionForAccount, account, gasLimit, ... }
  //
  // These params are spread into `prepareTransactionAsync` to wire up the
  // session key and gasless voucher automatically.
  const handleSendHello = async () => {
    if (!signless.isActive) {
      alert("Activate the signless session first");
      return;
    }

    setLoading(true);
    try {
      // `false` = do not use signless (use gasless only).
      // Pass `true` for a pure signless transaction (no gasless).
      const { sessionForAccount, ...params } =
        await prepareEzTransactionParams(false);

      if (!sessionForAccount) throw new Error("Missing sessionForAccount");

      const { transaction } = await prepareTransactionAsync({
        args: [null], // HelloWorld takes no meaningful args in this example
        value: 0n,
        ...params,
      });

      signAndSend(transaction, {
        onSuccess: () => setLoading(false),
        onError: () => setLoading(false),
      });
    } catch (e) {
      console.error("[SwitchSignless] prepare/send failed:", e);
      setLoading(false);
    }
  };

  const voucherEnabled = gasless.voucherStatus?.enabled;
  const signlessActive = signless.isActive;

  // ─── Render ───────────────────────────────────────────────────────────────────

  return (
    <div style={styles.container}>
      <p style={styles.description}>
        {voucherEnabled
          ? "✅ Gasless session active."
          : gasless.isEnabled
          ? voucherPending
            ? "⏳ Requesting voucher..."
            : "🛠️ Waiting for voucher activation..."
          : "⚠️ Gasless service unavailable."}
      </p>

      <p style={{ color: signlessActive ? "green" : "red" }}>
        {signlessActive
          ? "✅ Signless session active"
          : "⚠️ Signless session inactive"}
      </p>

      <button
        style={{ ...styles.button, opacity: loading || !signlessActive ? 0.6 : 1 }}
        onClick={handleSendHello}
        disabled={loading || !signlessActive}
      >
        {loading ? "Sending..." : "Send HelloWorld"}
      </button>

      {/* EnableSignlessSession renders the switcher UI and handles
          session creation + deletion internally */}
      <div style={{ marginTop: "1rem" }}>
        <EnableSignlessSession
          type="switcher"
          requiredBalance={0}
          allowedActions={ALLOWED_SIGNLESS_ACTIONS}
        />
      </div>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: "1.5rem",
    background: "#f0fdf4",
    borderRadius: "1rem",
    boxShadow: "0 6px 18px rgba(0,0,0,0.05)",
    textAlign: "center",
    maxWidth: "420px",
    margin: "2rem auto",
    fontFamily: "Inter, sans-serif",
  },
  description: {
    marginBottom: "0.75rem",
    color: "#4b5563",
  },
  button: {
    marginTop: "1rem",
    background: "#6366f1",
    color: "#fff",
    fontWeight: "bold",
    fontSize: "1rem",
    padding: "0.75rem 1.25rem",
    borderRadius: "0.75rem",
    border: "none",
    cursor: "pointer",
    transition: "background 0.3s",
    width: "100%",
  },
};
