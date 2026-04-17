import type { HexString } from '@gear-js/api';
import { useProgram } from '@gear-js/react-hooks';

import { Program } from '@/lib/extended-vft';
import { GAS_LIMIT } from '@/frontend/shared/constants/gas';

import { usePrepareProgramTx } from '../usePrepareProgramTx';

type Params = {
    from: HexString;
    to: HexString;
    value: string;
};

/**
 * Example: Prepare a VFT transfer transaction (no execution).
 *
 * This returns a prepared transaction that can be executed later
 * (e.g., tx.signAndSend()) by the UI or another hook.
 */
export function usePrepareVftTransferTx(programId?: HexString) {
    const { data: program } = useProgram({
        library: Program,
        id: programId,
    });

    const { prepare, account } = usePrepareProgramTx<Params>({
        program,
        serviceName: 'vft',
        functionName: 'transfer',
        mapArgs: ({ from, to, value }) => [from, to, value],
        gasLimit: GAS_LIMIT,
    });

    return {
        program,
        account,
        prepare,
    };
}
