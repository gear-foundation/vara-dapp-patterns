import { useAlert } from "@gear-js/react-hooks";
import {
  GenericTransactionReturn,
  TransactionReturn,
} from "@gear-js/react-hooks/dist/hooks/sails/types";
import { useEzTransactions } from "gear-ez-transactions";
import { useCheckBalance } from "./use-check-balance";

export type Options = {
  onSuccess?: () => void;
  onError?: () => void;
};

type Voucher = {
  id?: string;
};

type SignlessState = {
  voucher?: Voucher;
};

type GaslessState = {
  voucherId?: string;
};

type EzTransactionsState = {
  signless: SignlessState;
  gasless: GaslessState;
};

/// useSignAndSend
///
/// Orchestrates the final step of the ez-transactions pattern:
/// verifying available balance and submitting a prepared transaction.
///
/// It composes two concerns:
/// 1. `useCheckBalance` — determines which balance to use and validates it
/// 2. `transaction.signAndSend()` — submits the prepared extrinsic
///
/// The hook reads current signless and gasless state from `useEzTransactions`
/// to resolve the correct balance source automatically:
/// - If gasless is active: checks the gasless voucher's balance
/// - If signless is active: checks the signless pair voucher's balance
/// - Otherwise: checks the user's own wallet balance
export const useSignAndSend = () => {
  const { signless, gasless } = useEzTransactions() as EzTransactionsState;
  const alert = useAlert();

  const { checkBalance } = useCheckBalance({
    signlessPairVoucherId: signless.voucher?.id,
    gaslessVoucherId: gasless.voucherId as `0x${string}` | undefined,
  });

  /// Sign and send a prepared transaction.
  ///
  /// Flow:
  ///   1. Read the estimated gas from the prepared extrinsic args
  ///   2. Run `checkBalance(gas, callback, onError)`
  ///   3. If balance is sufficient, `callback` executes `signAndSend()`
  ///   4. On success: call `options.onSuccess()`
  ///   5. On error: call `options.onError()` and show alert
  ///
  /// Note: The callback is synchronous to satisfy ESLint's `no-misused-promises`.
  /// The actual async work is wrapped with `void`.
  const signAndSend = (
    transaction: TransactionReturn<() => GenericTransactionReturn<null>>,
    options?: Options
  ): void => {
    const { onSuccess, onError } = options ?? {};

    // The estimated gas is encoded as the third argument of the extrinsic.
    // This value was set by `calculateGas()` during transaction preparation.
    const calculatedGas = BigInt(transaction.extrinsic.args[2].toString());

    checkBalance(
      calculatedGas,
      () => {
        void transaction
          .signAndSend()
          .then(({ response }) =>
            response().then(() => {
              onSuccess?.();
            })
          )
          .catch((error: unknown) => {
            onError?.();
            console.error("[useSignAndSend] Transaction failed:", error);
            alert.error("Transaction failed");
          });
      },
      onError
    );
  };

  return { signAndSend };
};
