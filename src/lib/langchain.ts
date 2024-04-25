import '@logseq/libs';
import { PageEntity } from '@logseq/libs/dist/LSPlugin';
import { z } from 'zod';
import { Client } from 'langsmith';
import { LangChainTracer } from '@langchain/core/tracers/tracer_langchain';
import { SupabaseClient, createClient } from '@supabase/supabase-js';
import { SupabaseFilterRPCCall, SupabaseVectorStore } from '@langchain/community/vectorstores/supabase';
import { StructuredTool } from '@langchain/core/tools';
import { ChatOpenAI, formatToOpenAITool, OpenAIEmbeddings } from '@langchain/openai';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import { RunnablePassthrough, Runnable, RunnableBranch, RunnableSequence } from '@langchain/core/runnables';
import { ChatPromptTemplate, MessagesPlaceholder } from '@langchain/core/prompts';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { JsonOutputKeyToolsParser } from 'langchain/output_parsers';
import { getPageContents } from './logseq';
import { getPluginSettings } from './setting';

const LANGSMITH_PROJECT_NAME = 'logseq-rag';
const CHUNK_SIZE = 1000;
const CHUNK_OVERLAP = 200;

let supabaseCilent: SupabaseClient | null = null;

class CitedAnswer extends StructuredTool {
    name = 'cited_answer';
    description = 'Answer the user question based only on the given sources, and cite the sources used.';
    schema = z.object({
        answer: z.string().describe(`The answer to the user question, which is based only on the given sources.`),
        citations: z.array(z.number()).describe('The integer IDs of the SPECIFIC sources which justify the answer.'),
    });
    constructor() {
        super();
    }
    _call(input: z.infer<(typeof this)['schema']>): Promise<string> {
        return Promise.resolve(JSON.stringify(input, null, 2));
    }
}

const citeTool = formatToOpenAITool(new CitedAnswer());

const contextualizeQSystemPrompt = `Given a chat history and the latest user question
which might reference context in the chat history, formulate a standalone question
which can be understood without the chat history. Do NOT answer the question,
just reformulate it if needed and otherwise return it as is.`;

const contextualizeQPrompt = ChatPromptTemplate.fromMessages([
    ['system', contextualizeQSystemPrompt],
    new MessagesPlaceholder('chat_history'),
    ['human', '{question}'],
]);

const systemPrompt = `You're a helpful AI assistant. Given a user question and contents with source ID in square brackets, answer the user question  base on provided contents with following rules:
1. Only answer with the contents provided. If none of the content answer the question, just say you don't know.
2. Use three sentences maximum and keep the answer as concise as possible.
3. Add source id in [id] format of which's contnet justify the sentence most after the period to each sentence in answer.

Here are the contents:
{context}`;

const prompt = ChatPromptTemplate.fromMessages([
    ['system', systemPrompt],
    new MessagesPlaceholder('chat_history'),
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

    const llmWithCiteTool = llm.bind({
        tools: [citeTool],
        tool_choice: citeTool,
    });
    const outputParser = new JsonOutputKeyToolsParser({
        keyName: 'cited_answer',
        returnSingle: true,
    });

    const ragChain = RunnableSequence.from([
        RunnablePassthrough.assign({
            docs: RunnableBranch.from([
                [
                    (input) => !input.chat_history || input.chat_history.length === 0,
                    RunnableSequence.from([(input) => input.question, retriever]),
                ],
                RunnableSequence.from([contextualizeQPrompt, llm, new StringOutputParser(), retriever]),
            ]),
        }),
        RunnablePassthrough.assign({
            context: (input: { docs: Array<Document> }) => {
                return formatContextWithId(input.docs);
            },
        }),
        RunnablePassthrough.assign({
            cited_answer: prompt.pipe(llmWithCiteTool).pipe(outputParser),
        }),
    ]);

    return ragChain;
}
