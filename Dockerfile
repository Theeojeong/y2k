FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PATH="/home/app/.local/bin:$PATH"

RUN useradd -m -u 10001 app
WORKDIR /app

# System deps (if needed for building wheels)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
  && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml README.md /app/
COPY y2kapp /app/y2kapp
COPY main.py /app/main.py

RUN pip install --upgrade pip && pip install . && pip install gunicorn

USER app

ENV APP_ENV=production \
    LOG_LEVEL=info \
    PORT=8000 \
    HOST=0.0.0.0

EXPOSE 8000

CMD ["gunicorn", "-k", "uvicorn.workers.UvicornWorker", "-w", "2", "-b", "0.0.0.0:8000", "y2kapp:app"]

