import type { HexString, MessageQueuedData } from '@gear-js/api';
import { useAccount, useApi } from '@gear-js/react-hooks';
import type { AddressOrPair, SubmittableExtrinsic } from '@polkadot/api/types';
import type { TypeRegistry } from '@polkadot/types';
import type { ISubmittableResult } from '@polkadot/types/types';
import { useMutation, type UseMutationOptions } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { throwOnErrorReply } from 'sails-js';

type Extrinsic = SubmittableExtrinsic<'promise', ISubmittableResult>;

export type ProgramRegistry = {
  programId: HexString;
  registry: TypeRegistry;
};

export type SignAndSendParams = {
  extrinsic: Extrinsic;
  /**
   * Optional override. If provided, it will be used directly.
   * If not provided, the connected extension account is used.
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
  mutationOptions?: Omit<
    UseMutationOptions<void, Error, SignAndSendParams>,
    'mutationFn' | 'mutationKey'
  >;
};

/**
 * Pattern: Verified Sign & Send
 *
 * Executes an extrinsic and verifies real success by:
 * - Rejecting on runtime-level failure (`ExtrinsicFailed`)
 * - Collecting `gear.MessageQueued` events
 * - Fetching reply events for queued messages
 * - Throwing on program-level reply errors via `throwOnErrorReply`
 *
 * This is useful when "extrinsic included" is not enough and you need
 * stronger correctness guarantees for UX and business logic.
 */
export function useVerifiedSignAndSend({
  programs,
  resolveOn = 'inBlock',
  mutationOptions,
}: UseVerifiedSignAndSendOptions) {
  const { api } = useApi();
  const { account } = useAccount();

  // O(1) registry access by programId.
  const registryByProgramId = useMemo(
    () => new Map(programs.map((p) => [p.programId, p.registry] as const)),
    [programs],
  );

  const checkErrorReplies = useCallback(
    async (blockHash: HexString, queued: MessageQueuedData[]) => {
      if (!api) throw new Error('API is not initialized');
      if (!queued.length) return;

      await Promise.all(
        queued.map(async ({ destination, id }) => {
          const programId = destination.toHex() as HexString;
          const registry = registryByProgramId.get(programId);

          // If registry is not provided for this program, we skip decoding.
          if (!registry) return;

          const reply = await api.message.getReplyEvent(programId, id.toHex(), blockHash);

          const detailsOpt = reply.data.message.details;
          if (detailsOpt.isNone) return;

          const { details, payload } = reply.data.message;
          return throwOnErrorReply(details.unwrap().code, payload, api.specVersion, registry);
        }),
      );
    },
    [api, registryByProgramId],
  );

  const signAndSend = useCallback(
    async ({ extrinsic, addressOrPair }: SignAndSendParams) => {
      if (!api) throw new Error('API is not initialized');

      // If addressOrPair is provided, we can sign without requiring extension account.
      if (!addressOrPair && !account) throw new Error('No account connected');

      const shouldResolve = (result: ISubmittableResult) => {
        if (resolveOn === 'finalized') return result.status.isFinalized;
        return result.status.isInBlock;
      };

      return new Promise<void>((resolve, reject) => {
        let settled = false;

        const settleOnce = (fn: () => void) => {
          if (settled) return;
          settled = true;
          fn();
        };

        const statusCallback = (result: ISubmittableResult) => {
          try {
            if (!shouldResolve(result)) return;

            const { events, status } = result;
            const queued: MessageQueuedData[] = [];

            for (const { event } of events) {
              const { method, section } = event;

              if (section === 'gear' && method === 'MessageQueued') {
                queued.push(event.data as MessageQueuedData);
              }

              if (method === 'ExtrinsicFailed') {
                const error = api.getExtrinsicFailedError(event);
                const docs = Array.isArray(error.docs) ? error.docs.join(' ') : String(error.docs);

                settleOnce(() => reject(new Error(`${error.method}: ${docs}`)));
                return;
              }
            }

            const blockHash = (status.isInBlock ? status.asInBlock : status.asFinalized).toHex();

            checkErrorReplies(blockHash, queued)
              .then(() => settleOnce(() => resolve()))
              .catch((err) => settleOnce(() => reject(err)));
          } catch (err) {
            settleOnce(() => reject(err as Error));
          }
        };

        // IMPORTANT: signAndSend returns an unsubscribe function (often via Promise).
        const submit = async () => {
          try {
            if (addressOrPair) {
              const unsub = await extrinsic.signAndSend(addressOrPair, statusCallback);
              const originalResolve = resolve;
              const originalReject = reject;

              resolve = () => {
                try { unsub(); } catch {}
                originalResolve();
              };
              reject = (e) => {
                try { unsub(); } catch {}
                originalReject(e);
              };

              return;
            }

            // extension account path
            const { address, signer } = account!;
            const unsub = await extrinsic.signAndSend(address, { signer }, statusCallback);

            const originalResolve = resolve;
            const originalReject = reject;

            resolve = () => {
              try { unsub(); } catch {}
              originalResolve();
            };
            reject = (e) => {
              try { unsub(); } catch {}
              originalReject(e);
            };
          } catch (err) {
            settleOnce(() => reject(err as Error));
          }
        };

        void submit();
      });
    },
    [api, account, resolveOn, checkErrorReplies],
  );

  return useMutation({
    mutationKey: ['verifiedSignAndSend', resolveOn],
    mutationFn: signAndSend,
    ...mutationOptions,
  });
}
