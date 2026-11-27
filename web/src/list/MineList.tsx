import type { MyPr } from "../github/dashboard.ts";
import type { FeatureKind } from "../logic/feature.ts";
import {
    type FeatureBlock,
    type FeatureSection,
    featureId,
    type ListLayout,
    type Row,
    type StackMember,
} from "../logic/layout.ts";
import type { Stack, StackName } from "../logic/stacks.ts";
import type { PrSessions } from "../sessions.ts";
import { useCollapse } from "./collapse.tsx";
import { BranchIcon, ChevronIcon, LinkIcon, RepoIcon } from "./icons.tsx";
import { ContextItem, External, type FeatureBadgeProps, PrItem, UnresolvedTotal } from "./PrRows.tsx";

export type Grouping = "repo" | "feature";

interface ListContext {
    grouping: Grouping;
    layout: ListLayout<MyPr>;
    sessions: PrSessions;
    now: number;
    onShowFeature: (key: string) => void;
}

const FEATURE_KIND_LABEL: Record<FeatureKind, string> = {
    declared: "declared with Part-of",
    ticket: "shared ticket",
    branch: "shared branch name",
};

const repoShort = (repo: string) => repo.split("/")[1] ?? repo;

function featureBadge(pr: MyPr, ctx: ListContext): FeatureBadgeProps | null {
    if (ctx.grouping !== "repo" || !pr.feature) return null;
    const repoCount = ctx.layout.featureSpan.get(pr.feature.key) ?? 0;
    if (repoCount < 2) return null;
    const { key, label } = pr.feature;
    return { label, repoCount, onShow: () => ctx.onShowFeature(key) };
}

function Pr({ pr, ctx }: { pr: MyPr; ctx: ListContext }) {
    return (
        <PrItem pr={pr} session={ctx.sessions.made.get(pr.html_url)} feature={featureBadge(pr, ctx)} now={ctx.now} />
    );
}

function StackLabel({ name }: { name: StackName | null }) {
    if (!name) return null;
    const title = name.declared
        ? `Named by a "Stack:" line in a PR description`
        : `Title of the bottom PR; add a "Stack: <name>" line to a PR description to name the stack`;
    return (
        <span className={`stack-name${name.declared ? "" : " stack-name-derived"}`} title={title}>
            {name.text}
        </span>
    );
}

function StackGroup({ stack, members, ctx }: { stack: Stack; members: StackMember<MyPr>[]; ctx: ListContext }) {
    // Keyed by the bottom PR, so a stack keeps its state in both the by-repo and the by-feature view.
    const { collapsed, headerProps } = useCollapse(`stack:${stack.ordered[0]?.repoFullName}#${stack.id}`);
    return (
        <div className={`stack-group${collapsed ? " collapsed" : ""}`}>
            <div className="stack-header collapse-header" {...headerProps}>
                <ChevronIcon />
                <BranchIcon />
                <span className="stack-label">Stack of {stack.size}</span>
                <StackLabel name={stack.name} />
                {stack.rootBaseRef && <span className="stack-onto">onto {stack.rootBaseRef}</span>}
            </div>
            {!collapsed && (
                <div className="stack-body">
                    {members.map((member) =>
                        member.kind === "pr" ? (
                            <Pr key={member.pr.number} pr={member.pr} ctx={ctx} />
                        ) : (
                            <ContextItem key={member.node.number} node={member.node} now={ctx.now} />
                        ),
                    )}
                </div>
            )}
        </div>
    );
}

function Rows({ rows, ctx }: { rows: Row<MyPr>[]; ctx: ListContext }) {
    return rows.map((row) =>
        row.kind === "pr" ? (
            <Pr key={`pr-${row.pr.number}`} pr={row.pr} ctx={ctx} />
        ) : (
            <StackGroup key={`stack-${row.stack.id}`} stack={row.stack} members={row.members} ctx={ctx} />
        ),
    );
}

function RepoGroup({ repo, rows, drawn, ctx }: { repo: string; rows: Row<MyPr>[]; drawn: MyPr[]; ctx: ListContext }) {
    const { collapsed, headerProps } = useCollapse(`repo:${repo}`);
    return (
        <div className={`repo-group${collapsed ? " collapsed" : ""}`}>
            <div className="repo-header collapse-header" {...headerProps}>
                <ChevronIcon />
                <RepoIcon />
                <span className="repo-name">
                    <External href={`https://github.com/${repo}`}>{repoShort(repo)}</External>
                </span>
                <UnresolvedTotal prs={drawn} />
                <span className="repo-pr-count">{drawn.length}</span>
            </div>
            {!collapsed && (
                <div className="group-body">
                    <Rows rows={rows} ctx={ctx} />
                </div>
            )}
        </div>
    );
}

function FeatureRepoSection({
    featureKey,
    section,
    ctx,
}: {
    featureKey: string;
    section: FeatureSection<MyPr>;
    ctx: ListContext;
}) {
    // Distinct from the by-repo key: collapsing one part of a cross-repo change should not collapse
    // that repository everywhere else.
    const { collapsed, headerProps } = useCollapse(`feature-repo:${featureKey}::${section.repo}`);
    return (
        <div className={`feature-repo-section${collapsed ? " collapsed" : ""}`}>
            <div className="feature-repo collapse-header" {...headerProps}>
                <ChevronIcon />
                <RepoIcon />
                <External href={`https://github.com/${section.repo}`}>{repoShort(section.repo)}</External>
                <UnresolvedTotal prs={section.drawn} />
                <span className="feature-repo-count">{section.drawn.length + section.context.length}</span>
            </div>
            {!collapsed && (
                <div className="group-body">
                    <Rows rows={section.rows} ctx={ctx} />
                    {section.context.map((node) => (
                        <ContextItem key={`context-${node.number}`} node={node} now={ctx.now} />
                    ))}
                </div>
            )}
        </div>
    );
}

function FeatureGroup({ block, ctx }: { block: FeatureBlock<MyPr>; ctx: ListContext }) {
    const { group } = block;
    const { collapsed, headerProps } = useCollapse(`feature:${group.key}`);
    return (
        <div className={`feature-group${collapsed ? " collapsed" : ""}`} id={featureId(group.key)}>
            <div className="feature-header collapse-header" {...headerProps}>
                <ChevronIcon />
                <LinkIcon />
                <span className="feature-key">{group.label}</span>
                <span className="feature-kind">{FEATURE_KIND_LABEL[group.kind]}</span>
                <UnresolvedTotal prs={block.drawn} />
                <span className="feature-count">
                    {block.sections.length} repos · {block.prCount} PRs
                </span>
            </div>
            {!collapsed && (
                <div className="group-body">
                    {block.sections.map((section) => (
                        <FeatureRepoSection key={section.repo} featureKey={group.key} section={section} ctx={ctx} />
                    ))}
                </div>
            )}
        </div>
    );
}

/** The viewer's own PRs, by repository, or with cross-repo changes first when grouped by feature. */
export function MineList(props: ListContext) {
    const { layout } = props;
    if (!layout.features.length && !layout.repos.length) {
        return <div className="empty">No pull requests found.</div>;
    }
    return (
        <>
            {layout.features.map((block) => (
                <FeatureGroup key={block.group.key} block={block} ctx={props} />
            ))}
            {layout.features.length > 0 && layout.repos.length > 0 && (
                <div className="section-label">Single-repo work</div>
            )}
            {layout.repos.map(({ repo, body }) => (
                <RepoGroup key={repo} repo={repo} rows={body.rows} drawn={body.drawn} ctx={props} />
            ))}
        </>
    );
}
