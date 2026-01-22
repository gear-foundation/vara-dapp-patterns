/**
 * Simple example: VFT transfer
 *
 * Flow:
 * 1) Prepare the program transaction in `prepare` mode (returns an extrinsic)
 * 2) Execute + verify it with `useVerifiedSignAndSend`
 */

import type { HexString } from '@gear-js/api';
import { useAlert, useApi, useAccount, useProgram } from '@gear-js/react-hooks';
import type { SubmittableExtrinsic } from '@polkadot/api/types';
import type { ISubmittableResult } from '@polkadot/types/types';
import { useState } from 'react';

import { Program as VftProgram } from '@/lib/extended-vft';
import { getErrorMessage } from '@/frontend/shared/errors/getErrorMessage';

import { useProgramTxMutation } from '@/frontend/patterns/hooks/program-tx-mutation/useProgramTxMutation';
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

export function VftTransferNoBatchExample({ vftProgramId, from, to }: Props) {
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
   * Builder pattern (prepare-only):
   * Create the extrinsic for `vft.transfer` without executing it.
   */
  const transfer = useProgramTxMutation<TransferParams, { extrinsic?: Extrinsic }>({
    program,
    serviceName: 'vft',
    functionName: 'transfer',
    mapArgs: ({ from, to, value }) => [from, to, value],
    mode: 'prepare',
  });

  /**
   * Executor + verification pattern:
   * Executes a provided extrinsic and verifies runtime + program replies.
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
      const tx = await transfer.mutateAsync({ from, to, value });

      if (!tx?.extrinsic) {
        alert.error('Failed to prepare transfer extrinsic');
        return;
      }

      // execute the prepared extrinsic directly
      await verifiedSend.mutateAsync({ extrinsic: tx.extrinsic });
    } catch (err) {
      alert.error(getErrorMessage(err));
    }
  };

  const isDisabled =
    !api ||
    !account ||
    !program ||
    transfer.isPending ||
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
