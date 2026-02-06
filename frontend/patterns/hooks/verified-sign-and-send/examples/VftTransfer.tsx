/**
 * Example: VFT transfer with verified execution
 *
 * Flow:
 * 1) Prepare an extrinsic for `vft.transfer` (no execution)
 * 2) Execute + verify it with `useVerifiedSignAndSend`
 */
import type { HexString } from '@gear-js/api';
import { useAlert, useApi, useAccount, useProgram, usePrepareProgramTransaction } from '@gear-js/react-hooks';
import type { SubmittableExtrinsic } from '@polkadot/api/types';
import type { ISubmittableResult } from '@polkadot/types/types';
import { useState } from 'react';

import { Program as VftProgram } from '@/lib/extended-vft';
import { getErrorMessage } from '@/frontend/shared/errors/getErrorMessage';

import { useVerifiedSignAndSend } from '@/frontend/patterns/hooks/verified-sign-and-send/useVerifiedSignAndSend';

type Extrinsic = SubmittableExtrinsic<'promise', ISubmittableResult>;

type TransferParams = {
  from: HexString;
  to: HexString;
  value: string;
};

type Props = {
  vftProgramId: HexString;
  from: HexString;
  to: HexString;
};

export function VftTransferExample({ vftProgramId, from, to }: Props) {
  const { api } = useApi();
  const { account } = useAccount();
  const alert = useAlert();

  const [value, setValue] = useState('100');

  // Load the VFT program client
  const { data: program } = useProgram({
    library: VftProgram,
    id: vftProgramId,
  });

  /**
   * Prepare step (builder): creates an extrinsic for `vft.transfer`.
   * This is intentionally separated from execution & verification.
   */
  const { prepareTransactionAsync } = usePrepareProgramTransaction({
    program,
    serviceName: 'vft',
    functionName: 'transfer',
  });

  /**
   * Execute + verify step: runtime + program replies.
   */
  const verifiedSend = useVerifiedSignAndSend({
    programs: program ? [{ programId: vftProgramId, registry: program.registry }] : [],
    resolveOn: 'inBlock',
    mutationOptions: {
      onSuccess: () => alert.success('Transfer successful'),
      onError: (err) => alert.error(getErrorMessage(err)),
    },
  });

  const onTransfer = async () => {
    if (!api || !account || !program) return;

    try {
      const prepared = (await prepareTransactionAsync({
        args: [from, to, value] satisfies TransferParams extends any ? unknown[] : unknown[],
      })) as { extrinsic?: Extrinsic };

      if (!prepared?.extrinsic) {
        alert.error('Failed to prepare transfer extrinsic');
        return;
      }

      await verifiedSend.mutateAsync({ extrinsic: prepared.extrinsic });
    } catch (err) {
      alert.error(getErrorMessage(err));
    }
  };

  const isDisabled =
    !api ||
    !account ||
    !program ||
    verifiedSend.isPending ||
    !value ||
    Number(value) <= 0;

  return (
    <div style={{ display: 'grid', gap: 8, maxWidth: 420 }}>
      <div>
        <div>VFT Program: {vftProgramId}</div>
        <div>From: {from}</div>
        <div>To: {to}</div>
      </div>

      <label>
        Amount
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="100"
          style={{ width: '100%' }}
        />
      </label>

      <button onClick={onTransfer} disabled={isDisabled}>
        {verifiedSend.isPending ? 'Sending...' : 'Send VFT Transfer'}
      </button>

      {!account && <div>Please connect your wallet.</div>}
      {!program && <div>Loading program...</div>}
    </div>
  );
}
