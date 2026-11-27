import type { CodegenConfig } from "@graphql-codegen/cli";

// Every custom scalar of GitHub's schema arrives as a JSON string.
const STRING_SCALARS = [
    "Base64String",
    "BigInt",
    "Date",
    "DateTime",
    "GitObjectID",
    "GitRefname",
    "GitSSHRemote",
    "GitTimestamp",
    "HTML",
    "PreciseDateTime",
    "URI",
    "X509Certificate",
];

const config: CodegenConfig = {
    schema: "node_modules/@octokit/graphql-schema/schema.graphql",
    documents: ["web/src/github/**/*.ts", "!web/src/github/gql/**"],
    generates: {
        "web/src/github/gql/": {
            preset: "client",
            presetConfig: { fragmentMasking: false },
            config: {
                documentMode: "string",
                enumsAsTypes: true,
                useTypeImports: true,
                skipTypename: true,
                strictScalars: true,
                scalars: Object.fromEntries(STRING_SCALARS.map((name) => [name, "string"])),
            },
        },
    },
};

export default config;
