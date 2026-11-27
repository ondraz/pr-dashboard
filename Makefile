.PHONY: serve stop test lint format

PORT ?= 6789
URL = http://localhost:$(PORT)/

node_modules/.package-lock.json: package.json package-lock.json
	npm ci

# serve the dashboard on localhost (a real origin isolates the stored token from other local files,
# and the server also tells the page which Claude session made or reviewed each PR)
serve: node_modules/.package-lock.json
	@ if lsof -ti:$(PORT) >/dev/null 2>&1; then \
		echo "Server already running on port $(PORT)"; \
	else \
		PORT=$(PORT) node server/main.ts >/dev/null 2>&1 & \
		echo "Server started on port $(PORT) (pid $$!)"; \
	fi
	@ open $(URL) 2>/dev/null || xdg-open $(URL) >/dev/null 2>&1 || echo "Open $(URL)"

stop:
	@ if lsof -ti:$(PORT) >/dev/null 2>&1; then \
		kill $$(lsof -ti:$(PORT)) && echo "Server on port $(PORT) stopped"; \
	else \
		echo "No server running on port $(PORT)"; \
	fi

# lint, type check and tests, as CI runs them
test: node_modules/.package-lock.json
	npm run lint
	npm run typecheck
	npm test

lint: node_modules/.package-lock.json
	npm run lint

format: node_modules/.package-lock.json
	npm run format
