import React from 'react';
import { Box, Typography } from '@mui/material';

export function ChatMessageBubble(props: { message: any }) {
    const { role } = props.message;
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
                <Typography variant='body1'>{props.message.content}</Typography>
                {/* {props.sources && props.sources.length ? (
                    <>
                        <code className="mt-4 mr-auto bg-slate-600 px-2 py-1 rounded">
                            <h2>🔍 Sources:</h2>
                        </code>
                        <code className="mt-1 mr-2 bg-slate-600 px-2 py-1 rounded text-xs">
                            {props.sources?.map((source, i) => (
                                <div className="mt-2" key={'source:' + i}>
                                    {i + 1}. &quot;{source.pageContent}&quot;
                                    {source.metadata?.loc?.lines !== undefined ? (
                                        <div>
                                            <br />
                                            Lines {source.metadata?.loc?.lines?.from} to{' '}
                                            {source.metadata?.loc?.lines?.to}
                                        </div>
                                    ) : (
                                        ''
                                    )}
                                </div>
                            ))}
                        </code>
                    </>
                ) : (
                    ''
                )} */}
            </Box>
        </Box>
    );
}
