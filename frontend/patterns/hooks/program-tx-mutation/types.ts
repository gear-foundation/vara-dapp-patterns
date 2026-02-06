import type { UseMutationOptions } from '@tanstack/react-query';

export type SignAndSendableTransaction<TResult = unknown> = {
  signAndSend: () => Promise<TResult>;
};

export type ProgramTxMutationOptions<TResult = unknown> = UseMutationOptions<
  TResult,
  Error,
  SignAndSendableTransaction<TResult>
>;
