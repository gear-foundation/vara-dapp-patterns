import { useAccount, usePrepareProgramTransaction } from '@gear-js/react-hooks';
import { useMutation } from '@tanstack/react-query';

import type {
  ProgramTxMutationOptions,
  SignAndSendableTransaction,
  TxMode,
} from './types';

type PrepareTransactionAsyncResult = {
  transaction: SignAndSendableTransaction;
};

/**
 * Base pattern: "Program Tx Mutation"
 *
 * This hook standardizes how frontend applications prepare and execute
 * Vara program transactions by combining:
 * - `usePrepareProgramTransaction` (Gear JS)
 * - `useMutation` (React Query)
 *
 * It supports two execution modes:
 * - `prepare`: prepares and returns the transaction without executing it
 * - `signAndSend`: prepares, signs, and sends the transaction inside the hook
 */
export function useProgramTxMutation<TParams, TResult = unknown>(
  options: ProgramTxMutationOptions<TParams, TResult>,
) {
  const {
    program,
    serviceName,
    functionName,
    mapArgs,
    gasLimit,
    mode = 'prepare' as TxMode,
    mutationOptions,
  } = options;

  const { account } = useAccount();

  const { prepareTransactionAsync } = usePrepareProgramTransaction({
    program,
    serviceName,
    functionName,
  });

  const mutationFn = async (params: TParams): Promise<TResult> => {
    if (!program || !account) {
      // Explicitly throw to trigger React Query error handling
      throw new Error('Program or account is not found');
    }

    const { transaction } = (await prepareTransactionAsync({
      args: mapArgs(params),
      ...(gasLimit ? { gasLimit } : {}),
    })) as PrepareTransactionAsyncResult;

    if (mode === 'signAndSend') {
      return (await transaction.signAndSend()) as TResult;
    }

    // mode === 'prepare'
    return transaction as unknown as TResult;
  };

  const mutation = useMutation({
    mutationFn,
    ...mutationOptions,
  });

  return {
    program,
    account,
    ...mutation, // mutate, mutateAsync, isPending, error, data, etc.
  };
}
