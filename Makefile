.PHONY: up down build process-heavy up-gpu up-gpu-nvidia up-watch

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

# Watch mode: keeps running for new files, with auto-restart on exit/crash
# (restart: unless-stopped). The default `up` is one-shot: it organizes,
# uploads and stops.
up-watch:
	$(ensure-writable)
	EXTRA_FLAGS="--watch $(FLAGS)" RESTART_POLICY=unless-stopped docker compose up

# GPU acceleration (VAAPI): Intel iGPU / AMD APU
up-gpu:
	$(ensure-writable)
	EXTRA_FLAGS="$(FLAGS)" docker compose -f docker-compose.yml -f docker-compose.gpu.yml up

# GPU acceleration (NVENC): NVIDIA GPU (requires nvidia-container-toolkit)
up-gpu-nvidia:
	$(ensure-writable)
	EXTRA_FLAGS="$(FLAGS)" docker compose -f docker-compose.yml -f docker-compose.gpu-nvidia.yml up

process-heavy:
	$(ensure-writable)
	EXTRA_FLAGS="--process-heavy" docker compose up

down:
	docker compose down

build:
	docker compose build
