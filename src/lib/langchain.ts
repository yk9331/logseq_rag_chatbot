import '@logseq/libs';
import { OpenAI } from 'openai';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import { ChatOpenAI } from '@langchain/openai';
import { RetrievalQAChain } from 'langchain/chains';
import { createClient } from '@supabase/supabase-js';
import { SupabaseVectorStore } from '@langchain/community/vectorstores/supabase';
import { OpenAIEmbeddings } from '@langchain/openai';
import { backOff } from 'exponential-backoff';
import { PageEntity } from '@logseq/libs/dist/LSPlugin';
import { getPageContent } from './logseq';
import { getOpenaiSettings } from './setting';

export interface OpenAIOptions {
    apiKey: string;
    completionEngine?: string;
    temperature?: number;
    maxTokens?: number;
    chatPrompt?: string;
    completionEndpoint?: string;
}

const OpenAIDefaults = (apiKey: string): OpenAIOptions => ({
    apiKey,
    completionEngine: 'gpt-3.5-turbo',
    temperature: 1.0,
    maxTokens: 1000,
});

const CHUNK_SIZE = 1000;
const CHUNK_OVERLAP = 200;

const retryOptions = {
    numOfAttempts: 7,
    retry: (err: any) => {
        if (err instanceof TypeError && err.message === 'Failed to fetch') {
            // Handle the TypeError: Failed to fetch error
            console.warn('retrying due to network error', err);
            return true;
        }

        if (!err.response || !err.response.data || !err.response.data.error) {
            return false;
        }
        if (err.response.status === 429) {
            const errorType = err.response.data.error.type;
            if (errorType === 'insufficient_quota') {
                return false;
            }
            console.warn('Rate limit exceeded. Retrying...');
            return true;
        }
        if (err.response.status >= 500) {
            return true;
        }

        return false;
    },
};

export async function buildPageQAChain(page: PageEntity): Promise<RetrievalQAChain> {
    const openAISettings = getOpenaiSettings();
    
    const { ids, blockContents } = await getPageContent(page.id);
    const blockMetadatas = ids.map((blockId: string) => {
        return {
            block_id: blockId,
            page_id: page.uuid,
        };
    });
    const splitter = RecursiveCharacterTextSplitter.fromLanguage('markdown', {
        chunkSize: CHUNK_SIZE,
        chunkOverlap: CHUNK_OVERLAP,
    });
    const docs = await splitter.createDocuments(blockContents, blockMetadatas);

    const client = createClient('http://127.0.0.1:8000', openAISettings.supabaseServiceKey!);
    const vectorstore = await SupabaseVectorStore.fromDocuments(docs, new OpenAIEmbeddings({apiKey:openAISettings.apiKey}), {
        client,
        tableName: 'documents',
        queryName: 'match_documents',
    });
    const llm = new ChatOpenAI({
        apiKey: openAISettings.apiKey,
        model: openAISettings.completionEngine,
        temperature: openAISettings.temperature,
    });
    const qaChain = RetrievalQAChain.fromLLM(llm, vectorstore.asRetriever());
    return qaChain;
}

