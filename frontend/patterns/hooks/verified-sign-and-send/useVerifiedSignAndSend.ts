import type { HexString, MessageQueuedData } from '@gear-js/api';
import { useAccount, useApi } from '@gear-js/react-hooks';
import type { AddressOrPair, SubmittableExtrinsic } from '@polkadot/api/types';
import type { TypeRegistry } from '@polkadot/types';
import type { ISubmittableResult } from '@polkadot/types/types';
import { useMutation, type UseMutationOptions } from '@tanstack/react-query';
import { throwOnErrorReply } from 'sails-js';

type Extrinsic = SubmittableExtrinsic<'promise', ISubmittableResult>;

export type ProgramRegistry = {
  programId: HexString;
  registry: TypeRegistry;
};

export type SignAndSendParams = {
  extrinsic: Extrinsic;
  /**
   * Optional override. If not provided, the connected extension account is used.
   */
  addressOrPair?: AddressOrPair;
};

export type UseVerifiedSignAndSendOptions = {
  /**
   * Programs involved in the extrinsic execution, used to decode reply errors.
   * Provide only valid entries (no `undefined`).
   */
  programs: ProgramRegistry[];

  /**
   * When to resolve the mutation.
   * - `inBlock` (default): resolves when included in a block (faster)
   * - `finalized`: resolves when finalized (stronger guarantee, slower)
   */
  resolveOn?: 'inBlock' | 'finalized';

  /**
   * React Query mutation options (onError/onSuccess/retry/etc).
   */
  mutationOptions?: Omit<UseMutationOptions<void, unknown, SignAndSendParams>, 'mutationFn' | 'mutationKey'>;
};

/**
 * Pattern: Verified Sign & Send
 *
 * Executes a extrinsic and verifies real success by:
 * - Detecting `ExtrinsicFailed` and returning a decoded error
 * - Collecting `gear.MessageQueued` events
 * - Fetching reply events for queued messages
 * - Throwing on program-level reply errors via `throwOnErrorReply`
 *
 * This pattern is useful when "extrinsic success" is not sufficient and you need
 * stronger correctness guarantees for UX and business logic.
 */
export function useVerifiedSignAndSend({
  programs,
  resolveOn = 'inBlock',
  mutationOptions,
}: UseVerifiedSignAndSendOptions) {
  const { api } = useApi();
  const { account } = useAccount();

  // Build a lookup map once for O(1) registry access.
  const registryByProgramId = new Map(programs.map((p) => [p.programId, p.registry] as const));

  const checkErrorReplies = async (blockHash: HexString, queued: MessageQueuedData[]) => {
    if (!api) throw new Error('API is not initialized');

    await Promise.all(
      queued.map(async ({ destination, id }) => {
        const programId = destination.toHex() as HexString;
        const registry = registryByProgramId.get(programId);
        if (!registry) return;

        const reply = await api.message.getReplyEvent(programId, id.toHex(), blockHash);
        const { details, payload } = reply.data.message;

        return throwOnErrorReply(details.unwrap().code, payload, api.specVersion, registry);
      }),
    );
  };

  const signAndSend = ({ extrinsic, addressOrPair }: SignAndSendParams) =>
    new Promise<void>((resolve, reject) => {
      if (!api) throw new Error('API is not initialized');
      if (!account) throw new Error('Account is not found');

      const { address, signer } = account;

      const shouldResolve = (result: ISubmittableResult) => {
        if (resolveOn === 'finalized') return result.status.isFinalized;
        return result.status.isInBlock;
      };

      const statusCallback = (result: ISubmittableResult) => {
        const { events, status } = result;
        if (!shouldResolve(result)) return;

        const queued: MessageQueuedData[] = [];

        for (const { event } of events) {
          const { method, section } = event;

          if (section === 'gear' && method === 'MessageQueued') {
            queued.push(event.data as MessageQueuedData);
          }

          if (method === 'ExtrinsicFailed') {
            const error = api.getExtrinsicFailedError(event);
            reject(new Error(`${error.method}: ${error.docs}`));
            return;
          }
        }

        // If we got here, the extrinsic did not fail at the runtime level.
        // Now verify program-level execution via replies.
        const blockHash = (status.isInBlock ? status.asInBlock : status.asFinalized).toHex();

        checkErrorReplies(blockHash, queued)
          .then(() => resolve())
          .catch((err) => reject(err));
      };

      const submit = () =>
        addressOrPair
          ? extrinsic.signAndSend(addressOrPair, statusCallback)
          : extrinsic.signAndSend(address, { signer }, statusCallback);

      submit().catch((err: Error) => reject(err));
    });

  return useMutation({
    mutationKey: ['verifiedSignAndSend', resolveOn],
    mutationFn: signAndSend,
    ...mutationOptions,
  });
}
