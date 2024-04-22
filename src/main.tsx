import '@logseq/libs';
import React from 'react';
import ReactDOM from 'react-dom/client';
import CssBaseline from '@mui/material/CssBaseline';

import './ui/style.css';
import { settingsSchema } from './lib/setting';
import { LogseqRAG } from './ui/LogseqRAG';

function createModel() {
    return { openRag };
}

async function openRag() {
    logseq.showMainUI({ autoFocus: true });
};

async function main() {
    logseq.setMainUIInlineStyle({
        position: 'fixed',
        zIndex: 11,
    });

    if (logseq.settings!.ragChatShortcut) {
        logseq.App.registerCommandShortcut(
            {
                binding: logseq.settings!.ragChatShortcut,
            },
            openRag,
        );
    }

    // Toolbar Btn
    logseq.App.registerUIItem('toolbar', {
        key: 'open-rag',
        template: '<a data-on-click="openRag" class="button"><div style="font-size:16px;">💬</div></a>',
    });

    // Main UI
    const root = ReactDOM.createRoot(document.getElementById('app')!);
    root.render(
        <React.StrictMode>
            <CssBaseline />
            <LogseqRAG />
        </React.StrictMode>,
    );
}

logseq.useSettingsSchema(settingsSchema);
logseq.ready(createModel()).then(main).catch(console.error);
