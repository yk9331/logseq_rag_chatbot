import '@logseq/libs';
import { PageEntity, BlockEntity } from '@logseq/libs/dist/LSPlugin.user';
import React, { useState, useEffect } from 'react';
import Box from '@mui/material/Box';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Modal from '@mui/material/Modal';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import { RetrievalQAChain } from 'langchain/chains';
import { useImmer } from 'use-immer';

import './style.css';
import { ChatMessage } from './components/ChatMesssage';
import { buildPageQAChain } from '../lib/langchain';
import { useAppVisible } from '../lib/utils';

export type AppState = PendingState | LoadingState | ReadyState | ErrorState;
export interface PendingState {
    status: 'pending';
}
export interface LoadingState {
    status: 'loading';
    page: PageEntity;
}
export interface ReadyState {
    status: 'ready';
    page: PageEntity;
    qaChain: RetrievalQAChain;
}
export interface ErrorState {
    status: 'error';
    page?: PageEntity | BlockEntity | null;
    qaChain?: RetrievalQAChain | null;
    error: Error;
}

export interface ChatMessage {
    query: string;
    prompt: string;
    temperature?: number;
    queryTimestamp: EpochTimeStamp;
    result?: string;
    anwserTimestamp?: EpochTimeStamp;
}

export type ChatState = ChatReadyState | ChatSuccessState | ChatErrorState;
export interface ChatReadyState {
    status: 'ready' | 'running';
}
export interface ChatSuccessState {
    status: 'success';
    result: string;
}
export interface ChatErrorState {
    status: 'error';
    error: Error;
}

const defaultAppState: AppState = {
    status: 'pending',
};
const defaultChatState: ChatState = {
    status: 'ready',
};

export const LogseqRAG = () => {
    const visible = useAppVisible();
    const [appState, updateAppState] = useImmer<AppState>(defaultAppState);
    const [chatState, updateChatState] = useImmer<ChatState>(defaultChatState);
    const [chatHistory, updateChatHistory] = useImmer<Array<ChatMessage>>([]);
    const [previousMessage, setPreviousMessage] = useState<ChatMessage | null>(null);
    const [query, setQuery] = useState('');
    
    const chatDisabled = appState.status !== 'ready' || chatState.status != 'ready' || !query;

    useEffect(() => {
        const preparePage = async () => {
            console.log("prepare")
            if (visible && appState.status == 'pending') {
                const currentPage = (await logseq.Editor.getCurrentPage()) as PageEntity;
                if (!currentPage) {
                    updateAppState({
                        status: 'error',
                        error: new Error('Page not set'),
                    });
                    return;
                }
                updateAppState({
                    status: 'loading',
                    page: currentPage,
                });
                const qaChain = await buildPageQAChain(currentPage);
                updateAppState({
                    status: 'ready',
                    page: currentPage,
                    qaChain: qaChain,
                });
            }
        };
        preparePage();
    }, [visible]);

    async function runChatMessage() {
        const chatMessage = {
            query,
            prompt: query,
            queryTimestamp: Date.now(),
            open: true,
        };
        setPreviousMessage(chatMessage);
        updateChatState((draft) => {
            draft.status = 'running';
        });
        updateChatHistory((draft) => {
            draft.push(chatMessage);
        });
        if (appState.status === 'ready') {
            const result = await appState.qaChain.call({ query });
            updateChatHistory((draft) => {
                if (result.text.length && draft.length) {
                    draft[draft.length - 1].result = result.text;
                    draft[draft.length - 1].anwserTimestamp = Date.now();
                }
            });
        }
    }

    // TODO Insert full chat history to page
    // const onInsertFullChat = async () => {
    // };

    // TODO Insert last chat message to page
    // const onInsert = async () => {
    //     const result = history[history.length - 1];
    //     if (appState.status == 'ready') {
    //         logseq.Editor.prependBlockInPage(appState.page.uuid, result);
    //     }
    //     logseq.hideMainUI({ restoreEditingCursor: true });
    // };

    const onClose = () => {
        setQuery('');
        updateChatHistory([]);
        updateAppState(defaultAppState);
        updateChatState(defaultChatState);
        logseq.hideMainUI({ restoreEditingCursor: true });
    };

    return (
        <Modal open={true} onClose={onClose} className="flex items-center justify-center">
            <div className="container bg-white max-w-3xl mx-auto rounded-lg shadow-2xl fixed p-4 ">
                <List
                    sx={{
                        width: '100%',
                        position: 'relative',
                        overflow: 'scroll',
                        'overflow-wrap': 'break-word',
                        'overflow-x': 'hidden',
                        'overflow-y': 'auto',
                        maxHeight: 500,
                    }}
                >
                    {chatHistory.map((item) => {
                        return (
                            <ListItem key={`item-${item.queryTimestamp}`} disablePadding={true}>
                                <ChatMessage
                                    query={item.query}
                                    result={item.result}
                                    queryTimestamp={item.queryTimestamp}
                                ></ChatMessage>
                            </ListItem>
                        );
                    })}
                </List>
                <Box className="flex items-center text-lg font-medium">
                    <TextField
                        id="logseq-rag-search"
                        className="p-5 text-white placeholder-white-200 w-full bg-transparent border-0 outline-none"
                        autoFocus={true}
                        placeholder="Ask a question about your page:"
                        onChange={(e) => {
                            setQuery(e.target.value);
                        }}
                        multiline={true}
                        value={query}
                    />
                    <Button disabled={chatDisabled} onClick={runChatMessage}>
                        Send
                    </Button>
                </Box>
            </div>
        </Modal>
    );
};
