import { useAccount, usePrepareProgramTransaction } from '@gear-js/react-hooks';
import { useCallback } from 'react';

export type SignAndSendableTransaction = {
  signAndSend: () => Promise<unknown>;
};

type PrepareTransactionAsyncResult = {
  transaction: SignAndSendableTransaction;
};

export type PrepareProgramTxOptions<TParams> = {
  program?: unknown;
  serviceName: string;
  functionName: string;
  mapArgs: (params: TParams) => readonly unknown[];
  gasLimit?: unknown;
};

export function usePrepareProgramTx<TParams>(options: PrepareProgramTxOptions<TParams>) {
  const { program, serviceName, functionName, mapArgs, gasLimit } = options;

  const { account } = useAccount();

  const { prepareTransactionAsync } = usePrepareProgramTransaction({
    program,
    serviceName,
    functionName,
  });

  const canPrepare = Boolean(program && account);

  const prepare = useCallback(
    async (params: TParams): Promise<SignAndSendableTransaction> => {
      if (!program) throw new Error('Program instance is not available');
      if (!account) throw new Error('No account connected');

      const { transaction } = (await prepareTransactionAsync({
        args: mapArgs(params),
        ...(gasLimit ? { gasLimit } : {}),
      })) as PrepareTransactionAsyncResult;

      return transaction;
    },
    [program, account, prepareTransactionAsync, mapArgs, gasLimit],
  );

  return {
    program,
    account,
    canPrepare,
    prepare,
  };
}
