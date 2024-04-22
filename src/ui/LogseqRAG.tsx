'use client';

import React, { useEffect, useState } from 'react';
import { PageEntity } from '@logseq/libs/dist/LSPlugin';
import TextField from '@mui/material/TextField';
import Autocomplete from '@mui/material/Autocomplete';
import { Box, Checkbox, FormGroup, FormControlLabel, Typography, Button, Backdrop, Modal } from '@mui/material';

import { useAppVisible } from '../lib/utils';
import { PageUploader } from './components/PageUploader';
import { LoadingMessage } from './components/LoadingMessage';

const CHAT_EMOJI = '🤖';
const CHAT_TITLE = 'Logseq Chatbot';
const PLACEHOLDER = 'Ask me something about your Logseq page.';

export function LogseqRAG() {
    const visible = useAppVisible();
    const [pages, setPages] = useState<Array<PageEntity> | null>(null);
    const [selectedPage, setSelectedPage] = useState<PageEntity | null>(null);
    const [includeLinkedPages, setIncludeLinkedPages] = useState(true);
    const [selectedPageLoaded, setSelectedPageLoaded] = useState(false);
    const [includedPages, setIncludedPages] = useState<Array<PageEntity> | null>(null);
    const [query, setQuery] = useState('');

    useEffect(() => {
        if (visible) {
            const getPages = async () => {
                const pages = await logseq.Editor.getAllPages();
                setPages(pages);
            };
            getPages();
        }
    }, [visible, setPages]);

    if (!pages) {
        return (
            <Backdrop sx={{ color: '#fff', zIndex: (theme) => theme.zIndex.drawer + 1 }} open={true}>
                <LoadingMessage />
            </Backdrop>
        );
    }

    async function sendMessage(e) {
        e.preventDefault();
    }

    const onClose = () => {
        setSelectedPage(null);
        setQuery('');
        // updateChatHistory([]);
        // updateAppState(defaultAppState);
        // updateChatState(defaultChatState);
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
                <Typography variant="h5" marginBottom={2}>
                    {CHAT_EMOJI} {CHAT_TITLE}
                </Typography>
                {/* Page Selector */}
                <Box display="flex" flexDirection="column" marginBottom={2}>
                    <Autocomplete
                        id="page-selector"
                        sx={{ margin: 'auto', width: '600px' }}
                        options={pages.filter((p) => !p['journal?']).sort((a, b) => b.updatedAt - a.updatedAt)}
                        getOptionLabel={(option) => option.originalName}
                        value={selectedPage}
                        onChange={(event: any, page: PageEntity | null) => {
                            setSelectedPage(page);
                            setSelectedPageLoaded(false);
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
                                    checked={includeLinkedPages}
                                    onChange={(e) => setIncludeLinkedPages(e.target.checked)}
                                    inputProps={{ 'aria-label': 'controlled' }}
                                />
                            }
                            label="Include Linked Pages"
                        />
                    </FormGroup>
                </Box>
                {/* Page Loader Backdrop */}
                {selectedPage && !selectedPageLoaded ? (
                    <PageUploader
                        pageUUID={selectedPage?.uuid}
                        includeLinkedPages={includeLinkedPages}
                        setSelectedPageLoaded={setSelectedPageLoaded}
                        setIncludedPages={setIncludedPages}
                    />
                ) : (
                    ''
                )}
                {/* Chat Messages */}
                <Box
                    display="flex"
                    flexDirection="column-reverse"
                    width="600px"
                    minHeight="500px"
                    maxHeight="500px"
                    overflow="auto"
                    marginBottom={2}
                    border={1}
                    borderRadius={1}
                    // ref={messageContainerRef}
                >
                    {/* {messages.length > 0
                        ? [...messages].reverse().map((m, i) => {
                              const sourceKey = (messages.length - 1 - i).toString();
                              return m.role === 'system' ? (
                                  <IntermediateStep key={m.id} message={m}></IntermediateStep>
                              ) : (
                                  <ChatMessageBubble
                                      key={m.id}
                                      message={m}
                                      aiEmoji={CHAT_EMOJI}
                                      sources={sourcesForMessages[sourceKey]}
                                  ></ChatMessageBubble>
                              );
                          })
                        : ''} */}
                </Box>
                {/* Chat Inputs */}
                <Box component="form" display="flex" flexDirection="row">
                    <TextField
                        required
                        multiline
                        fullWidth
                        id="chat-input"
                        rows={3}
                        label={PLACEHOLDER}
                        value={query}
                        // onChange={handleInputChange}
                        sx={{ margin: 'auto', width: '500px' }}
                    />
                    <Button
                        variant="outlined"
                        sx={{ width: '90px', marginLeft: '10px' }}
                        // disabled={chatEndpointIsLoading || intermediateStepsLoading}
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
