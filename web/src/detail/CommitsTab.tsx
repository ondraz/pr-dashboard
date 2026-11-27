import { External } from "../list/PrRows.tsx";
import { timeAgo } from "../logic/time.ts";
import { useOpenPr } from "./PrContext.tsx";
import { usePullRequestCommits } from "./usePullRequest.ts";

const DAY = new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric" });

/** The PR's commits, oldest first, by the day they were committed. */
export function CommitsTab() {
    const { route, detail } = useOpenPr();
    const { data, error } = usePullRequestCommits(route);
    if (error && !data) return <div className="error">{error.message}</div>;
    if (!data) {
        return (
            <div className="loading">
                <div className="spinner" />
                <div>Loading commits...</div>
            </div>
        );
    }
    if (!data.commits.length) return <div className="empty">No commits.</div>;

    const days: { day: string; commits: typeof data.commits }[] = [];
    for (const commit of data.commits) {
        const day = DAY.format(new Date(commit.committedDate));
        const last = days.at(-1);
        if (last?.day === day) last.commits.push(commit);
        else days.push({ day, commits: [commit] });
    }
    return (
        <div className="commits-tab">
            {days.map(({ day, commits }) => (
                <section key={`${day}-${commits[0]?.oid}`} className="commit-day">
                    <h2>Commits on {day}</h2>
                    <ul className="commit-rows">
                        {commits.map((commit) => {
                            const author = commit.author?.user?.login ?? commit.author?.name ?? "unknown";
                            return (
                                <li key={commit.oid} className="commit-row">
                                    <div className="commit-main">
                                        <span className="commit-headline">{commit.messageHeadline}</span>
                                        <span className="commit-meta">
                                            {author} committed {timeAgo(commit.committedDate)}
                                        </span>
                                    </div>
                                    <External className="sha" href={`${detail.pr.url}/commits/${commit.oid}`}>
                                        {commit.abbreviatedOid}
                                    </External>
                                </li>
                            );
                        })}
                    </ul>
                </section>
            ))}
            {data.commits.length < data.totalCount && (
                <div className="timeline-note">
                    Showing {data.commits.length} of {data.totalCount} commits;{" "}
                    <External href={`${detail.pr.url}/commits`}>the rest are on GitHub</External>.
                </div>
            )}
        </div>
    );
}
