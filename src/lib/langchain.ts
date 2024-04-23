import '@logseq/libs';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import { ChatOpenAI } from '@langchain/openai';
import { PromptTemplate } from '@langchain/core/prompts';
import { SupabaseClient, createClient } from '@supabase/supabase-js';
import { SupabaseFilterRPCCall, SupabaseVectorStore } from '@langchain/community/vectorstores/supabase';
import { OpenAIEmbeddings } from '@langchain/openai';
import { PageEntity } from '@logseq/libs/dist/LSPlugin';
import { getPageContents } from './logseq';
import { getPluginSettings } from './setting';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { RunnablePassthrough, RunnableSequence, RunnableMap } from '@langchain/core/runnables';
import { formatDocumentsAsString } from 'langchain/util/document';

export interface OpenAIOptions {
    apiKey: string;
    completionEngine?: string;
    temperature?: number;
    maxTokens?: number;
    chatPrompt?: string;
    completionEndpoint?: string;
}

const CHUNK_SIZE = 1000;
const CHUNK_OVERLAP = 200;

const TEMPLATE = `Use the following pieces of context to answer the question at the end.
If you don't know the answer, just say that you don't know, don't try to make up an answer.
Use three sentences maximum and keep the answer as concise as possible.

{context}

Question: {question}

Helpful Answer:`;

const customRagPrompt = PromptTemplate.fromTemplate(TEMPLATE);

async function initSupabaseVectorstore(client?: SupabaseClient): Promise<SupabaseVectorStore> {
    const settings = getPluginSettings();
    const supabase = client !==undefined ? client : createClient(settings.supabaseProjectUrl!, settings.supabaseServiceKey!)

    const embedding = new OpenAIEmbeddings({ apiKey: settings.apiKey });
    const vectorstore = await SupabaseVectorStore.fromExistingIndex(embedding, {
        client: supabase,
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
    const pageIds = contents.map((c) => c.page.uuid);
    
    const settings = getPluginSettings();
    const client = createClient(settings.supabaseProjectUrl!, settings.supabaseServiceKey!);
    
    const { data, error } = await client.from('pages').select().in('uuid', pageIds);
    const pageUpdatedAt = data?.reduce((obj, p) => Object.assign(obj, { [p.uuid]: p.updated_at }), {});
    const updatedContent = contents.filter((c) => pageUpdatedAt[c.page.uuid] === undefined || c.page.updatedAt > pageUpdatedAt[c.page.uuid]);
    const updatedIds = updatedContent.map((c) => c.page.uuid);
    await client.from('documents').delete().in('metadata->>page_id', updatedIds);

    const docs = [];
    const splitter = RecursiveCharacterTextSplitter.fromLanguage('markdown', {
        chunkSize: CHUNK_SIZE,
        chunkOverlap: CHUNK_OVERLAP,
    });
    for (const { page, ids, blockContents } of updatedContent) {
        const blockMetadatas = ids.map((blockId: string) => {
            return {
                block_id: blockId,
                page_id: page.uuid,
            };
        });
        const splittedBlocks = await splitter.createDocuments(blockContents, blockMetadatas);
        docs.push(...splittedBlocks);
    }

    const vectorstore = await initSupabaseVectorstore(client);
    await vectorstore.addDocuments(docs);
    await client.from('pages').upsert(
        contents.map((c) => {
            const { page } = c;
            return {
                uuid: page.uuid,
                id: page.id,
                updated_at: page.updatedAt,
                name: page.name,
                original_name: page.originalName,
            };
        }),
    );

    return contents.map((p) => p.page);
}

export async function buildRagChatChain(includedPages: Array<PageEntity>): Promise<RunnableMap<any, any>> {
    const settings = getPluginSettings();
    const vectorstore = await initSupabaseVectorstore();
    const retriever = await vectorstore.asRetriever(undefined, buildRPCPageFilter(includedPages));

    const llm = new ChatOpenAI({
        model: settings.completionEngine,
        temperature: settings.temperature,
        apiKey: settings.apiKey,
    });
    const ragChainFromDocs = RunnableSequence.from([
        RunnablePassthrough.assign({
            context: (input) => formatDocumentsAsString(input.context),
        }),
        customRagPrompt,
        llm,
        new StringOutputParser(),
    ]);

    const ragChainWithSource = new RunnableMap({
        steps: { context: retriever, question: new RunnablePassthrough() },
    });
    return ragChainWithSource.assign({ answer: ragChainFromDocs });
}
