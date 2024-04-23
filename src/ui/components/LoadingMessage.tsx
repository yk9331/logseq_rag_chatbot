import React from 'react';
import { Box, CircularProgress } from '@mui/material';

export function LoadingMessage() {
    return (
        <Box display="flex" flexDirection="row" justifyContent="center" alignItems="center">
            <CircularProgress color="inherit" />
            <Box display="flex" flexDirection="column" alignItems="center" justifyContent="center" padding={4}>
                loading...
            </Box>
        </Box>
    );
}
