import { Box, CircularProgress, Typography } from '@mui/material';

export function LogseqErrorMessage(props: { error: any }) {
    return (
        <Box textAlign={'center'}>
            <div>{props?.error?.message}</div>
            <div>Check if your Logseq API Server run correctly. </div>
        </Box>
    );
}
