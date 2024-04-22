import { SettingSchemaDesc } from '@logseq/libs/dist/LSPlugin';
import { OpenAIOptions } from './langchain';

interface PluginOptions extends OpenAIOptions {
    injectPrefix?: string;
    supabaseServiceKey?: string
}

export const settingsSchema: SettingSchemaDesc[] = [
    {
        key: 'supabaseServiceKey',
        type: 'string',
        default: '',
        title: 'Supabase Service Key',
        description: '',
    },
    {
        key: 'openAIKey',
        type: 'string',
        default: '',
        title: 'OpenAI API Key',
        description: 'Your OpenAI API key. You can get one at https://beta.openai.com',
    },
    {
        key: 'openAICompletionEngine',
        type: 'string',
        default: 'gpt-3.5-turbo',
        title: 'OpenAI Completion Engine',
        description: 'See Engines in OpenAI docs.',
    },
    {
        key: 'chatCompletionEndpoint',
        type: 'string',
        default: 'http://api.openai.com/v1',
        title: 'OpenAI API Completion Endpoint',
        description: "The endpoint to use for OpenAI API completion requests. You shouldn't need to change this.",
    },
    {
        key: 'chatPrompt',
        type: 'string',
        default: 'Do not refer to yourself in your answers. Do not say as an AI language model...',
        title: 'OpenAI Chat Prompt',
        description:
            'Initial message that tells ChatGPT how to answer. Only used for gpt-3.5. See https://platform.openai.com/docs/guides/chat/introduction for more info.',
    },
    {
        key: 'openAITemperature',
        type: 'number',
        default: 1.0,
        title: 'OpenAI Temperature',
        description:
            'The temperature controls how much randomness is in the output.<br/>' +
            "You can set a different temperature in your own prompt templates by adding a 'prompt-template' property to the block.",
    },
    {
        key: 'openAIMaxTokens',
        type: 'number',
        default: 1000,
        title: 'OpenAI Max Tokens',
        description:
            "The maximum amount of tokens to generate. Tokens can be words or just chunks of characters. The number of tokens processed in a given API request depends on the length of both your inputs and outputs. As a rough rule of thumb, 1 token is approximately 4 characters or 0.75 words for English text. One limitation to keep in mind is that your text prompt and generated completion combined must be no more than the model's maximum context length (for most models this is 2048 tokens, or about 1500 words).",
    },
    {
        key: 'ragChatShortcut',
        type: 'string',
        default: 'mod+r mod+e',
        title: 'Keyboard Shortcut for /rag popup',
        description: '',
    },
];

export function getOpenaiSettings(): PluginOptions {
    const supabaseServiceKey = logseq.settings!['supabaseServiceKey'];
    const apiKey = logseq.settings!['openAIKey'];
    const completionEngine = logseq.settings!['openAICompletionEngine'];
    const temperature = Number.parseFloat(logseq.settings!['openAITemperature']);
    const maxTokens = Number.parseInt(logseq.settings!['openAIMaxTokens']);
    const chatPrompt = logseq.settings!['chatPrompt'];
    const completionEndpoint = logseq.settings!['chatCompletionEndpoint'];
    return {
        supabaseServiceKey,
        apiKey,
        completionEngine,
        completionEndpoint,
        chatPrompt,
        temperature,
        maxTokens,
    };
}
