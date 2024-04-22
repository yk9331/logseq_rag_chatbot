'use client';

import React, { useEffect } from 'react';
import Backdrop from '@mui/material/Backdrop';
import { LoadingMessage } from './LoadingMessage';
import { LogseqErrorMessage } from './LogseqErrorMessage';
import { buildPageVectors } from '../../lib/langchain';
import { PageEntity } from '@logseq/libs/dist/LSPlugin.user';

export function PageUploader(props: {
    pageUUID: string;
    includeLinkedPages: boolean;
    setSelectedPageLoaded: React.Dispatch<React.SetStateAction<boolean>>;
    setIncludedPages: React.Dispatch<React.SetStateAction<Array<PageEntity> | null>>;
}) {
    const [open, setOpen] = React.useState(true);
    const [error, setError] = React.useState(null);
    const { pageUUID, includeLinkedPages, setSelectedPageLoaded, setIncludedPages } = props;

    useEffect(() => {
        buildPageVectors(pageUUID, includeLinkedPages)
            .then((pages) => {
                setIncludedPages(pages);
                setSelectedPageLoaded(true);
            })
            .catch((e) => {
                setError(e);
            });
    }, [pageUUID, includeLinkedPages, setSelectedPageLoaded, setIncludedPages]);

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
                <LogseqErrorMessage error={error} />
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
