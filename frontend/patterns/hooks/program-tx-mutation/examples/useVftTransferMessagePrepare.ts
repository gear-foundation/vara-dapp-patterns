import type { HexString } from '@gear-js/api';
import { useProgram } from '@gear-js/react-hooks';
import { Program } from '@/lib/extended-vft';
import { useProgramTxMutation } from '../useProgramTxMutation';
import { GAS_LIMIT } from '@/frontend/shared/constants/gas';

type Params = {
  from: HexString;
  to: HexString;
  value: string;
};

export function useVftTransferMessage(programId?: HexString) {
  const { data: program } = useProgram({
    library: Program,
    id: programId,
  });

  const { mutateAsync, isPending } = useProgramTxMutation<Params, unknown>({
    program,
    serviceName: 'vft',
    functionName: 'transfer',
    mapArgs: ({ from, to, value }) => [from, to, value],
    gasLimit: GAS_LIMIT,
    mode: 'prepare',
  });

  return { mutateAsync, isPending, program };
}
