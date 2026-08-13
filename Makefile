.PHONY: serve stop

PORT ?= 6789

# serve the dashboard on localhost (a real origin isolates the stored token from other local files)
serve:
	@ if lsof -ti:$(PORT) >/dev/null 2>&1; then \
		echo "Server already running on port $(PORT)"; \
	else \
		python3 -m http.server $(PORT) --bind 127.0.0.1 -d . >/dev/null 2>&1 & \
		echo "Server started on port $(PORT) (pid $$!)"; \
	fi
	@ python3 -m webbrowser http://localhost:$(PORT)/


stop:
	@ if lsof -ti:$(PORT) >/dev/null 2>&1; then \
		kill $$(lsof -ti:$(PORT)) && echo "Server on port $(PORT) stopped"; \
	else \
		echo "No server running on port $(PORT)"; \
	fi
