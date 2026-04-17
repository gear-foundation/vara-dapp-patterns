import { useMutation, type UseMutationOptions } from '@tanstack/react-query';

export type SignAndSendableTransaction<TResult = unknown> = {
  signAndSend: () => Promise<TResult>;
};

export type ProgramTxMutationOptions<TResult> = UseMutationOptions<
  TResult,
  Error,
  SignAndSendableTransaction<TResult>
>;

/**
 * useProgramTxMutation
 *
 * Executes a previously prepared transaction using React Query.
 *
 * Input:  a SignAndSendableTransaction
 * Output: the result of transaction.signAndSend()
 *
 * This hook owns execution state (pending/success/error),
 * but intentionally does not prepare or verify transactions.
 */
export function useProgramTxMutation<TResult = unknown>(
  mutationOptions?: ProgramTxMutationOptions<TResult>,
) {
  return useMutation<TResult, Error, SignAndSendableTransaction<TResult>>({
    mutationFn: (transaction) => {
      if (!transaction?.signAndSend) {
        throw new Error('Invalid transaction object provided');
      }

      return transaction.signAndSend();
    },
    ...mutationOptions,
  });
}
