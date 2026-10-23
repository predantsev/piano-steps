# piano-steps transcriber — a separate service that talks to the app only through its HTTP API.
#   docker compose --profile transcriber build transcriber
#   docker compose run --rm transcriber youtube "https://www.youtube.com/watch?v=…"
FROM python:3.11-slim-bookworm

# uv from PyPI (pulling ghcr.io/astral-sh/uv needs registry auth on some machines)
RUN pip install --no-cache-dir uv==0.11.13 \
 && apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg libsndfile1 ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    UV_PROJECT_ENVIRONMENT=/opt/venv
# dependencies first (cached layer), then the project itself; uv's download cache stays in a
# BuildKit cache mount, not in the image
COPY pyproject.toml uv.lock .python-version README.md ./
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-dev --no-install-project
COPY src ./src
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-dev

ENV PATH=/opt/venv/bin:$PATH \
    TRANSCRIBE_WORK=/work \
    TRANSCRIBE_MODELS=/models \
    PIANO_STEPS_URL=http://app:9300
# model weights (ByteDance checkpoint, ~165 MB) and downloaded audio live in named volumes
VOLUME ["/models", "/work"]
ENTRYPOINT ["transcribe"]
CMD ["--help"]
