import { BlockEntity, BlockUUIDTuple } from '@logseq/libs/dist/LSPlugin.user';

function isBlockEntity(b: BlockEntity | BlockUUIDTuple): b is BlockEntity {
    return (b as BlockEntity).uuid !== undefined;
}

async function getTreeContent(b: BlockEntity) {
    let content = '';
    const trimmedBlockContent = b.content.trim();
    if (trimmedBlockContent.length > 0) {
        content += trimmedBlockContent;
    }

    if (!b.children) {
        return content;
    }

    for (const child of b.children) {
        if (isBlockEntity(child)) {
            content += await getTreeContent(child);
        } else {
            const childBlock = await logseq.Editor.getBlock(child[1], {
                includeChildren: true,
            });
            if (childBlock) {
                content += await getTreeContent(childBlock);
            }
        }
    }
    return content;
}

async function getPageContent(uuid: string): Promise<any> {
    const blockContents = [];
    const ids = [];

    const page = await logseq.Editor.getPage(uuid);
    if (!page) {
        throw new Error('Page not found');
    }

    const pageBlocks = await logseq.Editor.getPageBlocksTree(page.name);
    for (const pageBlock of pageBlocks) {
        const blockContent = await getTreeContent(pageBlock);
        if (blockContent.length > 0) {
            blockContents.push(blockContent);
            ids.push(pageBlock.uuid);
        }
    }
    return { page, ids, blockContents };
}

async function getPageLinkedReferencesContent(uuid: string): Promise<any> {
    const pages = [];
    const refs = await logseq.Editor.getPageLinkedReferences(uuid);
    for (const ref of refs!) {
        if (ref[0]! && ref[0].name) {
            const page = await getPageContent(ref[0].name);
            pages.push(page);
        }
    }
    return pages;
}

export async function getPageContents(uuid: string, includeLinkedPages: boolean) {
    const pages = [];
    const page = await getPageContent(uuid);
    pages.push(page);
    if (includeLinkedPages) {
        const refs = await getPageLinkedReferencesContent(uuid);
        pages.push(...refs);
    }
    return pages;
}
