import React from 'react';
import '@logseq/libs';
import { Box, Button, Typography } from '@mui/material';

export function ChatMessageBubble(props: { message: any }) {
    const { role, content, citations, docs } = props.message;
    const bgColor = role === 'user' ? '#87CEFA' : '#DCDCDC';
    const alignment = role === 'user' ? 'flex-end' : 'flex-start';
    const prefix = role === 'user' ? '🧑' : '🤖';
    return (
        <Box
            sx={{
                display: 'flex',
                bgcolor: bgColor,
                paddingX: '4px',
                paddingY: '2px',
                maxWidth: '80%',
                borderRadius: '5px',
                marginBottom: '8px',
                marginX: '8px',
                alignSelf: alignment,
            }}
        >
            <Box marginRight={2}>{prefix}</Box>
            <Box sx={{ display: 'flex', flexDirection: 'column', 'white-space': 'pre-wrap' }}>
                <Typography variant="body1">{content}</Typography>
                {citations && citations.length ? (
                    <Box
                        sx={{ display: 'flex', flexDirection: 'column', 'white-space': 'pre-wrap', marginTop: '10px' }}
                    >
                        <Typography variant="subtitle2">🔍 Sources:</Typography>
                        <Box
                            sx={{
                                display: 'flex',
                                flexDirection: 'column',
                                'white-space': 'pre-wrap',
                                marginX: '10px',
                            }}
                        >
                            {citations.map((source, i) => {
                                const doc = docs[source];
                                return (
                                    <Button
                                        key={'source:' + i}
                                        onClick={async (e) => {
                                            const page = await logseq.Editor.getPage(doc.metadata.page_id);
                                            logseq.Editor.scrollToBlockInPage(page.name, doc.metadata.block_id);
                                            logseq.hideMainUI();
                                        }}
                                        sx={{
                                            textTransform: 'none',
                                            textAlign: 'left',
                                        }}
                                    >
                                        <Typography
                                            variant="caption"
                                            maxHeight="3em"
                                            overflow="hidden"
                                            textOverflow="ellipsis"
                                        >
                                            [{i + 1}].{doc.pageContent.substring(0, 120)}...
                                        </Typography>
                                    </Button>
                                );
                            })}
                        </Box>
                    </Box>
                ) : (
                    ''
                )}
            </Box>
        </Box>
    );
}
