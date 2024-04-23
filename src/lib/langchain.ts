import '@logseq/libs';
import { OpenAI } from 'openai';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import { ChatOpenAI } from '@langchain/openai';
import { PromptTemplate } from '@langchain/core/prompts';
import { createClient } from '@supabase/supabase-js';
import { SupabaseFilterRPCCall, SupabaseVectorStore } from '@langchain/community/vectorstores/supabase';
import { OpenAIEmbeddings } from '@langchain/openai';
import { backOff } from 'exponential-backoff';
import { PageEntity } from '@logseq/libs/dist/LSPlugin';
import { getPageContents } from './logseq';
import { getPluginSettings } from './setting';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { RunnablePassthrough, RunnableSequence } from '@langchain/core/runnables';
import { formatDocumentsAsString } from 'langchain/util/document';

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
const template = `Use the following pieces of context to answer the question at the end.
If you don't know the answer, just say that you don't know, don't try to make up an answer.
Use three sentences maximum and keep the answer as concise as possible.
Always say "thanks for asking!" at the end of the answer.

{context}

Question: {question}

Helpful Answer:`;
const customRagPrompt = PromptTemplate.fromTemplate(template);

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

async function initSupabaseVectorstore(): Promise<SupabaseVectorStore> {
    const settings = getPluginSettings();
    const client = createClient(settings.supabaseProjectUrl!, settings.supabaseServiceKey!);
    const embedding = new OpenAIEmbeddings({ apiKey: settings.apiKey });
    const vectorstore = await SupabaseVectorStore.fromExistingIndex(embedding, {
        client,
        tableName: 'documents',
        queryName: 'match_documents',
    });

    return vectorstore;
}

function buildRPCPageFilter(pages: Array<PageEntity>): SupabaseFilterRPCCall {
    const pageIds = pages.map((p) => p.uuid);
    const funcFilter: SupabaseFilterRPCCall = (rpc) => rpc.in('metadata->>page_id', pageIds);
    return funcFilter;
}

export async function buildPageVectors(uuid: string, includeLinkedPages: boolean): Promise<Array<PageEntity>> {
    const contents = await getPageContents(uuid, includeLinkedPages);

    const docs = [];
    const splitter = RecursiveCharacterTextSplitter.fromLanguage('markdown', {
        chunkSize: CHUNK_SIZE,
        chunkOverlap: CHUNK_OVERLAP,
    });
    for (const { page, ids, blockContents } of contents) {
        const blockMetadatas = ids.map((blockId: string) => {
            return {
                block_id: blockId,
                page_id: page.uuid,
            };
        });
        const splittedBlocks = await splitter.createDocuments(blockContents, blockMetadatas);
        docs.push(...splittedBlocks);
    }

    // TODO: check page updatedTime
    // if ( > vectorstore page.updatedTime) {delete and recreate page}
    const vectorstore = await initSupabaseVectorstore();
    await vectorstore.addDocuments(docs);

    return contents.map((p) => p.page);
}

export async function buildRagChatChain(includedPages: Array<PageEntity>): Promise<RunnableSequence<any, string>> {
    const settings = getPluginSettings();
    const vectorstore = await initSupabaseVectorstore();
    const retriever = await vectorstore.asRetriever(6, buildRPCPageFilter(includedPages));

    const llm = new ChatOpenAI({
        model: settings.completionEngine,
        temperature: settings.temperature,
        apiKey: settings.apiKey,
    });
    const ragChain = RunnableSequence.from([
        {
            context: retriever.pipe(formatDocumentsAsString),
            question: new RunnablePassthrough(),
        },
        customRagPrompt,
        llm,
        new StringOutputParser(),
    ]);
    return ragChain;
}
