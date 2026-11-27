import type { ChangedFile, FileTreeNode } from "../logic/diff.ts";

const STATUS_MARK: Partial<Record<ChangedFile["status"], string>> = {
    added: "+",
    removed: "−",
    renamed: "→",
    copied: "→",
};

function Nodes({ nodes, onOpen }: { nodes: readonly FileTreeNode[]; onOpen: (file: ChangedFile) => void }) {
    return (
        <ul>
            {nodes.map((node) =>
                node.file ? (
                    <li key={`file:${node.path}`}>
                        <button
                            type="button"
                            className={`tree-file status-${node.file.status}`}
                            title={node.path}
                            onClick={() => node.file && onOpen(node.file)}
                        >
                            <span className="tree-mark" aria-hidden="true">
                                {STATUS_MARK[node.file.status] ?? "•"}
                            </span>
                            {node.name}
                        </button>
                    </li>
                ) : (
                    <li key={`dir:${node.path}`}>
                        <details open className="tree-dir">
                            <summary title={node.path}>{node.name}</summary>
                            <Nodes nodes={node.children} onOpen={onOpen} />
                        </details>
                    </li>
                ),
            )}
        </ul>
    );
}

/** The changed files by directory, each opening its diff; the filter narrows the tree and the diffs alike. */
export function FileTree({
    tree,
    filter,
    onFilter,
    onOpen,
}: {
    tree: readonly FileTreeNode[];
    filter: string;
    onFilter: (filter: string) => void;
    onOpen: (file: ChangedFile) => void;
}) {
    return (
        <nav className="file-tree" aria-label="Changed files">
            <input
                type="search"
                className="file-filter"
                placeholder="Filter changed files"
                aria-label="Filter changed files"
                value={filter}
                onChange={(event) => onFilter(event.target.value)}
            />
            {tree.length ? <Nodes nodes={tree} onOpen={onOpen} /> : <p className="muted">No file matches.</p>}
        </nav>
    );
}