export async function openAIWithStream(
    input: string,
    openAiOptions: OpenAIOptions,
    onContent: (content: string) => void,
    onStop: () => void,
): Promise<string | null> {
    const options = { ...OpenAIDefaults(openAiOptions.apiKey), ...openAiOptions };
    const engine = options.completionEngine!;

    try {
        if (engine.startsWith('gpt-3.5') || engine.startsWith('gpt-4')) {
            const inputMessages: OpenAI.Chat.CreateChatCompletionRequestMessage[] = [{ role: 'user', content: input }];
            if (openAiOptions.chatPrompt && openAiOptions.chatPrompt.length > 0) {
                inputMessages.unshift({ role: 'system', content: openAiOptions.chatPrompt });
            }
            const body = {
                messages: inputMessages,
                temperature: options.temperature,
                max_tokens: options.maxTokens,
                top_p: 1,
                frequency_penalty: 0,
                presence_penalty: 0,
                model: engine,
                stream: true,
            };
            const response = await backOff(
                () =>
                    fetch(`${options.completionEndpoint}/chat/completions`, {
                        method: 'POST',
                        body: JSON.stringify(body),
                        headers: {
                            Authorization: `Bearer ${options.apiKey}`,
                            'Content-Type': 'application/json',
                            Accept: 'text/event-stream',
                        },
                    }).then((response) => {
                        if (response.ok && response.body) {
                            const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
                            let result = '';
                            const readStream = (): any =>
                                reader.read().then(({ value, done }) => {
                                    if (done) {
                                        reader.cancel();
                                        onStop();
                                        return Promise.resolve({ choices: [{ message: { content: result } }] });
                                    }

                                    const data = getDataFromStreamValue(value);
                                    if (!data || !data[0]) {
                                        return readStream();
                                    }

                                    let res = '';
                                    for (let i = 0; i < data.length; i++) {
                                        res += data[i].choices[0]?.delta?.content || '';
                                    }
                                    result += res;
                                    onContent(res);
                                    return readStream();
                                });
                            return readStream();
                        } else {
                            return Promise.reject(response);
                        }
                    }),
                retryOptions,
            );
            const choices = (response as OpenAI.Chat.Completions.ChatCompletion)?.choices;
            if (
                choices &&
                choices[0] &&
                choices[0].message &&
                choices[0].message.content &&
                choices[0].message.content.length > 0
            ) {
                return trimLeadingWhitespace(choices[0].message.content);
            } else {
                return null;
            }
        } else {
            const body = {
                prompt: input,
                temperature: options.temperature,
                max_tokens: options.maxTokens,
                top_p: 1,
                frequency_penalty: 0,
                presence_penalty: 0,
                model: engine,
                stream: true,
            };
            const response = await backOff(
                () =>
                    fetch(`${options.completionEndpoint}/completions`, {
                        method: 'POST',
                        body: JSON.stringify(body),
                        headers: {
                            Authorization: `Bearer ${options.apiKey}`,
                            'Content-Type': 'application/json',
                            Accept: 'text/event-stream',
                        },
                    }).then((response) => {
                        if (response.ok && response.body) {
                            const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
                            let result = '';
                            const readStream = (): any =>
                                reader.read().then(({ value, done }) => {
                                    if (done) {
                                        reader.cancel();
                                        onStop();
                                        return Promise.resolve({ choices: [{ text: result }] });
                                    }

                                    const data = getDataFromStreamValue(value);
                                    if (!data || !data[0]) {
                                        return readStream();
                                    }

                                    let res = '';
                                    for (let i = 0; i < data.length; i++) {
                                        res += data[i].choices[0]?.text || '';
                                    }
                                    result += res;
                                    onContent(res);
                                    return readStream();
                                });
                            return readStream();
                        } else {
                            return Promise.reject(response);
                        }
                    }),
                retryOptions,
            );
            const choices = (response as OpenAI.Completion)?.choices;
            if (choices && choices[0] && choices[0].text && choices[0].text.length > 0) {
                return trimLeadingWhitespace(choices[0].text);
            } else {
                return null;
            }
        }
    } catch (e: any) {
        if (e?.response?.data?.error) {
            console.error(e?.response?.data?.error);
            throw new Error(e?.response?.data?.error?.message);
        } else {
            throw e;
        }
    }
}

function getDataFromStreamValue(value: string) {
    const matches = [...value.split('data:')];
    return matches
        .filter((content) => content.trim().length > 0 && !content.trim().includes('[DONE]'))
        .map((match) => {
            try {
                return JSON.parse(match);
            } catch (e) {
                return null;
            }
        });
}

function trimLeadingWhitespace(s: string): string {
    return s.replace(/^\s+/, '');
}
