# Experiment only; never used by render.yaml or production deployment.
ARG PYTHON_BASE=python:3.12-slim-bookworm
FROM ${PYTHON_BASE}
ARG SOURCE_COMMIT
LABEL org.opencontainers.image.revision=${SOURCE_COMMIT}
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PYTHONPATH=/api:/harness AWS_EC2_METADATA_DISABLED=true
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg procps ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /api
COPY api/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY api/app ./app
COPY api/migrations ./migrations
COPY capacity /harness/capacity
RUN useradd --create-home --uid 10001 capacity
USER capacity
CMD ["python", "-m", "uvicorn", "capacity.app:app", "--host", "127.0.0.1", "--port", "18047"]
