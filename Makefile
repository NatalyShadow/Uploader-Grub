.PHONY: up down build

MEDIA_DIR := $(shell grep -oP 'MEDIA_PATH=\K.*' .env 2>/dev/null)

define ensure-writable
	@if [ -z "$(MEDIA_DIR)" ]; then \
		echo "❌ MEDIA_PATH is not set in .env"; \
		echo "   Add: MEDIA_PATH=/path/to/your/content"; \
		exit 1; \
	fi
	@if [ -d "$(MEDIA_DIR)" ]; then \
		OWNER=$$(stat -c '%U' "$(MEDIA_DIR)" 2>/dev/null); \
		ME=$$(whoami); \
		if [ "$$OWNER" != "$$ME" ]; then \
			echo "❌ $(MEDIA_DIR) is owned by '$$OWNER' — run:"; \
			echo "   sudo chown -R $$ME:$$ME $(MEDIA_DIR)"; \
			exit 1; \
		fi; \
	fi
	@mkdir -p "$(MEDIA_DIR)"
endef

up:
	$(ensure-writable)
	EXTRA_FLAGS="$(FLAGS)" docker compose up

down:
	docker compose down

build:
	docker compose build
