import {
  useAccount,
  useAlert,
  useApi,
  useBalance,
} from "@gear-js/react-hooks";
import { stringShorten } from "@polkadot/util";

type Props = {
  /// Voucher ID of the gasless voucher (HexString).
  /// When provided, the voucher's balance is checked instead of the user's account balance.
  gaslessVoucherId?: `0x${string}`;

  /// Voucher ID of the signless pair voucher (used when signless mode is active).
  /// Takes priority over the account's own balance when present.
  signlessPairVoucherId?: string;
};

/// useCheckBalance
///
/// Determines which balance to verify before submitting a transaction and
/// checks whether it exceeds the minimum required amount.
///
/// Balance resolution priority:
///   1. `gaslessVoucherId` — the gasless voucher's balance (highest priority)
///   2. `signlessPairVoucherId` — the signless session pair's voucher balance
///   3. `account.decodedAddress` — the user's own wallet balance (fallback)
///
/// This hook does not sign or send anything. It is a guard that either
/// calls the `callback` (sufficient funds) or fires an error alert (insufficient funds).
function useCheckBalance(args?: Props) {
  const { signlessPairVoucherId, gaslessVoucherId } = args ?? {};
  const { api } = useApi();
  const { account } = useAccount();
  const alert = useAlert();

  // Determine which address to check. Gasless voucher takes priority.
  const voucherAddress = signlessPairVoucherId ?? account?.decodedAddress;
  const addressToCheck = gaslessVoucherId ?? voucherAddress;

  const { balance } = useBalance(addressToCheck);

  /// Check if `addressToCheck` has enough funds to cover the gas for `limit`.
  ///
  /// The minimum required balance is:
  ///   existentialDeposit + gasLimit * valuePerGas
  ///
  /// Where:
  /// - `existentialDeposit` is the minimum account balance to stay alive
  /// - `gasLimit` is the estimated gas in fee units
  /// - `valuePerGas` is the VARA cost per gas unit
  ///
  /// If sufficient: calls `callback()` immediately.
  /// If insufficient: shows an alert with the shortened address and calls `onError()`.
  const checkBalance = (
    limit: bigint,
    callback: () => void,
    onError?: () => void
  ) => {
    if (!api) {
      onError?.();
      return;
    }

    const chainBalance = BigInt(balance?.toString() ?? "0");
    const valuePerGas = BigInt(api.valuePerGas.toString());
    const chainEDeposit = BigInt(api.existentialDeposit.toString());
    const required = chainEDeposit + limit * valuePerGas;

    if (chainBalance < required) {
      alert.error(
        `Low balance on ${stringShorten(addressToCheck ?? "", 8)}`
      );
      onError?.();
      return;
    }

    callback();
  };

  return { checkBalance };
}

export { useCheckBalance };
