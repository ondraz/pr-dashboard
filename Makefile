.PHONY: serve dev stop build codegen test e2e lint format

PORT ?= 6789
URL = http://localhost:$(PORT)/

node_modules/.package-lock.json: package.json package-lock.json
	npm ci

WEB_SOURCES = $(shell find web -type f -not -path 'web/dist/*') $(wildcard shared/*.ts) vite.config.ts

web/dist/index.html: node_modules/.package-lock.json $(WEB_SOURCES)
	npm run build

# build the React app into web/dist when its sources changed
build: web/dist/index.html

# build the app if needed and serve it on localhost (a real origin isolates the stored token from
# other local files, and the server also tells the page which Claude session made or reviewed each PR)
serve: build
	@ if lsof -ti tcp:$(PORT) -sTCP:LISTEN >/dev/null 2>&1; then \
		echo "Server already running on port $(PORT)"; \
	else \
		PORT=$(PORT) node server/main.ts >/dev/null 2>&1 & \
		echo "Server started on port $(PORT) (pid $$!)"; \
	fi
	@ open $(URL) 2>/dev/null || xdg-open $(URL) >/dev/null 2>&1 || echo "Open $(URL)"

# the same server with Vite as middleware, for hot reload, in the foreground
dev: node_modules/.package-lock.json
	PORT=$(PORT) node server/main.ts --dev

stop:
	@ if lsof -ti tcp:$(PORT) -sTCP:LISTEN >/dev/null 2>&1; then \
		kill $$(lsof -ti tcp:$(PORT) -sTCP:LISTEN) && echo "Server on port $(PORT) stopped"; \
	else \
		echo "No server running on port $(PORT)"; \
	fi

# regenerate the GraphQL types in web/src/github/gql from the queries in web/src/github
codegen: node_modules/.package-lock.json
	npm run codegen

# codegen, lint, type check, tests and build, as CI runs them
test: node_modules/.package-lock.json
	npm run codegen
	npm run lint
	npm run typecheck
	npm test
	npm run build

# the Playwright smoke test of the built app, served on port 6790 with GitHub's API answered inside the browser
e2e: build
	npm run e2e

lint: node_modules/.package-lock.json
	npm run lint

format: node_modules/.package-lock.json
	npm run format
