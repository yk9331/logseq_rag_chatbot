'use client';

import React, { useEffect, useState } from 'react';
import { useImmer } from 'use-immer';
import { RunnableSequence } from '@langchain/core/runnables';
import { PageEntity } from '@logseq/libs/dist/LSPlugin';
import TextField from '@mui/material/TextField';
import Autocomplete from '@mui/material/Autocomplete';
import { Box, Checkbox, FormGroup, FormControlLabel, Typography, Button, Backdrop, Modal } from '@mui/material';

import { useAppVisible } from '../lib/utils';
import { LoadingMessage } from './components/LoadingMessage';
import { ChatMessageBubble } from './components/ChatMessageBubble';
import { IntermediateStep } from './components/IntermediateStep';
import { buildPageVectors, buildRagChatChain } from '../lib/langchain';

const CHAT_TITLE = '🤖 Logseq Chatbot';
const PLACEHOLDER = 'Ask me something about your Logseq page.';

export function LogseqRAG() {
    const visible = useAppVisible();
    const [pages, setPages] = useState<Array<PageEntity> | null>(null);
    const [selectedPage, setSelectedPage] = useImmer({
        page: null,
        includeLinkedPages: true,
        isLoading: false,
        isLoaded: false,
        error: null,
    });
    const [includedPages, setIncludedPages] = useState<Array<PageEntity> | null>(null);
    const [ragChain, setRagChain] = useState<RunnableSequence<any, string> | null>(null);
    const [query, setQuery] = useState('');
    const [isLoadingAnswer, setIsLoadingAnswer] = useState<boolean>(false);
    const [messages, updateMessages] = useImmer<Array<any>>([]);

    useEffect(() => {
        if (visible) {
            const getPages = async () => {
                const pages = await logseq.Editor.getAllPages();
                setPages(pages);
            };
            getPages();
        }
    }, [visible, setPages]);

    useEffect(() => {
        if (selectedPage.page && !selectedPage.isLoading && !selectedPage.isLoaded) {
            const build = async () => {
                try {
                    setSelectedPage((draft) => {
                        draft.isLoading = true;
                    });
                    const pages = await buildPageVectors(selectedPage.page.uuid, selectedPage.includeLinkedPages);
                    const chain = await buildRagChatChain(pages);
                    setIncludedPages(pages);
                    setRagChain(chain);
                    setSelectedPage((draft) => {
                        draft.isLoaded = true;
                        draft.isLoading = false;
                    });
                } catch (e) {
                    setSelectedPage((draft) => {
                        draft.error = e;
                    });
                }
            };
            build();
        }
    }, [selectedPage, setSelectedPage]);

    if (!pages) {
        return (
            <Backdrop sx={{ color: '#fff', zIndex: (theme) => theme.zIndex.drawer + 1 }} open={true}>
                <LoadingMessage />
            </Backdrop>
        );
    }

    async function sendMessage(e) {
        e.preventDefault();
        if (!ragChain || isLoadingAnswer) {
            return;
        }
        setIsLoadingAnswer(true);
        const messageLength = messages.length;
        const userMessage = { id: messageLength, content: query, role: 'user' };
        setQuery('');
        updateMessages((messages) => {
            messages.push(userMessage);
        });
        const systemMessage = { id: messageLength + 1, content: '', role: 'assistant' };
        updateMessages((messages) => {
            messages.push(systemMessage);
        });
        const output = {};
        let currentKey: string | null = null;
        for await (const chunk of await ragChain.stream(userMessage.content)) {
            for (const key of Object.keys(chunk)) {
                if (output[key] === undefined) {
                    output[key] = chunk[key];
                } else {
                    output[key] += chunk[key];
                }

                if (key !== currentKey) {
                    console.log(`\n\n${key}: ${JSON.stringify(chunk[key])}`);
                } else {
                    console.log(chunk[key]);
                }
                currentKey = key;
            }
            updateMessages((messages) => {
                messages[messageLength + 1].content =
                    output['answer'] === undefined ? 'Generating...' : output['answer'];
            });
            console.log(output);
        }
        setIsLoadingAnswer(false);
    }

    const onClose = () => {
        setQuery('');
        // updateChatHistory([]);
        // updateAppState(defaultAppState);
        // updateChatState(defaultChatState);
        updateMessages([]);
        logseq.hideMainUI({ restoreEditingCursor: true });
    };

    return (
        <Modal open={true} onClose={onClose} sx={{ height: '100vh', width: '100%', display: 'flex' }}>
            <Box
                display="flex"
                flexDirection="column"
                alignItems="start"
                overflow="auto"
                sx={{
                    bgcolor: 'white',
                    width: '660px',
                    margin: 'auto',
                    padding: '30px',
                    borderRadius: '10px',
                    marginY: '30px',
                }}
            >
                <Box>
                    {selectedPage.isLoading ? (
                        <Backdrop sx={{ color: '#fff', zIndex: (theme) => theme.zIndex.drawer + 1 }} open={true}>
                            <LoadingMessage />
                        </Backdrop>
                    ) : (
                        ''
                    )}
                    {/* TODO: add error alert */}
                </Box>

                <Typography variant="h5" marginBottom={2}>
                    {CHAT_TITLE}
                </Typography>
                {/* Page Selector */}
                <Box display="flex" flexDirection="column">
                    <Autocomplete
                        id="page-selector"
                        sx={{ margin: 'auto', width: '600px' }}
                        options={pages.filter((p) => !p['journal?']).sort((a, b) => b.updatedAt - a.updatedAt)}
                        getOptionLabel={(option) => option.originalName}
                        value={selectedPage.page}
                        onChange={(event: any, page: PageEntity | null) => {
                            setSelectedPage((draft) => {
                                draft.page = page;
                                draft.isLoaded = false;
                                draft.error = false;
                            });
                        }}
                        renderInput={(params) => (
                            <TextField {...params} label="Select the page you want to chat with" />
                        )}
                    />
                </Box>
                {/* Chat Options */}
                <Box display="flex" flexDirection="row" marginBottom={2}>
                    <FormGroup>
                        <FormControlLabel
                            control={
                                <Checkbox
                                    id="include_linked_pages"
                                    checked={selectedPage.includeLinkedPages}
                                    onChange={(e) =>
                                        setSelectedPage((draft) => {
                                            draft.includeLinkedPages = e.target.checked;
                                            draft.isLoaded = false;
                                        })
                                    }
                                    inputProps={{ 'aria-label': 'controlled' }}
                                />
                            }
                            label="Include Linked Pages"
                        />
                    </FormGroup>
                </Box>
                <Box
                    display="flex"
                    flexDirection="column-reverse"
                    width="600px"
                    minHeight="460px"
                    maxHeight="460px"
                    overflow="auto"
                    marginBottom={2}
                    border={1}
                    borderRadius={1}
                    justifyContent="flex-start"
                    // ref={messageContainerRef}
                >
                    {messages.length > 0
                        ? [...messages].reverse().map((m) => {
                              return m.role === 'system' ? (
                                  <IntermediateStep key={m.id} message={m}></IntermediateStep>
                              ) : (
                                  <ChatMessageBubble key={m.id} message={m}></ChatMessageBubble>
                              );
                          })
                        : ''}
                </Box>
                {/* Chat Inputs */}
                <Box component="form" display="flex" flexDirection="row">
                    <TextField
                        required
                        multiline
                        fullWidth
                        id="chat-input"
                        rows={2}
                        label={PLACEHOLDER}
                        value={query}
                        onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                            setQuery(event.target.value);
                        }}
                        sx={{ margin: 'auto', width: '500px' }}
                    />
                    <Button
                        variant="outlined"
                        sx={{ width: '90px', marginLeft: '10px' }}
                        disabled={!selectedPage.isLoaded || !ragChain || isLoadingAnswer}
                        onClick={sendMessage}
                    >
                        Send
                    </Button>
                </Box>
                {/* <ToastContainer /> */}
            </Box>
        </Modal>
    );
}
