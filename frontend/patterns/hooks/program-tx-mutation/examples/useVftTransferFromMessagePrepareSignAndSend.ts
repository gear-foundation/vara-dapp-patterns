import type { HexString } from '@gear-js/api';
import { useAlert } from '@gear-js/react-hooks';
import { Program } from '@/lib/extended-vft';
import { useProgram } from '@gear-js/react-hooks';
import { useProgramTxMutation } from '../useProgramTxMutation';
import { getErrorMessage } from '@/frontend/shared/errors/getErrorMessage';

type Params = {
    from: HexString;
    to: HexString;
    value: string;
};

export function useVftTransferFromMessage(programId: HexString) {
    const { data: program } = useProgram({
        library: Program,
        id: programId,
    });
    const alert = useAlert();

    const { mutateAsync: transferFromMessage, isPending } = useProgramTxMutation<Params, unknown>({
        program,
        serviceName: 'vft',
        functionName: 'transferFrom',
        mapArgs: ({ from, to, value }) => [from, to, value],
        mode: 'signAndSend',
        mutationOptions: {
            onError: (error) => alert.error(getErrorMessage(error)),
        },
    });

    return { transferFromMessage, isPending };
}
