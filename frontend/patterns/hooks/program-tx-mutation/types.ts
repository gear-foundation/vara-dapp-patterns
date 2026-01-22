import type { UseMutationOptions } from '@tanstack/react-query';

export type TxMode = 'prepare' | 'signAndSend';

/**
 * Configuration options for the base "Program Tx Mutation" pattern.
 *
 * This type defines how a Vara program transaction should be prepared
 * and optionally executed.
 */
export type ProgramTxMutationOptions<TParams, TResult> = {
  /**
   * Program client instance (e.g. a Sails-generated program).
   *
   * Note: Ideally, this should be typed with the concrete program type
   * provided by your SDK if available.
   */
  program: unknown;

  /**
   * Name of the service exposed by the program.
   */
  serviceName: string;

  /**
   * Name of the function to be called on the program.
   */
  functionName: string;

  /**
   * Maps domain-specific parameters to the argument list
   * expected by the program function.
   */
  mapArgs: (params: TParams) => unknown[];

  /**
   * Optional gas limit for calls that require explicit gas configuration.
   */
  gasLimit?: bigint;

  /**
   * Execution mode:
   * - `prepare`: prepares and returns the transaction
   * - `signAndSend`: prepares, signs, and sends the transaction inside the hook
   */
  mode?: TxMode;

  /**
   * Optional React Query mutation options
   * (onError, onSuccess, retry, etc.).
   */
  mutationOptions?: Omit<UseMutationOptions<TResult, unknown, TParams>, 'mutationFn'>;
};

/**
 * Minimal shape of a transaction object that can be signed and sent.
 *
 * This intentionally avoids coupling to internal SDK types in order
 * to keep the pattern generic and reusable.
 */
export type SignAndSendableTransaction = {
  signAndSend: (...args: any[]) => Promise<any>;
};
