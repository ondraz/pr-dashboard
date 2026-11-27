import { createContext, useContext } from "react";
import { type AccessTokenSource, createGitHubClient, type GitHubClient } from "../github/client.ts";
import { fetchSessions, type PrSessions } from "../sessions.ts";
import { type AuthApi, LocalAuthApi } from "./auth.ts";

/** What the page reaches outside the browser through; tests swap in their own. */
export interface Services {
    createClient: (token: string | AccessTokenSource) => GitHubClient;
    fetchSessions: () => Promise<PrSessions>;
    auth: AuthApi;
}

export const defaultServices: Services = {
    createClient: (token) => createGitHubClient({ token }),
    fetchSessions: () => fetchSessions(),
    auth: new LocalAuthApi(),
};

export const ServicesContext = createContext<Services>(defaultServices);

export function useServices(): Services {
    return useContext(ServicesContext);
}
