import React, { useEffect } from 'react';
import Backdrop from '@mui/material/Backdrop';
import { LoadingMessage } from './LoadingMessage';
import { ErrorMessage } from './ErrorMessage';
import { buildPageVectors, buildRagChatChain } from '../../lib/langchain';
import { PageEntity } from '@logseq/libs/dist/LSPlugin.user';
import { RunnableSequence } from '@langchain/core/runnables';

export function RagChainBuilder(props: {
    pageUUID: string;
    includeLinkedPages: boolean;
    setSelectedPageLoaded: React.Dispatch<React.SetStateAction<boolean>>;
    setIncludedPages: React.Dispatch<React.SetStateAction<Array<PageEntity> | null>>;
    setRagChain: React.Dispatch<React.SetStateAction<RunnableSequence<any, string> | null>>;
}) {
    const [open, setOpen] = React.useState(true);
    const [error, setError] = React.useState(null);
    const { pageUUID, includeLinkedPages, setSelectedPageLoaded, setIncludedPages, setRagChain } = props;

    useEffect(() => {
        const build = async () => {
            try {
                const pages = await buildPageVectors(pageUUID, includeLinkedPages);
                const chain = await buildRagChatChain(pages);
                setIncludedPages(pages);
                setRagChain(chain);
                setSelectedPageLoaded(true);
            } catch (e) {
                setError(e);
            }
        };
        build();
    }, []);

    const handleClose = (e) => {
        setOpen(false);
    };

    if (error) {
        return (
            <Backdrop
                sx={{ color: '#fff', zIndex: (theme) => theme.zIndex.drawer + 1 }}
                open={open}
                onClick={handleClose}
            >
                <ErrorMessage error={error} />
            </Backdrop>
        );
    } else {
        return (
            <Backdrop sx={{ color: '#fff', zIndex: (theme) => theme.zIndex.drawer + 1 }} open={open}>
                <LoadingMessage />
            </Backdrop>
        );
    }
}
