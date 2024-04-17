import { PropsWithChildren } from 'react';
import Stack from '@mui/material/Stack';
import Card from '@mui/material/Card';
import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import moment from 'moment';

export const ChatMessage = ({
    query,
    result,
    queryTimestamp,
}: PropsWithChildren<{ query: string; result?: string; queryTimestamp: EpochTimeStamp }>) => {
    return (
        <Card variant="outlined" className="w-full my-2 mr-4 px-2">
            <Stack spacing={1} className="py-4">
                <Box className="px-2 text-xl ">{query}</Box>
                <Box className="px-2 text-xs text-slate-800">
                    {moment.utc(queryTimestamp).local().format('YYYY-MM-DD hh:mm:ss')}
                </Box>
                <Divider />
                <Box className="px-2 text-base">{result ? result : 'Generating...'}</Box>
            </Stack>
        </Card>
    );
};
