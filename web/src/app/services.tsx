import { createContext, useContext } from "react";
import { createGitHubClient, type GitHubClient } from "../github/client.ts";
import { fetchSessions, type PrSessions } from "../sessions.ts";

/** What the page reaches outside the browser through; tests swap in their own. */
export interface Services {
    createClient: (token: string) => GitHubClient;
    fetchSessions: () => Promise<PrSessions>;
}

export const defaultServices: Services = {
    createClient: (token) => createGitHubClient({ token }),
    fetchSessions: () => fetchSessions(),
};

export const ServicesContext = createContext<Services>(defaultServices);

export function useServices(): Services {
    return useContext(ServicesContext);
}
