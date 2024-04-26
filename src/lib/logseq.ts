import { BlockEntity, BlockUUIDTuple, PageEntity } from '@logseq/libs/dist/LSPlugin.user';

interface BlockConetnt {
    uuid: string;
    content: string;
}

interface PageConetnt {
    page: PageEntity;
    ids: string[];
    blockContents: string[];
}

function isBlockEntity(b: BlockEntity | BlockUUIDTuple): b is BlockEntity {
    return (b as BlockEntity).uuid !== undefined;
}

async function getTreeContent(b: BlockEntity): Promise<BlockConetnt[]> {
    const content = [];
    const trimmedBlockContent = b.content.trim();
    if (trimmedBlockContent.length > 0) {
        content.push({ uuid: b.uuid, content: trimmedBlockContent });
    }

    if (!b.children) {
        return content;
    }

    for (const child of b.children) {
        if (isBlockEntity(child)) {
            const blocks = await getTreeContent(child);
            content.push(...blocks);
        } else {
            const childBlock = await logseq.Editor.getBlock(child[1], {
                includeChildren: true,
            });
            if (childBlock) {
                const blocks = await getTreeContent(childBlock);
                content.push(...blocks);
            }
        }
    }
    return content;
}

async function getPageContent(uuid: string): Promise<PageConetnt> {
    const blocks = [];
    const ids = [];

    const page = await logseq.Editor.getPage(uuid);
    if (!page) {
        throw new Error('Page not found');
    }

    const pageBlocks = await logseq.Editor.getPageBlocksTree(page.name);
    for (const pageBlock of pageBlocks) {
        const flattenBlocks = await getTreeContent(pageBlock);
        for (const block of flattenBlocks) {
            blocks.push(block.content);
            ids.push(block.uuid);
        }
    }
    return { page, ids, blockContents: blocks };
}

async function getPageLinkedReferencesContent(uuid: string): Promise<PageConetnt[]> {
    const pages = [];
    const refs = await logseq.Editor.getPageLinkedReferences(uuid);
    if (refs) {
        for (const ref of refs) {
            if (ref[0]! && ref[0].name) {
                const page = await getPageContent(ref[0].name);
                pages.push(page);
            }
        }
    }
    return pages;
}

export async function getPageContents(uuid: string, includeLinkedPages: boolean):Promise<PageConetnt[]> {
    const pages = [];
    const page = await getPageContent(uuid);
    pages.push(page);
    if (includeLinkedPages) {
        const refs = await getPageLinkedReferencesContent(uuid);
        pages.push(...refs);
    }
    return pages;
}
