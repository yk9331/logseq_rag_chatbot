import '@logseq/libs';
import { z } from 'zod';
import { StructuredTool } from '@langchain/core/tools';
import { formatToOpenAITool } from '@langchain/openai';
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
import { JsonOutputKeyToolsParser } from 'langchain/output_parsers';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { LangChainTracer } from '@langchain/core/tracers/tracer_langchain';
import { Client } from 'langsmith';

const createLangSmithCallback = (apiUrl: string, apiKey: string) =>
    new LangChainTracer({
        projectName: 'logseq-rag',
        client: new Client({ apiUrl, apiKey }),
    });
const CHUNK_SIZE = 1000;
const CHUNK_OVERLAP = 200;
class CitedAnswer extends StructuredTool {
    name = 'cited_answer';
    description = 'Answer the user question based only on the given sources, and cite the sources used.';
    schema = z.object({
        answer: z.string()
            .describe(`The answer with inline citation to the user question, which follow the following rules.
1. Only answer with the contents provided. If none of the content answer the question, just say you don't know.
2. Use three sentences maximum and keep the answer as concise as possible.
3. After every sentence you write, add one source id in square brackets which's contnet justify the sentence most.
        `),
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
const formatDocsWithId = (docs: Array<Document>): string => {
    return docs.map((doc: Document, idx: number) => `[${idx}]\n${doc.pageContent}`).join('\n\n');
};

const prompt = ChatPromptTemplate.fromMessages([
    [
        'system',
        "You're a helpful AI assistant. Given a user question and some contents with source id in square brackets, answer the user question, and cite the sources used. Here are the real contents:\n\n{context}",
    ],
    ['human', '{question}'],
]);

async function initSupabaseVectorstore(client?: SupabaseClient): Promise<SupabaseVectorStore> {
    const settings = getPluginSettings();
    const supabase =
        client !== undefined ? client : createClient(settings.supabaseProjectUrl!, settings.supabaseServiceKey!);

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
    const formatDocsWithId = (docs: Array<Document>): string => {
        return (
            '\n\n' +
            docs.map((doc: Document, idx: number) => `Source ID: ${idx}\nContent: ${doc.pageContent}`).join('\n\n')
        );
    };
    
    const llmWithCiteTool = llm.bind({
        tools: [citeTool],
        tool_choice: citeTool,
    });
    const outputParser = new JsonOutputKeyToolsParser({
        keyName: 'cited_answer',
        returnSingle: true,
    });
    const answerChain = prompt.pipe(llmWithCiteTool).pipe(outputParser);
    const ragMap = RunnableMap.from({
        question: new RunnablePassthrough(),
        docs: retriever,
    });

    const ragWithCiteChain = ragMap
        .assign({
            context: (input: { docs: Array<Document> }) => formatDocsWithId(input.docs),
        })
        .assign({ cited_answer: answerChain });
    // .pick(['question', 'docs', 'cited_answer', 'context']);

    return ragWithCiteChain;
}
