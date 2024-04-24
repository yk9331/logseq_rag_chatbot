import '@logseq/libs';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import { ChatOpenAI } from '@langchain/openai';
import { SupabaseClient, createClient } from '@supabase/supabase-js';
import { SupabaseFilterRPCCall, SupabaseVectorStore } from '@langchain/community/vectorstores/supabase';
import { OpenAIEmbeddings } from '@langchain/openai';
import { PageEntity } from '@logseq/libs/dist/LSPlugin';
import { getPageContents } from './logseq';
import { getPluginSettings } from './setting';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { RunnablePassthrough, Runnable, RunnableMap} from '@langchain/core/runnables';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { LangChainTracer } from '@langchain/core/tracers/tracer_langchain';
import { Client } from 'langsmith';

const LANGSMITH_PROJECT_NAME = 'logseq-rag';
const CHUNK_SIZE = 1000;
const CHUNK_OVERLAP = 200;

let supabaseCilent: SupabaseClient | null = null;

const systemPrompt = `You're a helpful AI assistant. Given a user question and contents with source ID in square brackets, answer the user question  base on provided contents with following rules:
1. Only answer with the contents provided. If none of the content answer the question, just say you don't know.
2. Use three sentences maximum and keep the answer as concise as possible.
3. Add source id in [id] format of which's contnet justify the sentence most after the period to each sentence in answer.

Here are the contents:
{context}`;

const prompt = ChatPromptTemplate.fromMessages([
    ['system', systemPrompt],
    ['human', '{question}'],
]);

function formatContextWithId(docs: Array<Document>): string {
    return docs.map((doc: Document, idx: number) => `[${idx}]\n${doc.pageContent}`).join('\n\n');
}

function createLangSmithCallback(apiUrl: string, apiKey: string) {
    return new LangChainTracer({
        projectName: LANGSMITH_PROJECT_NAME,
        client: new Client({ apiUrl, apiKey }),
    });
}

function getSupabaseClient(): SupabaseClient {
    if (supabaseCilent) {
        return supabaseCilent;
    }
    const settings = getPluginSettings();
    supabaseCilent = createClient(settings.supabaseProjectUrl!, settings.supabaseServiceKey!);
    return supabaseCilent;
}

async function initSupabaseVectorstore(): Promise<SupabaseVectorStore> {
    const settings = getPluginSettings();
    const supabase = getSupabaseClient();
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

    const client = getSupabaseClient();

    const { data, error } = await client.from('pages').select().in('uuid', pageIds);
    const pageUpdatedAt = data?.reduce((obj, p) => Object.assign(obj, { [p.uuid]: p.updated_at }), {});
    const updatedContent = contents.filter(
        (c) => pageUpdatedAt[c.page.uuid] === undefined || c.page.updatedAt > pageUpdatedAt[c.page.uuid],
    );
    const updatedIds = updatedContent.map((c) => c.page.uuid);
    await client.from('documents').delete().in('metadata->>page_id', updatedIds);

    const docs = [];
    const splitter = new RecursiveCharacterTextSplitter({
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

    const vectorstore = await initSupabaseVectorstore();
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

export async function buildRagChatChain(includedPages: Array<PageEntity>): Promise<Runnable<any, any, any>> {
    const settings = getPluginSettings();
    const vectorstore = await initSupabaseVectorstore();
    const retriever = await vectorstore.asRetriever(6, buildRPCPageFilter(includedPages));
    const callbacks =
        settings.langsmithAPIKey && settings.langsmithAPIUrl
            ? [createLangSmithCallback(settings.langsmithAPIUrl, settings.langsmithAPIKey)]
            : [];
    const llm = new ChatOpenAI({
        model: settings.completionEngine,
        temperature: settings.temperature,
        apiKey: settings.apiKey,
        callbacks: callbacks,
    });

    const answerChain = prompt
        .pipe(llm)
        .pipe(new StringOutputParser())
    const ragMap = RunnableMap.from({
        question: new RunnablePassthrough(),
        docs: retriever,
    });
    const ragChain = ragMap
        .assign({
            context: (input: { docs: Array<Document> }) => formatContextWithId(input.docs),
        })
        .assign({ answer: answerChain })
        .pick(['question', 'docs', 'answer']);

    return ragChain;
}
